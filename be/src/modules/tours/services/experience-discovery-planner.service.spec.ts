import { ExperienceDiscoveryPlannerService } from './experience-discovery-planner.service';

describe('ExperienceDiscoveryPlannerService', () => {
  it('plans bounded provider-neutral experience queries without structural kinds', () => {
    const plan = new ExperienceDiscoveryPlannerService().plan({
      scope: { destinationName: 'Gualeguaychú' },
      requestedThemes: ['nature', 'food'],
      semanticQuery: 'costanera carnaval',
      coverageGaps: ['local waterfront experiences'],
      breadth: 'focused',
      maxCandidates: 8,
    });

    expect(plan.queries.length).toBeLessThanOrEqual(4);
    expect(plan.queries.map((q) => q.purpose)).toContain('coverage_gap');
    expect(plan.queries.join(' ')).not.toMatch(/targetKind|ActivityKind|NEIGHBORHOOD_WALK/);
    expect(plan.enrichmentAllowed).toBe(true);
  });
});
