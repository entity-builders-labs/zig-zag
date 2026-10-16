import { SemanticTarget } from '../preferences/preference-assertion.interface';
import { PREFERENCE_DIMENSIONS } from '../preferences/preference-facet-vocabulary';
// Kept as a compatibility export for existing callers. The implementation
// lives with the canonical strong-match policy so weak matches cannot acquire
// planner preference weight.

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/**
 * Pure facet-matching primitive.
 * Determines whether an Experience candidate or catalog Experience carries
 * the typed fact `facet` names (a closed dimension and canonical key). It
 * compares typed keys only; there is no open-concept (trait) string matching.
 */
export function candidateMatchesPreferenceFacet(
  experience: unknown,
  facet: SemanticTarget,
): boolean {
  if (
    !experience ||
    typeof experience !== 'object' ||
    !facet ||
    !facet.key ||
    !facet.dimension
  ) {
    return false;
  }

  const dim = facet.dimension.trim().toLowerCase();
  const normalizedFacetKey = normalizeText(facet.key);
  if (!normalizedFacetKey) {
    return false;
  }

  const exp = experience as Record<string, any>;
  const metadata =
    exp.metadata && typeof exp.metadata === 'object' ? exp.metadata : {};

  if (dim === PREFERENCE_DIMENSIONS.THEME) {
    // Theme: matches strictly against experience.themes and experience.metadata.themes.
    // Never matches description, name, or traits.
    const themes = [...stringList(exp.themes), ...stringList(metadata.themes)];
    return themes.some((theme) => normalizeText(theme) === normalizedFacetKey);
  }

  if (dim === PREFERENCE_DIMENSIONS.INTENT) {
    // Intent: matches strictly against experience.intents, metadata.intents, and metadata.archetypes.
    // Never matches description or traits.
    const intents = [
      ...stringList(exp.intents),
      ...stringList(metadata.intents),
      ...stringList(metadata.archetypes),
    ];
    return intents.some(
      (intent) => normalizeText(intent) === normalizedFacetKey,
    );
  }

  // Structured dimensions: winery_scale, tourism_intensity, nature_type, local_character
  const structuredDimensions: string[] = [
    PREFERENCE_DIMENSIONS.WINERY_SCALE,
    PREFERENCE_DIMENSIONS.TOURISM_INTENSITY,
    PREFERENCE_DIMENSIONS.NATURE_TYPE,
    PREFERENCE_DIMENSIONS.LOCAL_CHARACTER,
  ];

  if (structuredDimensions.includes(dim)) {
    // Must match only against explicit dimension-specific evidence.
    return hasExplicitDimensionedEvidence(
      exp,
      metadata,
      dim,
      normalizedFacetKey,
    );
  }

  // Any unknown dimension is rejected
  return false;
}

/**
 * True iff the candidate carries explicit dimensioned evidence for
 * `(targetDim, normalizedTargetKey)` — in `dimensionedTraits` (top-level or
 * metadata), `metadata.preferenceFacets` / `metadata.facets`, or the
 * `metadata.dimensions` map. Never inspects name / description / free text.
 * `normalizedTargetKey` is already normalized by the caller.
 */
function hasExplicitDimensionedEvidence(
  exp: Record<string, any>,
  metadata: Record<string, any>,
  targetDim: string,
  normalizedTargetKey: string,
): boolean {
  const dimensionedTraits = [
    ...(Array.isArray(exp.dimensionedTraits) ? exp.dimensionedTraits : []),
    ...(Array.isArray(metadata.dimensionedTraits)
      ? metadata.dimensionedTraits
      : []),
  ];
  const hasDimensionedMatch = dimensionedTraits.some((item) => {
    if (!item || typeof item !== 'object') return false;
    const itemDim =
      typeof item.dimension === 'string'
        ? item.dimension.trim().toLowerCase()
        : '';
    const itemKey = typeof item.key === 'string' ? normalizeText(item.key) : '';
    return itemDim === targetDim && itemKey === normalizedTargetKey;
  });
  if (hasDimensionedMatch) return true;

  const facets = [
    ...(Array.isArray(metadata.preferenceFacets)
      ? metadata.preferenceFacets
      : []),
    ...(Array.isArray(metadata.facets) ? metadata.facets : []),
  ];
  const hasFacetMatch = facets.some((item) => {
    if (!item || typeof item !== 'object') return false;
    const itemDim =
      typeof item.dimension === 'string'
        ? item.dimension.trim().toLowerCase()
        : '';
    const itemKey = typeof item.key === 'string' ? normalizeText(item.key) : '';
    return itemDim === targetDim && itemKey === normalizedTargetKey;
  });
  if (hasFacetMatch) return true;

  if (metadata.dimensions && typeof metadata.dimensions === 'object') {
    const dimValue = metadata.dimensions[targetDim];
    if (
      typeof dimValue === 'string' &&
      normalizeText(dimValue) === normalizedTargetKey
    ) {
      return true;
    }
  }

  return false;
}
