/**
 * The shared competitive corpus for the Checkpoint G engine-quality benchmark:
 * ~320 heterogeneous Buenos Aires Experiences with overlapping facet clusters,
 * seeded ONCE and reused (never mutated) across every user profile. Many rows
 * are plausible near-matches for any given request, so ranking must
 * discriminate rather than pick the one obvious answer.
 *
 * `metadata.oracle` is test-only scaffolding (never read by production — grep
 * clean). `metadata.dimensionedTraits` IS read by production
 * (`hasExplicitDimensionedEvidence`) and is how `tourism_intensity` /
 * `local_character` / `exploration_style` matching works.
 */
import { Axis, AxisWeights } from './axis-oracle';

const ORIGIN_LAT = -34.6037;
const ORIGIN_LNG = -58.3816;

export const ALWAYS_OPEN = {
  status: 'known' as const,
  rangesByWeekday: Object.fromEntries(
    Array.from({ length: 7 }, (_, weekday) => [
      weekday,
      [{ startMinutesFromMidnight: 0, endMinutesFromMidnight: 1439 }],
    ]),
  ),
};

export interface DimensionedTrait {
  dimension: string;
  key: string;
}

export interface RowOracle {
  cluster: string;
  axisWeights: AxisWeights;
  /** 0..1 taste axes — DIAGNOSTIC ONLY, never used as an ordinal "better". */
  iconicity: number;
  localness: number;
  /** Bare facet keys this row satisfies (mirrors candidateMatchesPreferenceFacet). */
  preferenceTags: string[];
  qualityScore: number;
  feasible: boolean;
  geoOk: boolean;
  expectedStrengths: string[];
  expectedWeaknesses: string[];
}

export interface SeedRow {
  id: string;
  clusterKey: string;
  canonicalName: string;
  description: string;
  themes: string[];
  traits: string[];
  intents: string[];
  dimensionedTraits: DimensionedTrait[];
  durationMinutes: number;
  price: number;
  qualityScore: number;
  latitude: number;
  longitude: number;
  /** Undefined => no embedding written (distractors). */
  axisWeights?: AxisWeights;
  oracle: RowOracle;
}

interface ClusterSpec {
  key: string;
  rows: number;
  themes: string[];
  traits: string[];
  intents: string[];
  dimensionedTraits: DimensionedTrait[];
  qualityScore: number;
  durationMinutes: number;
  price: number;
  axisWeights?: AxisWeights;
  iconicity: number;
  localness: number;
  /** Only `religious_history_arch` puts religion tokens in free text. */
  freeTextTokens?: string[];
  expectedStrengths: string[];
  expectedWeaknesses: string[];
}

