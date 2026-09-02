import { GreedyDailyPlanningSolver } from 'src/modules/tours/services/greedy-daily-planning.solver';
import { createGreedySolver } from '../harness/solver-factory';
import { TourInputBuilder } from '../builders/tour-input.builder';
import { CandidateBuilder } from '../builders/candidate.builder';
import { rankCandidatesByRelevance } from 'src/modules/tours/utils/candidate-ranking.util';

describe('Experience V2 selection at scale', () => {
  it('plans deterministically from 300 verified Experience candidates', async () => {
    const candidates = Array.from({ length: 300 }, (_, index) =>
      CandidateBuilder.aCandidate(`experience-${String(index).padStart(3, '0')}`)
        .withTitle(index % 2 ? `Culture ${index}` : `Nature ${index}`)
        .withThemes(index % 2 ? 'culture' : 'nature')
        .withScores(1 - index / 1000, 0.8)
        .withCentroid(-34.6 + (index % 10) * 0.0001, -58.4 + (index % 10) * 0.0001)
        .build(),
    );
    const input = TourInputBuilder.aTourInput().withDays(3).withCandidates(candidates).build();
    const solver = (createGreedySolver() as { solver: GreedyDailyPlanningSolver }).solver;
    const first = await solver.solve(input);
    const second = await solver.solve(input);
    expect(first.days).toHaveLength(3);
    expect(first.days.flatMap(day => day.experiences).length).toBeGreaterThan(0);
    expect(first).toEqual(second);
    expect(first.unselected.length + first.days.flatMap(day => day.experiences).length).toBe(300);
  });

  it('changes the leading selection when normalized preference affinity changes', () => {
    const pool = Array.from({ length: 300 }, (_, index) => ({ id: `experience-${index}`, source: 'poi' as const, weightedScore: 1, preferenceScore: index % 2 ? 1 : 0 }));
    const natureFirst = rankCandidatesByRelevance(pool, null);
    const cultureFirst = rankCandidatesByRelevance(pool.map(candidate => ({ ...candidate, preferenceScore: candidate.preferenceScore ? 0 : 1 })), null);
    expect(natureFirst[0].candidate.id).toBe('experience-1');
    expect(cultureFirst[0].candidate.id).toBe('experience-0');
  });
});
