import { RankableCandidate, RankedCandidate } from './candidate-ranking.util';

const DEFAULT_MIN_RESERVED_PER_INTENT = 2;

/**
 * A plain top-N slice of the ranked pool can starve out a real candidate
 * for a format the user explicitly requested (e.g. `walk`/`route_like`/
 * `day_trip`) whenever plain single-place candidates numerically dominate
 * the pool — which they usually do, since Places acquisition only ever
 * produces single-PLACE Experiences. Reserve up to `minReservedPerIntent`
 * of the best-scoring real matches for every requested intent that has at
 * least one, before filling the rest of the window by pure score.
 *
 * Never fabricates a reservation: a requested intent with zero real matches
 * in `ranked` simply reserves nothing (that's CoverageAnalyzer/acquisition's
 * concern, not this function's). A candidate matching more than one
 * requested intent is reserved at most once.
 */
export function selectBoundedWindow<T extends RankableCandidate>(
  ranked: RankedCandidate<T & { original: any }>[],
  getIntents: (candidate: T & { original: any }) => string[] | undefined,
  requestedIntents: string[],
  windowSize: number,
  minReservedPerIntent = DEFAULT_MIN_RESERVED_PER_INTENT,
): RankedCandidate<T & { original: any }>[] {
  const uniqueIntents = Array.from(new Set(requestedIntents.filter(Boolean)));
  if (uniqueIntents.length === 0 || windowSize <= 0) {
    return ranked.slice(0, windowSize);
  }

  const reservedIds = new Set<string>();
  const reserved: RankedCandidate<T & { original: any }>[] = [];

  for (const intent of uniqueIntents) {
    const matches = ranked.filter(
      (item) =>
        !reservedIds.has(item.candidate.id) &&
        (getIntents(item.candidate) ?? []).includes(intent),
    );
    for (const match of matches.slice(0, minReservedPerIntent)) {
      reservedIds.add(match.candidate.id);
      reserved.push(match);
    }
  }

  const remainingSlots = Math.max(0, windowSize - reserved.length);
  const fill = ranked
    .filter((item) => !reservedIds.has(item.candidate.id))
    .slice(0, remainingSlots);

  return [...reserved, ...fill]
    .sort(
      (left, right) =>
        right.scoreBreakdown.totalScore - left.scoreBreakdown.totalScore,
    )
    .slice(0, windowSize);
}
