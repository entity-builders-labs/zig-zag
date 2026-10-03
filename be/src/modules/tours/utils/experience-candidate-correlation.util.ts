import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';

/**
 * Stable transient candidate correlation key: never an Experience identity or
 * dedupe key. Used across acquisition, extraction, entity resolution,
 * geographic validation, and materialization.
 */
export function traceCandidateKey(candidate: ExperienceCandidate): string {
  const evidence = [...candidate.evidenceKeys].sort().join('|');
  const hints = (
    candidate.orderedByEvidence
      ? candidate.componentHints
      : [...candidate.componentHints].sort((left, right) =>
          `${left.key}:${left.name}`.localeCompare(
            `${right.key}:${right.name}`,
          ),
        )
  )
    .map((hint) => `${hint.key}:${hint.name}`)
    .join('|');
  return `${candidate.name.trim().toLocaleLowerCase()}:${evidence}:${hints}`;
}
