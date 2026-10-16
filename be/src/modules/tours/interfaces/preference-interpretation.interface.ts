import {
  PreferenceAssertion,
  UnresolvedPreferenceConcept,
} from '../preferences/preference-assertion.interface';
import { InterpretedAnchor } from './preference-spec.interface';

export interface NormalizedPreferenceIntent {
  interpretationStatus?: 'complete' | 'partial' | 'failed';
  unresolvedFreeText?: string;
  /** Typed assertions the extractor established and validation accepted. */
  assertions: PreferenceAssertion[];
  /** Concepts without a shared typed identity (observability only). */
  unresolvedConcepts: UnresolvedPreferenceConcept[];

  /**
   * Concrete named places/areas/routes the user explicitly mentioned
   * (spec §4, plan Task A2 / D3). `priority: 'must'` is emitted only for
   * explicit, unambiguous named-place intent; anything weaker or ambiguous
   * defaults to `'soft'`. A soft anchor is a strong inclusion tilt, never a
   * forced selection -- see `docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md` §4.
   */
  anchoredPlaces: InterpretedAnchor[];

  /** Positive interests only; the semantic query of the utility boundary. */
  positiveSemanticQuery: string;
  /**
   * Diagnostics only (task 25.5): what the extractor found uncertain or
   * noteworthy, recorded in the trace. Never parsed and never an input to
   * assertions, utility, matching, enforcement, composition, planning,
   * eligibility or any policy decision. Diagnostics are not domain semantics.
   */
  ambiguities: string[];
  notes: string[];
}

export interface PreferenceInterpretationTrace {
  stage: 'preference_interpretation';
  provider?: string;
  model?: string;
  systemPrompt: string;
  userPrompt: string;
  responseSchema: Record<string, unknown>;
  rawResponse?: unknown;
  parsedResponse: NormalizedPreferenceIntent;
  facetNormalizationDecisions?: FacetNormalizationDecision[];
  validationErrors: string[];
  status: 'applied' | 'failed' | 'skipped';
  durationMs: number;
  unresolvedFreeText?: string;
}

/** Validation outcome of one extractor assertion (trace only). */
export interface FacetNormalizationDecision {
  rawDimension: string;
  rawKey: string;
  normalizedDimension?: string;
  normalizedKey?: string;
  accepted: boolean;
  evidence?: string[];
  reason:
    | 'VALID_AS_EMITTED'
    | 'UNKNOWN_DIMENSION'
    | 'UNKNOWN_KEY'
    | 'INVALID_ASSERTION_FIELD'
    | 'MISSING_EVIDENCE'
    | 'UNSUPPORTED_BY_INPUT';
}
