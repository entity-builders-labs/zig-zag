import { PreferenceFacet } from '../preferences/preference-facet.interface';
import { PREFERENCE_DIMENSIONS } from '../preferences/preference-facet-vocabulary';

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
 * Determines whether an Experience candidate or catalog Experience satisfies
 * a given PreferenceFacet based strictly on its dimension and dimension-specific evidence.
 */
export function candidateMatchesPreferenceFacet(
  experience: unknown,
  facet: PreferenceFacet,
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

  if (dim === PREFERENCE_DIMENSIONS.TRAIT) {
    // Trait: matches against experience.traits, metadata.traits, and relational TraitDefinition values
    // (exposed as dimensionedTraits where dimension is 'trait' or 'general').
    const rawTraits = [
      ...stringList(exp.traits),
      ...stringList(metadata.traits),
    ];
    if (
      rawTraits.some((trait) => normalizeText(trait) === normalizedFacetKey)
    ) {
      return true;
    }

    const dimensionedTraits = [
      ...(Array.isArray(exp.dimensionedTraits) ? exp.dimensionedTraits : []),
      ...(Array.isArray(metadata.dimensionedTraits)
        ? metadata.dimensionedTraits
        : []),
    ];

    return dimensionedTraits.some((item) => {
      if (!item || typeof item !== 'object') return false;
      const itemDim =
        typeof item.dimension === 'string'
          ? item.dimension.trim().toLowerCase()
          : '';
      if (itemDim !== 'trait' && itemDim !== 'general') return false;
      const itemKey =
        typeof item.key === 'string' ? normalizeText(item.key) : '';
      const itemLabel =
        typeof item.label === 'string' ? normalizeText(item.label) : '';
      return itemKey === normalizedFacetKey || itemLabel === normalizedFacetKey;
    });
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
    // 1. dimensionedTraits (top-level or in metadata)
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
      const itemKey =
        typeof item.key === 'string' ? normalizeText(item.key) : '';
      return itemDim === dim && itemKey === normalizedFacetKey;
    });
    if (hasDimensionedMatch) {
      return true;
    }

    // 2. Explicit metadata preferenceFacets or facets
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
      const itemKey =
        typeof item.key === 'string' ? normalizeText(item.key) : '';
      return itemDim === dim && itemKey === normalizedFacetKey;
    });
    if (hasFacetMatch) {
      return true;
    }

    // 3. Explicit metadata.dimensions map
    if (metadata.dimensions && typeof metadata.dimensions === 'object') {
      const dimValue = metadata.dimensions[dim];
      if (
        typeof dimValue === 'string' &&
        normalizeText(dimValue) === normalizedFacetKey
      ) {
        return true;
      }
    }

    // If no explicit dimension-specific evidence: return false
    return false;
  }

  // exploration_style and any unknown dimensions are rejected
  return false;
}
