import {
  TargetCompatibility,
  TargetObservation,
} from '../preferences/target-knowledge.interface';
import { reconcileTargetKnowledge } from './target-knowledge-reconciliation.util';
import { hardTargetCompatibility } from './target-composite-aggregation.util';

/**
 * Persistence supersession (task 25.7, owner 2026-10-16): a re-observation
 * replaces only the prior observation of the same stable source-fact
 * identity; independent sources are never last-write-wins.
 */
export function applyObservation(
  existing: readonly TargetObservation[],
  incoming: TargetObservation,
): TargetObservation[] {
  return [
    ...existing.filter(
      (observation) => observation.sourceFactId !== incoming.sourceFactId,
    ),
    incoming,
  ];
}

/**
 * Catalog projection: reconcile each required component's observations for a
 * target, then aggregate to the candidate's compatibility. A component with
 * no observations reconciles to UNKNOWN { NO_EVIDENCE } (never negative
 * evidence).
 */
export function candidateTargetCompatibility(
  polarity: 'INCLUDE' | 'EXCLUDE',
  componentsObservations: readonly (readonly TargetObservation[])[],
): TargetCompatibility {
  return hardTargetCompatibility(
    polarity,
    componentsObservations.map((observations) =>
      reconcileTargetKnowledge(observations),
    ),
  );
}
