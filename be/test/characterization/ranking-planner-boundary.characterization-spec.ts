import {
  rankCandidatesByRelevance,
  RankableCandidate,
  CandidateScoreBreakdown,
} from '../../src/modules/tours/utils/candidate-ranking.util';
import { selectBoundedWindow } from '../../src/modules/tours/utils/candidate-window-selection.util';
import { sortCandidatesDeterministically } from '../../src/modules/tours/utils/daily-planning-candidate-sort.util';
import { scoreCandidateForDay } from '../../src/modules/tours/utils/daily-planning-placement.util';
import { PlanningCandidateNormalizerService } from '../../src/modules/tours/services/planning-candidate-normalizer.service';
import dailyPlanningPolicyConfig from '../../src/modules/tours/config/daily-planning-policy.config';

/**
 * TEST 5 — RANKING PRIORITY ACROSS THE PLANNER BOUNDARY
 *
 * `rankCandidatesByRelevance` treats `preferenceScore` as a HARD sort tier
 * (`preferenceCompare`): a strongly-preferred candidate ranks strictly above a
 * weakly-preferred one regardless of semantic similarity / quality.
 *
 * This test follows one such pair (A: strong preference, low semantic; B: weak
 * preference, high semantic) across every boundary and pins where the
 * ranking-layer ordering changes:
 *   1. `selectBoundedWindow` re-sorts the final window by `totalScore` only.
 *   2. `PlanningCandidateNormalizerService` carries `semanticScore` /
 *      `rankingScore` / `qualityScore` but NO preference field.
 *   3. `sortCandidatesDeterministically` (greedy order) sorts by
 *      `rankingScore ?? semanticScore`.
 *   4. `scoreCandidateForDay` (solver soft score) has no preference term.
 */

interface Cand extends RankableCandidate {
  original: { id: string; intents: string[] };
}

const A: Cand = {
  id: 'A-strong-pref',
  source: 'poi',
  kind: 'poi',
  weightedScore: 0, // qualityBonus 0
  preferenceScore: 1.0, // satisfies every requested facet
  original: { id: 'A-strong-pref', intents: ['visit'] },
};
const B: Cand = {
  id: 'B-weak-pref',
  source: 'poi',
  kind: 'poi',
  weightedScore: 0,
  preferenceScore: 0.2, // barely matches
  original: { id: 'B-weak-pref', intents: ['visit'] },
};

const similarity = new Map<string, number>([
  ['A-strong-pref', 0.1], // low semantic
  ['B-weak-pref', 0.95], // high semantic
]);

