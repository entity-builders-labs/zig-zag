/**
 * Reservoir-promotion no-degradation rule (owner, task 25.2): a promotion
 * may improve capacity, but must Pareto-preserve the preference quality of
 * every previously occupied rank position.
 *
 * Both arguments are the scheduled preference ranks of a solution (lower is
 * better). For every position k of the current solution, the trial's k-th
 * best rank must be equal or better. Extra trial positions are allowed. No
 * sum, average, weighting or compensation between positions.
 */
export function preservesRankPositions(
  trialRanks: readonly number[],
  currentRanks: readonly number[],
): boolean {
  const trial = [...trialRanks].sort((a, b) => a - b);
  const current = [...currentRanks].sort((a, b) => a - b);
  return (
    trial.length >= current.length &&
    current.every((rank, index) => trial[index] <= rank)
  );
}
