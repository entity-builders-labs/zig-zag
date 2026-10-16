export const PREFERENCE_DIMENSIONS = {
  THEME: 'theme',
  TRAIT: 'trait',
  INTENT: 'intent',
  WINERY_SCALE: 'winery_scale',
  TOURISM_INTENSITY: 'tourism_intensity',
  NATURE_TYPE: 'nature_type',
  LOCAL_CHARACTER: 'local_character',
  // Activated in Phase 6. Wizard-sourced only (the LLM interpreter is
  // forbidden from emitting it); influences ranking, never acquisition or
  // search-query phrasing.
  EXPLORATION_STYLE: 'exploration_style',
  // Hard dietary requirements (typed structured input or extractor output).
  DIETARY_SUITABILITY: 'dietary_suitability',
} as const;

export type PreferenceDimension =
  (typeof PREFERENCE_DIMENSIONS)[keyof typeof PREFERENCE_DIMENSIONS];

export const INITIAL_DIMENSION_VOCABULARY: Record<
  PreferenceDimension,
  readonly string[]
> = {
  [PREFERENCE_DIMENSIONS.THEME]: [
    'history',
    'culture',
    'art',
    'architecture',
    'nature',
    'outdoor',
    'beach',
    'hiking',
    'food',
    'gastronomy',
    'nightlife',
    'music',
    'entertainment',
    'family',
    'tango',
    'wine',
    'photography',
    'shopping',
    'sports',
  ],
  [PREFERENCE_DIMENSIONS.TRAIT]: [],
  [PREFERENCE_DIMENSIONS.INTENT]: [
    'walk',
    'route_like',
    'day_trip',
    'visit',
    'performance',
    'shopping',
    'food',
    'nightlife',
  ],
  [PREFERENCE_DIMENSIONS.WINERY_SCALE]: ['boutique', 'medium', 'industrial'],
  [PREFERENCE_DIMENSIONS.TOURISM_INTENSITY]: [
    'hidden',
    'local',
    'popular',
    'iconic',
  ],
  [PREFERENCE_DIMENSIONS.NATURE_TYPE]: [
    'mountain',
    'forest',
    'coast',
    'river',
    'desert',
    'park',
  ],
  [PREFERENCE_DIMENSIONS.LOCAL_CHARACTER]: [
    'authentic',
    'residential',
    'traditional',
    'contemporary',
  ],
  // Matches the two actionable poles of the ExplorationStyle enum
  // (ICONIC / LOCAL_DEEP_DIVE). BALANCED is deliberately absent — it is
  // neutral and produces no facet / no ranking pressure.
  [PREFERENCE_DIMENSIONS.EXPLORATION_STYLE]: ['iconic', 'local_deep_dive'],
  [PREFERENCE_DIMENSIONS.DIETARY_SUITABILITY]: ['vegan'],
};

/**
 * Version of the typed facet schema above. The schema holds domain concepts
 * (dimensions and canonical keys), never natural-language words: there is no
 * alias, synonym or keyword table, and natural language is interpreted only
 * by the semantic extractor (owner, 2026-10-15).
 */
export const PREFERENCE_FACET_SCHEMA_VERSION = 'facet-schema-v1';

/**
 * Dimensions a preference assertion may target: closed, typed dimensions
 * whose keys Experience facts share. The open `trait` dimension holds
 * arbitrary strings with no shared typed identity, and `exploration_style`
 * is a meta-preference, so neither is an assertion target.
 */
export const ASSERTION_TARGET_DIMENSIONS = [
  PREFERENCE_DIMENSIONS.THEME,
  PREFERENCE_DIMENSIONS.INTENT,
  PREFERENCE_DIMENSIONS.WINERY_SCALE,
  PREFERENCE_DIMENSIONS.TOURISM_INTENSITY,
  PREFERENCE_DIMENSIONS.NATURE_TYPE,
  PREFERENCE_DIMENSIONS.LOCAL_CHARACTER,
  PREFERENCE_DIMENSIONS.DIETARY_SUITABILITY,
] as const;

export type AssertionTargetDimension =
  (typeof ASSERTION_TARGET_DIMENSIONS)[number];

/** The canonical key of a typed target, or undefined when the schema lacks it. */
export function canonicalTargetKey(
  dimension: string,
  key: string,
): string | undefined {
  if (!(ASSERTION_TARGET_DIMENSIONS as readonly string[]).includes(dimension)) {
    return undefined;
  }
  return canonicalizeFacetKey(dimension, key);
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_ -]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Returns the canonical key when `rawKey` IS a key of the dimension's schema,
 * after formatting normalization only (case, accents, spaces/hyphens to
 * underscores). It never translates words: a key outside the schema returns
 * undefined. For the open `trait` dimension it returns the normalized string.
 * For unknown dimensions, returns undefined.
 */
export function canonicalizeFacetKey(
  dimension: string,
  rawKey: string,
): string | undefined {
  if (
    !dimension ||
    typeof dimension !== 'string' ||
    !rawKey ||
    typeof rawKey !== 'string'
  ) {
    return undefined;
  }

  const dim = dimension.trim().toLowerCase() as PreferenceDimension;

  // Reject any dimensions not in PREFERENCE_DIMENSIONS
  const validDimensions = Object.values(PREFERENCE_DIMENSIONS) as string[];
  if (!validDimensions.includes(dim)) {
    return undefined;
  }

  const normalizedRaw = normalizeText(rawKey);
  if (!normalizedRaw) {
    return undefined;
  }

  const snake = normalizedRaw.replace(/[ -]+/g, '_');

  // Trait dimension is open-ended
  if (dim === PREFERENCE_DIMENSIONS.TRAIT) {
    return snake;
  }

  const vocab = INITIAL_DIMENSION_VOCABULARY[dim];
  return vocab.includes(snake) ? snake : undefined;
}
