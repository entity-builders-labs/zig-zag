import { CoverageAnalyzer } from './coverage-analyzer.service';

describe('CoverageAnalyzer', () => {
  let service: CoverageAnalyzer;

  beforeEach(() => {
    service = new CoverageAnalyzer();
  });

  it('marks fifteen irrelevant unrated candidates as insufficient', () => {
    const report = service.analyze({
      candidates: Array.from({ length: 15 }, (_, index) => ({
        id: `candidate-${index}`,
        name: `Unknown place ${index}`,
        weightedScore: 0,
        distanceKm: 1,
      })),
      requestedThemes: ['history', 'art'],
      days: 1,
      explorationStyle: 'balanced',
      semanticCoverage: {
        status: 'unavailable',
        eligibleCandidateCount: 15,
        indexedCandidateCount: 0,
        reason: 'index unavailable',
      },
      offeredCandidateCount: 15,
      providerHealth: { status: 'healthy' },
    });

    expect(report.status).toBe('insufficient');
    expect(report.decision.action).toBe('places_text_search');
    expect(report.eligibleCandidateCount).toBe(15);
  });

  it('chooses Places Text Search for a conventional theme deficit', () => {
    const report = service.analyze({
      candidates: [
        {
          id: 'museum-1',
          name: 'Historic Museum',
          source: 'google_places',
          type: 'museum',
          knownActivityTypeName: 'museum',
          weightedScore: 4.5,
          distanceKm: 1,
        },
        {
          id: 'monument-1',
          name: 'Monumento Central',
          source: 'google_places',
          type: 'monument',
          knownActivityTypeName: 'historical_landmark',
          weightedScore: 4.3,
          distanceKm: 1.3,
        },
        {
          id: 'church-1',
          name: 'Cathedral',
          source: 'google_places',
          type: 'church',
          knownActivityTypeName: 'church',
          weightedScore: 4.4,
          distanceKm: 1.7,
        },
        {
          id: 'plaza-1',
          name: 'Main Plaza',
          source: 'google_places',
          type: 'plaza',
          knownActivityTypeName: 'plaza',
          weightedScore: 4.2,
          distanceKm: 2,
        },
      ],
      requestedThemes: ['history', 'beach'],
      days: 1,
      explorationStyle: 'balanced',
      semanticCoverage: {
        status: 'applied',
        eligibleCandidateCount: 4,
        indexedCandidateCount: 4,
      },
      offeredCandidateCount: 4,
      providerHealth: { status: 'healthy' },
    });

    expect(report.status).toBe('insufficient');
    expect(report.decision.action).toBe('places_text_search');
  });

  it('reports provider outage as degraded instead of destination scarcity when no usable pool exists', () => {
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

  it('records the PR6/PR7 destination knowledge boundary explicitly', () => {
    const report = service.analyze({
      candidates: [
        {
          id: 'art-1',
          name: 'City Art Museum',
          source: 'google_places',
          type: 'museum',
          knownActivityTypeName: 'art_museum',
          weightedScore: 4.8,
          distanceKm: 1,
        },
        {
          id: 'art-2',
          name: 'Gallery District',
          source: 'google_places',
          type: 'gallery',
          knownActivityTypeName: 'art_gallery',
          weightedScore: 4.6,
          distanceKm: 4,
        },
        {
          id: 'park-1',
          name: 'Central Park',
          source: 'google_places',
          type: 'park',
          knownActivityTypeName: 'park',
          weightedScore: 4.4,
          distanceKm: 6,
        },
        {
          id: 'food-1',
          name: 'Food Market',
          source: 'google_places',
          type: 'market',
          knownActivityTypeName: 'food_market',
          weightedScore: 4.3,
          distanceKm: 8,
        },
      ],
      requestedThemes: ['art'],
      days: 1,
      explorationStyle: 'balanced',
      semanticCoverage: {
        status: 'applied',
        eligibleCandidateCount: 4,
        indexedCandidateCount: 4,
      },
      offeredCandidateCount: 4,
      providerHealth: { status: 'healthy' },
    });

    expect(report.status).toBe('sufficient');
    expect(report.destinationKnowledge.status).toBe('unsupported_until_pr7');
    expect(report.destinationKnowledge.reason).toContain('PR 6');
  });
});
