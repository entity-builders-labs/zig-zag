import { TargetObservation } from '../preferences/target-knowledge.interface';

/**
 * Persistence supersession (task 25.7, owner 2026-10-16): a re-observation
 * replaces only the prior observation of the same stable source-fact
 * identity; independent sources are never last-write-wins. The database
 * enforces the same rule with `@@unique([sourceFactId])` + upsert; this pure
 * form keeps the semantics unit-testable without a live database.
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
