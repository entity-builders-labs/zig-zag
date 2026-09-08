export const PREFERENCE_DIMENSIONS = {
  THEME: 'theme',
  TRAIT: 'trait',
  INTENT: 'intent',
  WINERY_SCALE: 'winery_scale',
  TOURISM_INTENSITY: 'tourism_intensity',
  NATURE_TYPE: 'nature_type',
  LOCAL_CHARACTER: 'local_character',
  // Reserved for Phase 6 rollout only; dormant in Phase 2
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
  ],
  [PREFERENCE_DIMENSIONS.TRAIT]: [],
  [PREFERENCE_DIMENSIONS.INTENT]: [
    'walk',
    'route_like',
    'day_trip',
    'visit',
    'performance',
    'shopping',
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
  // Dormant in Phase 2
  [PREFERENCE_DIMENSIONS.EXPLORATION_STYLE]: [
    'relaxed',
    'balanced',
    'intensive',
  ],
};

/**
 * Mapping of localized or synonym phrases to canonical domain keys.
 */
const CANONICAL_KEY_SYNONYMS: Record<string, string> = {
  // Themes
  arquitectura: 'architecture',
  architectural: 'architecture',
  comida: 'food',
  gastronomia: 'gastronomy',
  gastronomía: 'gastronomy',
  culinario: 'food',
  culinaria: 'food',
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

  // Intents
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
  visita: 'visit',
  conocer: 'visit',
  espectaculo: 'performance',
  espectáculo: 'performance',
  show: 'performance',
  compras: 'shopping',
  shopping: 'shopping',

  // Winery scale
  chica: 'boutique',
  pequeña: 'boutique',
  pequena: 'boutique',
  artesanal: 'boutique',
  familiar_winery: 'boutique',
  mediana: 'medium',
  grande: 'industrial',

  // Tourism intensity
  oculto: 'hidden',
  escondido: 'hidden',
  secreto: 'hidden',
  autentico: 'authentic',
  auténtico: 'authentic',
  icono: 'iconic',
  iconico: 'iconic',
  icónico: 'iconic',

  // Nature type
  montana: 'mountain',
  montaña: 'mountain',
  bosque: 'forest',
  costa: 'coast',
  rio: 'river',
  río: 'river',
  parque: 'park',
  desierto: 'desert',
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
 * Maps a raw facet key (including localized wording or accents) into its canonical domain key.
 */
export function canonicalizeFacetKey(
  dimension: string,
  rawKey: string,
): string {
  const normalizedRaw = normalizeText(rawKey);
  if (!normalizedRaw) {
    return '';
  }

  // Check direct synonym match
  if (CANONICAL_KEY_SYNONYMS[normalizedRaw]) {
    return CANONICAL_KEY_SYNONYMS[normalizedRaw];
  }

  // Check without spaces / hyphenated
  const snake = normalizedRaw.replace(/[ -]+/g, '_');
  if (CANONICAL_KEY_SYNONYMS[snake]) {
    return CANONICAL_KEY_SYNONYMS[snake];
  }

  // If already in known vocabulary for this dimension, return it
  const dim = dimension.trim().toLowerCase() as PreferenceDimension;
  const vocab = INITIAL_DIMENSION_VOCABULARY[dim];
  if (vocab && vocab.includes(snake)) {
    return snake;
  }
  if (vocab && vocab.includes(normalizedRaw)) {
    return normalizedRaw;
  }

  return snake;
}
