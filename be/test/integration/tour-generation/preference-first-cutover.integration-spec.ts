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
import { seedTour } from '../support/seed';

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
});
