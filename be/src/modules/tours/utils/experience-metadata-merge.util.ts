/**
 * Order-independent Experience metadata merge (plan Task B4, spec §8:
 * "Provider order must not erase richer metadata. Metadata merge semantics
 * must be order-independent for union-valued semantic arrays and
 * conservative for scalar facts.").
 *
 * `mergeExperienceMetadata(a, b)` combines two independently-sourced
 * observations of the SAME real-world Experience (e.g. the persisted row
 * and a newly re-observed candidate, in either order) into one metadata
 * snapshot, using a canonical, field-specific policy instead of a generic
 * object spread / last-write-wins:
 *
 * - `themes` / `intents` (+ legacy `archetypes` intents fallback) /
 *   `traits`: union, deduped, sorted -- never simply "whichever side came
 *   last".
 * - `dimensionedTraits`: union of explicit `{dimension, key, label?}`
 *   entries verbatim, deduped by `dimension:key`. NEVER derived from a
 *   plain `traits[]` string -- the classifier does not emit a dimension
 *   taxonomy in v1 (spec §9.1), so persistence must not invent one (e.g.
 *   a freeform trait `"iconic"` must never become a manufactured
 *   `tourism_intensity:iconic` dimensioned entry here).
 * - `classification`: version-aware, atomic replacement (D2) -- never
 *   merged field-by-field with another classification (that would break
 *   its own internal fact/evidence 1:1 consistency, B2's invariant). A
 *   current, valid `classified` result beats a current `degraded` one,
 *   which beats a stale-prompt-version or malformed one, which beats
 *   nothing. Equally-ranked candidates are resolved by a deterministic,
 *   content-based tie-break -- never by which literal argument position
 *   supplied them.
 * - `qualityScore`: the stronger of two valid scores (commutative max);
 *   missing is unknown, never 0, and never suppresses a valid score from
 *   the other side.
 * - every other/unknown key: a generic "richer non-empty value wins over
 *   empty, deterministic tie-break otherwise" policy, so an unmodeled
 *   future key still merges symmetrically rather than falling back to a
 *   naive object spread.
 *
 * Every rule here is deliberately commutative:
 * `mergeExperienceMetadata(a, b)` deep-equals `mergeExperienceMetadata(b,
 * a)` for any two inputs.
 *
 * Pure and side-effect-free: no Prisma, no acquisition, no provider calls.
 * Consumed by `ExperienceCatalogService`'s dedupe-reconciliation path.
 */

import {
  canReuseClassification,
  CURRENT_CLASSIFICATION_PROMPT_VERSION,
} from '../services/experience-classification.service';
import { normalizeClassifierTrait } from './trait-shape-guard.util';

export interface ExperienceMetadataSnapshot {
  qualityScore?: number | null;
  metadata?: unknown;
}

export interface MergedExperienceMetadata {
  qualityScore: number | null;
  metadata: Record<string, unknown>;
}

/** Metadata keys with a dedicated policy below; everything else falls
 *  through to the generic scalar policy. `archetypes` is a legacy
 *  read-only fallback for `intents` -- it is folded into the canonical
 *  `intents` union and never re-emitted on its own. */
