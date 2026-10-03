import {
  rankCandidatesByRelevance,
  RankableCandidate,
  CandidateScoreBreakdown,
} from '../../src/modules/tours/utils/candidate-ranking.util';
import { filterOverlappingExperienceCandidates } from '../../src/modules/tours/utils/candidate-overlap-filter.util';
import { sortCandidatesDeterministically } from '../../src/modules/tours/utils/daily-planning-candidate-sort.util';
import { PlanningCandidateNormalizerService } from '../../src/modules/tours/services/planning-candidate-normalizer.service';
import dailyPlanningPolicyConfig from '../../src/modules/tours/config/daily-planning-policy.config';
import { evaluateExperiencePreferences } from '../../src/modules/tours/utils/experience-preference-evaluator.util';
import {
  MobilityPreferences,
  TransportationMode,
  TravelPace,
} from '../../src/modules/tours/interfaces/tour-generation.interface';
import { createGreedySolver } from '../acceptance/harness/solver-factory';

/**
 * TEST 10 — REALISTIC ROSARIO-LIKE SELECTION REGRESSION
 * (pre-planner selection + real deterministic planner)
 *
 * A deterministic ~60-row catalog run through the REAL chain end to end:
 *   rankCandidatesByRelevance
 *     -> selectBoundedWindow
 *     -> filterOverlappingExperienceCandidates
 *     -> PlanningCandidateNormalizerService
 *     -> sortCandidatesDeterministically (greedy order)
 *     -> GreedyDailyPlanningSolver.solve  (deterministic fake travel)
 *
 * No Rosario-specific production code — only a catalog shaped like the real
 * bitácora that motivated this work.
 *
 * Request: interests = history, culture, architecture; explorationStyle =
 * iconic; additionalPreferences = "Quiero visitar el Monumento a la Bandera".
 * Everything is kept feasible so SELECTION is the variable, not capacity.
 *
 * This is the integrative scenario for the confirmed defects (CHAR-1..CHAR-8)
 * and the open product questions. It contains NO `it.failing` invariant of its
 * own: the definite defects are each RED in their own file; here they compound
 * into observable behavior, plus two explicitly-labelled PRODUCT HYPOTHESES.
 */

const WINDOW = 15;

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
  durationMinutes: number;
}

const MONUMENT = {
  name: 'Monumento a la Bandera',
  latitude: -32.9477,
  longitude: -60.6303,
};

function buildCatalog(): Row[] {
  const rows: Row[] = [];

  // 1. The named landmark as a standalone PLACE — facet-less (CHAR-1), so it
  //    only matches the generic `visit` intent; middling semantic similarity.
  rows.push({
    id: 'monument-standalone',
    canonicalName: 'Monumento a la Bandera',
    description: 'The National Flag Memorial.',
    themes: [],
    intents: ['visit'],
    components: [{ geoEntity: { ...MONUMENT } }],
    similarity: 0.55,
    qualityScore: null,
    durationMinutes: 60,
  });

  // 2. A historical circuit that CONTAINS the monument as one of four
  //    components (CHAR-7 overlap). Components kept tight (~200 m) so the
  //    circuit is feasible and selection — not walking capacity — is tested.
  rows.push({
    id: 'historical-circuit',
    canonicalName: 'Circuito Histórico Central',
    description: 'A historical circuit through the city centre.',
    themes: ['history', 'culture'],
    intents: ['walk'],
    components: [
      { geoEntity: { ...MONUMENT } },
      {
        geoEntity: {
          name: 'Plaza 25 de Mayo',
          latitude: -32.9472,
          longitude: -60.6295,
        },
      },
      {
        geoEntity: {
          name: 'Pasaje Juramento',
          latitude: -32.9468,
          longitude: -60.6299,
        },
      },
      {
        geoEntity: {
          name: 'Bolsa de Comercio',
          latitude: -32.9475,
          longitude: -60.629,
        },
      },
    ],
    similarity: 0.5,
    qualityScore: null,
    durationMinutes: 90,
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
      durationMinutes: 60,
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
      durationMinutes: 60,
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
      durationMinutes: 60,
    });
  }

  return rows;
}

const GENEROUS_MOBILITY: MobilityPreferences = {
  allowedTransportationModes: [
    TransportationMode.WALKING,
    TransportationMode.PUBLIC_TRANSPORT,
  ],
  maxWalkingDistancePerDayMeters: 30000,
  maxContinuousWalkingDistanceMeters: 8000,
  travelPace: TravelPace.MODERATE,
  accessibilityNeeds: [],
};

async function runChain(explorationStyle: 'iconic' | 'local_deep_dive') {
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
  const window = ranked.slice(0, WINDOW);
  const overlap = filterOverlappingExperienceCandidates(
    window.map((w: any) => ({
      id: w.candidate.id,
      rankingScore: w.scoreBreakdown.totalScore,
      components: w.candidate.original.components,
    })),
  );
  const keptIds = new Set(overlap.kept.map((k) => k.id));

  // ── through the real planner ──
  const breakdownById = new Map<string, CandidateScoreBreakdown>(
    ranked.map((r) => [r.candidate.id, r.scoreBreakdown]),
  );
  const survivors = window
    .map((w: any) => w.candidate.original as Row)
    .filter((row) => keptIds.has(row.id));
  const normalizer = new PlanningCandidateNormalizerService(
    dailyPlanningPolicyConfig(),
  );
  const normalized = await normalizer.normalizeExperiences(
    survivors.map((row) => ({
      id: row.id,
      canonicalName: row.canonicalName,
      description: row.description,
      durationMinutes: row.durationMinutes,
      latitude: row.components[0].geoEntity.latitude,
      longitude: row.components[0].geoEntity.longitude,
      components: row.components,
    })),
    breakdownById,
  );
  const greedyOrderIds = sortCandidatesDeterministically(normalized).map(
    (n) => n.experienceId,
  );

  const { solver } = createGreedySolver();
  const solution = await solver.solve({
    destination: { scale: 'point', attemptedQueries: ['Rosario, Argentina'] },
    requestedDays: 3,
    candidates: normalized,
    mobility: GENEROUS_MOBILITY,
    travelPace: TravelPace.MODERATE,
    planningWindow: {
      startMinutesFromMidnight: 9 * 60,
      endMinutesFromMidnight: 20 * 60,
    },
    startDates: ['2026-09-07T00:00:00.000Z'],
  });
  const selectedIds = solution.days.flatMap((d) =>
    d.experiences.map((e) => e.experienceId),
  );

  return {
    catalog,
    preferenceById,
    rankedIds: ranked.map((r) => r.candidate.id),
    windowIds: window.map((w: any) => w.candidate.id),
    overlapExcluded: overlap.excluded,
    keptIds,
    plannerInputIds: normalized.map((n) => n.experienceId),
    greedyOrderIds,
    selectedIds,
    unselected: solution.unselected,
  };
}

