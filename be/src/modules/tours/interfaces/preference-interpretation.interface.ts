import { PreferenceFacet } from '../preferences/preference-facet.interface';
import { AnchoredPlace } from './preference-spec.interface';

export interface NormalizedPreferenceIntent {
  /** Canonical single positive facet collection. */
  preferredFacets: PreferenceFacet[];

  /**
   * Concrete named places/areas/routes the user explicitly mentioned
   * (spec §4, plan Task A2 / D3). `priority: 'must'` is emitted only for
   * explicit, unambiguous named-place intent; anything weaker or ambiguous
   * defaults to `'soft'`. A soft anchor is a strong inclusion tilt, never a
   * forced selection -- see `docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md` §4.
   */
  anchoredPlaces: AnchoredPlace[];

  // Preserved negative and constraint fields
  excludedThemes: string[];
  excludedTraits: string[];
  hardExclusions: string[];
  softConstraints: string[];
  ambiguities: string[];
  dietaryPreferences: string[];
  accessibilityPreferences: string[];
  budgetPreferences: string[];
  groupPreferences: string[];
  positiveSemanticQuery: string;
  notes: string[];
}

export function getFacetsByDimension(
  facets: PreferenceFacet[] | undefined | null,
  dimension: string,
): PreferenceFacet[] {
  if (!Array.isArray(facets)) {
    return [];
  }
  const target = dimension.trim().toLowerCase();
  return facets.filter((f) => f.dimension?.trim().toLowerCase() === target);
}

export function getFacetKeysByDimension(
  facets: PreferenceFacet[] | undefined | null,
  dimension: string,
): string[] {
  return getFacetsByDimension(facets, dimension).map((f) => f.key);
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
  validationErrors: string[];
  status: 'applied' | 'fallback' | 'failed' | 'skipped';
  durationMs: number;
}
