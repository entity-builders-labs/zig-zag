import { CoverageAnalyzer } from './coverage-analyzer.service';

describe('CoverageAnalyzer', () => {
  let service: CoverageAnalyzer;

  beforeEach(() => {
    service = new CoverageAnalyzer();
  });

  const semantic = {
    status: 'applied' as const,
    eligibleCandidateCount: 4,
    indexedCandidateCount: 4,
  };

  function candidate(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      name: `Experience ${id}`,
      source: 'catalog',
      weightedScore: 4.5,
      distanceKm: 1,
      durationMinutes: 120,
      themes: ['history'],
      traits: ['walking'],
      intents: ['visit-like'],
      ...overrides,
    };
  }

  it('scales required candidate count by travel pace', () => {
    const base = {
      candidates: Array.from({ length: 5 }, (_, index) =>
        candidate(`candidate-${index}`),
      ),
      requestedThemes: [] as string[],
      days: 1,
      explorationStyle: 'balanced',
      semanticCoverage: semantic,
      offeredCandidateCount: 5,
      providerHealth: { status: 'healthy' as const },
    };

    expect(
      service.analyze({ ...base, travelPace: 'relaxed' })
        .requiredCandidateCount,
    ).toBe(3);
    expect(
      service.analyze({ ...base, travelPace: 'moderate' })
        .requiredCandidateCount,
    ).toBe(4);
    expect(
      service.analyze({ ...base, travelPace: 'fast' }).requiredCandidateCount,
    ).toBe(5);
  });

  it('keeps a mature relevant catalog local-only', () => {
    const report = service.analyze({
      candidates: Array.from({ length: 8 }, (_, index) =>
        candidate(`history-${index}`, { themes: ['history', 'architecture'] }),
      ),
      requestedThemes: ['history'],
      requestedTraits: ['walking'],
      requestedIntents: ['visit-like'],
      days: 1,
      semanticCoverage: {
        ...semantic,
        eligibleCandidateCount: 8,
        indexedCandidateCount: 8,
      },
      offeredCandidateCount: 8,
      providerHealth: { status: 'healthy' },
    });

    expect(report.status).toBe('sufficient');
    expect(report.relevantCandidateCount).toBe(8);
    expect(report.decision).toEqual({
      action: 'none',
      reason: 'coverage_sufficient',
      requiresAdditionalDiscovery: false,
    });
  });

  it('treats a large but irrelevant catalog as insufficient coverage', () => {
    const report = service.analyze({
      candidates: Array.from({ length: 300 }, (_, index) =>
        candidate(`irrelevant-${index}`, {
          themes: ['shopping'],
          traits: ['indoor'],
          intents: ['shopping-like'],
        }),
      ),
      requestedThemes: ['tango'],
      requestedTraits: ['live music'],
      requestedIntents: ['performance-like'],
      days: 1,
      semanticCoverage: {
        status: 'applied',
        eligibleCandidateCount: 300,
        indexedCandidateCount: 300,
      },
      offeredCandidateCount: 300,
      providerHealth: { status: 'healthy' },
    });

    expect(report.eligibleCandidateCount).toBe(300);
    expect(report.relevantCandidateCount).toBe(0);
    expect(report.status).toBe('insufficient');
    expect(report.decision.action).toBe('needs_additional_discovery');
    expect(report.decision.requiresAdditionalDiscovery).toBe(true);
    expect(report.deficits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: 'missing_requested_theme',
          theme: 'tango',
        }),
        expect.objectContaining({
          reason: 'missing_requested_trait',
          trait: 'live music',
        }),
        expect.objectContaining({
          reason: 'missing_requested_intent',
          intent: 'performance-like',
        }),
      ]),
    );
  });

  it('reports provider outage as degraded when no usable pool exists', () => {
    const report = service.analyze({
      candidates: [],
      requestedThemes: ['history'],
      days: 1,
      semanticCoverage: {
        status: 'unavailable',
        eligibleCandidateCount: 0,
        indexedCandidateCount: 0,
        reason: 'provider failed',
      },
      offeredCandidateCount: 0,
      providerHealth: { status: 'degraded', reason: 'quota_exhausted' },
    });

    expect(report.status).toBe('degraded');
    expect(report.decision.action).toBe('fail');
    expect(report.decision.reason).toBe(
      'provider_degraded_without_usable_pool',
    );
  });

  it('detects duration mismatch without pretending the catalog is empty', () => {
    const report = service.analyze({
      candidates: Array.from({ length: 4 }, (_, index) =>
        candidate(`long-${index}`, { durationMinutes: 360 }),
      ),
      requestedThemes: ['history'],
      preferredDurationMinutes: { max: 120 },
      days: 1,
      semanticCoverage: semantic,
      offeredCandidateCount: 4,
      providerHealth: { status: 'healthy' },
    });

    expect(report.relevantCandidateCount).toBe(4);
    expect(report.deficits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'insufficient_duration_fit' }),
      ]),
    );
  });
});
