/**
 * Trait-shape guard (spec §9.1, plan Task B2).
 *
 * Freeform classifier traits remain freeform strings -- concise, open-ended
 * descriptive properties (e.g. "rooftop", "family friendly", "craft beer"),
 * never a full sentence, and never a structured `{dimension,key}` fact in
 * disguise (spec: "no dimensionedFacets", "no generic sentence-shaped
 * traits"). This module decides SHAPE only -- whether a raw classifier
 * output value even looks like a legitimate trait. It does not decide
 * TRUTH: whether a trait is actually supported by cited evidence is a
 * separate, service-level concern (`experience-classification.service.ts`).
 */

/** Conservative "concise" cutoff -- every real example in this codebase's
 * existing prompts ("craft beer", "rooftop", "family friendly", "specialty
 * coffee") is 1-2 words; this leaves modest headroom without accepting a
 * sentence fragment. */
const MAX_TRAIT_WORDS = 3;

const SENTENCE_ENDING_PUNCTUATION = /[.!?]$/;

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * True iff `value` is a plain string shaped like a concise, open-ended
 * trait. Callers pass raw, runtime-unknown classifier output here; a
 * non-string (including a `{dimension,key}`-shaped object) is rejected
 * outright, never coerced into a string.
 */
export function isValidClassifierTraitShape(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (/[\n\r]/.test(value)) return false;
  const normalized = normalizeWhitespace(value);
  if (!normalized) return false;
  if (SENTENCE_ENDING_PUNCTUATION.test(normalized)) return false;
  const wordCount = normalized.split(' ').length;
  if (wordCount > MAX_TRAIT_WORDS) return false;
  return true;
}

/**
 * Normalizes an already-shape-valid trait into its canonical persisted
 * form (trimmed, single-spaced, lowercased) -- matching the existing
 * freeform-trait persistence convention (e.g.
 * `ExperienceCatalogService.resolveOrCreateTraitDefinitions`). Callers must
 * check `isValidClassifierTraitShape` first; this does not re-validate shape.
 */
export function normalizeClassifierTrait(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

/**
 * Sanitizes a raw, runtime-unknown traits value: a non-array degrades to
 * `[]` rather than throwing. Drops any entry that isn't validly shaped,
 * normalizes surviving entries, and deduplicates by normalized value.
 */
export function sanitizeClassifierTraits(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of value) {
    if (!isValidClassifierTraitShape(raw)) continue;
    const normalized = normalizeClassifierTrait(raw);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}
