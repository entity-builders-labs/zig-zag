import {
  ExperienceCandidate,
  GeoEntityHint,
} from '../interfaces/experience-discovery.interface';
import { normalizeExperienceCandidateFacets } from './experience-candidate-facet-normalizer.util';

const ROLES = new Set(['area', 'waypoint', 'route', 'venue']);
const KINDS = new Set(['PLACE', 'AREA', 'ROUTE']);
const MAX_HINTS = 8;

export interface ExperienceExtractionResult {
  candidates: ExperienceCandidate[];
  validationErrors: string[];
}

/**
 * Some discovery extractor providers (confirmed live: Groq/qwen3.8-27b in
 * `response_format: {type:'json_object'}` mode, which guarantees valid JSON
 * but never a specific top-level shape) sometimes return a single candidate
 * object directly instead of the documented `{"candidates":[...]}` envelope
 * the prompt asks for. Before this fix, that shape fell through to `[]`
 * with zero validationErrors — a real, well-evidenced multi-component
 * candidate was silently discarded with no observable signal anywhere.
 *
 * This is a structural, provider-agnostic repair (bare object with the two
 * fields every real candidate must have: `name` and `componentHints`),
 * never a per-provider or per-candidate-name special case. The repair is
 * always reported via `validationErrors` — never silent — so it stays
 * visible in `WebAcquisitionResult.validationErrors` and the generation
 * trace without any new plumbing.
 */
function normalizeExtractorEnvelope(raw: unknown): {
  entries: unknown[];
  repairNotes: string[];
} {
  if (Array.isArray(raw)) {
    return { entries: raw, repairNotes: [] };
  }
  if (raw && typeof raw === 'object') {
    const wrapped = (raw as Record<string, unknown>).candidates;
    if (Array.isArray(wrapped)) {
      return { entries: wrapped, repairNotes: [] };
    }
    const name = (raw as Record<string, unknown>).name;
    const componentHints = (raw as Record<string, unknown>).componentHints;
    if (typeof name === 'string' && Array.isArray(componentHints)) {
      return {
        entries: [raw],
        repairNotes: [
          'extractor_envelope_repaired: response was a single bare candidate object instead of {"candidates":[...]}; wrapped automatically',
        ],
      };
    }
  }
  return { entries: [], repairNotes: [] };
}

export function extractExperienceCandidates(
  raw: unknown,
  evidenceKeys: Set<string>,
  maxCandidates: number,
): ExperienceExtractionResult {
  const { entries, repairNotes } = normalizeExtractorEnvelope(raw);
  const candidates: ExperienceCandidate[] = [];
  const validationErrors: string[] = [...repairNotes];

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
    if (!Array.isArray(candidate?.intents))
      errors.push('intents must be an array');
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
    // Deterministic, provider-neutral repair of the semantic facets: themes and
    // intents are controlled vocabularies, traits is open-ended, and a
    // controlled concept the model placed in the wrong array is moved to the
    // right one instead of leaking through (see
    // experience-candidate-facet-normalizer.util.ts).
    const facets = normalizeExperienceCandidateFacets({
      themes: candidate.themes,
      traits: candidate.traits,
      intents: candidate.intents,
    });
    candidates.push({
      name: candidate.name.trim(),
      description:
        typeof candidate.description === 'string'
          ? candidate.description.trim()
          : undefined,
      themes: facets.themes,
      traits: facets.traits,
      intents: facets.intents,
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
      orderedByEvidence: candidate.orderedByEvidence === true,
    });
  }
  return { candidates, validationErrors };
}
