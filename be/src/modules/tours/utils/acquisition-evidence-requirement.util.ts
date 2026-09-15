import { AcquisitionDeficit } from '../interfaces/experience-acquisition-plan.interface';
import { AcquisitionEvidenceRequirement } from '../interfaces/acquisition-evidence-requirement.interface';

const REQUIREMENT_ORDER: AcquisitionEvidenceRequirement[] = [
  'COMPOSITE_WALK',
  'CANONICAL_ROUTE',
  'SINGLE_PLACE',
  'GENERAL_TOURISM_EXPERIENCE',
];

export function deriveAcquisitionEvidenceRequirements(
  deficits: AcquisitionDeficit[],
): AcquisitionEvidenceRequirement[] {
  const requirements = new Set<AcquisitionEvidenceRequirement>();

  for (const deficit of deficits) {
    if (deficit.origin === 'global_capacity') {
      requirements.add('GENERAL_TOURISM_EXPERIENCE');
      continue;
    }

    if (deficit.dimension === 'intent') {
      if (deficit.key === 'walk') requirements.add('COMPOSITE_WALK');
      else if (deficit.key === 'route_like')
        requirements.add('CANONICAL_ROUTE');
      else if (deficit.key === 'visit') requirements.add('SINGLE_PLACE');
      else requirements.add('GENERAL_TOURISM_EXPERIENCE');
      continue;
    }

    requirements.add('GENERAL_TOURISM_EXPERIENCE');
  }

  return REQUIREMENT_ORDER.filter((requirement) =>
    requirements.has(requirement),
  );
}
