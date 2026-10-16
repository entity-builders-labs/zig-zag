import { SemanticTarget } from '../preferences/preference-assertion.interface';

/**
 * The provider-neutral typed facts the canonical preference matcher reads
 * (review correction B, 2026-10-16). Each raw representation — a catalog
 * row, a discovery candidate, a persisted classification — adapts once into
 * these facts at its own boundary (`experience-match-facts.util.ts`); the
 * matcher never probes metadata or casts an unknown shape.
 */
export interface ExperienceSemanticFacts {
  /** Canonical theme keys of the facet schema. */
  themes: readonly string[];
  /** Canonical intent keys of the facet schema. */
  intents: readonly string[];
  /**
   * Typed facts on the other closed schema dimensions (winery scale,
   * tourism intensity, nature type, local character, dietary suitability,
   * accessibility). Absence of a fact is UNKNOWN, never a negative fact.
   */
  dimensionedFacts: readonly SemanticTarget[];
}

/**
 * State of the Experience's evidence-only semantic classification.
 * UNCLASSIFIED: none recorded; DEGRADED: a recorded classification failure
 * (known-thin evidence). Neither is completeness: an absent fact in a
 * CLASSIFIED Experience still means "not substantiated", not "absent".
 */
export type ExperienceClassificationState =
  | 'CLASSIFIED'
  | 'DEGRADED'
  | 'UNCLASSIFIED';

/** The facts strong-match eligibility reads, on top of the semantic facts. */
export interface ExperienceMatchFacts {
  semantic: ExperienceSemanticFacts;
  classificationState: ExperienceClassificationState;
  /** At least one resolved component with valid coordinates. */
  hasResolvedGeography: boolean;
  /** Canonical quality on the 0..5 scale, or null when UNKNOWN. */
  qualityScore: number | null;
  /** Visit duration in minutes, or null when UNKNOWN. */
  durationMinutes: number | null;
}