const KNOWN_METADATA_KEYS = new Set([
  'themes',
  'intents',
  'archetypes',
  'traits',
  'dimensionedTraits',
  'classification',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function normalizeSimpleKey(value: string): string {
  return value.trim().toLowerCase();
}

/** Union of raw string candidates, normalized (identity + stored form) via
 *  `normalize`, sorted. Sorting the result (not just deduping) is itself
 *  part of the order-independence guarantee: two equal sets must produce
 *  byte-identical arrays regardless of which side contributed which
 *  member. */
function sortedUnion(
  values: string[],
  normalize: (value: string) => string,
): string[] {
  const set = new Set<string>();
  for (const raw of values) {
    if (typeof raw !== 'string') continue;
    const normalized = normalize(raw);
    if (normalized) set.add(normalized);
  }
  return Array.from(set).sort();
}

interface DimensionedTraitEntry {
  dimension: string;
  key: string;
  label?: string;
}

function isDimensionedTraitEntry(
  value: unknown,
): value is DimensionedTraitEntry {
  if (!isPlainObject(value)) return false;
  const dimension = value.dimension;
  const key = value.key;
  return (
    typeof dimension === 'string' &&
    dimension.trim().length > 0 &&
    typeof key === 'string' &&
    key.trim().length > 0
  );
}

/** Union of explicit dimensioned-trait entries from both sides, deduped by
 *  `dimension:key`. Malformed entries are dropped, never coerced or used
 *  to manufacture a new dimension. Candidates are sorted by identity (then
 *  by label) BEFORE dedupe, so which literal entry "wins" for a given
 *  identity never depends on which side (a or b) supplied it -- only on
 *  the entries' own content. */
function mergeDimensionedTraits(
  a: unknown,
  b: unknown,
): DimensionedTraitEntry[] {
  const combined = [
    ...(Array.isArray(a) ? a : []),
    ...(Array.isArray(b) ? b : []),
  ].filter(isDimensionedTraitEntry);

  const withIdentity = combined
    .map((entry) => ({
      identity: `${entry.dimension.trim().toLowerCase()}:${entry.key.trim().toLowerCase()}`,
      entry,
    }))
    .sort((x, y) => {
      if (x.identity !== y.identity) return x.identity < y.identity ? -1 : 1;
      const xLabel = x.entry.label ?? '';
      const yLabel = y.entry.label ?? '';
      return xLabel < yLabel ? -1 : xLabel > yLabel ? 1 : 0;
    });

  const byIdentity = new Map<string, DimensionedTraitEntry>();
  for (const { identity, entry } of withIdentity) {
    if (!byIdentity.has(identity)) {
      byIdentity.set(identity, {
        dimension: entry.dimension,
        key: entry.key,
        label: entry.label,
      });
    }
  }
  return Array.from(byIdentity.keys())
    .sort()
    .map((identity) => byIdentity.get(identity)!);
}

/** Null-safe, order-independent "strongest valid signal" quality merge
 *  (matches the policy `quality-score.util.ts` itself expects a caller to
 *  apply between two already-computed scores): a missing score never
 *  outranks a real one, and two real scores resolve via `Math.max`
 *  (commutative). */
function mergeQualityScore(
  a: number | null | undefined,
  b: number | null | undefined,
): number | null {
  const aValid = typeof a === 'number' && Number.isFinite(a);
  const bValid = typeof b === 'number' && Number.isFinite(b);
  if (!aValid && !bValid) return null;
  if (!aValid) return b as number;
  if (!bValid) return a as number;
  return Math.max(a as number, b as number);
}

/** Minimal, LOCAL shape check for "a well-formed, current-prompt-version
 *  classification payload, in EITHER state" -- deliberately separate from
 *  `canReuseClassification` (which excludes `degraded` by design, since
 *  that predicate answers a different question: "may Stage 6 be skipped
 *  for this Experience?", not "is this worth keeping through a merge?").
 *  A current, well-formed `degraded` classification is real, meaningful
 *  state (spec D1: a marker for a later reclassification job to repair)
 *  and must not be silently dropped by a merge just because it isn't
 *  reusable. */
function isWellFormedCurrentClassification(value: unknown): value is {
  themes: unknown[];
  intents: unknown[];
  traits: unknown[];
  reasoningEvidence: unknown[];
  promptVersion: number;
  state: 'classified' | 'degraded';
} {
  if (!isPlainObject(value)) return false;
  if (value.promptVersion !== CURRENT_CLASSIFICATION_PROMPT_VERSION) {
    return false;
  }
  if (!Array.isArray(value.themes)) return false;
  if (!Array.isArray(value.intents)) return false;
  if (!Array.isArray(value.traits)) return false;
  if (!Array.isArray(value.reasoningEvidence)) return false;
  return value.state === 'classified' || value.state === 'degraded';
}

/** Ranks a metadata blob's `classification` field: 2 = current + reusable
 *  (`state: 'classified'`, passes the full `canReuseClassification` shape
 *  guard including internal fact/evidence consistency); 1 = current +
 *  well-formed but `degraded`; 0 = absent, malformed, or a stale prompt
 *  version. Version-aware by construction -- never a function of which
 *  provider/call supplied it. */
function classificationTier(metadata: Record<string, unknown>): 0 | 1 | 2 {
  if (
    canReuseClassification(
      { classification: metadata.classification },
      CURRENT_CLASSIFICATION_PROMPT_VERSION,
    )
  ) {
    return 2;
  }
  return isWellFormedCurrentClassification(metadata.classification) ? 1 : 0;
}

/** Picks which side's `classification` survives the merge. Treated as one
 *  atomic, indivisible unit -- never merged field-by-field with the
 *  other side's classification, which would silently break its own
 *  internal 1:1 fact/evidence consistency (B2's invariant). Ties (both
 *  sides equally ranked) are resolved by content -- more `reasoningEvidence`
 *  wins; a final exact tie falls back to a stable lexicographic
 *  comparison of the serialized payload -- so the result is identical
 *  regardless of which side is `a` and which is `b`. */
function pickClassification(
  aMeta: Record<string, unknown>,
  bMeta: Record<string, unknown>,
): unknown {
  const aTier = classificationTier(aMeta);
  const bTier = classificationTier(bMeta);
  if (aTier === 0 && bTier === 0) return undefined;
  if (aTier !== bTier)
    return aTier > bTier ? aMeta.classification : bMeta.classification;

  const aValue = aMeta.classification;
  const bValue = bMeta.classification;
  const aEvidenceCount =
    isPlainObject(aValue) && Array.isArray(aValue.reasoningEvidence)
      ? aValue.reasoningEvidence.length
      : 0;
  const bEvidenceCount =
    isPlainObject(bValue) && Array.isArray(bValue.reasoningEvidence)
      ? bValue.reasoningEvidence.length
      : 0;
  if (aEvidenceCount !== bEvidenceCount) {
    return aEvidenceCount > bEvidenceCount ? aValue : bValue;
  }
  const aKey = JSON.stringify(aValue);
  const bKey = JSON.stringify(bValue);
  return aKey <= bKey ? aValue : bValue;
}

function isEmptyGenericValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/** Generic, order-independent policy for any metadata key with no
 *  dedicated rule above: a non-empty value beats an empty/absent one; two
 *  identical values need no tie-break; two different non-empty values
 *  resolve to the "richer" (longer serialized) one, with a final stable
 *  lexicographic comparison on an exact tie -- so an unmodeled future key
 *  still converges regardless of argument order, without ever inventing
 *  structure for it. */
function mergeGenericValue(a: unknown, b: unknown): unknown {
  const aEmpty = isEmptyGenericValue(a);
  const bEmpty = isEmptyGenericValue(b);
  if (aEmpty && bEmpty) return undefined;
  if (aEmpty) return b;
  if (bEmpty) return a;

  const aKey = JSON.stringify(a);
  const bKey = JSON.stringify(b);
  if (aKey === bKey) return a;
  if (aKey.length !== bKey.length) return aKey.length > bKey.length ? a : b;
  return aKey <= bKey ? a : b;
}

export function mergeExperienceMetadata(
  a: ExperienceMetadataSnapshot,
  b: ExperienceMetadataSnapshot,
): MergedExperienceMetadata {
  const aMeta = asRecord(a?.metadata);
  const bMeta = asRecord(b?.metadata);

  const themes = sortedUnion(
    [...stringArray(aMeta.themes), ...stringArray(bMeta.themes)],
    normalizeSimpleKey,
  );
  const intents = sortedUnion(
    [
      ...stringArray(aMeta.intents ?? aMeta.archetypes),
      ...stringArray(bMeta.intents ?? bMeta.archetypes),
    ],
    normalizeSimpleKey,
  );
  const traits = sortedUnion(
    [...stringArray(aMeta.traits), ...stringArray(bMeta.traits)],
    normalizeClassifierTrait,
  );
  const dimensionedTraits = mergeDimensionedTraits(
    aMeta.dimensionedTraits,
    bMeta.dimensionedTraits,
  );
  const classification = pickClassification(aMeta, bMeta);

  const merged: Record<string, unknown> = {};

  const otherKeys = new Set([...Object.keys(aMeta), ...Object.keys(bMeta)]);
  for (const key of otherKeys) {
    if (KNOWN_METADATA_KEYS.has(key)) continue;
    const value = mergeGenericValue(aMeta[key], bMeta[key]);
    if (value !== undefined) merged[key] = value;
  }

  if (themes.length) merged.themes = themes;
  if (intents.length) merged.intents = intents;
  if (traits.length) merged.traits = traits;
  if (dimensionedTraits.length) merged.dimensionedTraits = dimensionedTraits;
  if (classification !== undefined) merged.classification = classification;

  return {
    qualityScore: mergeQualityScore(a?.qualityScore, b?.qualityScore),
    metadata: merged,
  };
}
