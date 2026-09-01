import { sortCandidatesDeterministically } from 'src/modules/tours/utils/daily-planning-candidate-sort.util';
import { CandidateBuilder } from '../builders/candidate.builder';

describe('Unit Acceptance: Candidate Sorting & Determinism (TC-RANK-01 to TC-RANK-03)', () => {
  it('TC-RANK-01: candidates sort primarily by semantic score descending', () => {
    const c1 = new CandidateBuilder().withId('c1').withScores(0.7, 0.9).build();
    const c2 = new CandidateBuilder()
      .withId('c2')
      .withScores(0.95, 0.5)
      .build();

    const sorted = sortCandidatesDeterministically([c1, c2]);
    expect(sorted[0].activityId).toBe('c2');
  });

  it('TC-RANK-02: ties in semantic score break by quality score descending', () => {
    const c1 = new CandidateBuilder().withId('c1').withScores(0.8, 0.9).build();
    const c2 = new CandidateBuilder()
      .withId('c2')
      .withScores(0.8, 0.95)
      .build();

    const sorted = sortCandidatesDeterministically([c1, c2]);
    expect(sorted[0].activityId).toBe('c2');
  });

  it('TC-RANK-03: ties in semantic and quality break deterministically by activityId lexical order', () => {
    const c1 = new CandidateBuilder()
      .withId('b-cand')
      .withScores(0.8, 0.8)
      .build();
    const c2 = new CandidateBuilder()
      .withId('a-cand')
      .withScores(0.8, 0.8)
      .build();

    const sorted1 = sortCandidatesDeterministically([c1, c2]);
    const sorted2 = sortCandidatesDeterministically([c2, c1]);

    expect(sorted1.map((c) => c.activityId)).toEqual(['a-cand', 'b-cand']);
    expect(sorted2.map((c) => c.activityId)).toEqual(['a-cand', 'b-cand']);
  });
});
