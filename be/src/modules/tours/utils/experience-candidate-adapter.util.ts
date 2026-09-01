import { ActivityProposal } from '../interfaces/activity-discovery.interface';
import {
  ExperienceCandidate,
  GeoEntityHintV2,
} from '../interfaces/experience-discovery.interface';

/**
 * Compatibility boundary for discovery migration. The legacy extractor may
 * still label a proposal with a kind, but the V2 candidate deliberately drops
 * that structural concept and keeps only physical entity expectations.
 */
export function toExperienceCandidate(
  proposal: ActivityProposal,
): ExperienceCandidate {
  return {
    name: proposal.name,
    description: proposal.shortReason,
    themes: [...proposal.themes],
    traits: [],
    suggestedDurationMinutes: proposal.suggestedDurationMinutes,
    componentHints: proposal.entityHints.map(
      (hint): GeoEntityHintV2 => ({
        key: hint.key,
        name: hint.name,
        role: hint.role,
        expectedKind:
          hint.role === 'area'
            ? 'AREA'
            : hint.role === 'route'
              ? 'ROUTE'
              : 'PLACE',
        required: hint.required,
        evidenceKeys: [...hint.evidenceKeys],
      }),
    ),
    evidenceKeys: [...proposal.evidenceKeys],
    shortReason: proposal.shortReason,
  };
}

export function toExperienceCandidates(
  proposals: ActivityProposal[],
): ExperienceCandidate[] {
  return proposals.map(toExperienceCandidate);
}
