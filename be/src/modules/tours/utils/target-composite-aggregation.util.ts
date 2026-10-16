import {
  TargetCompatibility,
  TargetKnowledge,
} from '../preferences/target-knowledge.interface';

/**
 * Composite aggregation of HARD target knowledge over a candidate's required
 * components (task 25.7, owner 2026-10-16):
 *
 * HARD INCLUDE: all required components SATISFY            -> COMPATIBLE
 *               any required component DOES_NOT_SATISFY    -> INCOMPATIBLE
 *               otherwise                                  -> UNKNOWN
 * HARD EXCLUDE: all required components DOES_NOT_SATISFY   -> COMPATIBLE
 *               any required component SATISFIES           -> INCOMPATIBLE
 *               otherwise                                  -> UNKNOWN
 *
 * A candidate with no required components cannot be proven compatible.
 */
export function hardTargetCompatibility(
  polarity: 'INCLUDE' | 'EXCLUDE',
  componentKnowledge: readonly TargetKnowledge[],
): TargetCompatibility {
  if (componentKnowledge.length === 0) {
    return 'UNKNOWN';
  }
  const states = componentKnowledge.map((knowledge) => knowledge.state);
  if (polarity === 'INCLUDE') {
    if (states.every((state) => state === 'SATISFIES')) {
      return 'COMPATIBLE';
    }
    if (states.some((state) => state === 'DOES_NOT_SATISFY')) {
      return 'INCOMPATIBLE';
    }
    return 'UNKNOWN';
  }
  // EXCLUDE: compatible only when nothing carries the excluded fact, and
  // incompatible as soon as one required component does.
  if (states.every((state) => state === 'DOES_NOT_SATISFY')) {
    return 'COMPATIBLE';
  }
  if (states.some((state) => state === 'SATISFIES')) {
    return 'INCOMPATIBLE';
  }
  return 'UNKNOWN';
}
