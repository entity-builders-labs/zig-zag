import {
  rankCandidatesByRelevance,
  RankableCandidate,
} from '../../src/modules/tours/utils/candidate-ranking.util';
import { selectBoundedWindow } from '../../src/modules/tours/utils/candidate-window-selection.util';
import { filterOverlappingExperienceCandidates } from '../../src/modules/tours/utils/candidate-overlap-filter.util';
import { evaluateExperiencePreferences } from '../../src/modules/tours/utils/experience-preference-evaluator.util';
import { matchedThemesFor } from '../../src/modules/tours/utils/theme-matching.util';

/**
 * TEST 10 — REALISTIC ROSARIO-LIKE SELECTION REGRESSION
 *
 * A deterministic ~60-row catalog run through the REAL selection chain
 * (ranking -> bounded window -> overlap filter -> planner normalization ->
 * greedy sort). No Rosario-specific production code — only a catalog shaped
 * like the real bitácora that motivated this work.
 *
 * Request: interests = history, culture, architecture; explorationStyle =
 * iconic; additionalPreferences = "Quiero visitar el Monumento a la Bandera".
 * Everything is feasible. This connects CHAR-1/2/3/5/6/7 into one scenario
 * and characterizes:
 *   A. does the named landmark reach the 15-window?
 *   B. at which stage is it lost?
 *   C. can a sports-only row (0 preference, high semantic) outrank a
 *      historical one?
 *   D. does iconic -> local_deep_dive change selection coherently?
 *   E. does the trace's matched-themes signal reflect what actually matched?
 */

const WINDOW = 15;
const ITINERARY_INTENTS = ['visit', 'walk'];

const wizardFacet = (dimension: string, key: string) => ({
  dimension,
  key,
  importance: 1,
  confidence: 1,
  source: 'wizard' as const,
});

const intentFor = (explorationStyle: 'iconic' | 'local_deep_dive'): any => ({
  preferredFacets: [
    wizardFacet('theme', 'history'),
    wizardFacet('theme', 'culture'),
    wizardFacet('theme', 'architecture'),
    wizardFacet('intent', 'visit'),
    wizardFacet('exploration_style', explorationStyle),
  ],
  excludedThemes: [],
  excludedTraits: [],
  hardExclusions: [],
  softConstraints: [],
  ambiguities: [],
  dietaryPreferences: [],
  accessibilityPreferences: [],
  budgetPreferences: [],
  groupPreferences: [],
  positiveSemanticQuery: 'Quiero visitar el Monumento a la Bandera',
  notes: [],
});

interface Row {
  id: string;
  canonicalName: string;
  description: string;
  themes: string[];
  intents: string[];
  components: Array<{
    geoEntity: { name: string; latitude: number; longitude: number };
  }>;
  /** simulated 1 - cosine_distance from the vector store */
  similarity: number;
  qualityScore: number | null;
}

const MONUMENT = {
  name: 'Monumento a la Bandera',
  latitude: -32.9477,
  longitude: -60.6303,
};

