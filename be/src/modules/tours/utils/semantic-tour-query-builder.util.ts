import { TourIntent } from '../interfaces/tour-generation.interface';

function humanize(value: string): string {
  return value.replace(/_/g, ' ').trim();
}

/**
 * Builds the provider-neutral text used only for semantic retrieval. Geographic
 * identity and mobility constraints deliberately stay out of this document:
 * destination eligibility is enforced before pgvector, and transportation is
 * enforced later by deterministic spatial feasibility.
 */
export function buildSemanticTourQuery(intent: TourIntent): string | null {
  const interests = intent.interests.map(humanize).filter(Boolean);
  const experienceFormats = intent.experienceFormats
    .map(humanize)
    .filter(Boolean);
  const additionalPreferences = intent.additionalPreferences?.trim();

  const lines = [
    interests.length > 0 ? `Interests: ${interests.join(', ')}` : undefined,
    experienceFormats.length > 0
      ? `Experience formats: ${experienceFormats.join(', ')}`
      : undefined,
    `Exploration style: ${humanize(intent.explorationStyle)}`,
    additionalPreferences
      ? `Additional preferences: ${additionalPreferences}`
      : undefined,
  ].filter((line): line is string => !!line);

  return interests.length > 0 || additionalPreferences
    ? lines.join('\n')
    : null;
}
