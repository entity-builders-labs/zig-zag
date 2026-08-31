import { ActivityKind } from '@prisma/client';
import { CoverageAnalyzer } from './coverage-analyzer.service';
import { ExperienceFormat } from '../interfaces/tour-generation.interface';

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
      kind: ActivityKind.POI,
      source: 'google_places',
      type: 'museum',
      knownActivityTypeName: 'museum',
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

    expect(service.analyze({ ...base, travelPace: 'relaxed' }).requiredCandidateCount).toBe(3);
    expect(service.analyze({ ...base, travelPace: 'moderate' }).requiredCandidateCount).toBe(4);
    expect(service.analyze({ ...base, travelPace: 'fast' }).requiredCandidateCount).toBe(5);
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

    expect(report.status).toBe('insufficient');
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
    expect(report.decision.reason).toBe('provider_degraded_without_usable_pool');
  });

  it('blocks when a requested composite format has zero candidates of that kind', () => {
    const report = service.analyze({
      candidates: [
        poiCandidate('1'),
        poiCandidate('2'),
        poiCandidate('3'),
        poiCandidate('4'),
      ],
      requestedThemes: [],
      requestedExperienceFormats: [ExperienceFormat.NEIGHBORHOOD_WALKS],
      days: 1,
      explorationStyle: 'balanced',
      semanticCoverage: semantic,
      offeredCandidateCount: 4,
      providerHealth: { status: 'healthy' },
    });

    expect(report.deficits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: 'missing_requested_experience_format',
          severity: 'blocking',
          experienceFormat: 'neighborhood_walks',
        }),
      ]),
    );
    expect(report.decision).toEqual(
      expect.objectContaining({
        action: 'defer_to_pr7_grounded_gap',
        reason: 'qualitative_gap_requires_activity_discovery',
      }),
    );
  });

  it('does not add a format deficit when the matching structural kind exists', () => {
    const report = service.analyze({
      candidates: [
        poiCandidate('1'),
        poiCandidate('2'),
        poiCandidate('3'),
        poiCandidate('4'),
        {
          id: 'route-1',
          name: 'Costanera route',
          kind: ActivityKind.ROUTE,
          source: 'catalog',
          distanceKm: 1,
        },
      ],
      requestedThemes: [],
      requestedExperienceFormats: [ExperienceFormat.THEMATIC_ROUTES],
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
        expect.objectContaining({ reason: 'missing_requested_experience_format' }),
      ]),
    );
  });

  it('prioritizes structural discovery when theme and format deficits coexist', () => {
    const report = service.analyze({
      candidates: [
        poiCandidate('1'),
        poiCandidate('2'),
        poiCandidate('3'),
        poiCandidate('4'),
      ],
      requestedThemes: ['architecture'],
      requestedExperienceFormats: [
        ExperienceFormat.THEMATIC_ROUTES,
        ExperienceFormat.EXPERIENCES,
      ],
      days: 1,
      explorationStyle: 'balanced',
      semanticCoverage: semantic,
      offeredCandidateCount: 4,
      providerHealth: { status: 'healthy' },
    });

    expect(report.deficits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'missing_requested_theme', theme: 'architecture' }),
        expect.objectContaining({
          reason: 'missing_requested_experience_format',
          experienceFormat: 'thematic_routes',
        }),
        expect.objectContaining({
          reason: 'missing_requested_experience_format',
          experienceFormat: 'experiences',
        }),
      ]),
    );
    expect(report.decision.action).toBe('defer_to_pr7_grounded_gap');
    expect(report.decision.reason).toBe('qualitative_gap_requires_activity_discovery');
  });

  it('does not gate point_visits because it has no composite kind mapping', () => {
    const report = service.analyze({
      candidates: [
        poiCandidate('1'),
        poiCandidate('2'),
        poiCandidate('3'),
        poiCandidate('4'),
      ],
      requestedThemes: [],
      requestedExperienceFormats: [ExperienceFormat.POINT_VISITS],
      days: 1,
      explorationStyle: 'balanced',
      semanticCoverage: semantic,
      offeredCandidateCount: 4,
      providerHealth: { status: 'healthy' },
    });

    expect(report.status).toBe('sufficient');
    expect(report.decision.action).toBe('none');
  });
});