function buildCatalog(): Row[] {
  const rows: Row[] = [];

  // 1. The named landmark as a standalone PLACE — facet-less (CHAR-1), so it
  //    scores 0 on preference; middling semantic similarity.
  rows.push({
    id: 'monument-standalone',
    canonicalName: 'Monumento a la Bandera',
    description: 'The National Flag Memorial.',
    themes: [], // acquired without facets
    intents: ['visit'],
    components: [{ geoEntity: { ...MONUMENT } }],
    similarity: 0.55,
    qualityScore: null,
  });

  // 2. A sprawling historical circuit that CONTAINS the monument as one of
  //    four components (CHAR-7 overlap victim/winner).
  rows.push({
    id: 'historical-circuit',
    canonicalName: 'Circuito Histórico Central',
    description: 'A long historical circuit through the city centre.',
    themes: ['history', 'culture'],
    intents: ['walk'],
    components: [
      { geoEntity: { ...MONUMENT } },
      {
        geoEntity: {
          name: 'Plaza 25 de Mayo',
          latitude: -32.947,
          longitude: -60.633,
        },
      },
      {
        geoEntity: {
          name: 'Pasaje Juramento',
          latitude: -32.977,
          longitude: -60.686,
        },
      },
      {
        geoEntity: {
          name: 'City Centre',
          latitude: -32.931,
          longitude: -60.649,
        },
      },
    ],
    similarity: 0.5,
    qualityScore: null,
  });

  // 3. 22 generic history/culture/architecture rows — real facets, moderate
  //    semantic. These fully cover the requested themes.
  for (let i = 0; i < 22; i++) {
    rows.push({
      id: `hist-${i}`,
      canonicalName: `Casa Histórica ${i}`,
      description:
        'A historic house with cultural exhibits and notable architecture.',
      themes: ['history', 'culture', 'architecture'],
      intents: ['visit'],
      components: [
        {
          geoEntity: {
            name: `Casa Histórica ${i}`,
            latitude: -32.945 + i * 0.0005,
            longitude: -60.63 + i * 0.0005,
          },
        },
      ],
      similarity: 0.45 + (i % 5) * 0.02,
      qualityScore: 4.0 + (i % 3) * 0.2,
    });
  }

  // 4. 15 sports-only rows — 0 preference match, but HIGH semantic similarity
  //    (embedding noise, like the real "Estadio" that got selected).
  for (let i = 0; i < 15; i++) {
    rows.push({
      id: `sport-${i}`,
      canonicalName: `Estadio ${i}`,
      description: 'A sports stadium.',
      themes: ['sports'],
      intents: ['visit'],
      components: [
        {
          geoEntity: {
            name: `Estadio ${i}`,
            latitude: -32.95 + i * 0.0007,
            longitude: -60.64 + i * 0.0007,
          },
        },
      ],
      similarity: 0.82 + (i % 4) * 0.01,
      qualityScore: 3.0,
    });
  }

  // 5. 21 culture_misc filler.
  for (let i = 0; i < 21; i++) {
    rows.push({
      id: `misc-${i}`,
      canonicalName: `Galería ${i}`,
      description: 'A small contemporary gallery.',
      themes: ['culture'],
      intents: ['visit'],
      components: [
        {
          geoEntity: {
            name: `Galería ${i}`,
            latitude: -32.94 + i * 0.0004,
            longitude: -60.62 + i * 0.0004,
          },
        },
      ],
      similarity: 0.3 + (i % 6) * 0.01,
      qualityScore: 3.5,
    });
  }

  return rows;
}

function runChain(explorationStyle: 'iconic' | 'local_deep_dive') {
  const catalog = buildCatalog();
  const intent = intentFor(explorationStyle);

  const preferenceById = new Map<string, number>();
  for (const row of catalog) {
    const hydrated = {
      canonicalName: row.canonicalName,
      description: row.description,
      themes: row.themes,
      traits: [] as string[],
      intents: row.intents,
      metadata: {
        themes: row.themes,
        traits: [] as string[],
        intents: row.intents,
      },
    };
    preferenceById.set(
      row.id,
      evaluateExperiencePreferences(hydrated, intent).score,
    );
  }

  const rankable: (RankableCandidate & { original: Row })[] = catalog.map(
    (row) => ({
      id: row.id,
      source: row.components.length > 1 ? 'composite' : 'poi',
      subtype: row.themes[0],
      weightedScore: row.qualityScore ?? undefined,
      preferenceScore: preferenceById.get(row.id) ?? 0,
      original: row,
    }),
  );

  const similarity = new Map(catalog.map((r) => [r.id, r.similarity]));
  const ranked = rankCandidatesByRelevance(rankable, similarity);
  const window = selectBoundedWindow(
    ranked as any,
    (c: any) => c.original.intents,
    ITINERARY_INTENTS,
    WINDOW,
  );
  const overlap = filterOverlappingExperienceCandidates(
    window.map((w: any) => ({
      id: w.candidate.id,
      rankingScore: w.scoreBreakdown.totalScore,
      components: w.candidate.original.components,
    })),
  );
  const keptIds = new Set(overlap.kept.map((k) => k.id));

  return {
    catalog,
    preferenceById,
    ranked,
    rankedIds: ranked.map((r) => r.candidate.id),
    windowIds: window.map((w: any) => w.candidate.id),
    window,
    overlapExcluded: overlap.excluded,
    keptIds,
  };
}

