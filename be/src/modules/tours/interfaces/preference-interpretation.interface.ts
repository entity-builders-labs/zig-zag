import { PreferenceFacet } from '../preferences/preference-facet.interface';

export interface NormalizedPreferenceIntent {
  /** Canonical single positive facet collection. */
  preferredFacets: PreferenceFacet[];

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
