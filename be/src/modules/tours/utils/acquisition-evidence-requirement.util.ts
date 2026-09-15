import { AcquisitionDeficit } from '../interfaces/experience-acquisition-plan.interface';
import { AcquisitionEvidenceRequirement } from '../interfaces/acquisition-evidence-requirement.interface';

const REQUIREMENT_ORDER: AcquisitionEvidenceRequirement[] = [
  'SINGLE_PLACE',
  'MULTI_COMPONENT_EXPERIENCE',
];

export function deriveAcquisitionEvidenceRequirements(
  deficits: AcquisitionDeficit[],
): AcquisitionEvidenceRequirement[] {
  const requirements = new Set<AcquisitionEvidenceRequirement>();

  for (const deficit of deficits) {
    if (deficit.origin === 'global_capacity') {
      requirements.add('SINGLE_PLACE');
      requirements.add('MULTI_COMPONENT_EXPERIENCE');
      continue;
    }

    if (deficit.dimension === 'intent') {
      if (deficit.key === 'walk' || deficit.key === 'route_like')
        requirements.add('MULTI_COMPONENT_EXPERIENCE');
      else if (deficit.key === 'visit') requirements.add('SINGLE_PLACE');
      else {
        requirements.add('SINGLE_PLACE');
        requirements.add('MULTI_COMPONENT_EXPERIENCE');
      }
      continue;
    }

    requirements.add('SINGLE_PLACE');
    requirements.add('MULTI_COMPONENT_EXPERIENCE');
  }

  return REQUIREMENT_ORDER.filter((requirement) =>
    requirements.has(requirement),
  );
}
