import {
  axisCosine,
  projectAxisVector,
  queryToAxisWeights,
} from './support/experience-selection/axis-oracle';
import {
  clusterShare,
  feasibleNonSelected,
  findStrictlyDominatedSelections,
  plan,
  poolCandidateIds,
  poolHasCluster,
  selected,
  selectedClusters,
  summarizeSelectionDiversity,
} from './support/experience-selection/assertions';
import { COUNTERFACTUALS } from './support/experience-selection/profiles';
import { seedCompetitiveCorpus } from './support/experience-selection/seed';
import {
  reverifyCorpus,
  snapshotCorpus,
  CorpusSnapshot,
} from './support/experience-selection/snapshot';
import {
  bootstrapCompetitiveApp,
  CompetitiveHarness,
  traceStep,
} from './support/experience-selection/harness';
import { RowOracle, SeedRow } from './support/experience-selection/corpus';

jest.setTimeout(300_000);

/**
 * Phase 7 Checkpoint G — engine-quality benchmark.
 *
 * ONE shared competitive corpus (~320 rows, seeded once, never mutated) is
 * reused across several user profiles. Real AppModule / Postgres / pgvector /
 * outbox / coverage / ranking / normalizer / solver / feasibility /
 * materialization / trace. Faked: preference interpreter (LangChain),
 * embeddings (a deterministic multi-axis oracle), routing (Haversine).
 *
 * Assertions are directional (cluster identity / cluster share), not exact ids.
 * If a reasonable counterfactual does not pass, that is Outcome C — reported,
 * not loosened.
 */
