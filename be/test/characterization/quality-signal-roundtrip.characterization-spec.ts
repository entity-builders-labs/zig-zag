import {
  qualityBonus,
  rankCandidatesByRelevance,
  RankableCandidate,
  CandidateScoreBreakdown,
} from '../../src/modules/tours/utils/candidate-ranking.util';
import { PlanningCandidateNormalizerService } from '../../src/modules/tours/services/planning-candidate-normalizer.service';
import { scoreCandidateForDay } from '../../src/modules/tours/utils/daily-planning-placement.util';
import dailyPlanningPolicyConfig from '../../src/modules/tours/config/daily-planning-policy.config';
import { StructuredExperienceCandidateSynthesizerService } from '../../src/modules/tours/services/structured-experience-candidate-synthesizer.service';
import { placesHistoricalLandmarkObservation } from './support/observations';

/**
 * TEST 6 — QUALITY SIGNAL ROUND-TRIP
 *
 * Follows an objective quality signal (Google Places `rating: 4.7`,
 * `userRatingCount: 5321`) from a `SourceObservation` through synthesis,
 * ranking, normalization and the solver soft score.
 *
 * Pinned current behavior:
 *  - the structured synthesizer carries NO quality field — the rating is
 *    dropped at the very first hop;
 *  - `qualityBonus` uses the current source-specific policy: POIs use
 *    `weightedScore`, while composites use the curated bonus and ignore
 *    `weightedScore`;
 *  - the normalizer forwards raw canonical Experience qualityScore (0..5);
 *  - the planner normalizes and applies that raw signal exactly once.
 */
describe('CHAR-6 quality signal round-trip', () => {
  it('the structured synthesizer drops Google Places rating/userRatingCount', () => {
    const synth = new StructuredExperienceCandidateSynthesizerService();
    const obs = placesHistoricalLandmarkObservation();
    expect((obs.metadata as any).rating).toBe(4.7);

    const [proposal] = synth.synthesizeProposals([obs]);
    const candidate: any = proposal.candidate;
    expect(candidate.qualityScore).toBeUndefined();
    expect(candidate.rating).toBeUndefined();
    expect(JSON.stringify(candidate)).not.toMatch(/4\.7|rating/i);
  });

  it('OPEN DESIGN: POIs and composites currently use different quality policies', () => {
    const poi: RankableCandidate = {
      id: 'poi',
      source: 'poi',
      weightedScore: 4.7,
    };
    const poiNoQuality: RankableCandidate = {
      id: 'poi-null',
      source: 'poi',
      weightedScore: undefined,
    };
    const composite: RankableCandidate = {
      id: 'composite',
      source: 'composite',
      weightedScore: 4.7, // has a quality score...
      isCurated: false, // ...but composites only get the curated bonus
    };
    expect(qualityBonus(poi)).toBeCloseTo((4.7 / 5) * 0.2, 5); // 0.188
    expect(qualityBonus(poiNoQuality)).toBe(0);
    // Current behavior: an uncurated composite ignores weightedScore.
    expect(qualityBonus(composite)).toBe(0);
  });

  it('normalizer forwards raw canonical quality; planner normalizes it once', async () => {
    const rankable: (RankableCandidate & { original: any })[] = [
      {
        id: 'q',
        source: 'poi',
        weightedScore: 4.7,
        preferenceScore: 0,
        original: {},
      },
    ];
    const ranked = rankCandidatesByRelevance(rankable, new Map([['q', 0.5]]));
    const breakdown = ranked[0].scoreBreakdown;
    expect(breakdown.qualityBonus).toBeCloseTo(0.188, 3);

    const normalizer = new PlanningCandidateNormalizerService(
      dailyPlanningPolicyConfig(),
    );
    const [normalized] = await normalizer.normalizeExperiences(
      [
        {
          id: 'q',
          canonicalName: 'Rated Landmark',
          description: '',
          durationMinutes: 90,
          latitude: -34.6,
          longitude: -58.38,
          qualityScore: 4.7,
          components: [] as any[],
        },
      ],
      new Map<string, CandidateScoreBreakdown>([['q', breakdown]]),
    );
    expect(normalized.qualityScore).toBe(4.7);

    const policy = dailyPlanningPolicyConfig();
    const solverQualityContribution =
      scoreCandidateForDay(
        normalized,
        { dayNumber: 1, assigned: [] } as any,
        { policy } as any,
      ) -
      policy.scoring.dayBalanceWeight -
      breakdown.semanticSimilarity!;
    // eslint-disable-next-line no-console
    console.info(
      `[CHAR-6] rating=4.7 -> raw qualityScore=${normalized.qualityScore} -> planner quality contribution=${solverQualityContribution}`,
    );
    expect(solverQualityContribution).toBeCloseTo(
      policy.scoring.qualityWeight * (4.7 / 5),
      5,
    );
    expect('rankingScore' in normalized).toBe(false);
  });

  it('INVARIANT: quality is weighted once from the raw canonical scale', async () => {
    const rankable: (RankableCandidate & { original: any })[] = [
      {
        id: 'quality',
        source: 'poi',
        weightedScore: 4.7,
        preferenceScore: 0,
        original: {},
      },
      {
        id: 'no-quality',
        source: 'poi',
        weightedScore: undefined,
        preferenceScore: 0,
        original: {},
      },
    ];
    const ranked = rankCandidatesByRelevance(
      rankable,
      new Map([
        ['quality', 0.5],
        ['no-quality', 0.5],
      ]),
    );
    const scoreBreakdownById = new Map<string, CandidateScoreBreakdown>(
      ranked.map((r) => [r.candidate.id, r.scoreBreakdown]),
    );
    const normalizer = new PlanningCandidateNormalizerService(
      dailyPlanningPolicyConfig(),
    );
    const normalized = await normalizer.normalizeExperiences(
      ['quality', 'no-quality'].map((id) => ({
        id,
        canonicalName: 'Rated Landmark',
        description: '',
        durationMinutes: 90,
        latitude: -34.6,
        longitude: -58.38,
        qualityScore: id === 'quality' ? 4.7 : undefined,
        components: [] as any[],
      })),
      scoreBreakdownById,
    );
    const candidateWithQuality = normalized.find(
      (candidate) => candidate.experienceId === 'quality',
    )!;
    const candidateWithoutQuality = normalized.find(
      (candidate) => candidate.experienceId === 'no-quality',
    )!;
    const policy = dailyPlanningPolicyConfig();
    const emptyDay: any = { dayNumber: 1, assigned: [] };
    const context: any = { policy };
    const scoreWithQuality = scoreCandidateForDay(
      candidateWithQuality,
      emptyDay,
      context,
    );
    const scoreWithoutQuality = scoreCandidateForDay(
      candidateWithoutQuality,
      emptyDay,
      context,
    );
    const effectivePlannerQualityContribution =
      scoreWithQuality - scoreWithoutQuality;
    const boundaryQualityScore = candidateWithQuality.qualityScore ?? 0;
    // eslint-disable-next-line no-console
    console.info(
      `[CHAR-6] raw boundary qualityScore=${boundaryQualityScore} effective planner contribution=${effectivePlannerQualityContribution}`,
    );
    expect(effectivePlannerQualityContribution).toBeCloseTo(
      dailyPlanningPolicyConfig().scoring.qualityWeight * (4.7 / 5),
      5,
    );
  });
});
