import { TourGenerationHarness } from './support/harness';
import { osmPoi } from './support/fakes';
import { seedTour, seedVerifiedExperience } from '../support/seed';
import { ExperienceAcquisitionPlannerService } from 'src/modules/tours/services/experience-acquisition-planner.service';

const DEST = { latitude: -34.6212, longitude: -58.373 };

/**
 * The resolved destination's ISO country code is a DestinationResolution
 * fact (the harness resolves Buenos Aires with `countryCode: 'AR'`). It must
 * reach every grounded web search the real generation path issues, through
 * EVERY acquisition-plan creation path -- the preference-deficit loop and
 * the planner's residual-capacity pass -- without being re-inferred:
 *
 *   DestinationResolution.countryCode
 *     -> ExperienceDiscoveryScope.destinationCountryCode
 *     -> ExperienceAcquisitionPlan.destination
 *     -> ExperienceAcquisitionService.executeWebSourcePlan
 *     -> ExperienceGroundedSearchRequest.destinationCountryCode
 */
describe('tour-generation integration · destination country code plumbing', () => {
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

  it('carries countryCode=AR into every acquisition plan and every grounded search request, on both the deficit and the planner residual-capacity paths', async () => {
    const planner = harness.app.get(ExperienceAcquisitionPlannerService);
    const buildPlan = jest.spyOn(planner, 'buildAcquisitionPlan');

    // One real match satisfies the sole requested facet, but the portfolio
    // is thin and the planned day keeps residual capacity with an empty
    // reservoir -- both acquisition paths run.
    await seedVerifiedExperience(harness.prisma, {
      canonicalName: 'Museo de Arte Moderno de San Telmo',
      themes: ['history'],
      intents: [],
      latitude: DEST.latitude,
      longitude: DEST.longitude,
      qualityScore: 4.0,
    });
    harness.configure({
      groundedSearch: {
        provider: 'serper',
        model: 'google-search',
        evidence: [],
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

    const plannedDestinations = buildPlan.mock.calls.map(
      ([input]) => input.destination,
    );
    const residualPass = buildPlan.mock.calls.find(([input]) =>
      input.deficits.some((deficit) =>
        (deficit.reason ?? '').startsWith('Planner has'),
      ),
    );
    const deficitPass = buildPlan.mock.calls.find(
      ([input]) =>
        !input.deficits.some((deficit) =>
          (deficit.reason ?? '').startsWith('Planner has'),
        ),
    );
    // Both creation paths really ran in this generation.
    expect(deficitPass).toBeDefined();
    expect(residualPass).toBeDefined();
    for (const destination of plannedDestinations) {
      expect(destination.destinationCountryCode).toBe('AR');
    }

    const groundedRequests = harness.fakes.groundedSearch.search.mock.calls.map(
      ([request]) => request,
    );
    expect(groundedRequests.length).toBeGreaterThan(0);
    for (const request of groundedRequests) {
      expect(request.destinationCountryCode).toBe('AR');
      // A country is not a language: nothing downstream invents one.
      expect(request).not.toHaveProperty('destinationLanguage');
    }

    buildPlan.mockRestore();
  });
});
