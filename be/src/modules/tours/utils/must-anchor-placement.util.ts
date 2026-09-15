import { UnmetAnchor } from '../interfaces/preference-spec.interface';
import { PlanningExperienceCandidate } from '../interfaces/daily-planning.interface';
import { sortCandidatesDeterministically } from './daily-planning-candidate-sort.util';

export function partitionMustIncludeCandidates(
  candidates: PlanningExperienceCandidate[],
): {
  must: PlanningExperienceCandidate[];
  regular: PlanningExperienceCandidate[];
} {
  const sorted = sortCandidatesDeterministically(candidates);
  return {
    must: sorted.filter((candidate) => candidate.mustInclude === true),
    regular: sorted.filter((candidate) => candidate.mustInclude !== true),
  };
}

/**
 * C5 owns this translation: composition only forces canonically resolved
 * venue IDs; the planner later reports hard-feasibility failures as
 * `INFEASIBLE` without inventing a replacement venue.
 */
export function unresolvedVenueMustAnchors(
  anchors: UnmetAnchor['anchor'][],
  resolvedVenueMustAnchorNames: readonly string[],
): UnmetAnchor[] {
  const resolved = new Set(
    resolvedVenueMustAnchorNames.map((name) => name.trim().toLowerCase()),
  );
  return anchors
    .filter(
      (anchor) =>
        anchor.status === 'resolved' &&
        anchor.kind === 'venue' &&
        anchor.priority === 'must' &&
        !resolved.has(anchor.canonicalName.trim().toLowerCase()),
    )
    .map((anchor) => ({ anchor, reason: 'UNRESOLVED' }));
}
