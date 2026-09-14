import { PreferenceFacet } from '../preferences/preference-facet.interface';
import { PREFERENCE_DIMENSIONS } from '../preferences/preference-facet-vocabulary';
// Kept as a compatibility export for existing callers. The implementation
// lives with the canonical strong-match policy so weak matches cannot acquire
// planner preference weight.
export { preferenceWeightForExperience } from './preference-strong-match.util';

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
    return hasExplicitDimensionedEvidence(
      exp,
      metadata,
      dim,
      normalizedFacetKey,
    );
  }

  if (dim === PREFERENCE_DIMENSIONS.EXPLORATION_STYLE) {
    // A meta-preference about how to experience the trip — it carries no
    // per-Experience tag of its own, so it is matched against the SAME
    // explicit dimensioned evidence a candidate already carries for
    // tourism_intensity / local_character. Only explicit dimensioned
    // evidence — never name / description / duration / component count.
    // Soft ranking, never an exclusion. `balanced` never reaches here (it
    // produces no facet). An unknown key matches nothing. Look up by the
    // canonical key (underscores intact — `normalizeText` above would have
    // collapsed `local_deep_dive` to `local deep dive`).
    const canonicalKey = facet.key.trim().toLowerCase();
    const targets = EXPLORATION_STYLE_EVIDENCE_TARGETS[canonicalKey];
    if (!targets) return false;
    return targets.some(([targetDim, targetKey]) =>
      hasExplicitDimensionedEvidence(
        exp,
        metadata,
        targetDim,
        normalizeText(targetKey),
      ),
    );
  }

  // Any unknown dimension is rejected
  return false;
}

/**
 * Canonical weighted facet satisfaction for planner-bound candidates.
 * Matching remains exclusively delegated to candidateMatchesPreferenceFacet;
 * this helper only deduplicates requested facet representations and sums their
 * already-normalized weights.
 */
// exploration_style key -> the (dimension, key) explicit dimensioned-evidence
// pairs a candidate must carry to count as a match. Conservative: iconic reads
// the "well-known / heavily-visited" end of tourism_intensity; local_deep_dive
// reads the "off the beaten path" end plus an explicit authentic local
// character. Nothing here reads themes, name, description, or geometry.
const EXPLORATION_STYLE_EVIDENCE_TARGETS: Record<
  string,
  ReadonlyArray<readonly [string, string]>
> = {
  iconic: [
    [PREFERENCE_DIMENSIONS.TOURISM_INTENSITY, 'iconic'],
    [PREFERENCE_DIMENSIONS.TOURISM_INTENSITY, 'popular'],
  ],
  local_deep_dive: [
    [PREFERENCE_DIMENSIONS.TOURISM_INTENSITY, 'hidden'],
    [PREFERENCE_DIMENSIONS.TOURISM_INTENSITY, 'local'],
    [PREFERENCE_DIMENSIONS.LOCAL_CHARACTER, 'authentic'],
  ],
};

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