describe('CHAR-10 realistic Rosario-like selection regression', () => {
  const iconic = runChain('iconic');

  it('A/B — the named "Monumento a la Bandera" standalone never reaches the 15-window (facet-less => only the generic "visit" intent matches => preferenceScore 0.2, far below the real history rows at 0.8)', () => {
    // 1 of 5 facets matched (intent:visit only — themes[] is empty, CHAR-1).
    expect(iconic.preferenceById.get('monument-standalone')).toBeCloseTo(
      0.2,
      5,
    );
    // A real history/culture/architecture row matches 4 of 5.
    expect(iconic.preferenceById.get('hist-0')).toBeCloseTo(0.8, 5);
    const rankPos = iconic.rankedIds.indexOf('monument-standalone');
    // eslint-disable-next-line no-console
    console.info(
      `[CHAR-10] monument-standalone rank position = ${rankPos} / ${iconic.rankedIds.length}; in window = ${iconic.windowIds.includes(
        'monument-standalone',
      )}`,
    );
    expect(rankPos).toBeGreaterThanOrEqual(WINDOW);
    expect(iconic.windowIds).not.toContain('monument-standalone');
  });

  it('B — the only offered candidate that contains the monument is the sprawling circuit, and CHAR-7 overlap logic keeps it only because it has the most components', () => {
    const circuitInWindow = iconic.windowIds.includes('historical-circuit');
    // eslint-disable-next-line no-console
    console.info(
      `[CHAR-10] historical-circuit in window = ${circuitInWindow}; kept = ${iconic.keptIds.has(
        'historical-circuit',
      )}`,
    );
    // Whether or not it makes the window, the standalone monument does not,
    // so the user's named place only ever appears (if at all) buried inside
    // a 4-stop circuit they did not ask for.
    expect(iconic.windowIds).not.toContain('monument-standalone');
  });

  it('C — sports-only rows (preferenceScore 0, high semantic) are held BELOW every history row by the hard preference tier', () => {
    const firstSportRank = iconic.rankedIds.findIndex((id) =>
      id.startsWith('sport-'),
    );
    const lastHistRank = iconic.rankedIds
      .map((id, i) => (id.startsWith('hist-') ? i : -1))
      .filter((i) => i >= 0)
      .pop()!;
    // eslint-disable-next-line no-console
    console.info(
      `[CHAR-10] first sport rank=${firstSportRank}, last hist rank=${lastHistRank}`,
    );
    // The hard tier DOES protect against the sports-outranks-history failure
    // for rows that carry real theme facets...
    expect(firstSportRank).toBeGreaterThan(lastHistRank);
    // ...but note the facet-less monument shares the sports tier (pref 0):
    const monumentRank = iconic.rankedIds.indexOf('monument-standalone');
    expect(monumentRank).toBeGreaterThan(lastHistRank);
  });

  it('D — switching iconic -> local_deep_dive does NOT change the selected window (exploration_style has no dimensioned evidence to match — CHAR-2)', () => {
    const local = runChain('local_deep_dive');
    // eslint-disable-next-line no-console
    console.info(
      `[CHAR-10] iconic window == local window? ${JSON.stringify(iconic.windowIds) === JSON.stringify(local.windowIds)}`,
    );
    expect(local.windowIds).toEqual(iconic.windowIds);
  });

  it('E — the bitácora matched-themes signal is derived from a JSON scan, not from what the preference evaluator matched', () => {
    // A sports row that reached nowhere near a theme match still "matches"
    // history/culture/architecture if those words appear anywhere in its
    // trace metadata blob (CHAR-4). Here a plain sports row does NOT, but a
    // row whose description mentions the themes does — regardless of themes[].
    const sportsThemes = matchedThemesFor(
      { id: 's', name: 'Estadio 0', metadata: { themes: ['sports'] } } as any,
      ['history', 'culture', 'architecture'],
    );
    expect(sportsThemes).toEqual([]);
    const misleading = matchedThemesFor(
      {
        id: 'm',
        name: 'Estadio 0',
        metadata: {
          themes: ['sports'],
          note: 'near the historic culture and architecture district',
        },
      } as any,
      ['history', 'culture', 'architecture'],
    );
    // eslint-disable-next-line no-console
    console.info(
      `[CHAR-10] misleading matchedThemesFor => ${JSON.stringify(misleading)}`,
    );
    expect(misleading).toEqual(
      expect.arrayContaining(['history', 'culture', 'architecture']),
    );
  });

  it('F — determinism: the whole chain is stable across runs', () => {
    const again = runChain('iconic');
    expect(again.windowIds).toEqual(iconic.windowIds);
    expect(again.rankedIds).toEqual(iconic.rankedIds);
  });

  it.failing(
    'INVARIANT: a user who writes "Quiero visitar el Monumento a la Bandera" gets that place (standalone or as an offered candidate) in the selection window',
    () => {
      expect(
        iconic.windowIds.includes('monument-standalone') ||
          iconic.windowIds.includes('historical-circuit'),
      ).toBe(true);
      // and specifically the standalone, not only buried in a circuit:
      expect(iconic.windowIds).toContain('monument-standalone');
    },
  );

  it.failing(
    'INVARIANT: changing explorationStyle must change the selected set for an iconic-heavy request',
    () => {
      const local = runChain('local_deep_dive');
      expect(local.windowIds).not.toEqual(iconic.windowIds);
    },
  );
});
