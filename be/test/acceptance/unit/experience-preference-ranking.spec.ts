import { sortCandidatesDeterministically } from 'src/modules/tours/utils/daily-planning-candidate-sort.util';
import { CandidateBuilder } from '../builders/candidate.builder';

describe('Experience V2 preference ranking', () => {
  it('keeps theme affinity as candidate data without format gates', () => {
    const nature = CandidateBuilder.aCandidate('nature').withThemes('nature').withScores(.95, .9).build();
    const culture = CandidateBuilder.aCandidate('culture').withThemes('culture').withScores(.8, .9).build();
    expect(sortCandidatesDeterministically([culture, nature])[0].experienceId).toBe('nature');
  });
});
