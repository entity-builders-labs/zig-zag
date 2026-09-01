import {
  ExperienceCandidate,
  ExperienceDiscoveryPlan,
} from './experience-discovery.interface';

describe('Experience discovery V2 contracts', () => {
  it('represents a single-place experience without a structural kind', () => {
    const candidate: ExperienceCandidate = {
      name: 'Visitar MALBA',
      themes: ['art'],
      traits: ['single_place', 'indoor'],
      componentHints: [
        {
          key: 'malba',
          name: 'MALBA',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['e1'],
        },
      ],
      evidenceKeys: ['e1'],
      shortReason: 'Museum visit grounded in supplied evidence.',
    };

    expect(candidate).not.toHaveProperty('kind');
    expect(candidate.componentHints).toHaveLength(1);
  });

  it('keeps discovery fan-out provider-neutral and bounded', () => {
    const plan: ExperienceDiscoveryPlan = {
      queries: [
        {
          query: 'San Telmo historic walking experiences',
          purpose: 'coverage_gap',
          expectedEvidence: ['ordered stops', 'walk identity'],
        },
      ],
      enrichmentAllowed: true,
    };

    expect(plan.queries).toHaveLength(1);
    expect(plan.queries[0]).not.toHaveProperty('provider');
  });
});
