export type PreferenceFacetSource = 'wizard' | 'free_text';
export type PreferenceFacetStrength = 'strong' | 'medium' | 'weak';

export interface PreferenceFacet {
  dimension: string;
  key: string;
  /** Ranking importance. Deterministic code-driven (0..1). */
  importance: number;
  /** Confidence that this facet correctly represents user intent (0..1). */
  confidence: number;
  source: PreferenceFacetSource;
}

export interface InterpretedPreferenceFacet {
  dimension: string;
  key: string;
  confidence: number;
  strength?: PreferenceFacetStrength;
}

export function calculateEffectiveWeight(facet: PreferenceFacet): number {
  return facet.importance * facet.confidence;
}

/**
 * Shared deterministic strength-to-importance mapper.
 * Authoritative single source of truth for both LLM output and regex fallbacks.
 */
export function mapStrengthToImportance(
  strength?: PreferenceFacetStrength,
): number {
  switch (strength) {
    case 'strong':
      return 1.0;
    case 'medium':
      return 0.7;
    case 'weak':
      return 0.5;
    default:
      return 0.7;
  }
}
