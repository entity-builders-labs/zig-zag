import { ExperienceCandidate } from './experience-discovery.interface';
import { SourceObservation } from './experience-acquisition.interface';

/**
 * Internal envelope pairing a synthesized ExperienceCandidate with the raw
 * source observations that generated it. Used by corroboration and disappears
 * before downstream resolution.
 */
export interface StructuredCandidateProposal {
  candidate: ExperienceCandidate;
  observations: SourceObservation[];
}
