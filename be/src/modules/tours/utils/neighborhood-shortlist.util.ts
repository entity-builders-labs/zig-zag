import { OsmCandidate } from '@integrations/osm/services/osm-places.service';

export interface NeighborhoodScoringInput {
  candidate: OsmCandidate;
  /** True if this neighborhood already has a curated ActivityFamily. */
  hasExistingFamily: boolean;
  /** Cheap proxy for "this is a real, interesting area" — see spec §2. */
  poiCount: number;
}

const DEFAULT_SHORTLIST_SIZE = 6;

/**
 * A city can return dozens of real neighborhoods (Buenos Aires alone has
 * 48) — not all are worth exploring per generation. Existing-family
 * neighborhoods come first (near-zero marginal cost, reuses trusted
 * content), then POI density as a tie-breaker. See
 * docs/superpowers/specs/2026-08-21-activity-engine-design.md, "Area-scale
 * exploration".
 */
export function shortlistNeighborhoods(
  inputs: NeighborhoodScoringInput[],
  k: number = DEFAULT_SHORTLIST_SIZE,
): OsmCandidate[] {
  return [...inputs]
    .sort((a, b) => {
      if (a.hasExistingFamily !== b.hasExistingFamily) {
        return a.hasExistingFamily ? -1 : 1;
      }
      return b.poiCount - a.poiCount;
    })
    .slice(0, k)
    .map((input) => input.candidate);
}
