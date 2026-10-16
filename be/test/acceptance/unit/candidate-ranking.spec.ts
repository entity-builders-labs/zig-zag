import { sortCandidatesDeterministically } from 'src/modules/tours/utils/daily-planning-candidate-sort.util';
import { CandidateBuilder } from '../builders/candidate.builder';

describe('Unit Acceptance: Candidate Sorting & Determinism (TC-RANK-01 to TC-RANK-03)', () => {
  // Semantic, quality and explicit-evidence ordering is the preference-utility
  // boundary's job (G-P7-U.A scenarios); the planner only follows its rank.
  it('TC-RANK-01: candidates sort by canonical preference rank, best first', () => {
    const c1 = new CandidateBuilder().withId('c1').withPreferenceRank(2).build();
    const c2 = new CandidateBuilder().withId('c2').withPreferenceRank(1).build();

    const sorted = sortCandidatesDeterministically([c1, c2]);
    expect(sorted[0].experienceId).toBe('c2');
  });

  it('TC-RANK-02: the planner never re-ranks by raw breakdown signals', () => {
    const highQuality = new CandidateBuilder()
      .withId('c1')
      .withPreferenceRank(2)
      .build();
    highQuality.preference.breakdown = {
      ...highQuality.preference.breakdown,
      quality: { status: 'KNOWN', score: 5 },
    };
    const better = new CandidateBuilder()
      .withId('c2')
      .withPreferenceRank(1)
      .build();

    const sorted = sortCandidatesDeterministically([highQuality, better]);
    expect(sorted[0].experienceId).toBe('c2');
  });

  it('TC-RANK-03: equal ranks break deterministically by experienceId lexical order', () => {
    const c1 = new CandidateBuilder()
      .withId('b-cand')
      .withPreferenceRank(1)
      .build();
    const c2 = new CandidateBuilder()
      .withId('a-cand')
      .withPreferenceRank(1)
      .build();

    const sorted1 = sortCandidatesDeterministically([c1, c2]);
    const sorted2 = sortCandidatesDeterministically([c2, c1]);

    expect(sorted1.map((c) => c.experienceId)).toEqual(['a-cand', 'b-cand']);
    expect(sorted2.map((c) => c.experienceId)).toEqual(['a-cand', 'b-cand']);
  });
});
