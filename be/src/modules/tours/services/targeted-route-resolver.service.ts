import {
  OsmPlacesService,
  OsmRouteObjectRejectionReason,
  OsmRouteSegment,
} from '@integrations/osm/services/osm-places.service';
import { GeographicScope } from '../interfaces/experience-resolution.interface';
import {
  DestinationCompatibility,
  evaluateDestinationCompatibility,
} from '../utils/destination-compatibility.policy';
import { boundingBoxToCenterRadius } from '../utils/geometry-search-area.util';
import {
  RouteRetrievalVariantKind,
  routeRetrievalQueryVariants,
} from '../utils/route-retrieval-name.util';
import {
  RouteCandidateCluster,
  clusterRouteSegments,
} from '../utils/route-segment-clustering.util';

/**
 * ROUTE candidate acquisition (Stage 3 production path):
 *
 *   route hint
 *     -> bounded retrieval-name variants (raw + one generic designator drop)
 *     -> targeted OSM query: highway ways with that EXACT name tag, around
 *        a circle covering the DESTINATION boundary
 *     -> structural filter at the OSM adapter (way + highway + linear +
 *        real geometry + real id)
 *     -> segment grouping (exact name + OSM topology, no distance merge)
 *     -> per-cluster destination compatibility (single destination policy)
 *     -> RESOLVED / AMBIGUOUS / NOT_FOUND / INCOMPATIBLE / UNAVAILABLE
 *
 * Acquisition only: a RESOLVED cluster is a typed fact for candidate
 * correlation and IdentityVerifier, never a verdict on its own. Scoped by
 * the destination, never a neighborhood anchor, never `map_to_area`.
 */

export interface TargetedRouteResolutionRequest {
  name: string;
  /** The request's DESTINATION scope (not the entity-resolution anchor). */
  destination: GeographicScope;
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
  compatibility: DestinationCompatibility;
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
  /** Real provider calls made (one per retrieval variant). */
  acquisitionQueryCount: number;
}

/**
 * The circle a destination-scoped acquisition covers: for an admin boundary,
 * its bbox center + a radius reaching the farthest bbox corner (the shared
 * `boundingBoxToCenterRadius` primitive); for a point-scale destination, the
 * destination's own point/radius. The Overpass query builder hard-caps it.
 */
function acquisitionCircle(destination: GeographicScope) {
  if (destination.kind === 'POINT_RADIUS') {
    return {
      latitude: destination.latitude,
      longitude: destination.longitude,
      radiusMeters: destination.radiusMeters,
    };
  }
  const circle = boundingBoxToCenterRadius(destination.boundary.geometry);
  return { ...circle, radiusMeters: Math.ceil(circle.radiusMeters) };
}

export class TargetedRouteResolverService {
  constructor(private readonly osmPlaces: OsmPlacesService) {}

  async resolve(
    request: TargetedRouteResolutionRequest,
  ): Promise<TargetedRouteResolutionResult> {
    const circle = acquisitionCircle(request.destination);
    const variants: RouteVariantAcquisition[] = [];
    const segmentsById = new Map<number, OsmRouteSegment>();

    for (const { variant, name } of routeRetrievalQueryVariants(request.name)) {
      const query = { name, ...circle };
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

    const base = { variants, acquisitionQueryCount: variants.length };
    // A failed variant could have held the real street: provider failure is
    // never reported as NOT_FOUND and never lets the other variant resolve.
    if (variants.some((v) => v.providerStatus === 'failed')) {
      return {
        ...base,
        status: 'UNAVAILABLE',
        reason: 'ACQUISITION_PROVIDER_FAILED',
        clusters: [],
        compatibleClusterCount: 0,
      };
    }

    const clusters: EvaluatedRouteCluster[] = clusterRouteSegments([
      ...segmentsById.values(),
    ]).map((cluster) => ({
      ...cluster,
      compatibility: evaluateDestinationCompatibility(
        { probePoints: cluster.segments.map((s) => s.probePoint) },
        request.destination,
      ),
    }));
    if (clusters.length === 0) {
      return {
        ...base,
        status: 'NOT_FOUND',
        reason: 'NO_ROUTE_OBJECT_ACQUIRED',
        clusters: [],
        compatibleClusterCount: 0,
      };
    }

    const compatible = clusters.filter(
      (c) => c.compatibility.verdict === 'COMPATIBLE',
    );
    const common = {
      ...base,
      clusters,
      compatibleClusterCount: compatible.length,
    };
    if (clusters.some((c) => c.compatibility.verdict === 'UNKNOWN')) {
      // An unverifiable cluster could be the real one: never pick a winner.
      return {
        ...common,
        status: 'AMBIGUOUS',
        reason: 'DESTINATION_COMPATIBILITY_UNKNOWN',
      };
    }
    if (compatible.length === 1) {
      return {
        ...common,
        status: 'RESOLVED',
        reason: 'SINGLE_COMPATIBLE_CLUSTER',
        resolved: compatible[0],
      };
    }
    if (compatible.length > 1) {
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
