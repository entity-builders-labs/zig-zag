import { PreferenceFacet } from '../preferences/preference-facet.interface';
import { canonicalizeFacetKey } from '../preferences/preference-facet-vocabulary';

/**
 * Constructs a normalized PreferenceFacet for a wizard selection.
 * Wizard choices always have importance: 1.0, confidence: 1.0, and source: 'wizard'.
 */
export function normalizeWizardFacet(
  dimension: string,
  rawKey: string,
): PreferenceFacet {
  const normDim = dimension.trim().toLowerCase();
  const canonicalKey = canonicalizeFacetKey(normDim, rawKey);
  return {
    dimension: normDim,
    key: canonicalKey,
    importance: 1.0,
    confidence: 1.0,
    source: 'wizard',
  };
}

/**
 * Merges explicit wizard facets and inferred free-text facets.
 *
 * Strict Invariant:
 * Explicit wizard selections take absolute precedence. If a facet with the same
 * (dimension, key) was chosen in the wizard, the free-text version is ignored
 * and cannot weaken, duplicate, or overwrite the wizard facet.
 * Inferred facets with distinct (dimension, key) are retained.
 */
export function mergePreferenceFacets(
  wizardFacets: PreferenceFacet[] = [],
  interpretedFacets: PreferenceFacet[] = [],
): PreferenceFacet[] {
  const mergedMap = new Map<string, PreferenceFacet>();

  // 1. Wizard facets are inserted first as authoritative
  for (const facet of wizardFacets) {
    if (!facet || !facet.key) {
      continue;
    }
    const normDim = facet.dimension.trim().toLowerCase();
    const canonicalKey = canonicalizeFacetKey(normDim, facet.key);
    if (!canonicalKey) {
      continue;
    }
    const compoundKey = `${normDim}:${canonicalKey}`;
    mergedMap.set(compoundKey, {
      dimension: normDim,
      key: canonicalKey,
      importance: 1.0,
      confidence: 1.0,
      source: 'wizard',
    });
  }

  // 2. Free-text facets are merged; cannot weaken or overwrite existing wizard facets
  for (const facet of interpretedFacets) {
    if (!facet || !facet.key) {
      continue;
    }
    const normDim = facet.dimension.trim().toLowerCase();
    const canonicalKey = canonicalizeFacetKey(normDim, facet.key);
    if (!canonicalKey) {
      continue;
    }
    const compoundKey = `${normDim}:${canonicalKey}`;
    if (!mergedMap.has(compoundKey)) {
      mergedMap.set(compoundKey, {
        dimension: normDim,
        key: canonicalKey,
        importance: facet.importance,
        confidence: facet.confidence,
        source: 'free_text',
      });
    }
  }

  return Array.from(mergedMap.values());
}
