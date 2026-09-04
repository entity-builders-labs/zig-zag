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
    expect(queries.every((query) => query.includes('from Buenos Aires'))).toBe(
      true,
    );
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

  it('plans exactly one query combining every preference, not one per theme/trait/intent', () => {
    // Multiple calls were tried and measured against the live provider: each
    // extra call cost real money for no quality gain, so a single
    // consolidated query is the deliberate design, not a temporary
    // simplification.
    const plan = new ExperienceDiscoveryPlannerService().plan({
      scope: { destinationName: 'San Juan, Argentina' },
      requestedThemes: ['history', 'nature', 'architecture'],
      preferredTraits: ['scenic', 'family-friendly'],
      requestedIntents: ['walk', 'route_like', 'day_trip'],
      semanticQuery: 'valle de la luna',
      breadth: 'focused',
      maxCandidates: 8,
    });

    expect(plan.queries).toHaveLength(1);
  });

  it('includes preferred traits in the single query (previously dropped entirely)', () => {
    const plan = new ExperienceDiscoveryPlannerService().plan({
      scope: { destinationName: 'Mendoza' },
      requestedThemes: ['wine'],
      preferredTraits: ['romantic'],
      breadth: 'focused',
      maxCandidates: 8,
    });

    expect(plan.queries[0].query).toContain('romantic');
  });

  it('builds a plain keyword-style query, not a long instruction sentence', () => {
    // Search engines respond to search terms, not prompts — verified
    // against the live Tavily API: a natural-language instruction sentence
    // performed worse than a short keyword join for the same preferences.
    const plan = new ExperienceDiscoveryPlannerService().plan({
      scope: { destinationName: 'San Juan, Argentina' },
      requestedThemes: ['history', 'nature', 'architecture'],
      requestedIntents: ['walk', 'route_like', 'day_trip'],
      semanticQuery: 'valle de la luna',
      breadth: 'focused',
      maxCandidates: 8,
    });

    expect(plan.queries[0].query.length).toBeLessThan(200);
    expect(plan.queries[0].query).not.toMatch(
      /\b(please|list|reachable|verifiable)\b/i,
    );
  });

  it('never leaks CoverageAnalyzer diagnostic message text into the query (regression: caused wrong-country results)', () => {
    // Real production bug: coverageGaps used to be built from
    // deficit.message (a full Spanish sentence for the Bitácora, e.g. 'No
    // hay coverage verificable para el tema solicitado "history".') and fed
    // straight into the search query, drowning it in noise that made Tavily
    // return mostly San Juan, Puerto Rico results instead of San Juan,
    // Argentina. coverageGaps must never resurface as query text.
    const plan = new ExperienceDiscoveryPlannerService().plan({
      scope: { destinationName: 'San Juan, Argentina' },
      requestedThemes: ['history'],
      coverageGaps: [
        'No hay coverage verificable para el tema solicitado "history".',
      ],
      breadth: 'focused',
      maxCandidates: 8,
    });

    expect(plan.queries[0].query).not.toMatch(/no hay|verificable|solicitado/i);
  });
});