export const CLUSTER_META: ClusterSpec[] = [
  {
    key: 'iconic_history_arch',
    rows: 16,
    themes: ['history', 'architecture'],
    traits: ['guided_tour'],
    intents: ['walk', 'visit'],
    dimensionedTraits: [{ dimension: 'tourism_intensity', key: 'iconic' }],
    qualityScore: 4.4,
    durationMinutes: 90,
    price: 20,
    axisWeights: { history: 1, architecture: 1, iconic: 1 },
    iconicity: 0.9,
    localness: 0.1,
    expectedStrengths: ['history', 'architecture', 'iconic'],
    expectedWeaknesses: ['hidden_history', 'local'],
  },
  {
    key: 'hidden_history_arch',
    rows: 16,
    themes: ['history', 'architecture'],
    traits: ['local', 'offbeat'],
    intents: ['walk', 'visit'],
    dimensionedTraits: [
      { dimension: 'tourism_intensity', key: 'hidden' },
      { dimension: 'local_character', key: 'authentic' },
    ],
    qualityScore: 4.2,
    durationMinutes: 90,
    price: 20,
    axisWeights: { history: 1, architecture: 1, hidden_history: 1, local: 1 },
    iconicity: 0.1,
    localness: 0.9,
    expectedStrengths: ['history', 'architecture', 'hidden_history', 'local'],
    expectedWeaknesses: ['iconic'],
  },
  {
    key: 'craft_beer_crawl',
    rows: 16,
    themes: ['food'],
    traits: ['local', 'craft_beer'],
    intents: ['walk'],
    dimensionedTraits: [{ dimension: 'local_character', key: 'authentic' }],
    qualityScore: 4.2,
    durationMinutes: 120,
    price: 30,
    axisWeights: { food: 1, craft_beer: 1, local: 0.6 },
    iconicity: 0.2,
    localness: 0.8,
    expectedStrengths: ['food', 'craft_beer', 'local'],
    expectedWeaknesses: ['specialty_coffee'],
  },
  {
    key: 'specialty_coffee_tour',
    rows: 16,
    themes: ['food'],
    traits: ['local', 'specialty_coffee'],
    intents: ['walk'],
    dimensionedTraits: [{ dimension: 'local_character', key: 'authentic' }],
    qualityScore: 4.2,
    durationMinutes: 90,
    price: 18,
    axisWeights: { food: 1, specialty_coffee: 1, local: 0.6 },
    iconicity: 0.2,
    localness: 0.8,
    expectedStrengths: ['food', 'specialty_coffee', 'local'],
    expectedWeaknesses: ['craft_beer'],
  },
  {
    key: 'generic_food_walk',
    rows: 16,
    themes: ['food'],
    traits: ['local'],
    intents: ['walk'],
    dimensionedTraits: [],
    qualityScore: 4.0,
    durationMinutes: 90,
    price: 22,
    axisWeights: { food: 1, local: 0.6 },
    iconicity: 0.3,
    localness: 0.6,
    expectedStrengths: ['food', 'local'],
    expectedWeaknesses: ['craft_beer', 'specialty_coffee'],
  },
  {
    key: 'exact_fit_history',
    rows: 16,
    themes: ['history', 'architecture'],
    traits: ['local_guide'],
    intents: ['walk'],
    dimensionedTraits: [],
    qualityScore: 4.3,
    durationMinutes: 90,
    price: 20,
    axisWeights: { history: 1, architecture: 1 },
    iconicity: 0.4,
    localness: 0.5,
    expectedStrengths: ['history', 'architecture', 'local_guide'],
    expectedWeaknesses: [],
  },
  {
    key: 'generic_five_star_history',
    rows: 16,
    themes: ['history'],
    traits: [],
    intents: ['visit'],
    dimensionedTraits: [],
    qualityScore: 5.0,
    durationMinutes: 120,
    price: 40,
    axisWeights: { history: 1 },
    iconicity: 0.5,
    localness: 0.3,
    expectedStrengths: ['history'],
    expectedWeaknesses: ['architecture', 'walk'],
  },
  {
    key: 'secular_history_arch',
    rows: 20,
    themes: ['history', 'architecture'],
    traits: ['guided_tour'],
    intents: ['walk', 'visit'],
    dimensionedTraits: [],
    qualityScore: 4.1,
    durationMinutes: 90,
    price: 18,
    axisWeights: { history: 1, architecture: 1 },
    iconicity: 0.4,
    localness: 0.4,
    expectedStrengths: ['history', 'architecture'],
    expectedWeaknesses: [],
  },
  {
    key: 'religious_history_arch',
    rows: 20,
    themes: ['history', 'architecture', 'religion'],
    traits: ['religious'],
    intents: ['walk', 'visit'],
    dimensionedTraits: [],
    qualityScore: 4.9,
    durationMinutes: 90,
    price: 12,
    axisWeights: { history: 1, architecture: 1, religion: 1 },
    iconicity: 0.6,
    localness: 0.3,
    freeTextTokens: ['catedral', 'iglesia', 'templo'],
    expectedStrengths: ['history', 'architecture'],
    expectedWeaknesses: [],
  },
  {
    key: 'history_tango',
    rows: 16,
    themes: ['history', 'architecture', 'tango'],
    traits: ['performance'],
    intents: ['walk'],
    dimensionedTraits: [],
    qualityScore: 4.2,
    durationMinutes: 90,
    price: 20,
    axisWeights: { history: 1, architecture: 1, tango: 1 },
    iconicity: 0.5,
    localness: 0.5,
    expectedStrengths: ['history', 'architecture', 'tango'],
    expectedWeaknesses: [],
  },
  {
    key: 'history_plain',
    rows: 16,
    themes: ['history', 'architecture'],
    traits: [],
    intents: ['walk'],
    dimensionedTraits: [],
    qualityScore: 4.6,
    durationMinutes: 90,
    price: 20,
    axisWeights: { history: 1, architecture: 1 },
    iconicity: 0.5,
    localness: 0.4,
    expectedStrengths: ['history', 'architecture'],
    expectedWeaknesses: [],
  },
  {
    key: 'culture_misc',
    rows: 30,
    themes: ['history', 'culture', 'art'],
    traits: [],
    intents: ['visit'],
    dimensionedTraits: [],
    qualityScore: 3.6,
    durationMinutes: 90,
    price: 15,
    axisWeights: { history: 0.5 },
    iconicity: 0.4,
    localness: 0.4,
    expectedStrengths: ['history'],
    expectedWeaknesses: ['architecture', 'walk'],
  },
  {
    key: 'food_misc',
    rows: 20,
    themes: ['food', 'gastronomy'],
    traits: [],
    intents: ['food', 'visit'],
    dimensionedTraits: [],
    qualityScore: 3.5,
    durationMinutes: 90,
    price: 25,
    axisWeights: { food: 0.5 },
    iconicity: 0.3,
    localness: 0.4,
    expectedStrengths: ['food'],
    expectedWeaknesses: ['walk', 'local'],
  },
  {
    key: 'distractor_shopping',
    rows: 43,
    themes: ['shopping'],
    traits: [],
    intents: ['shopping'],
    dimensionedTraits: [],
    qualityScore: 3.0,
    durationMinutes: 60,
    price: 10,
    axisWeights: undefined,
    iconicity: 0.2,
    localness: 0.2,
    expectedStrengths: [],
    expectedWeaknesses: ['history', 'architecture', 'food'],
  },
  {
    key: 'distractor_sports',
    rows: 43,
    themes: ['sports', 'outdoor'],
    traits: [],
    intents: ['visit'],
    dimensionedTraits: [],
    qualityScore: 3.0,
    durationMinutes: 60,
    price: 10,
    axisWeights: undefined,
    iconicity: 0.2,
    localness: 0.2,
    expectedStrengths: [],
    expectedWeaknesses: ['history', 'architecture', 'food'],
  },
];

