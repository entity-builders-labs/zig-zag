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

  function poiCandidate(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      name: `POI ${id}`,
      source: 'google_places',
      type: 'museum',
      weightedScore: 4.5,
      distanceKm: 1,
      ...overrides,
    };
  }

  it('scales required candidate count by travelPace', () => {
    const base = {
      candidates: Array.from({ length: 4 }, (_, index) =>
        poiCandidate(`candidate-${index}`),
      ),
      requestedThemes: [] as string[],
      days: 1,
      explorationStyle: 'balanced',
      semanticCoverage: semantic,
      offeredCandidateCount: 4,
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

  it('chooses Places Text Search for a conventional theme-only deficit', () => {
    const report = service.analyze({
      candidates: [
        poiCandidate('1'),
        poiCandidate('2'),
        poiCandidate('3'),
        poiCandidate('4'),
      ],
      requestedThemes: ['beach'],
      days: 1,
      explorationStyle: 'balanced',
      semanticCoverage: semantic,
      offeredCandidateCount: 4,
      providerHealth: { status: 'healthy' },
    });

    expect(report.status).toBe('sufficient');
    expect(report.decision.action).toBe('places_text_search');
    expect(report.decision.reason).toBe('missing_requested_theme');
  });

  it('reports provider outage as degraded when no usable pool exists', () => {
    const report = service.analyze({
      candidates: [],
      requestedThemes: ['history'],
      days: 1,
      explorationStyle: 'balanced',
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

  it('does not block when a requested experience shape has zero candidates', () => {
    const report = service.analyze({
      candidates: [
        poiCandidate('1'),
        poiCandidate('2'),
        poiCandidate('3'),
        poiCandidate('4'),
      ],
      requestedThemes: [],
      days: 1,
      explorationStyle: 'balanced',
      semanticCoverage: semantic,
      offeredCandidateCount: 4,
      providerHealth: { status: 'healthy' },
    });

    expect(report.deficits).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: 'missing_requested_experience_format',
        }),
      ]),
    );
    expect(report.decision.action).toBe('none');
  });

  it('does not add a structural deficit when a different experience shape exists', () => {
    const report = service.analyze({
      candidates: [
        poiCandidate('1'),
        poiCandidate('2'),
        poiCandidate('3'),
        poiCandidate('4'),
        {
          id: 'route-1',
          name: 'Costanera route',
          source: 'catalog',
          distanceKm: 1,
        },
      ],
      requestedThemes: [],
      days: 1,
      explorationStyle: 'balanced',
      semanticCoverage: {
        ...semantic,
        eligibleCandidateCount: 5,
        indexedCandidateCount: 5,
      },
      offeredCandidateCount: 5,
      providerHealth: { status: 'healthy' },
    });

    expect(report.deficits).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: 'missing_requested_experience_format',
        }),
      ]),
    );
  });

  it('uses theme coverage rather than structural format gates', () => {
    const report = service.analyze({
      candidates: [
        poiCandidate('1'),
        poiCandidate('2'),
        poiCandidate('3'),
        poiCandidate('4'),
      ],
      requestedThemes: ['architecture'],
      days: 1,
      explorationStyle: 'balanced',
      semanticCoverage: semantic,
      offeredCandidateCount: 4,
      providerHealth: { status: 'healthy' },
    });

    expect(report.deficits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: 'missing_requested_theme',
          theme: 'architecture',
        }),
      ]),
    );
    expect(report.decision.action).toBe('places_text_search');
    expect(report.decision.reason).toBe('missing_requested_theme');
  });

  it('uses real catalog candidates without structural format mapping', () => {
    const report = service.analyze({
      candidates: [
        poiCandidate('1'),
        poiCandidate('2'),
        poiCandidate('3'),
        poiCandidate('4'),
      ],
      requestedThemes: [],
      days: 1,
      explorationStyle: 'balanced',
      semanticCoverage: semantic,
      offeredCandidateCount: 4,
      providerHealth: { status: 'healthy' },
    });

    expect(report.status).toBe('sufficient');
    expect(report.decision.action).toBe('none');
    expect(report.requestedThemeCoverage).toEqual([]);
  });

  it('does not report a structural deficit when only another experience exists', () => {
    const report = service.analyze({
      candidates: [
        {
          id: 'route-1',
          name: 'Route',
          source: 'catalog',
          distanceKm: 1,
        },
      ],
      requestedThemes: [],
      days: 1,
      explorationStyle: 'balanced',
      semanticCoverage: {
        ...semantic,
        eligibleCandidateCount: 1,
        indexedCandidateCount: 1,
      },
      offeredCandidateCount: 1,
      providerHealth: { status: 'healthy' },
    });

    expect(report.deficits).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: 'missing_requested_experience_format',
        }),
      ]),
    );
  });
});
