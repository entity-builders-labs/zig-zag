import {
  ExperienceCandidate,
  GeoEntityHint,
} from '../interfaces/experience-discovery.interface';

const ROLES = new Set(['area', 'waypoint', 'route', 'venue']);
const KINDS = new Set(['PLACE', 'AREA', 'ROUTE']);
const MAX_HINTS = 8;

export interface ExperienceExtractionResult {
  candidates: ExperienceCandidate[];
  validationErrors: string[];
}

export function extractExperienceCandidates(
  raw: unknown,
  evidenceKeys: Set<string>,
  maxCandidates: number,
): ExperienceExtractionResult {
  const entries = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as any).candidates)
      ? (raw as any).candidates
      : [];
  const candidates: ExperienceCandidate[] = [];
  const validationErrors: string[] = [];

  for (const [index, value] of entries.slice(0, maxCandidates).entries()) {
    const candidate = value as any;
    const errors: string[] = [];
    if (
      !candidate ||
      typeof candidate.name !== 'string' ||
      !candidate.name.trim()
    )
      errors.push('name is required');
    if (!Array.isArray(candidate?.themes))
      errors.push('themes must be an array');
    if (!Array.isArray(candidate?.traits))
      errors.push('traits must be an array');
    if (
      !Array.isArray(candidate?.componentHints) ||
      candidate.componentHints.length === 0
    )
      errors.push('componentHints is required');
    if (
      !Array.isArray(candidate?.evidenceKeys) ||
      candidate.evidenceKeys.length === 0
    )
      errors.push('evidenceKeys is required');
    if (
      Array.isArray(candidate?.evidenceKeys) &&
      candidate.evidenceKeys.some(
        (key: unknown) => !evidenceKeys.has(String(key)),
      )
    )
      errors.push('candidate references unknown evidence');

    const hints: GeoEntityHint[] = [];
    if (Array.isArray(candidate?.componentHints)) {
      for (const [hintIndex, hint] of candidate.componentHints
        .slice(0, MAX_HINTS)
        .entries()) {
        if (!hint || typeof hint.name !== 'string' || !hint.name.trim()) {
          errors.push(`component ${hintIndex + 1} name is required`);
          continue;
        }
        if (!ROLES.has(hint.role) || !KINDS.has(hint.expectedKind))
          errors.push(`component ${hintIndex + 1} has invalid role/kind`);
        if (
          !Array.isArray(hint.evidenceKeys) ||
          hint.evidenceKeys.length === 0 ||
          hint.evidenceKeys.some(
            (key: unknown) => !evidenceKeys.has(String(key)),
          )
        )
          errors.push(`component ${hintIndex + 1} has invalid evidence`);
        hints.push({
          key: String(hint.key || `component-${hintIndex + 1}`),
          name: hint.name.trim(),
          role: hint.role,
          expectedKind: hint.expectedKind,
          required: hint.required === true,
          evidenceKeys: hint.evidenceKeys ?? [],
        });
      }
    }
    if (errors.length) {
      validationErrors.push(`Candidate ${index + 1}: ${errors.join('; ')}`);
      continue;
    }
    candidates.push({
      name: candidate.name.trim(),
      description:
        typeof candidate.description === 'string'
          ? candidate.description.trim()
          : undefined,
      themes: candidate.themes.map(String),
      traits: candidate.traits.map(String),
      suggestedDurationMinutes: Number.isInteger(
        candidate.suggestedDurationMinutes,
      )
        ? candidate.suggestedDurationMinutes
        : undefined,
      componentHints: hints,
      evidenceKeys: candidate.evidenceKeys.map(String),
      shortReason:
        typeof candidate.shortReason === 'string'
          ? candidate.shortReason.trim()
          : '',
    });
  }
  return { candidates, validationErrors };
}
