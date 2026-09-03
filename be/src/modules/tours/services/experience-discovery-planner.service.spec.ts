import { ExperienceDiscoveryPlannerService } from './experience-discovery-planner.service';

describe('ExperienceDiscoveryPlannerService', () => {
  it('plans bounded provider-neutral experience queries without structural kinds', () => {
    const plan = new ExperienceDiscoveryPlannerService().plan({
      scope: {
        destinationName: 'Gualeguaychú',
      },
      requestedThemes: ['nature', 'food'],
      requestedIntents: ['walk'],
      semanticQuery: 'costanera carnaval',
      coverageGaps: ['local waterfront experiences'],
      breadth: 'focused',
      maxCandidates: 8,
    });

    expect(plan.queries.length).toBeLessThanOrEqual(4);
    expect(plan.queries.map((q) => q.purpose)).toContain('coverage_gap');
    expect(plan.queries.map((q) => q.query).join(' ')).toContain(
      'Gualeguaychú',
    );
    expect(plan.queries.map((q) => q.query).join(' ')).toContain('walk');
    expect(plan.queries.join(' ')).not.toMatch(
      /targetKind|ActivityKind|NEIGHBORHOOD_WALK/,
    );
    expect(plan.enrichmentAllowed).toBe(true);
  });

  it('treats day_trip as a soft FROM-base same-day facet without an origin-bound model', () => {
    const plan = new ExperienceDiscoveryPlannerService().plan({
      scope: { destinationName: 'Buenos Aires' },
      requestedThemes: ['nature', 'gastronomy'],
      requestedIntents: ['day_trip'],
      semanticQuery: 'local culture',
      coverageGaps: ['missing requested intent day_trip'],
      breadth: 'focused',
      maxCandidates: 8,
    });

    const queries = plan.queries.map(({ query }) => query);
    expect(queries.length).toBeGreaterThan(0);
    expect(
      queries.every((query) => query.includes('from Buenos Aires')),
    ).toBe(true);
    expect(
      queries.every((query) => query.includes('returning the same day')),
    ).toBe(true);
    expect(queries.every((query) => query.includes('no overnight'))).toBe(true);
    expect(queries[0]).toContain('day trips from Buenos Aires');
    expect(JSON.stringify(plan)).not.toMatch(
      /originName|sameDayReturn|maxOutboundTravelMinutes|origin_bound_open|OvernightPolicy/i,
    );
  });

  it('keeps non-day-trip facets destination-local', () => {
    const plan = new ExperienceDiscoveryPlannerService().plan({
      scope: { destinationName: 'Buenos Aires' },
      requestedThemes: ['culture'],
      requestedIntents: ['walk'],
      breadth: 'focused',
      maxCandidates: 8,
    });

    expect(plan.queries[0].query).toContain('Buenos Aires');
    expect(plan.queries[0].query).toContain('walk');
    expect(plan.queries[0].query).not.toContain('day trips from Buenos Aires');
  });
});