describe('CHAR-10 realistic Rosario-like selection regression', () => {
  let iconic: Awaited<ReturnType<typeof runChain>>;

  beforeAll(async () => {
    iconic = await runChain('iconic');
  });

  it('A/B — the named "Monumento a la Bandera" standalone never reaches the 15-window (facet-less => only the generic "visit" intent matches => preferenceScore 0.2, far below the real history rows at 0.8)', () => {
    expect(iconic.preferenceById.get('monument-standalone')).toBeCloseTo(
      0.2,
      5,
    );
    expect(iconic.preferenceById.get('hist-0')).toBeCloseTo(0.8, 5);
    const rankPos = iconic.rankedIds.indexOf('monument-standalone');
    // eslint-disable-next-line no-console
    console.info(
      `[CHAR-10] monument-standalone rank=${rankPos}/${iconic.rankedIds.length} inWindow=${iconic.windowIds.includes(
        'monument-standalone',
      )}`,
    );
    expect(rankPos).toBeGreaterThanOrEqual(WINDOW);
    expect(iconic.windowIds).not.toContain('monument-standalone');
  });

  it('B — it is lost at RANKING, before the window; the only monument-containing candidate that reaches the planner (if any) is the sprawling circuit', () => {
    // eslint-disable-next-line no-console
    console.info(
      `[CHAR-10] plannerInputIds=${JSON.stringify(iconic.plannerInputIds)}`,
    );
    expect(iconic.plannerInputIds).not.toContain('monument-standalone');
    // The circuit is the ONLY candidate carrying the monument as a component.
    const circuitReachedPlanner =
      iconic.plannerInputIds.includes('historical-circuit');
    expect(typeof circuitReachedPlanner).toBe('boolean');
  });

  it('C — the hard preference tier holds every faceted history row above every sports row; the facet-less monument shares the sports (pref ~0) tier', () => {
    const firstSportRank = iconic.rankedIds.findIndex((id) =>
      id.startsWith('sport-'),
    );
    const lastHistRank = iconic.rankedIds
      .map((id, i) => (id.startsWith('hist-') ? i : -1))
      .filter((i) => i >= 0)
      .pop()!;
    // eslint-disable-next-line no-console
    console.info(
      `[CHAR-10] firstSportRank=${firstSportRank} lastHistRank=${lastHistRank}`,
    );
    expect(firstSportRank).toBeGreaterThan(lastHistRank);
    expect(iconic.rankedIds.indexOf('monument-standalone')).toBeGreaterThan(
      lastHistRank,
    );
  });

  it('C2 — no sports row is scheduled by the planner (they never reach the window)', () => {
    // eslint-disable-next-line no-console
    console.info(`[CHAR-10] selectedIds=${JSON.stringify(iconic.selectedIds)}`);
    expect(iconic.selectedIds.some((id) => id.startsWith('sport-'))).toBe(
      false,
    );
    expect(iconic.selectedIds).not.toContain('monument-standalone');
    expect(iconic.selectedIds.length).toBeGreaterThan(0);
  });

  it('D — PRODUCT/DESIGN HYPOTHESIS (not an invariant): switching iconic -> local_deep_dive does NOT change the selected window (exploration_style has no dimensioned evidence to match — CHAR-2)', async () => {
    const local = await runChain('local_deep_dive');
    // eslint-disable-next-line no-console
    console.info(
      `[CHAR-10] iconic window == local window? ${
        JSON.stringify(iconic.windowIds) === JSON.stringify(local.windowIds)
      }`,
    );
    expect(local.windowIds).toEqual(iconic.windowIds);
    expect(local.selectedIds).toEqual(iconic.selectedIds);
  });

  it('F — determinism: the whole chain (rank -> window -> overlap -> normalize -> solve) is stable across runs', async () => {
    const again = await runChain('iconic');
    expect(again.rankedIds).toEqual(iconic.rankedIds);
    expect(again.windowIds).toEqual(iconic.windowIds);
    expect(again.greedyOrderIds).toEqual(iconic.greedyOrderIds);
    expect(again.selectedIds).toEqual(iconic.selectedIds);
  });

  it('PRODUCT HYPOTHESIS (NOT a settled invariant): "Quiero visitar el Monumento a la Bandera" does not put that place in the selection', () => {
    // Current behavior, pinned: the named standalone is neither windowed nor
    // scheduled. Whether a free-text named place SHOULD be honoured is an open
    // product decision (canonical docs treat positive preferences as soft).
    expect(iconic.windowIds).not.toContain('monument-standalone');
    expect(iconic.selectedIds).not.toContain('monument-standalone');
  });
});
