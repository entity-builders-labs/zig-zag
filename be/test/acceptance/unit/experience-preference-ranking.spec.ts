import { sortCandidatesDeterministically } from 'src/modules/tours/utils/daily-planning-candidate-sort.util';
import { CandidateBuilder } from '../builders/candidate.builder';

describe('Experience V2 preference ranking', () => {
  it('orders planner candidates by their canonical preference rank without format gates', () => {
    const nature = CandidateBuilder.aCandidate('nature')
      .withPreferenceRank(1)
      .build();
    const culture = CandidateBuilder.aCandidate('culture')
      .withPreferenceRank(2)
      .build();
    expect(
      sortCandidatesDeterministically([culture, nature])[0].experienceId,
    ).toBe('nature');
  });
});
