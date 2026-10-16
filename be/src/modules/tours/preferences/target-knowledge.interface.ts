import { SemanticTarget } from './preference-assertion.interface';

/**
 * Target-level knowledge for HARD eligibility (task 25.7, owner 2026-10-16).
 *
 * HARD enforcement reads knowledge keyed by `SemanticTarget`. A target's
 * compatibility state is SATISFIES / DOES_NOT_SATISFY / UNKNOWN; absence of
 * evidence is never negative evidence, and there is no dimension-level
 * completeness model.
 */

/** The reconciled, provider-neutral knowledge for one (GeoEntity, target). */
export type TargetKnowledge =
  | { state: 'SATISFIES' }
  | { state: 'DOES_NOT_SATISFY' }
  | { state: 'UNKNOWN'; reason: UnknownTargetReason };

/**
 * Why reconciled target knowledge is UNKNOWN. These are retained beneath the
 * UNKNOWN state and never collapse into a single "missing knowledge" reason.
 */
export type UnknownTargetReason =
  | 'NO_EVIDENCE'
  | 'CONFLICTING_EVIDENCE'
  | 'INCONCLUSIVE_EVIDENCE';

/**
 * One provider-fact observation about a target, normalized once at the
 * adapter boundary. `state` INCONCLUSIVE is evidence of nothing: a value such
 * as `wheelchair=limited` neither proves nor disproves wheelchair access.
 */
export interface TargetObservation {
  /**
   * Stable identity of the source fact (for example `osm:way/123:wheelchair`).
   * A re-observation may supersede only the prior observation of the SAME
   * source-fact identity; independent sources never last-write-wins.
   */
  sourceFactId: string;
  state: 'SATISFIES' | 'DOES_NOT_SATISFY' | 'INCONCLUSIVE';
}

/**
 * One normalized (target, observation) pair produced by a provider adapter.
 * The target is a typed SemanticTarget and the observation is
 * provider-neutral; provider-specific semantics (tag names, element ids)
 * terminate at the adapter.
 */
export interface TargetObservationFact {
  target: SemanticTarget;
  observation: TargetObservation;
}

/**
 * Compatibility of a candidate (single-place or composite Experience) with a
 * hard target, after aggregation over its required components.
 */
export type TargetCompatibility = 'COMPATIBLE' | 'INCOMPATIBLE' | 'UNKNOWN';