describe('Experience selection — competitive engine-quality benchmark (CP-G)', () => {
  let h: CompetitiveHarness;
  let token: string;
  let seedRows: SeedRow[];
  let oracleById: Map<string, RowOracle>;
  let snap: CorpusSnapshot;
  const diagnostics: any[] = [];

  beforeAll(async () => {
    h = await bootstrapCompetitiveApp();
    await h.truncateAll(); // wipes `user` — must precede authenticate()
    token = await h.authenticate();
    ({ seedRows, oracleById } = await seedCompetitiveCorpus(h.prisma));
    snap = await snapshotCorpus(h.prisma);
    expect(snap.count).toBe(seedRows.length);
    expect(seedRows.length).toBeGreaterThanOrEqual(300);
  });

  afterEach(async () => {
    await reverifyCorpus(h.prisma, snap); // corpus is never mutated between profiles
    await h.truncateToursOnly();
  });

  afterAll(async () => {
    // eslint-disable-next-line no-console
    console.info('[CP-G][diagnostics]', JSON.stringify(diagnostics, null, 2));
    await h?.close();
  });

  /* ---------------------------------------------------------------- *
   * Axis-oracle properties (pure — different query ⇒ different vector,
   * stored vectors frozen; the directional cosine deltas CF1/CF2 lean on).
   * ---------------------------------------------------------------- */
  describe('axis-oracle properties', () => {
    const q = (interests: string, style: string, extra: string) =>
      `Interests: ${interests}\nExploration style: ${style}\nAdditional preferences: ${extra}`;

    it('CF1: query vectors diverge by exploration style; overlap follows the axis weights', () => {
      const qA = q(
        'history, architecture',
        'iconic',
        'iconic must-see landmarks and famous historic architecture',
      );
      const qB = q(
        'history, architecture',
        'local deep dive',
        'hidden history in local neighborhoods, offbeat residential streets',
      );
      const wA = queryToAxisWeights(qA);
      const wB = queryToAxisWeights(qB);
      expect(projectAxisVector(wA)).not.toEqual(projectAxisVector(wB));

      const iconicRow = { history: 1, architecture: 1, iconic: 1 };
      const hiddenRow = {
        history: 1,
        architecture: 1,
        hidden_history: 1,
        local: 1,
      };
      // A leans iconic; B leans hidden — by a wide margin, both directions.
      expect(
        axisCosine(wA, iconicRow) - axisCosine(wA, hiddenRow),
      ).toBeGreaterThan(0.3);
      expect(
        axisCosine(wB, hiddenRow) - axisCosine(wB, iconicRow),
      ).toBeGreaterThan(0.3);
    });

    it('CF2: craft-beer vs specialty-coffee query vectors diverge directionally', () => {
      const qA = q(
        'food',
        'balanced',
        'craft beer crawl through local breweries and taprooms',
      );
      const qB = q(
        'food',
        'balanced',
        'specialty coffee tasting tour, local roasters and cafes',
      );
      const wA = queryToAxisWeights(qA);
      const wB = queryToAxisWeights(qB);
      expect(projectAxisVector(wA)).not.toEqual(projectAxisVector(wB));

      const beerRow = { food: 1, craft_beer: 1, local: 0.6 };
      const coffeeRow = { food: 1, specialty_coffee: 1, local: 0.6 };
      expect(
        axisCosine(wA, beerRow) - axisCosine(wA, coffeeRow),
      ).toBeGreaterThan(0.3);
      expect(
        axisCosine(wB, coffeeRow) - axisCosine(wB, beerRow),
      ).toBeGreaterThan(0.3);
    });

    it('stored corpus vectors are byte-stable across the run', async () => {
      await reverifyCorpus(h.prisma, snap);
    });
  });

  it('keeps explorationStyle outside facet coverage and acquisition semantics', () => {
    const interpretation = COUNTERFACTUALS[0].variants[0].interpretation;
    expect(interpretation.preferredFacets).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimension: 'exploration_style' }),
      ]),
    );
  });

  /* ---------------------------------------------------------------- *
   * Generic gates — asserted on every generated tour.
   * ---------------------------------------------------------------- */
  function assertGenericGates(tour: any): void {
    const coverage = traceStep(tour, 'coverage_analysis');
    expect(coverage.decision.outcome).toBe('none');
    expect(
      coverage.outputs.totalDistinctEligibleExperiences,
    ).toBeGreaterThanOrEqual(250);
    expect(traceStep(tour, 'candidate_pool').candidates.length).toBeGreaterThan(
      0,
    );
    expect(tour.metadata.generationTrace.version).toBe(4);
    expect(
      tour.metadata.generationTrace.steps.some(
        (s: any) => s.stage === 'discovery',
      ),
    ).toBe(false);
    expect(
      tour.metadata.generationTrace.steps.some((s: any) =>
        [
          'entity_resolution',
          'geographic_validation',
          'catalog_materialization',
        ].includes(s.stage),
      ),
    ).toBe(false);
    expect(tour.metadata.executionSummary.status).toBe('completed');
    expect(tour.experiences.length).toBeGreaterThanOrEqual(3);
  }

  /* ---------------------------------------------------------------- *
   * The five counterfactuals.
   * ---------------------------------------------------------------- */
  for (const cf of COUNTERFACTUALS) {
    describe(cf.title, () => {
      const tours: Record<string, any> = {};

      for (const variant of cf.variants) {
        it(`${variant.name}: selection direction, dominance, determinism`, async () => {
          h.setInterpretation(variant.interpretation);
          const tour = await h.generateTour(token, variant.request);
          tours[variant.name] = tour;

          assertGenericGates(tour);

          const clusters = selectedClusters(tour);
          const rows = selected(tour);
          const diversity = summarizeSelectionDiversity(tour);
          diagnostics.push({
            cf: cf.key,
            variant: variant.name,
            selectedClusters: clusters,
            diversity,
          });

          if (variant.expectDominantCluster) {
            expect(poolHasCluster(tour, variant.expectDominantCluster)).toBe(
              true,
            );
          }

          // No strictly-dominated selection on a requested dimension.
          expect(
            findStrictlyDominatedSelections(
              variant.requestedFacetKeys,
              rows,
              feasibleNonSelected(
                tour,
                seedRows,
                cf.key === 'hard-exclusion'
                  ? (row) => row.themes.includes('religion')
                  : undefined,
              ),
              oracleById,
            ),
          ).toEqual([]);

          // Determinism: same request twice ⇒ deep-equal plan.
          h.setInterpretation(variant.interpretation);
          const again = await h.generateTour(token, variant.request);
          expect(plan(again)).toEqual(plan(tour));
        });
      }

      it('cross-variant behavior', () => {
        if (cf.key === 'iconic-vs-local') {
          expect(plan(tours['1A-iconic'])).not.toEqual(plan(tours['1B-local']));
          expect(
            clusterShare(tours['1A-iconic'], 'iconic_history_arch'),
          ).toBeGreaterThan(
            clusterShare(tours['1A-iconic'], 'hidden_history_arch'),
          );
          expect(
            clusterShare(tours['1B-local'], 'hidden_history_arch'),
          ).toBeGreaterThan(
            clusterShare(tours['1B-local'], 'iconic_history_arch'),
          );
        }

        if (cf.key === 'craft-beer-vs-coffee') {
          expect(plan(tours['2A-craft-beer'])).not.toEqual(
            plan(tours['2B-specialty-coffee']),
          );
          expect(
            clusterShare(tours['2A-craft-beer'], 'craft_beer_crawl'),
          ).toBeGreaterThan(
            clusterShare(tours['2B-specialty-coffee'], 'craft_beer_crawl'),
          );
          expect(
            clusterShare(tours['2B-specialty-coffee'], 'specialty_coffee_tour'),
          ).toBeGreaterThan(
            clusterShare(tours['2A-craft-beer'], 'specialty_coffee_tour'),
          );
        }

        if (cf.key === 'exact-fit-vs-quality') {
          const tour = tours['3-only'];
          expect(clusterShare(tour, 'exact_fit_history')).toBeGreaterThan(
            clusterShare(tour, 'generic_five_star_history'),
          );
        }

        if (cf.key === 'hard-exclusion') {
          const tour = tours['4-only'];
          expect(
            selected(tour).every((r) => !r.themes.includes('religion')),
          ).toBe(true);
          expect(poolHasCluster(tour, 'religious_history_arch')).toBe(false);
          expect(
            poolCandidateIds(tour).every((id) => !id.includes('-religious_')),
          ).toBe(true);
        }

        if (cf.key === 'one-preference-delta') {
          const b = tours['5B-baseline'];
          const a = tours['5A-plus-tango'];
          expect(plan(a)).not.toEqual(plan(b));
          expect(clusterShare(a, 'history_tango')).toBeGreaterThan(
            clusterShare(b, 'history_tango'),
          );
        }
      });
    });
  }
});