describe('CHAR-5 ranking priority across the planner boundary', () => {
  it('STAGE 1 — ranking: the higher-preference candidate is first even though its totalScore is lower', () => {
    const ranked = rankCandidatesByRelevance([A, B], similarity);
    // eslint-disable-next-line no-console
    console.info(
      `[CHAR-5] ranked=${ranked
        .map(
          (r) =>
            `${r.candidate.id}(pref=${r.candidate.preferenceScore} total=${r.scoreBreakdown.totalScore.toFixed(3)})`,
        )
        .join(', ')}`,
    );
    expect(ranked[0].candidate.id).toBe('A-strong-pref');
    // The hard tier is doing real work: A's totalScore is BELOW B's.
    expect(ranked[0].scoreBreakdown.totalScore).toBeLessThan(
      ranked[1].scoreBreakdown.totalScore,
    );
  });

  it('STAGE 2 — selectBoundedWindow re-sorts by totalScore and inverts the ranking-layer order', () => {
    const ranked = rankCandidatesByRelevance([A, B], similarity) as any;
    const windowed = selectBoundedWindow(
      ranked,
      (c: any) => c.original.intents,
      ['visit'],
      15,
    );
    // Ranking said [A, B]; the offered window says [B, A].
    expect(windowed.map((w: any) => w.candidate.id)).toEqual([
      'B-weak-pref',
      'A-strong-pref',
    ]);
  });

  it('STAGE 3 — the normalizer carries no preference signal into the planner contract', async () => {
    const ranked = rankCandidatesByRelevance([A, B], similarity);
    const breakdownById = new Map<string, CandidateScoreBreakdown>(
      ranked.map((r) => [r.candidate.id, r.scoreBreakdown]),
    );
    const normalizer = new PlanningCandidateNormalizerService(
      dailyPlanningPolicyConfig(),
    );
    const experiences = [A, B].map((c) => ({
      id: c.id,
      canonicalName: c.id,
      description: '',
      durationMinutes: 90,
      latitude: -34.6,
      longitude: -58.38,
      components: [] as any[],
    }));
    const normalized = await normalizer.normalizeExperiences(
      experiences,
      breakdownById,
    );
    const a = normalized.find((n) => n.experienceId === 'A-strong-pref')!;
    expect(a).toMatchObject({
      semanticScore: 0.1,
      qualityScore: undefined,
    });
    // No preference-derived field exists on the planner candidate at all.
    expect(Object.keys(a)).not.toContain('preferenceScore');
    expect(Object.keys(a)).not.toContain('preferenceBonus');
    // rankingScore is the totalScore — which for A is the LOWER number.
    const b = normalized.find((n) => n.experienceId === 'B-weak-pref')!;
    expect(a.rankingScore!).toBeLessThan(b.rankingScore!);
  });

  it('STAGE 4 — greedy order and the solver soft score both prefer the weakly-preferred B', async () => {
    const ranked = rankCandidatesByRelevance([A, B], similarity);
    const breakdownById = new Map<string, CandidateScoreBreakdown>(
      ranked.map((r) => [r.candidate.id, r.scoreBreakdown]),
    );
    const normalizer = new PlanningCandidateNormalizerService(
      dailyPlanningPolicyConfig(),
    );
    const normalized = await normalizer.normalizeExperiences(
      [A, B].map((c) => ({
        id: c.id,
        canonicalName: c.id,
        description: '',
        durationMinutes: 90,
        latitude: -34.6,
        longitude: -58.38,
        components: [] as any[],
      })),
      breakdownById,
    );

    const greedyOrder = sortCandidatesDeterministically(normalized).map(
      (n) => n.experienceId,
    );
    expect(greedyOrder).toEqual(['B-weak-pref', 'A-strong-pref']);

    const policy = dailyPlanningPolicyConfig();
    const emptyDay: any = { dayNumber: 1, assigned: [] };
    const ctx: any = { policy };
    const scoreA = scoreCandidateForDay(
      normalized.find((n) => n.experienceId === 'A-strong-pref')!,
      emptyDay,
      ctx,
    );
    const scoreB = scoreCandidateForDay(
      normalized.find((n) => n.experienceId === 'B-weak-pref')!,
      emptyDay,
      ctx,
    );
    // eslint-disable-next-line no-console
    console.info(`[CHAR-5] solver soft score A=${scoreA} B=${scoreB}`);
    // The solver ranks B above A on day 1 — opposite to the ranking-layer
    // preference tier.
    expect(scoreB).toBeGreaterThan(scoreA);
  });

  it('OPEN CONTRACT: later planner ordering currently inverts the ranking layer preference tier', async () => {
    const ranked = rankCandidatesByRelevance([A, B], similarity);
    const rankingLayerFirst = ranked[0].candidate.id;
    const breakdownById = new Map<string, CandidateScoreBreakdown>(
      ranked.map((r) => [r.candidate.id, r.scoreBreakdown]),
    );
    const normalizer = new PlanningCandidateNormalizerService(
      dailyPlanningPolicyConfig(),
    );
    const normalized = await normalizer.normalizeExperiences(
      [A, B].map((c) => ({
        id: c.id,
        canonicalName: c.id,
        description: '',
        durationMinutes: 90,
        latitude: -34.6,
        longitude: -58.38,
        components: [] as any[],
      })),
      breakdownById,
    );
    const greedyOrder = sortCandidatesDeterministically(normalized).map(
      (n) => n.experienceId,
    );
    expect(rankingLayerFirst).toBe('A-strong-pref');
    expect(greedyOrder).toEqual(['B-weak-pref', 'A-strong-pref']);
  });
});
