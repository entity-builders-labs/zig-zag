import { Injectable } from '@nestjs/common';
import {
  OsmPlacesService,
  OsmRouteObjectRejectionReason,
  OsmRouteSegment,
} from '@integrations/osm/services/osm-places.service';
import { Coordinates } from '@shared/utils/distance.utils';
import {
  DestinationAdminCompatibilityService,
  DestinationAdminContext,
  DestinationCompatibilityResult,
} from './destination-admin-compatibility.service';
import {
  RouteRetrievalVariantKind,
  routeRetrievalQueryVariants,
} from '../utils/route-retrieval-name.util';
import {
  RouteCandidateCluster,
  clusterRouteSegments,
} from '../utils/route-segment-clustering.util';

/**
 * Stage 3 ROUTE characterization spike -- NOT wired into production.
 *
 *   route hint
 *     -> bounded retrieval-name variants (raw + one generic designator drop)
 *     -> targeted OSM query: highway ways with that exact name tag,
 *        within a radius covering the DESTINATION
 *     -> structural filter at the OSM adapter (way + highway + linear +
 *        real geometry + real id)
 *     -> segment grouping (exact name + OSM topology)
 *     -> per-cluster destination admin compatibility (never distance)
 *     -> RESOLVED / AMBIGUOUS / NOT_FOUND / INCOMPATIBLE / UNAVAILABLE
 *
 * Replaces, for ROUTE only, the Nominatim bare-name search whose hard top-N
 * window never contained the destination's own street for common names.
 * Acquisition is scoped by the destination, never by a neighborhood anchor
 * and never through `map_to_area`.
 */

export interface TargetedRouteDestination extends DestinationAdminContext {
  point: Coordinates;
  /** Radius (m) around `point` that covers the destination's own extent. */
  acquisitionRadiusMeters: number;
}

export interface TargetedRouteResolutionRequest {
  name: string;
  destination: TargetedRouteDestination;
  /** Segment-grouping knob; default 0 = pure OSM topology. */
  continuityGapMeters?: number;
}

export interface RouteVariantAcquisition {
  variant: RouteRetrievalVariantKind;
  name: string;
  query: {
    name: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
  };
  providerStatus: 'success' | 'failed';
  failureReason?: string;
  rawCount: number;
  acceptedCount: number;
  accepted: Array<Pick<OsmRouteSegment, 'externalId' | 'name' | 'highway'>>;
  rejected: Array<{
    externalId: string;
    reason: OsmRouteObjectRejectionReason;
  }>;
}

export interface EvaluatedRouteCluster extends RouteCandidateCluster {
  compatibility: DestinationCompatibilityResult;
  /** Segment probes actually sent to the admin lookup for this cluster. */
  probedSegmentIds: string[];
}

export type TargetedRouteStatus =
  | 'RESOLVED'
  | 'AMBIGUOUS'
  | 'NOT_FOUND'
  | 'INCOMPATIBLE'
  | 'UNAVAILABLE';

export type TargetedRouteReason =
  | 'SINGLE_COMPATIBLE_CLUSTER'
  | 'MULTIPLE_COMPATIBLE_CLUSTERS'
  | 'DESTINATION_COMPATIBILITY_UNKNOWN'
  | 'NO_ROUTE_OBJECT_ACQUIRED'
  | 'ALL_CLUSTERS_OUTSIDE_DESTINATION'
  | 'ACQUISITION_PROVIDER_FAILED';

export interface TargetedRouteResolutionResult {
  status: TargetedRouteStatus;
  reason: TargetedRouteReason;
  variants: RouteVariantAcquisition[];
  clusters: EvaluatedRouteCluster[];
  compatibleClusterCount: number;
  resolved?: EvaluatedRouteCluster;
  /** Provider cost facts for the assessment (no hidden calls). */
  acquisitionQueryCount: number;
  adminLookupCount: number;
}

@Injectable()
export class TargetedRouteResolverService {
  constructor(
    private readonly osmPlaces: OsmPlacesService,
    private readonly compatibility: DestinationAdminCompatibilityService,
  ) {}

