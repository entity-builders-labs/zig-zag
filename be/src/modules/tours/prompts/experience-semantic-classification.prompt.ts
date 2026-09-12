import { ExperienceGroundingEvidence } from '../interfaces/experience-grounding.interface';
import {
  CANONICAL_INTENT_KEYS,
  CANONICAL_THEME_KEYS,
} from '../utils/experience-candidate-facet-normalizer.util';

/**
 * The evidence-only semantic classification contract (spec §9, plan Task
 * B2). Classification input is evidence about ONE already-identified
 * Experience -- never traveler preferences, never a second identity/
 * geography authority. Canonical theme/intent vocabularies are reused from
 * `experience-candidate-facet-normalizer.util.ts`, the same single source
 * of truth Stage 7 discovery extraction uses -- this is not a second copy
 * of the tourism taxonomy.
 */

export { CANONICAL_THEME_KEYS, CANONICAL_INTENT_KEYS };

/** Role framing + evidence-only / anti-fabrication rules. */
export function buildClassificationSystemPrompt(): string {
  return `You are an Experience semantic classifier.

Your task is evidence-only classification: given real, grounded evidence
already gathered about one specific Experience, decide which canonical
themes, canonical intents and freeform traits that evidence substantially
supports.

You NEVER receive and NEVER use the traveler's preferences, requested
themes, wizard selections or free-text intent for this decision -- this is
strictly about what the evidence itself substantiates, never about what a
user asked for. Classifying evidence to match a preference would be
fabrication, not classification.

Rules:
- themes must be drawn ONLY from this controlled vocabulary: ${CANONICAL_THEME_KEYS.join(', ')}.
- intents must be drawn ONLY from this controlled vocabulary: ${CANONICAL_INTENT_KEYS.join(', ')}.
- traits are freeform, open-ended, concise descriptive properties (e.g.
  "rooftop", "family friendly", "craft beer") -- never a full sentence, never
  more than a few words, and never a canonical theme or intent restated as a
  trait.
- Never invent a structured dimensioned fact (no "dimensionedFacets" output
  of any kind) -- traits stay plain freeform strings, nothing else.
- Accept a theme, intent or trait ONLY when it is substantially supported by
  the evidence -- never for an incidental word match, a passing mention, or a
  weak inference. When in doubt, omit it.
- Every accepted theme, intent and trait MUST have a corresponding entry in
  reasoningEvidence citing the exact evidence key(s) that support it. Never
  accept a semantic fact with no real evidence key backing it.
- Empty arrays are a normal, expected, accurate output when the evidence does
  not substantially support any theme, intent or trait -- do not force a
  result.
- Never invent coordinates, provider IDs, or facts not present in the
  supplied evidence.

Return JSON only. Output themes (array), intents (array), traits (array),
and reasoningEvidence: an array of {facet, evidenceKeys, reason}, where
facet is exactly "theme:<key>", "intent:<key>" or "trait:<value>" (matching
one of the accepted themes/intents/traits), evidenceKeys is a non-empty
array of the real evidence keys supplied to you, and reason is a short,
concrete justification.`;
}

/** The `Evidence:` header plus one line per evidence item, same convention
 *  discovery extraction uses (`[key] title/source: snippet`). */
export function buildClassificationEvidenceBlock(
  evidence: ExperienceGroundingEvidence[],
): string[] {
  return [
    'Evidence:',
    ...evidence.map(
      (item) => `[${item.key}] ${item.title || item.source}: ${item.snippet}`,
    ),
  ];
}

/** Full user prompt = entity identity header + evidence block. No
 *  traveler-preference parameter exists on this function at all. */
export function buildClassificationUserPrompt(
  canonicalName: string,
  evidence: ExperienceGroundingEvidence[],
): string {
  return [
    `Experience: ${canonicalName}`,
    ...buildClassificationEvidenceBlock(evidence),
  ].join('\n');
}

/**
 * JSON Schema for the classification envelope -- shares the same
 * enum-constrained theme/intent vocabulary as the discovery extraction
 * schema (`buildDiscoveryResponseJsonSchema`), kept as a distinct artifact
 * since classification and discovery are different stages with different
 * envelopes. Groq (v1's classification provider) runs in JSON-object mode
 * and leans on the system prompt above plus the deterministic backend
 * sanitizer in `experience-classification.service.ts`; this schema remains
 * available for a future schema-enforced provider.
 */
export function buildClassificationResponseJsonSchema(): Record<
  string,
  unknown
> {
  return {
    type: 'object',
    properties: {
      themes: {
        type: 'array',
        items: { type: 'string', enum: [...CANONICAL_THEME_KEYS] },
      },
      intents: {
        type: 'array',
        items: { type: 'string', enum: [...CANONICAL_INTENT_KEYS] },
      },
      traits: {
        type: 'array',
        items: { type: 'string' },
      },
      reasoningEvidence: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            facet: { type: 'string' },
            evidenceKeys: { type: 'array', items: { type: 'string' } },
            reason: { type: 'string' },
          },
          required: ['facet', 'evidenceKeys', 'reason'],
        },
      },
    },
    required: ['themes', 'intents', 'traits', 'reasoningEvidence'],
  };
}
