import {
  PREFERENCE_DIMENSIONS,
  canonicalizeFacetKey,
} from '../../../be/src/modules/tours/preferences/preference-facet-vocabulary';
import { FacetKey } from './contracts';

/**
 * The single facet canonicalization used by the spike (design D6). It
 * delegates to the backend's canonical vocabulary; nothing here invents a
 * facet. Unmapped terms return undefined and are dropped by callers.
 */
export function canonicalFacet(dimension: string, raw: string): FacetKey | undefined {
  const key = canonicalizeFacetKey(dimension, raw);
  return key ? `${dimension}:${key}` : undefined;
}

/** Thematic interests (THEME dimension) from wizard terms. */
export function thematicFacets(terms: string[]): FacetKey[] {
  return dedupe(terms.map((t) => canonicalFacet(PREFERENCE_DIMENSIONS.THEME, t)));
}

/**
 * Experience formats (INTENT dimension) from wizard terms, e.g. "walking"
 * -> intent:walk. This is experience intent, never transport permission
 * (architecture invariant 22): transport modes are a separate input.
 */
export function experienceFormatFacets(terms: string[]): FacetKey[] {
  return dedupe(terms.map((t) => canonicalFacet(PREFERENCE_DIMENSIONS.INTENT, t)));
}

export const WALKING_FORMAT_FACET: FacetKey = `${PREFERENCE_DIMENSIONS.INTENT}:walk`;

/**
 * Maps themes proposed by the research agent to canonical THEME facets. An
 * explicit `dimension:key` hint is accepted only when it validates against
 * the vocabulary; anything else unmapped is dropped (spec: no free-text
 * facets).
 */
export function mapClaimThemes(proposed: string[]): FacetKey[] {
  return dedupe(
    proposed.map((raw) => {
      const explicit = /^([a-z_]+):(.+)$/i.exec(raw.trim());
      if (explicit) return canonicalFacet(explicit[1].toLowerCase(), explicit[2]);
      return canonicalFacet(PREFERENCE_DIMENSIONS.THEME, raw);
    }),
  );
}

function dedupe(values: Array<FacetKey | undefined>): FacetKey[] {
  return [...new Set(values.filter((v): v is FacetKey => !!v))].sort();
}