  async resolve(
    request: TargetedRouteResolutionRequest,
  ): Promise<TargetedRouteResolutionResult> {
    const { destination } = request;
    const variants: RouteVariantAcquisition[] = [];
    const segmentsById = new Map<number, OsmRouteSegment>();

    for (const { variant, name } of routeRetrievalQueryVariants(request.name)) {
      const query = {
        name,
        latitude: destination.point.latitude,
        longitude: destination.point.longitude,
        radiusMeters: destination.acquisitionRadiusMeters,
      };
      const lookup = await this.osmPlaces.lookupHighwaysByName(query);
      variants.push({
        variant,
        name,
        query,
        providerStatus: lookup.status,
        ...(lookup.failureReason
          ? { failureReason: lookup.failureReason }
          : {}),
        rawCount: lookup.value.rawCount,
        acceptedCount: lookup.value.segments.length,
        accepted: lookup.value.segments.map(
          ({ externalId, name: segmentName, highway }) => ({
            externalId,
            name: segmentName,
            highway,
          }),
        ),
        rejected: lookup.value.rejected,
      });
      for (const segment of lookup.value.segments) {
        segmentsById.set(segment.osmId, segment);
      }
    }

    const acquisitionQueryCount = variants.length;
    // A failed variant could have held the real street: provider failure is
    // never reported as NOT_FOUND and never lets the other variant resolve.
    if (variants.some((v) => v.providerStatus === 'failed')) {
      return {
        status: 'UNAVAILABLE',
        reason: 'ACQUISITION_PROVIDER_FAILED',
        variants,
        clusters: [],
        compatibleClusterCount: 0,
        acquisitionQueryCount,
        adminLookupCount: 0,
      };
    }

    const clusters = clusterRouteSegments([...segmentsById.values()], {
      continuityGapMeters: request.continuityGapMeters,
    });
    if (clusters.length === 0) {
      return {
        status: 'NOT_FOUND',
        reason: 'NO_ROUTE_OBJECT_ACQUIRED',
        variants,
        clusters: [],
        compatibleClusterCount: 0,
        acquisitionQueryCount,
        adminLookupCount: 0,
      };
    }

    let adminLookupCount = 0;
    const evaluated: EvaluatedRouteCluster[] = [];
    for (const cluster of clusters) {
      // Deterministic probe order (segment id). A cluster is compatible as
      // soon as ANY of its segments lies inside the destination admin unit
      // (a real street may continue past the city limit); it is
      // INCOMPATIBLE only when every segment was checked and none is.
      let compatible: DestinationCompatibilityResult | undefined;
      let firstUnknown: DestinationCompatibilityResult | undefined;
      let firstIncompatible: DestinationCompatibilityResult | undefined;
      const probedSegmentIds: string[] = [];
      for (const segment of cluster.segments) {
        adminLookupCount += 1;
        probedSegmentIds.push(segment.externalId);
        const verdict = await this.compatibility.evaluate(
          segment.probePoint,
          destination,
        );
        if (verdict.verdict === 'COMPATIBLE') {
          compatible = verdict;
          break;
        }
        if (verdict.verdict === 'UNKNOWN') firstUnknown ??= verdict;
        else firstIncompatible ??= verdict;
      }
      evaluated.push({
        ...cluster,
        // Every cluster has >= 1 segment, so one of the three is set.
        compatibility: (compatible ?? firstUnknown ?? firstIncompatible)!,
        probedSegmentIds,
      });
    }

    const compatibleClusters = evaluated.filter(
      (c) => c.compatibility.verdict === 'COMPATIBLE',
    );
    const common = {
      variants,
      clusters: evaluated,
      compatibleClusterCount: compatibleClusters.length,
      acquisitionQueryCount,
      adminLookupCount,
    };

    if (evaluated.some((c) => c.compatibility.verdict === 'UNKNOWN')) {
      // An unverifiable cluster could be the real one: never pick a winner.
      return {
        ...common,
        status: 'AMBIGUOUS',
        reason: 'DESTINATION_COMPATIBILITY_UNKNOWN',
      };
    }
    if (compatibleClusters.length === 1) {
      return {
        ...common,
        status: 'RESOLVED',
        reason: 'SINGLE_COMPATIBLE_CLUSTER',
        resolved: compatibleClusters[0],
      };
    }
    if (compatibleClusters.length > 1) {
      return {
        ...common,
        status: 'AMBIGUOUS',
        reason: 'MULTIPLE_COMPATIBLE_CLUSTERS',
      };
    }
    return {
      ...common,
      status: 'INCOMPATIBLE',
      reason: 'ALL_CLUSTERS_OUTSIDE_DESTINATION',
    };
  }
}
