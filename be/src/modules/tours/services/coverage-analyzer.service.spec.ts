import { ActivityKind } from '@prisma/client';
import { CoverageAnalyzer } from './coverage-analyzer.service';
import { ExperienceFormat } from '../interfaces/tour-generation.interface';

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

  it('scales required candidate count by travelPace, not explorationStyle (bug fix)', () => {
    // Same 4-candidate pool, same explorationStyle — only travelPace differs.
    // Previously required stops/day was hardcoded via a comparison against
    // 'relaxed'/'fast_paced' fed with explorationStyle's real values
    // ('iconic'/'balanced'/'local_deep_dive'), which never matched, so this
    // pool was judged identically regardless of travelPace.
    const buildInput = (travelPace?: string) => ({
      candidates: Array.from({ length: 4 }, (_, index) => ({
        id: `candidate-${index}`,
        name: `Real place ${index}`,
      })),
      requestedThemes: [] as string[],
      days: 1,
      explorationStyle: 'balanced',
      travelPace,
      semanticCoverage: {
        status: 'not_requested' as const,
        eligibleCandidateCount: 4,
        indexedCandidateCount: 0,
      },
      offeredCandidateCount: 4,
      providerHealth: { status: 'healthy' as const },
    });

    const relaxed = service.analyze(buildInput('relaxed'));
    expect(relaxed.requiredCandidateCount).toBe(3); // 1 day * 3 stops
    expect(
      relaxed.deficits.some(
        (d) => d.reason === 'insufficient_usable_candidates',
      ),
    ).toBe(false);

    const fast = service.analyze(buildInput('fast'));
    expect(fast.requiredCandidateCount).toBe(5); // 1 day * 5 stops
    expect(
      fast.deficits.some((d) => d.reason === 'insufficient_usable_candidates'),
    ).toBe(true);

    const moderate = service.analyze(buildInput('moderate'));
    expect(moderate.requiredCandidateCount).toBe(4); // 1 day * 4 stops (default)
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

  describe('requested experience format coverage (PR 7.4)', () => {
    function poiCandidate(id: string) {
      return {
        id,
        name: `POI ${id}`,
        kind: ActivityKind.POI,
        source: 'google_places',
        type: 'museum',
        knownActivityTypeName: 'museum',
        weightedScore: 4.5,
        distanceKm: 1,
      };
    }

    const baseInput = {
      candidates: [
        poiCandidate('poi-1'),
        poiCandidate('poi-2'),
        poiCandidate('poi-3'),
        poiCandidate('poi-4'),
      ],
      requestedThemes: [] as string[],
      days: 1,
      explorationStyle: 'balanced',
      semanticCoverage: {
        status: 'applied' as const,
        eligibleCandidateCount: 4,
        indexedCandidateCount: 4,
      },
      offeredCandidateCount: 4,
      providerHealth: { status: 'healthy' as const },
    };

    it('blocks when a composite format is requested and the pool has zero of that kind', () => {
      const report = service.analyze({
        ...baseInput,
        requestedExperienceFormats: [ExperienceFormat.NEIGHBORHOOD_WALKS],
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
          deployableInPr6: false,
        }),
      );
    });

    it('does not add a deficit when no experience format was requested', () => {
      const report = service.analyze({ ...baseInput });

      expect(report.deficits).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reason: 'missing_requested_experience_format',
          }),
        ]),
      );
      expect(report.status).toBe('sufficient');
    });

    it('does not add a deficit for point_visits — it has no kind mapping', () => {
      const report = service.analyze({
        ...baseInput,
        requestedExperienceFormats: [ExperienceFormat.POINT_VISITS],
      });

      expect(report.deficits).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reason: 'missing_requested_experience_format',
          }),
        ]),
      );
      expect(report.status).toBe('sufficient');
    });

    it('does not add a deficit when the pool already has a candidate of the matching kind', () => {
      const report = service.analyze({
        ...baseInput,
        candidates: [
          ...baseInput.candidates,
          {
            id: 'walk-1',
            name: 'Neighborhood Walk',
            kind: ActivityKind.NEIGHBORHOOD_WALK,
            source: 'catalog',
            weightedScore: 4.5,
            distanceKm: 1,
          },
        ],
        requestedExperienceFormats: [ExperienceFormat.NEIGHBORHOOD_WALKS],
      });

      expect(report.deficits).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reason: 'missing_requested_experience_format',
          }),
        ]),
      );
    });

    it('keeps both reasons in the deficits array when a theme deficit coexists with a format deficit', () => {
      const report = service.analyze({
        ...baseInput,
        requestedThemes: ['nightlife'],
        requestedExperienceFormats: [ExperienceFormat.NEIGHBORHOOD_WALKS],
      });

      expect(report.deficits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ reason: 'missing_requested_theme' }),
          expect.objectContaining({
            reason: 'missing_requested_experience_format',
          }),
        ]),
      );
      // Existing precedent wins the decision label — cosmetic only, since
      // the orchestrator forwards the full deficits array either way.
      expect(report.decision.reason).toBe('missing_requested_theme');
    });
  });
});
