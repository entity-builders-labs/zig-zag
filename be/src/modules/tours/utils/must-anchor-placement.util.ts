import { UnmetAnchor } from '../interfaces/preference-spec.interface';

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
        anchor.kind === 'venue' &&
        anchor.priority === 'must' &&
        !resolved.has(anchor.rawName.trim().toLowerCase()),
    )
    .map((anchor) => ({ anchor, reason: 'UNRESOLVED' }));
}
