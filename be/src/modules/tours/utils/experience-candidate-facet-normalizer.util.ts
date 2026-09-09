import {
  canonicalizeFacetKey,
  INITIAL_DIMENSION_VOCABULARY,
  PREFERENCE_DIMENSIONS,
} from '../preferences/preference-facet-vocabulary';

/**
 * Deterministic, provider-neutral repair of an ExperienceCandidate's semantic
 * facets at the shared LLM extraction boundary.
 *
 * Domain contract:
 * - `themes`  is a CONTROLLED dimension  -> only canonical THEME keys survive.
 * - `intents` is a CONTROLLED dimension  -> only canonical INTENT keys survive.
 * - `traits`  is OPEN-ENDED              -> anything the central vocabulary does
 *   NOT recognize as a controlled theme or intent, kept as a human-readable
 *   label.
 *
 * Hard invariant: no value recognizable as a controlled theme/intent may remain
 * inside `traits`. Unknown long-tail concepts are never discarded — they fall
 * back to `traits`.
 *
 * The single source of truth is `preference-facet-vocabulary.ts`
 * (`INITIAL_DIMENSION_VOCABULARY` + `DIMENSION_KEY_SYNONYMS` via
 * `canonicalizeFacetKey`). This util never declares its own taxonomy and never
 * contains per-interest rules (no `if wine` / `if beer` / `if tango`).
 */

/** Canonical THEME keys, straight from the central vocabulary. */
export const CANONICAL_THEME_KEYS: readonly string[] =
  INITIAL_DIMENSION_VOCABULARY[PREFERENCE_DIMENSIONS.THEME];

/** Canonical INTENT keys, straight from the central vocabulary. */
export const CANONICAL_INTENT_KEYS: readonly string[] =
  INITIAL_DIMENSION_VOCABULARY[PREFERENCE_DIMENSIONS.INTENT];

export interface RawExperienceCandidateFacets {
  themes: unknown[];
  traits: unknown[];
  intents: unknown[];
}

export interface NormalizedExperienceCandidateFacets {
  themes: string[];
  traits: string[];
  intents: string[];
}

function canonicalTheme(raw: string): string | undefined {
  return canonicalizeFacetKey(PREFERENCE_DIMENSIONS.THEME, raw);
}

function canonicalIntent(raw: string): string | undefined {
  return canonicalizeFacetKey(PREFERENCE_DIMENSIONS.INTENT, raw);
}

/**
 * Open-ended dedupe identity for a free trait. TRAIT is deliberately
 * open-ended, so `canonicalizeFacetKey` returns a normalized snake-ish key
 * ("Craft Beer" / " CRAFT BEER " -> "craft_beer") rather than rejecting it.
 * The identity is used only for dedupe; the first trimmed human label is what
 * we keep in the output.
 */
function traitIdentity(label: string): string {
  return (
    canonicalizeFacetKey(PREFERENCE_DIMENSIONS.TRAIT, label) ??
    label.trim().toLowerCase()
  );
}

/**
 * Repairs `{ themes, traits, intents }` into the domain contract above.
 *
 * Origin-aware precedence (origin only breaks the tie for a key valid in BOTH
 * controlled dimensions, e.g. `food` / `nightlife` / `shopping`):
 *
 *   from themes[]  : canonical THEME  -> canonical INTENT -> open trait
 *   from intents[] : canonical INTENT -> canonical THEME  -> open trait
 *   from traits[]  : canonical THEME  -> canonical INTENT -> open trait
 *
 * There is NO global theme<->intent dedupe: if the raw input explicitly placed
 * the same key in both controlled arrays, it may legitimately survive in both.
 * Dedupe is only ever within a single output dimension.
 *
 * Pure and deterministic: raw arrays are processed in the fixed order
 * [themes, intents, traits], each in input order; Set / Map preserve insertion
 * order.
 */
export function normalizeExperienceCandidateFacets(
  input: RawExperienceCandidateFacets,
): NormalizedExperienceCandidateFacets {
  const themes = new Set<string>();
  const intents = new Set<string>();
  const traitsByIdentity = new Map<string, string>();

  const addTrait = (label: string): void => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const identity = traitIdentity(trimmed);
    if (!traitsByIdentity.has(identity)) {
      traitsByIdentity.set(identity, trimmed);
    }
  };

  const stringValues = (values: unknown[] | undefined): string[] =>
    (Array.isArray(values) ? values : [])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

  // from themes[] : THEME -> INTENT -> trait
  for (const raw of stringValues(input?.themes)) {
    const theme = canonicalTheme(raw);
    if (theme) {
      themes.add(theme);
      continue;
    }
    const intent = canonicalIntent(raw);
    if (intent) {
      intents.add(intent);
      continue;
    }
    addTrait(raw);
  }

  // from intents[] : INTENT -> THEME -> trait
  for (const raw of stringValues(input?.intents)) {
    const intent = canonicalIntent(raw);
    if (intent) {
      intents.add(intent);
      continue;
    }
    const theme = canonicalTheme(raw);
    if (theme) {
      themes.add(theme);
      continue;
    }
    addTrait(raw);
  }

  // from traits[] : THEME -> INTENT -> trait (promotes leaked controlled keys)
  for (const raw of stringValues(input?.traits)) {
    const theme = canonicalTheme(raw);
    if (theme) {
      themes.add(theme);
      continue;
    }
    const intent = canonicalIntent(raw);
    if (intent) {
      intents.add(intent);
      continue;
    }
    addTrait(raw);
  }

  // Belt and braces: per-value routing above already guarantees a trait failed
  // both controlled lookups, so this never drops anything today. Kept so the
  // hard invariant holds even if a future edit reorders the passes.
  for (const [identity, label] of traitsByIdentity) {
    if (canonicalTheme(label) || canonicalIntent(label)) {
      traitsByIdentity.delete(identity);
    }
  }

  return {
    themes: [...themes],
    intents: [...intents],
    traits: [...traitsByIdentity.values()],
  };
}
