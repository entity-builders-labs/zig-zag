import { ExperienceAcquisitionPlannerService } from './experience-acquisition-planner.service';

describe('ExperienceAcquisitionPlannerService · structured POI route', () => {
  const planner = new ExperienceAcquisitionPlannerService();
  const deficit = {
    origin: 'global_capacity' as const,
    reason: 'Destination catalog needs places',
    currentEligibleCount: 0,
    requiredEligibleCount: 10,
  };

  it('routes a capacity gap to STRUCTURED_POI using only a resolved destination window', () => {
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
      structuredPoi: { radiusMeters: 5_000 },
    });
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
});
