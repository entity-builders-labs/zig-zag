import { AcquisitionEvidenceRequirement } from '../interfaces/acquisition-evidence-requirement.interface';
import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';

/**
 * Stage 2 cutover (component-resolution-and-partial-composite-recovery-plan.md):
 * admission is decided from source-backed composition, not from a
 * per-component LLM-authored `required` flag (removed from `GeoEntityHint`).
 * Every hint reaching this function has already passed the deterministic
 * source-support gate (experience-candidate-extraction.util.ts /
 * component-source-support.util.ts), so "every evidence-backed non-area
 * component" IS the composition signal (amendment §3).
 */
export function candidateSatisfiesEvidenceRequirement(
  candidate: ExperienceCandidate,
  requirement: AcquisitionEvidenceRequirement,
): boolean {
  const meaningfulHints = candidate.componentHints.filter(
    (hint) => hint.role !== 'area',
  );

  switch (requirement) {
    case 'SINGLE_PLACE':
      return (
        meaningfulHints.length === 1 &&
        meaningfulHints[0].expectedKind === 'PLACE'
      );
    case 'MULTI_COMPONENT_EXPERIENCE':
      return meaningfulHints.length >= 2;
  }
}