const SIGNAL_CLUSTERS = new Set(
  CLUSTER_META.filter((c) => !c.key.startsWith('distractor_')).map(
    (c) => c.key,
  ),
);

function explorationStyleTags(dts: DimensionedTrait[]): string[] {
  const tags = new Set<string>();
  for (const dt of dts) {
    if (
      dt.dimension === 'tourism_intensity' &&
      (dt.key === 'iconic' || dt.key === 'popular')
    ) {
      tags.add('exploration_style:iconic');
    }
    if (
      (dt.dimension === 'tourism_intensity' &&
        (dt.key === 'hidden' || dt.key === 'local')) ||
      (dt.dimension === 'local_character' && dt.key === 'authentic')
    ) {
      tags.add('exploration_style:local_deep_dive');
    }
    tags.add(`${dt.dimension}:${dt.key}`);
  }
  return [...tags];
}

/** Pure. Deterministic ids and coordinates; distractors farther than signal. */
export function buildCompetitiveCorpus(): SeedRow[] {
  const rows: SeedRow[] = [];
  let signalIndex = 0;
  let distractorIndex = 0;

  for (const cluster of CLUSTER_META) {
    for (let n = 0; n < cluster.rows; n++) {
      const isSignal = SIGNAL_CLUSTERS.has(cluster.key);
      let latitude: number;
      let longitude: number;
      if (isSignal) {
        latitude = ORIGIN_LAT + (signalIndex % 15) * 0.00008;
        longitude = ORIGIN_LNG + Math.floor(signalIndex / 15) * 0.00008;
        signalIndex++;
      } else {
        latitude = ORIGIN_LAT + 0.0025 + (distractorIndex % 12) * 0.00008;
        longitude =
          ORIGIN_LNG + 0.0025 + Math.floor(distractorIndex / 12) * 0.00008;
        distractorIndex++;
      }

      const globalIndex = rows.length;
      const id = `comp-${cluster.key}-${String(globalIndex).padStart(3, '0')}`;
      const namePrefix = cluster.key
        .split('_')
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(' ');
      const freeText = (cluster.freeTextTokens ?? []).join(' ');
      const canonicalName = `${namePrefix} ${n + 1}`.trim();
      const description =
        `Deterministic benchmark Experience for cluster ${cluster.key}. ${freeText}`.trim();

      const preferenceTags = [
        ...cluster.themes,
        ...cluster.traits,
        ...cluster.intents,
        ...explorationStyleTags(cluster.dimensionedTraits),
      ];

      rows.push({
        id,
        clusterKey: cluster.key,
        canonicalName,
        description,
        themes: [...cluster.themes],
        traits: [...cluster.traits],
        intents: [...cluster.intents],
        dimensionedTraits: cluster.dimensionedTraits.map((dt) => ({ ...dt })),
        durationMinutes: cluster.durationMinutes,
        price: cluster.price,
        qualityScore: cluster.qualityScore,
        latitude,
        longitude,
        axisWeights: cluster.axisWeights
          ? { ...cluster.axisWeights }
          : undefined,
        oracle: {
          cluster: cluster.key,
          axisWeights: cluster.axisWeights
            ? { ...cluster.axisWeights }
            : ({} as AxisWeights),
          iconicity: cluster.iconicity,
          localness: cluster.localness,
          preferenceTags,
          qualityScore: cluster.qualityScore,
          feasible: true,
          geoOk: true,
          expectedStrengths: [...cluster.expectedStrengths],
          expectedWeaknesses: [...cluster.expectedWeaknesses],
        },
      });
    }
  }
  return rows;
}

export const CORPUS_SIZE = buildCompetitiveCorpus().length; // 320

/** Convenience: keys used by the diversity / dominance helpers. */
export function axisWeightsFor(cluster: string): AxisWeights {
  const meta = CLUSTER_META.find((c) => c.key === cluster);
  return meta?.axisWeights ?? ({} as AxisWeights);
}

export type { Axis };
