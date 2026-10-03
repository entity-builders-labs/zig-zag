import { calculateDistance } from '@shared/utils/distance.utils';

// Same tolerance ExperienceCatalogService.upsertGeoEntity uses to reconcile
// cross-provider identities for the same real place onto one GeoEntity —
// kept in sync deliberately, since this filter exists to catch the cases
// that reconciliation can't: candidates whose overlapping GeoEntity rows
// were already-persisted duplicates from *before* that fix existed, or from
// any other gap that lets the same real place end up under two ids. See that
// constant's own comment for why 150m, not a tighter point-scale radius —
// verified live with a real extended place (Caminito, La Boca).
const OVERLAP_RADIUS_METERS = 150;

export interface OverlapCandidateComponent {
  name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface OverlapCandidate {
  id: string;
  compositionOrderScore?: number;
  weightedPreferenceCoverage?: number;
  mustInclude?: boolean;
  components?: Array<{ geoEntity?: OverlapCandidateComponent | null }> | null;
}

export interface OverlapFilterResult<T extends OverlapCandidate> {
  kept: T[];
  excluded: Array<{
    id: string;
    reason: 'REDUNDANT_WITH_OTHER_CANDIDATE';
    overlapsWith: string;
  }>;
}

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function namesMatch(a: string, b: string): boolean {
  const normalizedA = normalize(a);
  const normalizedB = normalize(b);
  return (
    normalizedA === normalizedB ||
    normalizedA.includes(normalizedB) ||
    normalizedB.includes(normalizedA)
  );
}

function componentsOverlap(
  a: OverlapCandidateComponent,
  b: OverlapCandidateComponent,
): boolean {
  if (a.latitude == null || a.longitude == null) return false;
  if (b.latitude == null || b.longitude == null) return false;
  if (!a.name || !b.name || !namesMatch(a.name, b.name)) return false;
  const distanceKm = calculateDistance(
    { latitude: a.latitude, longitude: a.longitude },
    { latitude: b.latitude, longitude: b.longitude },
  );
  return distanceKm * 1000 <= OVERLAP_RADIUS_METERS;
}

/**
 * Two candidate Experiences that both reach the planner can genuinely
 * reference the *same real place* even when nothing links their records —
 * verified live: a standalone "Plaza Dorrego" POI Experience and a composite
 * "San Telmo Antique Fair..." Experience that separately resolved "Plaza
 * Dorrego" as one of its own components ended up as unrelated GeoEntity rows,
 * so the daily-planning solver had no signal they overlapped and booked the
 * traveler into the same real plaza twice on two different days.
 * ExperienceCatalogService.upsertGeoEntity now reconciles *newly resolved*
 * places to stop minting new duplicates, but it can't undo rows that already
 * existed before that fix (or close any other gap that produces one) — this
 * runs once per generation, directly on the geography the ranked pool
 * actually offers, so it catches the overlap regardless of how the
 * underlying records got that way.
 *
 * When two candidates share a component (by proximity + name, independent of
 * GeoEntity id), only one survives: prefer the one with more components (a
 * composite subsumes the plain POI it contains, not the other way around),
 * tie-broken by composition order, then by id for determinism.
 */
export function filterOverlappingExperienceCandidates<
  T extends OverlapCandidate,
>(candidates: T[]): OverlapFilterResult<T> {
  const componentsById = new Map<string, OverlapCandidateComponent[]>();
  for (const candidate of candidates) {
    componentsById.set(
      candidate.id,
      (candidate.components ?? [])
        .map((component) => component.geoEntity)
        .filter((geoEntity): geoEntity is OverlapCandidateComponent =>
          Boolean(geoEntity),
        ),
    );
  }

  const excludedIds = new Map<string, string>();
  const preferWinner = (a: T, b: T): T => {
    if (a.mustInclude === true && b.mustInclude !== true) return a;
    if (b.mustInclude === true && a.mustInclude !== true) return b;
    if (
      a.weightedPreferenceCoverage !== undefined ||
      b.weightedPreferenceCoverage !== undefined
    ) {
      const aCoverage = a.weightedPreferenceCoverage ?? -Infinity;
      const bCoverage = b.weightedPreferenceCoverage ?? -Infinity;
      if (aCoverage !== bCoverage) return aCoverage > bCoverage ? a : b;
    }
    const aComponentCount = componentsById.get(a.id)?.length ?? 0;
    const bComponentCount = componentsById.get(b.id)?.length ?? 0;
    if (aComponentCount !== bComponentCount) {
      return aComponentCount > bComponentCount ? a : b;
    }
    const aScore = a.compositionOrderScore ?? 0;
    const bScore = b.compositionOrderScore ?? 0;
    if (aScore !== bScore) return aScore > bScore ? a : b;
    return a.id < b.id ? a : b;
  };

  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i];
    if (excludedIds.has(a.id)) continue;
    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j];
      if (excludedIds.has(b.id)) continue;

      const aComponents = componentsById.get(a.id) ?? [];
      const bComponents = componentsById.get(b.id) ?? [];
      const overlaps = aComponents.some((componentA) =>
        bComponents.some((componentB) =>
          componentsOverlap(componentA, componentB),
        ),
      );
      if (!overlaps) continue;

      const winner = preferWinner(a, b);
      const loser = winner === a ? b : a;
      excludedIds.set(loser.id, winner.id);
      if (loser === a) break;
    }
  }

  return {
    kept: candidates.filter((candidate) => !excludedIds.has(candidate.id)),
    excluded: Array.from(excludedIds.entries()).map(([id, overlapsWith]) => ({
      id,
      reason: 'REDUNDANT_WITH_OTHER_CANDIDATE' as const,
      overlapsWith,
    })),
  };
}
