import { AcquisitionEvidenceRequirement } from '../interfaces/acquisition-evidence-requirement.interface';
import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';

export function candidateSatisfiesEvidenceRequirement(
  candidate: ExperienceCandidate,
  requirement: AcquisitionEvidenceRequirement,
): boolean {
  const requiredHints = candidate.componentHints.filter(
    (hint) => hint.required,
  );
  const meaningfulRequiredHints = requiredHints.filter(
    (hint) => hint.role !== 'area',
  );

  switch (requirement) {
    case 'GENERAL_TOURISM_EXPERIENCE':
      return meaningfulRequiredHints.length >= 1;
    case 'SINGLE_PLACE':
      return (
        meaningfulRequiredHints.length === 1 &&
        meaningfulRequiredHints[0].expectedKind === 'PLACE'
      );
    case 'COMPOSITE_WALK':
      return meaningfulRequiredHints.length >= 2;
    case 'CANONICAL_ROUTE':
      return meaningfulRequiredHints.some(
        (hint) => hint.expectedKind === 'ROUTE',
      );
  }
}
