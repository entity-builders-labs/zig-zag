import { TourGenerationHarness } from './support/harness';
import { osmPoi } from './support/fakes';
import { seedTour } from '../support/seed';

/**
 * A `food` request whose free text adds long-tail concepts ("craft beer",
 * "specialty coffee") with no shared typed identity. Since task 25.4 they are
 * unresolved concepts: they never become facets, deficits or forwarded
 * traits. The typed `food` deficit alone drives the real chain: deficit →
 * ExperienceAcquisitionPlanner → web SourcePlan → grounded search →
 * discovery extractor → an ExperienceCandidate (whose own OPEN traits are
 * catalog facts) → resolver → persistence → catalog re-query. Negative
 * preferences are never forwarded as search terms.
 */
const DEST = { latitude: -34.6, longitude: -58.42 };

describe('tour-generation integration · long-tail acquisition', () => {
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

  it('acquires through typed deficits only and never forwards unresolved concepts as traits', async () => {
    harness.fakes.langChain.generateChatResponse.mockResolvedValue(
      JSON.stringify({
        assertions: [],
        unresolvedConcepts: [
          {
            label: 'craft beer',
            polarity: 'INCLUDE',
            constraint: 'SOFT',
            evidence: ['cerveza artesanal'],
          },
          {
            label: 'specialty coffee',
            polarity: 'INCLUDE',
            constraint: 'SOFT',
            evidence: ['café de especialidad'],
          },
          {
            label: 'tourist trap',
            polarity: 'EXCLUDE',
            constraint: 'SOFT',
            evidence: ['nada turístico'],
          },
        ],
        positiveSemanticQuery:
          'craft beer taprooms and specialty coffee roasters in Buenos Aires',
      }),
    );

    harness.configure({
      groundedSearch: { evidence: [{ key: 'web:lt:1' }] },
      discoveryExtractor: {
        // A stable candidate carrying the open long-tail traits (in the same
        // canonical snake form the web SourcePlan forwards them as).
        candidates: [
          {
            name: 'Palermo craft beer & specialty coffee crawl',
            themes: ['food'],
            traits: ['craft_beer', 'specialty_coffee'],
            intents: ['food'],
            evidenceKeys: ['web:lt:1'],
          },
        ],
      },
      osm: {
        pois: [
          osmPoi(
            'Palermo craft beer & specialty coffee crawl',
            DEST.latitude,
            DEST.longitude,
          ),
        ],
      },
    });

    const tourId = await seedTour(harness.prisma, {
      destinationLabel: 'Buenos Aires',
      latitude: DEST.latitude,
      longitude: DEST.longitude,
      radiusMeters: 12000,
      days: 1,
      interests: ['food'],
      intents: ['food'],
      additionalPreferences:
        'quiero cerveza artesanal y café de especialidad, nada turístico',
    });

    const outcome = await harness.generate(tourId);
    expect(outcome.error?.message ?? 'ok').toBe('ok');

    // The web SourcePlan ran from the typed food deficit.
    expect(harness.fakes.groundedSearch.search).toHaveBeenCalled();
    const extractCall =
      harness.fakes.discoveryExtractor.extractExperiences.mock.calls[0];
    expect(extractCall).toBeDefined();
    const discoveryRequest = extractCall[0] as any;
    expect(discoveryRequest.requestedThemes).toEqual(['food']);
    // Unresolved concepts are never routed as traits or deficits.
    expect(discoveryRequest).not.toHaveProperty('preferredTraits');
    expect(
      discoveryRequest.coverageGaps.some((gap: string) =>
        /craft|coffee|trait/i.test(gap),
      ),
    ).toBe(false);

    // Negative preference never forwarded as a search term.
    const groundedArgs = JSON.stringify(
      harness.fakes.groundedSearch.search.mock.calls,
    ).toLowerCase();
    expect(groundedArgs).not.toContain('tourist');
    expect(JSON.stringify(discoveryRequest).toLowerCase()).not.toContain(
      'tourist trap',
    );

    // Persisted with the open traits preserved (not coerced into an enum).
    const persisted = await harness.prisma.experience.findFirst({
      where: { canonicalName: 'Palermo craft beer & specialty coffee crawl' },
    });
    expect(persisted).not.toBeNull();
    const traits = (persisted!.metadata as any)?.traits ?? [];
    expect(traits).toEqual(
      expect.arrayContaining(['craft_beer', 'specialty_coffee']),
    );

    // And it reached the planned Tour.
    const tour = await harness.loadTour(tourId);
    expect(
      tour.tourExperiences.some((te) => te.experienceId === persisted!.id),
    ).toBe(true);
  });
});
