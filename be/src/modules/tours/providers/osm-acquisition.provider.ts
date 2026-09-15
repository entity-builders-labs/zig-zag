import { Injectable, Logger } from '@nestjs/common';
import {
  OsmCandidate,
  OsmPlacesService,
} from '@integrations/osm/services/osm-places.service';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import {
  AcquisitionProviderResult,
  SourceEvidenceType,
  SourceObservation,
  SourceObservationGeo,
} from '../interfaces/experience-acquisition.interface';
import { AcquisitionEvidenceRequirement } from '../interfaces/acquisition-evidence-requirement.interface';
import { ExperienceDiscoveryScope } from '../interfaces/experience-discovery.interface';
import {
  OSM_ACQUISITION_CONCEPTS,
  resolveOsmConcepts,
} from '../constants/osm-acquisition-concepts';

export interface OsmAcquireOptions {
  concepts?: string[];
}

// Discovery radius used when the plan's destination scope carries no radius
// of its own. OsmPlacesService.lookupFeaturesNear still caps this.
const DEFAULT_DISCOVERY_RADIUS_METERS = 5000;
type OsmEvidenceType = Extract<SourceEvidenceType, 'place' | 'area' | 'route'>;

/**
 * Proactive OSM acquisition: given a `SourcePlan.osm.concepts` list, resolves
 * it through the explicit `osm-acquisition-concepts` registry into safe,
 * structured Overpass selectors, runs ONE bounded feature-discovery query via
 * the existing OSM stack, and maps the results into provider-neutral
 * `SourceObservation[]`.
 *
 * Strictly non-persistent: never touches Prisma / GeoEntity / Experience.
 * Strictly mechanical: matched concepts are recorded for trace only and are
 * NEVER used to infer themes/traits/intents/facets. Downstream synthesis and
 * corroboration are shared with Wikivoyage and Google Places.
 */
@Injectable()
export class OsmAcquisitionProvider {
  private readonly logger = new Logger(OsmAcquisitionProvider.name);

  constructor(private readonly osmPlaces: OsmPlacesService) {}

  async acquire(
    destination: ExperienceDiscoveryScope,
    options?: OsmAcquireOptions,
  ): Promise<AcquisitionProviderResult<SourceObservation>> {
    const { requested, selectors, supported, unsupported } = resolveOsmConcepts(
      options?.concepts ?? [],
    );

    if (unsupported.length > 0) {
      this.logger.debug(
        `OSM acquisition skipping unsupported concept(s): ${unsupported.join(', ')}`,
      );
    }

    const lat = destination?.latitude;
    const lng = destination?.longitude;
    const hasCoordinates =
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      (lat as number) >= -90 &&
      (lat as number) <= 90 &&
      (lng as number) >= -180 &&
      (lng as number) <= 180;

    const radiusRequestedMeters =
      destination?.radiusMeters ?? DEFAULT_DISCOVERY_RADIUS_METERS;

    const baseProvenance = {
      provider: 'osm' as const,
      requestedConcepts: requested,
      supportedConcepts: supported,
      unsupportedConcepts: unsupported,
      radiusRequestedMeters,
    };

    // Nothing to query: no usable coordinates, or every requested concept is
    // unsupported. A clean empty success, not a failure — Overpass is not called.
    if (!hasCoordinates || selectors.length === 0) {
      return {
        status: 'success',
        value: [],
        provenance: {
          ...baseProvenance,
          rawResultCount: 0,
          candidateCount: 0,
          observationCount: 0,
          dedupedCount: 0,
          evidenceKeys: [],
        },
      };
    }

    const lookup = await this.osmPlaces.lookupFeaturesNear(
      lat as number,
      lng as number,
      radiusRequestedMeters,
      selectors,
    );

    if (lookup.status === 'failed') {
      return {
        status: 'failed',
        value: [],
        failureReason: lookup.failureReason ?? 'Overpass query failed',
        provenance: {
          ...baseProvenance,
          rawResultCount: lookup.rawResultCount,
          candidateCount: 0,
          observationCount: 0,
          dedupedCount: 0,
          evidenceKeys: [],
        },
      };
    }

    const candidateCount = lookup.value.length;
    // dedupedCount counts candidates whose `osm:${type}:${id}` was already
    // emitted this pass (the same real OSM element returned more than once by
    // the union query). It deliberately does NOT count candidates dropped for
    // matching zero requested concepts — `candidateCount - observationCount`
    // includes those; `dedupedCount` isolates only the duplicate-element
    // collapses so the metric stays deterministic and unambiguous.
    let dedupedCount = 0;
    const byExternalId = new Map<string, SourceObservation>();
    for (const candidate of lookup.value) {
      const matchedConcepts = this.matchConcepts(candidate, supported);
      if (matchedConcepts.length === 0) continue;

      const existing = byExternalId.get(candidate.id);
      if (existing) {
        dedupedCount += 1;
        existing.metadata!.matchedConcepts = uniqueSorted([
          ...(existing.metadata!.matchedConcepts as string[]),
          ...matchedConcepts,
        ]);
        continue;
      }

      const evidenceType = this.classify(candidate, matchedConcepts);
      byExternalId.set(candidate.id, {
        provider: 'osm',
        externalId: candidate.id,
        evidenceKey: candidate.id,
        title: candidate.name,
        description: candidate.tags.description || undefined,
        geo: centroidOfGeometry(candidate.geometry),
        evidenceType,
        metadata: {
          osmType: candidate.osmType,
          osmTags: candidate.tags,
          matchedConcepts: uniqueSorted(matchedConcepts),
          // Task B1 -- preserved when the candidate carries it; never
          // fabricated here (OsmPlacesService remains the only place that
          // may ever populate it).
          narrativeContext: candidate.narrativeContext || undefined,
        },
        originationCapabilities: this.originationCapabilitiesFor(
          candidate,
          evidenceType,
        ),
      });
    }

    // Deterministic output: identical semantic OSM elements in any Overpass
    // response order must yield a deep-equal, identically-ordered result.
    const observations = [...byExternalId.values()].sort((a, b) =>
      a.evidenceKey.localeCompare(b.evidenceKey),
    );

    return {
      status: 'success',
      value: observations,
      provenance: {
        ...baseProvenance,
        rawResultCount: lookup.rawResultCount,
        candidateCount,
        observationCount: observations.length,
        dedupedCount,
        evidenceKeys: observations.map((obs) => obs.evidenceKey),
      },
    };
  }

