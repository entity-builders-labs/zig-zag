import { AssertionTargetDimension } from './preference-facet-vocabulary';

/**
 * Typed preference assertions (task 25.4, owner 2026-10-15).
 *
 * Natural language is interpreted only by the semantic extractor, which
 * asserts the target, polarity, provenance, importance, confidence and the
 * evidence. Structured input (a typed option the traveller selected) yields
 * assertions directly. Deterministic code validates the structured result
 * and never reinterprets the user's text: no alias, keyword, synonym or
 * regex list decides any of these fields, and the capture channel is never
 * authority.
 */

export type PreferencePolarity = 'INCLUDE' | 'EXCLUDE';

/** DIRECT: the traveller explicitly expressed it; INFERRED: derived. */
export type PreferenceProvenance = 'DIRECT' | 'INFERRED';

/** HARD constraints must be guaranteed; SOFT ones shape preference only. */
export type PreferenceConstraint = 'SOFT' | 'HARD';

export type PreferenceStrength = 'strong' | 'medium' | 'weak';

/**
 * A typed domain concept shared by preference assertions and Experience
 * facts: a closed dimension and one of its canonical keys.
 */
export interface SemanticTarget {
  dimension: AssertionTargetDimension;
  key: string;
}

export type PreferenceEvidence =
  /** A verbatim span of the traveller's own text. */
  | { kind: 'USER_TEXT_SPAN'; text: string }
  /** A typed option the traveller selected in a structured input. */
  | { kind: 'STRUCTURED_SELECTION'; field: string; value: string };

export interface PreferenceAssertion {
  target: SemanticTarget;
  polarity: PreferencePolarity;
  constraint: PreferenceConstraint;
  provenance: PreferenceProvenance;
  /** Stated importance (0..1), from the asserted strength. */
  importance: number;
  /** Confidence in the interpretation (0..1); 1 for a structured selection. */
  confidence: number;
  evidence: PreferenceEvidence[];
}

/**
 * A concept the extractor understood that has no shared typed identity in
 * the schema. Kept for observability and research only: it never takes part
 * in matching, and a HARD one makes the request's exclusion unenforceable.
 */
export interface UnresolvedPreferenceConcept {
  /** The extractor's own description; never matched against anything. */
  label: string;
  polarity: PreferencePolarity;
  constraint: PreferenceConstraint;
  evidence: PreferenceEvidence[];
  reason: 'UNRESOLVED_OPEN_CONCEPT';
}

/** Stated importance of an asserted strength (the live importance mapping). */
export function mapStrengthToImportance(strength: PreferenceStrength): number {
  switch (strength) {
    case 'strong':
      return 1.0;
    case 'medium':
      return 0.7;
    case 'weak':
      return 0.5;
  }
}

export function semanticTargetKey(target: SemanticTarget): string {
  return `${target.dimension}:${target.key}`;
}

/**
 * The single duplicate rule for assertions of one target and polarity:
 * DIRECT outranks INFERRED, then the higher importance x confidence. The
 * capture channel never decides it.
 */
export function outranksAssertion(
  candidate: PreferenceAssertion,
  existing: PreferenceAssertion,
): boolean {
  if (candidate.provenance !== existing.provenance) {
    return candidate.provenance === 'DIRECT';
  }
  return (
    candidate.importance * candidate.confidence >
    existing.importance * existing.confidence
  );
}

/** One assertion per (target, polarity), per `outranksAssertion`. */
export function dedupeAssertions(
  assertions: readonly (PreferenceAssertion | undefined)[],
): PreferenceAssertion[] {
  const best = new Map<string, PreferenceAssertion>();
  for (const assertion of assertions) {
    if (!assertion) continue;
    const identity = `${semanticTargetKey(assertion.target)}:${assertion.polarity}`;
    const existing = best.get(identity);
    if (!existing || outranksAssertion(assertion, existing)) {
      best.set(identity, assertion);
    }
  }
  return [...best.values()];
}

/**
 * One target asserted with both polarities. The contradiction is explicit and
 * never resolved by provenance, importance, confidence, channel or polarity
 * (owner, task 25.6); a later semantic reconciliation may resolve it
 * upstream. When both assertions are SOFT, neither participates and planning
 * continues. When either is HARD, the request has contradictory hard intent
 * and generation stops with `AMBIGUOUS_HARD_CONSTRAINT`.
 */
export interface PreferencePolarityConflict {
  target: SemanticTarget;
  include: PreferenceAssertion;
  exclude: PreferenceAssertion;
  /** True when either assertion is HARD: the conflict blocks planning. */
  blocking: boolean;
  reason: 'PREFERENCE_POLARITY_CONFLICT';
}

/**
 * Splits deduplicated assertions (one per target and polarity) into the
 * unambiguous ones and the targets asserted with both polarities.
 */
export function separatePolarityConflicts(
  assertions: readonly PreferenceAssertion[],
): {
  assertions: PreferenceAssertion[];
  conflicts: PreferencePolarityConflict[];
} {
  const byTarget = new Map<string, PreferenceAssertion[]>();
  for (const assertion of assertions) {
    const key = semanticTargetKey(assertion.target);
    byTarget.set(key, [...(byTarget.get(key) ?? []), assertion]);
  }
  const conflicts: PreferencePolarityConflict[] = [];
  const conflicting = new Set<string>();
  for (const [key, group] of byTarget) {
    const include = group.find((a) => a.polarity === 'INCLUDE');
    const exclude = group.find((a) => a.polarity === 'EXCLUDE');
    if (include && exclude) {
      conflicting.add(key);
      conflicts.push({
        target: include.target,
        include,
        exclude,
        blocking:
          include.constraint === 'HARD' || exclude.constraint === 'HARD',
        reason: 'PREFERENCE_POLARITY_CONFLICT',
      });
    }
  }
  return {
    assertions: assertions.filter(
      (assertion) => !conflicting.has(semanticTargetKey(assertion.target)),
    ),
    conflicts,
  };
}
