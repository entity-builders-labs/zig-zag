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
};

/**
 * Mapping of localized or synonym phrases to canonical domain keys, scoped strictly by dimension.
 */
export const DIMENSION_KEY_SYNONYMS: Record<
  PreferenceDimension,
  Record<string, string>
> = {
  [PREFERENCE_DIMENSIONS.THEME]: {
    arquitectura: 'architecture',
    architectural: 'architecture',
    comida: 'food',
    culinario: 'food',
    culinaria: 'food',
    gastronomia: 'gastronomy',
    gastronomía: 'gastronomy',
    historia: 'history',
    historico: 'history',
    histórico: 'history',
    cultura: 'culture',
    cultural: 'culture',
    arte: 'art',
    artistico: 'art',
    artístico: 'art',
    naturaleza: 'nature',
    vino: 'wine',
    vinos: 'wine',
    bodega: 'wine',
    bodegas: 'wine',
    winery: 'wine',
    wineries: 'wine',
    tango: 'tango',
    musica: 'music',
    música: 'music',
    musical: 'music',
    nocturno: 'nightlife',
    noche: 'nightlife',
    'vida nocturna': 'nightlife',
    aire_libre: 'outdoor',
    'aire libre': 'outdoor',
    playa: 'beach',
    playas: 'beach',
    senderismo: 'hiking',
    trekking: 'hiking',
    fotografia: 'photography',
    fotografía: 'photography',
    familia: 'family',
    familiar: 'family',
    compras: 'shopping',
    deporte: 'sports',
    deportes: 'sports',
  },
  [PREFERENCE_DIMENSIONS.INTENT]: {
    caminata: 'walk',
    caminar: 'walk',
    paseo: 'walk',
    walking: 'walk',
    'walking-like': 'walk',
    'route-like': 'route_like',
    ruta: 'route_like',
    recorrido: 'route_like',
    excursion: 'day_trip',
    excursión: 'day_trip',
    'day-trip': 'day_trip',
    'day trip': 'day_trip',
    visita: 'visit',
    conocer: 'visit',
    'visit-like': 'visit',
    espectaculo: 'performance',
    espectáculo: 'performance',
    show: 'performance',
    compras: 'shopping',
    shopping: 'shopping',
    comida: 'food',
    gastronomia: 'food',
    food: 'food',
    noche: 'nightlife',
    nightlife: 'nightlife',
    'vida nocturna': 'nightlife',
  },
  [PREFERENCE_DIMENSIONS.WINERY_SCALE]: {
    chica: 'boutique',
    pequeña: 'boutique',
    pequena: 'boutique',
    artesanal: 'boutique',
    familiar: 'boutique',
    familiar_winery: 'boutique',
    mediana: 'medium',
    grande: 'industrial',
  },
  [PREFERENCE_DIMENSIONS.TOURISM_INTENSITY]: {
    oculto: 'hidden',
    escondido: 'hidden',
    secreto: 'hidden',
    popular: 'popular',
    icono: 'iconic',
    iconico: 'iconic',
    icónico: 'iconic',
  },
  [PREFERENCE_DIMENSIONS.NATURE_TYPE]: {
    montana: 'mountain',
    montaña: 'mountain',
    bosque: 'forest',
    costa: 'coast',
    playa: 'coast',
    rio: 'river',
    río: 'river',
    parque: 'park',
    desierto: 'desert',
  },
  [PREFERENCE_DIMENSIONS.LOCAL_CHARACTER]: {
    autentico: 'authentic',
    auténtico: 'authentic',
    residencial: 'residential',
    tradicional: 'traditional',
    contemporaneo: 'contemporary',
    contemporáneo: 'contemporary',
    moderno: 'contemporary',
  },
  [PREFERENCE_DIMENSIONS.TRAIT]: {},
  [PREFERENCE_DIMENSIONS.EXPLORATION_STYLE]: {},
};

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
 * Maps a raw facet key into its canonical domain key within the given dimension.
 * For controlled dimensions (incl. exploration_style since Phase 6), returns
 * undefined if the key cannot be mapped to the canonical vocabulary — so
 * exploration_style 'iconic'/'local_deep_dive' canonicalize, 'balanced' and
 * anything else return undefined.
 * For open dimensions (trait), returns normalized string.
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

  // Controlled dimensions: theme, intent, winery_scale, tourism_intensity, nature_type, local_character
  const dimSynonyms = DIMENSION_KEY_SYNONYMS[dim];
  const synonymKey = dimSynonyms?.[normalizedRaw] ?? dimSynonyms?.[snake];

  const candidateKey = synonymKey ?? snake;
  const vocab = INITIAL_DIMENSION_VOCABULARY[dim];

  if (vocab && vocab.includes(candidateKey)) {
    return candidateKey;
  }

  if (vocab && vocab.includes(normalizedRaw)) {
    return normalizedRaw;
  }

  return undefined;
}
