import {
  TargetKnowledge,
  TargetObservation,
} from '../preferences/target-knowledge.interface';

/**
 * The single provider-neutral reconciliation policy over
 * `GeoEntity + SemanticTarget` (task 25.7, owner 2026-10-16):
 *
 * - no observations                 -> UNKNOWN { NO_EVIDENCE }
 * - all SATISFIES                   -> SATISFIES
 * - all DOES_NOT_SATISFY            -> DOES_NOT_SATISFY
 * - SATISFIES + DOES_NOT_SATISFY    -> UNKNOWN { CONFLICTING_EVIDENCE }
 * - any inconclusive observation    -> UNKNOWN { INCONCLUSIVE_EVIDENCE }
 *
 * There is no provider/source precedence: the input is already the effective
 * observation set (one per stable source-fact identity).
 */
export function reconcileTargetKnowledge(
  observations: readonly TargetObservation[],
): TargetKnowledge {
  if (observations.length === 0) {
    return { state: 'UNKNOWN', reason: 'NO_EVIDENCE' };
  }
  if (
    observations.some((observation) => observation.state === 'INCONCLUSIVE')
  ) {
    return { state: 'UNKNOWN', reason: 'INCONCLUSIVE_EVIDENCE' };
  }
  const hasSatisfies = observations.some(
    (observation) => observation.state === 'SATISFIES',
  );
  const hasDoesNotSatisfy = observations.some(
    (observation) => observation.state === 'DOES_NOT_SATISFY',
  );
  if (hasSatisfies && hasDoesNotSatisfy) {
    return { state: 'UNKNOWN', reason: 'CONFLICTING_EVIDENCE' };
  }
  if (hasSatisfies) {
    return { state: 'SATISFIES' };
  }
  return { state: 'DOES_NOT_SATISFY' };
}
