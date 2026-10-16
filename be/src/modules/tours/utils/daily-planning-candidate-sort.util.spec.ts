import {
  sortCandidatesDeterministically,
  selectDailyAnchors,
} from './daily-planning-candidate-sort.util';
import { PlanningExperienceCandidate } from '../interfaces/daily-planning.interface';
import { singleVisitCandidate } from '../fixtures/planning-input.fixture';

function candidate(
  id: string,
  preferenceRank: number,
): PlanningExperienceCandidate {
  return singleVisitCandidate({
    experienceId: id,
    durationMinutes: 60,
    preferenceRank,
  });
}

describe('sortCandidatesDeterministically', () => {
  it('orders by the canonical preference rank, best (lowest) first', () => {
    const sorted = sortCandidatesDeterministically([
      candidate('third', 3),
      candidate('first', 1),
      candidate('second', 2),
    ]);
    expect(sorted.map((c) => c.experienceId)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('never reads the preference breakdown: a richer breakdown does not outrank a better rank', () => {
    const richer = candidate('richer-breakdown', 2);
    richer.preference.breakdown = {
      ...richer.preference.breakdown,
      directEvidence: 5,
      semantic: { status: 'KNOWN', similarity: 0.99 },
      quality: { status: 'KNOWN', score: 5 },
    };
    const sorted = sortCandidatesDeterministically([
      richer,
      candidate('better-rank', 1),
    ]);
    expect(sorted.map((c) => c.experienceId)).toEqual([
      'better-rank',
      'richer-breakdown',
    ]);
  });

  it('breaks an equal rank by experienceId lexical ascending, stably', () => {
    const sorted = sortCandidatesDeterministically([
      candidate('b', 1),
      candidate('a', 1),
    ]);
    expect(sorted.map((c) => c.experienceId)).toEqual(['a', 'b']);
  });

  it('does not mutate its input', () => {
    const input = [candidate('b', 2), candidate('a', 1)];
    sortCandidatesDeterministically(input);
    expect(input.map((c) => c.experienceId)).toEqual(['b', 'a']);
  });
});

describe('selectDailyAnchors', () => {
  it('picks the top N sorted candidates as anchors, one per day in order', () => {
    const sorted = [candidate('a', 1), candidate('b', 2), candidate('c', 3)];
    expect(selectDailyAnchors(sorted, 2).map((c) => c.experienceId)).toEqual([
      'a',
      'b',
    ]);
  });

  it('returns fewer anchors than requested when candidates run out', () => {
    const sorted = [candidate('a', 1)];
    expect(selectDailyAnchors(sorted, 3)).toHaveLength(1);
  });
});
