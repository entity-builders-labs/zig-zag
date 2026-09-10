import {
  qualityBonus,
  rankCandidatesByRelevance,
  RankableCandidate,
  CandidateScoreBreakdown,
} from '../../src/modules/tours/utils/candidate-ranking.util';
import { PlanningCandidateNormalizerService } from '../../src/modules/tours/services/planning-candidate-normalizer.service';
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
 *  - `qualityBonus` for a multi-component ("composite") Experience ignores
 *    `weightedScore` entirely (only a curated bonus, which acquisition never
 *    sets) — quality is silently 0 for every multi-stop Experience;
 *  - the normalizer forwards the ALREADY-WEIGHTED `qualityBonus` (0..0.2) as
 *    `qualityScore`, and the solver multiplies it by `qualityWeight` (0.5)
 *    again — a second attenuation, and nowhere near the raw 0..5 scale the
 *    weight was tuned for.
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

  it('qualityBonus: a POI uses weightedScore; a multi-component Experience ignores it', () => {
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
    // DEFECT: a 4.7-rated multi-stop Experience contributes 0 quality.
    expect(qualityBonus(composite)).toBe(0);
  });

  it('normalizer forwards the already-weighted qualityBonus; the solver attenuates it again', async () => {
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
          components: [] as any[],
        },
      ],
      new Map<string, CandidateScoreBreakdown>([['q', breakdown]]),
    );
    // The planner receives the weighted bonus (~0.188), NOT the 4.7 rating.
    expect(normalized.qualityScore).toBeCloseTo(0.188, 3);

    const policy = dailyPlanningPolicyConfig();
    const solverQualityTerm =
      policy.scoring.qualityWeight * (normalized.qualityScore ?? 0);
    // eslint-disable-next-line no-console
    console.info(
      `[CHAR-6] rating=4.7 -> qualityBonus=${normalized.qualityScore} -> solver quality term=${solverQualityTerm}`,
    );
    // 0.5 * 0.188 = 0.094 — the "0.5 quality weight" acts on a 0..0.2 number.
    expect(solverQualityTerm).toBeCloseTo(0.094, 3);
    // A perfect 4.7 rating contributes LESS to the day-1 soft score than the
    // fixed day-balance bonus for an empty day (0.25 * 1/1).
    const dayBalanceBonus = policy.scoring.dayBalanceWeight * (1 / 1);
    expect(solverQualityTerm).toBeLessThan(dayBalanceBonus);
  });

  it.failing(
    'INVARIANT: a Google Places rating of 4.7 must produce a non-zero quality contribution in the planner soft score for a structured-acquired Experience',
    async () => {
      const synth = new StructuredExperienceCandidateSynthesizerService();
      const [proposal] = synth.synthesizeProposals([
        placesHistoricalLandmarkObservation(),
      ]);
      const c: any = proposal.candidate;
      // What acquisition would persist: no qualityScore anywhere.
      const rankable: (RankableCandidate & { original: any })[] = [
        {
          id: 'x',
          source: 'poi',
          weightedScore: (c.qualityScore as number) ?? undefined,
          preferenceScore: 0,
          original: {},
        },
      ];
      const ranked = rankCandidatesByRelevance(rankable, new Map([['x', 0.5]]));
      const normalizer = new PlanningCandidateNormalizerService(
        dailyPlanningPolicyConfig(),
      );
      const [normalized] = await normalizer.normalizeExperiences(
        [
          {
            id: 'x',
            canonicalName: c.name,
            description: c.description,
            durationMinutes: 90,
            latitude: -34.6,
            longitude: -58.38,
            components: [] as any[],
          },
        ],
        new Map<string, CandidateScoreBreakdown>([
          ['x', ranked[0].scoreBreakdown],
        ]),
      );
      const policy = dailyPlanningPolicyConfig();
      const qualityTerm =
        policy.scoring.qualityWeight * (normalized.qualityScore ?? 0);
      expect(qualityTerm).toBeGreaterThan(0);
    },
  );
});
