/**
 * PRE-B6 preference-first live cutover — milestone verification.
 *
 * See docs/superpowers/plans/2026-09-13-preference-first-live-cutover.md.
 * Each `describe` block below corresponds to one milestone's specific new
 * claim, proven against the real orchestration entrypoint
 * (`ExperienceGenerationService.generateTourExperiences`) through the shared
 * `TourGenerationHarness` (real Postgres, faked external transports only) --
 * never by invoking a lower-level service directly.
 */
import { TourGenerationHarness } from './support/harness';
import { osmPoi } from './support/fakes';
import { seedTour, seedVerifiedExperience } from '../support/seed';

const DEST = { latitude: -34.6212, longitude: -58.373 };

describe('tour-generation integration · preference-first live cutover', () => {
  let harness: TourGenerationHarness;

  beforeAll(async () => {
    harness = await TourGenerationHarness.create();
  });
  afterAll(async () => {
    await harness.close();
  });
  beforeEach(async () => {
    await harness.reset();
  });

  describe('M1 — PreferenceSpec is built and live', () => {
    it('the real orchestrator builds a canonical PreferenceSpec reflecting wizard facets and the interpreter-extracted anchor, and records it in the trace', async () => {
      harness.fakes.langChain.generateChatResponse.mockResolvedValueOnce(
        JSON.stringify({
          preferredFacets: [
            {
              dimension: 'theme',
              key: 'history',
              confidence: 0.95,
              strength: 'strong',
            },
          ],
          anchoredPlaces: [
            { rawName: 'San Telmo', kind: 'area', priority: 'must' },
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
          positiveSemanticQuery: 'historical walking tour in san telmo',
          notes: [],
        }),
      );

      const tourId = await seedTour(harness.prisma, {
        destinationLabel: 'San Telmo, Buenos Aires, Argentina',
        latitude: DEST.latitude,
        longitude: DEST.longitude,
        interests: ['history'],
        intents: ['walk'],
        additionalPreferences: 'caminata histórica por San Telmo',
      });

      // Cheap catalog so generation can complete regardless of coverage
      // outcome — M1 only asserts the PreferenceSpec itself, not coverage.
      harness.configure({
        osm: { pois: [] },
        groundedSearch: { evidence: [] },
        discoveryExtractor: { candidates: [] },
      });

      await harness.generate(tourId);
      const tour = await harness.loadTour(tourId);
      const steps = harness.traceSteps(tour.trace);
      const preferenceStep = steps.find(
        (step: any) => step.stage === 'preference_interpretation',
      );

      expect(preferenceStep).toBeTruthy();
      const spec = preferenceStep.outputs.preferenceSpec;
      expect(spec).toBeTruthy();
      // Wizard theme + interpreted theme collapse into one deduped facet.
      expect(spec.facets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ dimension: 'theme', key: 'history' }),
          expect.objectContaining({ dimension: 'intent', key: 'walk' }),
        ]),
      );
      // explorationStyle is never a facet (canonical invariant).
      expect(
        spec.facets.some((f: any) => f.dimension === 'exploration_style'),
      ).toBe(false);
      expect(spec.explorationStyle).toBe('balanced');
      expect(spec.anchors).toEqual([
        { rawName: 'San Telmo', kind: 'area', priority: 'must' },
      ]);
    });
  });

  describe('M2 — FacetRetrievalService/preference-sufficiency.util.ts replace CoverageAnalyzer as the sufficiency/deficit authority', () => {
    it('a facet already strongly satisfied by the real geographic catalog short-circuits acquisition (no CoverageAnalyzer theme-matching heuristic involved)', async () => {
      // basePortfolioTarget(days=1, pace='moderate') = 1 * 4 = 4 -- seed
      // exactly that many real, strong (qualityScore >= 3.0, resolved
      // geography) 'history' matches so the WHOLE portfolio is sufficient
      // from the catalog alone, never just the single facet.
      for (let i = 0; i < 4; i++) {
        await seedVerifiedExperience(harness.prisma, {
          canonicalName: `San Telmo historic landmark ${i}`,
          themes: ['history'],
          intents: [],
          latitude: DEST.latitude + i * 0.001,
          longitude: DEST.longitude + i * 0.001,
          qualityScore: 4.0,
        });
      }

      const tourId = await seedTour(harness.prisma, {
        destinationLabel: 'San Telmo, Buenos Aires, Argentina',
        latitude: DEST.latitude,
        longitude: DEST.longitude,
        days: 1,
        interests: ['history'],
        intents: [],
      });

      const outcome = await harness.generate(tourId);
      expect(outcome.error?.message ?? 'ok').toBe('ok');

      const tour = await harness.loadTour(tourId);
      const steps = harness.traceSteps(tour.trace);
      const coverageStep = steps.find(
        (step: any) => step.stage === 'coverage_analysis',
      );
      expect(coverageStep).toBeTruthy();
      // Canonical preference-first coverage result (cutover M2 cleanup) --
      // no legacy `coverageReport` projection. Real per-facet retrieval,
      // not the legacy keyword heuristic: strong match count reflects the
      // 4 seeded rows themselves.
      expect(coverageStep.coverageReport).toBeUndefined();
      const themeCoverage = coverageStep.outputs.facetResults;
      expect(themeCoverage).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            dimension: 'theme',
            key: 'history',
            strongMatchCount: 4,
          }),
        ]),
      );
      expect(coverageStep.decision.outcome).toBe('none');
      // Sufficient on the very first pass -- no acquisition stage at all.
      expect(steps.some((step: any) => step.stage === 'discovery')).toBe(false);
    });

    it('a facet with zero strong catalog matches produces a real preference_facet deficit that routes acquisition (never a legacy CoverageDeficit)', async () => {
      harness.configure({
        groundedSearch: {
          evidence: [{ key: 'web:food:1', title: 'San Telmo food crawl' }],
        },
        discoveryExtractor: {
          candidates: [
            {
              name: 'San Telmo food crawl',
              description: 'A tasting walk through San Telmo food stalls.',
              themes: ['food'],
              intents: [],
              suggestedDurationMinutes: 90,
              evidenceKeys: ['web:food:1'],
            },
          ],
        },
        osm: {
          pois: [
            osmPoi(
              'San Telmo food crawl',
              DEST.latitude + 0.0006,
              DEST.longitude + 0.0006,
            ),
          ],
        },
      });

      const tourId = await seedTour(harness.prisma, {
        destinationLabel: 'San Telmo, Buenos Aires, Argentina',
        latitude: DEST.latitude,
        longitude: DEST.longitude,
        days: 1,
        interests: ['food'],
        intents: [],
      });

      const outcome = await harness.generate(tourId);
      expect(outcome.error?.message ?? 'ok').toBe('ok');

      const tour = await harness.loadTour(tourId);
      const steps = harness.traceSteps(tour.trace);
      const discoveryStep = steps.find(
        (step: any) => step.stage === 'discovery',
      );
      expect(discoveryStep).toBeTruthy();
      expect(discoveryStep.inputs.deficits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            dimension: 'theme',
            key: 'food',
            reason:
              'Preference facet [theme:food] has no strong catalog match yet.',
          }),
        ]),
      );

      const persisted = await harness.prisma.experience.findFirst({
        where: { canonicalName: 'San Telmo food crawl', status: 'VERIFIED' },
      });
      expect(persisted).not.toBeNull();
    });
  });

  describe('M2 — global portfolio-capacity shortage (spec §6.2/§7)', () => {
    it('all requested facets satisfied but the global eligible portfolio is below target: emits a dimensionless global_capacity deficit and still acquires', async () => {
      // Exactly ONE strong 'history' match -- satisfies the sole requested
      // facet -- but basePortfolioTarget(days=1, 'moderate') = 4, so the
      // real eligible portfolio (1) is still far below target. The OLD
      // bug: acquisitionDeficits was built only from unsatisfiedFacets, so
      // this state produced sufficient=false with ZERO deficits -- the
      // planner got nothing to route and the loop exited without ever
      // acquiring, silently leaving the portfolio thin.
      await seedVerifiedExperience(harness.prisma, {
        canonicalName: 'Museo de Arte Moderno de San Telmo',
        themes: ['history'],
        intents: [],
        latitude: DEST.latitude,
        longitude: DEST.longitude,
        qualityScore: 4.0,
      });

      harness.configure({
        wikivoyage: {
          status: 'ok',
          title: 'San Telmo',
          entries: [
            {
              name: 'Feria de San Telmo',
              lat: DEST.latitude + 0.001,
              long: DEST.longitude + 0.001,
              sectionType: 'SEE',
            },
          ],
        },
        osm: {
          pois: [
            osmPoi(
              'Feria de San Telmo',
              DEST.latitude + 0.001,
              DEST.longitude + 0.001,
            ),
          ],
        },
      });

      const tourId = await seedTour(harness.prisma, {
        destinationLabel: 'San Telmo, Buenos Aires, Argentina',
        latitude: DEST.latitude,
        longitude: DEST.longitude,
        days: 1,
        interests: ['history'],
        intents: [],
      });

      const outcome = await harness.generate(tourId);
      expect(outcome.error?.message ?? 'ok').toBe('ok');

      const tour = await harness.loadTour(tourId);
      const steps = harness.traceSteps(tour.trace);

      // The FIRST coverage_analysis pass already sees the facet satisfied
      // (1 strong 'history' match) yet the portfolio is thin -- decision
      // must still call for acquisition, never "none".
      const firstCoverage = steps.find(
        (step: any) => step.stage === 'coverage_analysis',
      );
      expect(firstCoverage.decision.outcome).not.toBe('none');

      const discoveryStep = steps.find(
        (step: any) => step.stage === 'discovery',
      );
      expect(discoveryStep).toBeTruthy();
      const globalCapacityDeficit = discoveryStep.inputs.deficits.find(
        (d: any) => d.origin === 'global_capacity',
      );
      // The canonical representation: dimensionless, never faked as a
      // theme/trait/intent facet deficit, and no facet deficit alongside it
      // (the sole requested facet was already satisfied).
      expect(globalCapacityDeficit).toBeTruthy();
      expect(globalCapacityDeficit.dimension).toBeUndefined();
      expect(globalCapacityDeficit.key).toBeUndefined();
      expect(
        discoveryStep.inputs.deficits.some(
          (d: any) => d.origin === 'preference_facet',
        ),
      ).toBe(false);

      // Acquisition actually ran and grew the real catalog.
      const persisted = await harness.prisma.experience.findFirst({
        where: { canonicalName: 'Feria de San Telmo', status: 'VERIFIED' },
      });
      expect(persisted).not.toBeNull();
    });

    it('zero requested facets but a sufficiently broad eligible catalog: sufficient, no acquisition', async () => {
      // basePortfolioTarget(days=1, 'moderate') = 4 -- seed exactly that
      // many real, distinct, non-excluded places with a real PLACE
      // component. No theme/intent requested at all: the OLD bug made
      // `distinctEligibleIds` trivially 0 regardless of real catalog size,
      // so sufficiency was permanently unreachable whenever zero facets
      // were requested.
      const names = [
        'Plaza Dorrego',
        'Mercado de San Telmo',
        'Parque Lezama',
        'Pasaje de la Defensa',
      ];
      for (let i = 0; i < names.length; i++) {
        await seedVerifiedExperience(harness.prisma, {
          canonicalName: names[i],
          themes: [],
          intents: [],
          latitude: DEST.latitude + i * 0.001,
          longitude: DEST.longitude + i * 0.001,
          qualityScore: 4.0,
        });
      }

      const tourId = await seedTour(harness.prisma, {
        destinationLabel: 'San Telmo, Buenos Aires, Argentina',
        latitude: DEST.latitude,
        longitude: DEST.longitude,
        days: 1,
        interests: [],
        intents: [],
      });

      const outcome = await harness.generate(tourId);
      expect(outcome.error?.message ?? 'ok').toBe('ok');

      const tour = await harness.loadTour(tourId);
      const steps = harness.traceSteps(tour.trace);
      const coverageStep = steps.find(
        (step: any) => step.stage === 'coverage_analysis',
      );
      expect(coverageStep.decision.outcome).toBe('none');
      // Canonical preference-first coverage result (cutover M2 cleanup) --
      // no legacy `coverageReport`/`usableCandidateCount` projection.
      expect(coverageStep.coverageReport).toBeUndefined();
      expect(coverageStep.outputs.totalDistinctEligibleExperiences).toBe(4);
      // Sufficient on the very first pass -- no acquisition stage at all.
      expect(steps.some((step: any) => step.stage === 'discovery')).toBe(false);
    });
  });
});
