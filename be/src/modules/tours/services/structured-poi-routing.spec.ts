import { ExperienceAcquisitionPlannerService } from './experience-acquisition-planner.service';

describe('ExperienceAcquisitionPlannerService · structured POI route', () => {
  const planner = new ExperienceAcquisitionPlannerService();
  const deficit = {
    origin: 'global_capacity' as const,
    reason: 'Destination catalog needs places',
    currentEligibleCount: 0,
    requiredEligibleCount: 10,
  };

  it('routes a capacity gap to STRUCTURED_POI with its dependent STRUCTURED_ENTITY_FACTS batch, using only a resolved destination window', () => {
    const plan = planner.buildAcquisitionPlan({
      destination: {
        destinationName: 'Buenos Aires',
        latitude: -34.6,
        longitude: -58.38,
        radiusMeters: 5_000,
      },
      deficits: [deficit],
    });

    expect(plan.sourcePlans[0]).toEqual({
      provider: 'structured_poi',
      structuredPoi: {
        radiusMeters: 5_000,
        sourceClass: 'STRUCTURED_POI',
        routingPolicyVersion: 'gap-source-routing-v2',
        baseDiscovery: true,
        coverage: [],
        entityFacts: {
          sourceClass: 'STRUCTURED_ENTITY_FACTS',
          provider: 'wikidata',
        },
      },
    });
    expect(plan.sourcePlans.map((source) => source.provider)).toEqual([
      'structured_poi',
    ]);
  });

  it('does not invent a destination window to route structured discovery', () => {
    const plan = planner.buildAcquisitionPlan({
      destination: { destinationName: 'Buenos Aires' },
      deficits: [deficit],
    });

    expect(
      plan.sourcePlans.some((source) => source.provider === 'structured_poi'),
    ).toBe(false);
  });

  it('routes a gastronomy preference gap to food-and-drink structured coverage without destination-wide base discovery', () => {
    const plan = planner.buildAcquisitionPlan({
      destination: {
        destinationName: 'Buenos Aires',
        latitude: -34.6,
        longitude: -58.38,
        radiusMeters: 5_000,
      },
      deficits: [
        {
          origin: 'preference_facet',
          dimension: 'theme',
          key: 'gastronomy',
          reason: 'No strong gastronomy match',
        },
      ],
    });

    expect(
      plan.sourcePlans.find((source) => source.provider === 'structured_poi'),
    ).toEqual({
      provider: 'structured_poi',
      structuredPoi: {
        radiusMeters: 5_000,
        sourceClass: 'STRUCTURED_POI',
        routingPolicyVersion: 'gap-source-routing-v2',
        baseDiscovery: false,
        coverage: ['FOOD_AND_DRINK'],
        entityFacts: {
          sourceClass: 'STRUCTURED_ENTITY_FACTS',
          provider: 'wikidata',
        },
      },
    });
  });

  it('combines base discovery and food coverage when both gaps are present', () => {
    const plan = planner.buildAcquisitionPlan({
      destination: {
        destinationName: 'Buenos Aires',
        latitude: -34.6,
        longitude: -58.38,
        radiusMeters: 5_000,
      },
      deficits: [
        deficit,
        {
          origin: 'preference_facet',
          dimension: 'intent',
          key: 'food',
          reason: 'No strong food match',
        },
      ],
    });
    const structured = plan.sourcePlans.find(
      (source) => source.provider === 'structured_poi',
    );
    expect(structured).toMatchObject({
      structuredPoi: { baseDiscovery: true, coverage: ['FOOD_AND_DRINK'] },
    });
  });

  it('does not route a facet gap without structured coverage to structured discovery', () => {
    const plan = planner.buildAcquisitionPlan({
      destination: {
        destinationName: 'Buenos Aires',
        latitude: -34.6,
        longitude: -58.38,
        radiusMeters: 5_000,
      },
      deficits: [
        {
          origin: 'preference_facet',
          dimension: 'intent',
          key: 'walk',
          reason: 'No walk',
        },
      ],
    });
    expect(
      plan.sourcePlans.some((source) => source.provider === 'structured_poi'),
    ).toBe(false);
  });
});
