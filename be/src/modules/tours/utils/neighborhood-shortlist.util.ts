import { OsmCandidate } from '@integrations/osm/services/osm-places.service';

export interface NeighborhoodScoringInput {
  candidate: OsmCandidate;
  /** True if this neighborhood already has a curated ActivityFamily. */
  hasExistingFamily: boolean;
  /** Validated catalog POIs whose coordinates fall inside this boundary. */
  catalogPoiCount: number;
  /** Sum of rating/review prominence for catalog POIs in this boundary. */
  catalogProminenceScore?: number;
  /** Mean of the strongest catalog-POI matches to the wizard interests. */
  interestSimilarity?: number | null;
  /** Optional bounded Overpass signal. null means unknown, never zero. */
  overpassPoiCount: number | null;
}

export interface CatalogActivityLocation {
  id?: string;
  latitude?: number | null;
  longitude?: number | null;
  kind?: string | null;
  rating?: number | null;
  ratingCount?: number | null;
}

const DEFAULT_SHORTLIST_SIZE = 6;

/**
 * A city can return dozens of real neighborhoods (Buenos Aires alone has
 * 48) — not all are worth exploring per generation. Existing-family
 * neighborhoods receive a reuse bonus, but do not automatically beat a
 * neighborhood containing several prominent, interest-relevant catalog
 * POIs. Catalog coverage, review-backed prominence and semantic similarity
 * are normalized across this destination and combined into one score. An
 * optional known Overpass count can add a small corroborating signal; an
 * unknown count is never coerced to zero. The final name/id comparison only
 * makes a true no-evidence tie stable, without launching a detailed POI
 * query for every raw neighborhood. See
 * docs/superpowers/specs/2026-08-21-activity-engine-design.md, "Area-scale
 * exploration".
 */
export function shortlistNeighborhoods(
  inputs: NeighborhoodScoringInput[],
  k: number = DEFAULT_SHORTLIST_SIZE,
): OsmCandidate[] {
  const maxCatalogCount = Math.max(
    0,
    ...inputs.map((input) => input.catalogPoiCount),
  );
  const maxProminence = Math.max(
    0,
    ...inputs.map((input) => input.catalogProminenceScore ?? 0),
  );
  const knownOverpassCounts = inputs
    .map((input) => input.overpassPoiCount)
    .filter((count): count is number => count !== null);
  const maxOverpassCount = Math.max(0, ...knownOverpassCounts);

  const normalized = (value: number, maximum: number): number =>
    maximum > 0 ? value / maximum : 0;
  const score = (input: NeighborhoodScoringInput): number =>
    (input.hasExistingFamily ? 0.25 : 0) +
    normalized(input.catalogPoiCount, maxCatalogCount) * 0.15 +
    normalized(input.catalogProminenceScore ?? 0, maxProminence) * 0.35 +
    Math.max(0, Math.min(1, input.interestSimilarity ?? 0)) * 0.25 +
    (input.overpassPoiCount === null
      ? 0
      : 0.01 + normalized(input.overpassPoiCount, maxOverpassCount) * 0.09);

  return [...inputs]
    .sort((a, b) => {
      const scoreDifference = score(b) - score(a);
      if (Math.abs(scoreDifference) > Number.EPSILON) return scoreDifference;
      return (
        a.candidate.name.localeCompare(b.candidate.name) ||
        a.candidate.id.localeCompare(b.candidate.id)
      );
    })
    .slice(0, k)
    .map((input) => input.candidate);
}

export function countCatalogActivitiesWithinNeighborhood(
  neighborhood: OsmCandidate,
  activities: CatalogActivityLocation[],
): number {
  return catalogActivitiesWithinNeighborhood(neighborhood, activities).length;
}

export function buildNeighborhoodCatalogSignals(
  neighborhood: OsmCandidate,
  activities: CatalogActivityLocation[],
  similarityByActivityId: Map<string, number> | null,
): Pick<
  NeighborhoodScoringInput,
  'catalogPoiCount' | 'catalogProminenceScore' | 'interestSimilarity'
> {
  const contained = catalogActivitiesWithinNeighborhood(
    neighborhood,
    activities,
  );
  const prominence = contained.reduce(
    (sum, activity) => sum + catalogActivityProminence(activity),
    0,
  );
  const strongestSimilarities =
    similarityByActivityId === null
      ? []
      : contained
          .map((activity) =>
            activity.id ? similarityByActivityId.get(activity.id) : undefined,
          )
          .filter((value): value is number => value !== undefined)
          .sort((a, b) => b - a)
          .slice(0, 3);

  return {
    catalogPoiCount: contained.length,
    catalogProminenceScore: prominence,
    interestSimilarity:
      similarityByActivityId === null
        ? null
        : strongestSimilarities.length > 0
          ? strongestSimilarities.reduce((sum, value) => sum + value, 0) /
            strongestSimilarities.length
          : 0,
  };
}

function catalogActivitiesWithinNeighborhood(
  neighborhood: OsmCandidate,
  activities: CatalogActivityLocation[],
): CatalogActivityLocation[] {
  return activities.filter((activity) => {
    // Composite variants are represented separately by hasExistingFamily;
    // counting their centroid again would double-reward the same evidence.
    if (activity.kind && activity.kind !== 'POI') return false;
    if (activity.latitude == null || activity.longitude == null) return false;
    return geometryContainsPoint(
      neighborhood.geometry,
      activity.longitude,
      activity.latitude,
    );
  });
}

function catalogActivityProminence(activity: CatalogActivityLocation): number {
  const rating = Math.max(0, Math.min(5, activity.rating ?? 0)) / 5;
  const reviewCount = Math.max(0, activity.ratingCount ?? 0);
  // Review confidence grows logarithmically and saturates at 10k reviews:
  // one famous landmark should matter, without completely overwhelming all
  // other local evidence in a dense neighborhood.
  const reviewConfidence = Math.min(1, Math.log10(reviewCount + 1) / 4);
  return rating * reviewConfidence;
}

export function geometryContainsPoint(
  geometry: OsmCandidate['geometry'],
  longitude: number,
  latitude: number,
): boolean {
  if (geometry.type === 'Polygon') {
    return polygonContainsPoint(geometry.coordinates, longitude, latitude);
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygon) =>
      polygonContainsPoint(polygon, longitude, latitude),
    );
  }
  return false;
}

function polygonContainsPoint(
  rings: number[][][],
  longitude: number,
  latitude: number,
): boolean {
  if (!rings[0] || !ringContainsPoint(rings[0], longitude, latitude)) {
    return false;
  }
  return !rings
    .slice(1)
    .some((hole) => ringContainsPoint(hole, longitude, latitude));
}

function ringContainsPoint(
  ring: number[][],
  longitude: number,
  latitude: number,
): boolean {
  let inside = false;
  for (
    let current = 0, previous = ring.length - 1;
    current < ring.length;
    previous = current++
  ) {
    const [currentLongitude, currentLatitude] = ring[current];
    const [previousLongitude, previousLatitude] = ring[previous];
    const crossesLatitude =
      currentLatitude > latitude !== previousLatitude > latitude;
    const intersectionLongitude =
      ((previousLongitude - currentLongitude) * (latitude - currentLatitude)) /
        (previousLatitude - currentLatitude) +
      currentLongitude;
    if (crossesLatitude && longitude < intersectionLongitude) inside = !inside;
  }
  return inside;
}