  private originationCapabilitiesFor(
    candidate: OsmCandidate,
    evidenceType: 'place' | 'area' | 'route',
  ): AcquisitionEvidenceRequirement[] {
    if (evidenceType === 'place') {
      return ['GENERAL_TOURISM_EXPERIENCE', 'SINGLE_PLACE'];
    }
    if (evidenceType === 'area') return [];
    if (
      candidate.osmType === 'relation' &&
      typeof candidate.tags.route === 'string' &&
      candidate.tags.route.trim().length > 0
    ) {
      return ['GENERAL_TOURISM_EXPERIENCE', 'CANONICAL_ROUTE'];
    }
    return [];
  }

  /** Requested concepts whose registry selectors actually match this element. */
  private matchConcepts(
    candidate: OsmCandidate,
    supportedConcepts: string[],
  ): string[] {
    return supportedConcepts.filter((concept) =>
      OSM_ACQUISITION_CONCEPTS[concept]?.selectors.some((selector) => {
        const elementTypesOk =
          !selector.elementTypes ||
          selector.elementTypes.length === 0 ||
          selector.elementTypes.includes(candidate.osmType);
        if (!elementTypesOk) return false;
        if (selector.value === undefined) {
          return candidate.tags[selector.key] !== undefined;
        }
        return candidate.tags[selector.key] === selector.value;
      }),
    );
  }

  /**
   * Domain `evidenceType` from selector semantics, never from OSM element
   * type alone: `route` if any matched concept is route-like; else `area`
   * only when a matched concept is area-like AND the element is a way/relation
   * (a bare node can't defensibly be an AREA); else `place`.
   */
  private classify(
    candidate: OsmCandidate,
    matchedConcepts: string[],
  ): OsmEvidenceType {
    const evidenceTypes = new Set(
      matchedConcepts
        .map((concept) => OSM_ACQUISITION_CONCEPTS[concept]?.evidenceType)
        .filter((value): value is 'place' | 'area' | 'route' => !!value),
    );
    if (evidenceTypes.has('route')) return 'route';
    if (evidenceTypes.has('area') && candidate.osmType !== 'node')
      return 'area';
    return 'place';
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function centroidOfGeometry(
  geometry: GeoJsonGeometry | undefined,
): SourceObservationGeo | undefined {
  if (!geometry) return undefined;
  const points: Array<[number, number]> = [];
  collectPositions(geometry.coordinates as unknown, points);
  if (points.length === 0) return undefined;
  const sum = points.reduce(
    (acc, [lon, lat]) => [acc[0] + lon, acc[1] + lat],
    [0, 0],
  );
  const longitude = sum[0] / points.length;
  const latitude = sum[1] / points.length;
  // Only emit geo we can actually vouch for — no clamping, no invented point.
  // A malformed geometry (NaN/Infinity coords, out-of-range degrees) yields
  // `geo: undefined`; the observation's identity/title still survive.
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return undefined;
  }
  return { latitude, longitude };
}

function collectPositions(value: unknown, out: Array<[number, number]>): void {
  if (!Array.isArray(value)) return;
  if (
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  ) {
    out.push([value[0], value[1]]);
    return;
  }
  for (const item of value) collectPositions(item, out);
}
