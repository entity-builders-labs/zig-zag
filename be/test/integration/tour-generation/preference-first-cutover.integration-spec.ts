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
      // Real per-facet retrieval, not the legacy keyword heuristic: strong
      // match count reflects the 4 seeded rows themselves.
      const themeCoverage = coverageStep.coverageReport.requestedThemeCoverage;
      expect(themeCoverage).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ theme: 'history', strongMatchCount: 4 }),
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
});
