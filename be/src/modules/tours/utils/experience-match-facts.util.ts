import {
  ExperienceClassificationState,
  ExperienceMatchFacts,
  ExperienceSemanticFacts,
  ExperienceTargetKnowledge,
} from '../interfaces/experience-match-facts.interface';
import { SemanticTarget } from '../preferences/preference-assertion.interface';
import {
  TargetKnowledge,
  TargetObservation,
} from '../preferences/target-knowledge.interface';
import { reconcileTargetKnowledge } from './target-knowledge-reconciliation.util';
import {
  ASSERTION_TARGET_DIMENSIONS,
  AssertionTargetDimension,
  canonicalTargetKey,
  PREFERENCE_DIMENSIONS,
} from '../preferences/preference-facet-vocabulary';

/**
 * Boundary adapters into the typed match facts (review correction B). Each
 * raw representation adapts here exactly once; nothing downstream reads
 * metadata or casts unknown shapes to decide preference matching. Values
 * outside the typed schema are not facts and are dropped; nothing is
 * translated or invented.
 */

/** Closed schema dimensions carried as dimensioned facts (not theme/intent). */
const DIMENSIONED_FACT_DIMENSIONS: readonly AssertionTargetDimension[] =
  ASSERTION_TARGET_DIMENSIONS.filter(
    (dimension) =>
      dimension !== PREFERENCE_DIMENSIONS.THEME &&
      dimension !== PREFERENCE_DIMENSIONS.INTENT,
  );

function schemaKeys(
  dimension: AssertionTargetDimension,
  values: readonly unknown[] | undefined,
): string[] {
  const keys = new Set<string>();
  for (const value of values ?? []) {
    if (typeof value !== 'string') continue;
    const key = canonicalTargetKey(dimension, value);
    if (key) keys.add(key);
  }
  return [...keys];
}

/** A raw `{ dimension, key }` pair on a closed dimension, or undefined. */
function dimensionedFact(value: unknown): SemanticTarget | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { dimension, key } = value as { dimension?: unknown; key?: unknown };
  if (typeof dimension !== 'string' || typeof key !== 'string') {
    return undefined;
  }
  const typed = DIMENSIONED_FACT_DIMENSIONS.find(
    (candidate) => candidate === dimension.trim().toLowerCase(),
  );
  if (!typed) return undefined;
  const canonical = canonicalTargetKey(typed, key);
  return canonical ? { dimension: typed, key: canonical } : undefined;
}

/**
 * Semantic facts from typed theme/intent lists and dimensioned pairs (the
 * shared core of every adapter below).
 */
export function semanticFacts(input: {
  themes?: readonly unknown[];
  intents?: readonly unknown[];
  dimensionedTraits?: readonly unknown[];
}): ExperienceSemanticFacts {
  const facts = new Map<string, SemanticTarget>();
  for (const value of input.dimensionedTraits ?? []) {
    const fact = dimensionedFact(value);
    if (fact) facts.set(`${fact.dimension}:${fact.key}`, fact);
  }
  return {
    themes: schemaKeys(PREFERENCE_DIMENSIONS.THEME, input.themes),
    intents: schemaKeys(PREFERENCE_DIMENSIONS.INTENT, input.intents),
    dimensionedFacts: [...facts.values()],
  };
}

/** The persisted classification state recorded on a catalog row. */
function classificationState(
  classification: unknown,
): ExperienceClassificationState {
  if (!classification || typeof classification !== 'object') {
    return 'UNCLASSIFIED';
  }
  const state = (classification as { state?: unknown }).state;
  if (state === 'degraded') return 'DEGRADED';
  if (state === 'classified') return 'CLASSIFIED';
  return 'UNCLASSIFIED';
}

function knownQuality(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 5
    ? value
    : null;
}

function hasResolvedGeography(components: readonly unknown[] | undefined) {
  return (components ?? []).some((component) => {
    const geoEntity =
      component && typeof component === 'object'
        ? (component as { geoEntity?: unknown }).geoEntity
        : undefined;
    if (!geoEntity || typeof geoEntity !== 'object') return false;
    const { latitude, longitude } = geoEntity as {
      latitude?: unknown;
      longitude?: unknown;
    };
    return (
      typeof latitude === 'number' &&
      Number.isFinite(latitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      typeof longitude === 'number' &&
      Number.isFinite(longitude) &&
      longitude >= -180 &&
      longitude <= 180
    );
  });
}

/**
 * Catalog persistence adapter: the documented persisted classification
 * contract of a VERIFIED Experience (`themes`, `intents`, typed
 * `dimensionedTraits`, `classification.state`) plus its resolved geography,
 * quality, duration and reconciled target knowledge. Used once, by the
 * catalog projection.
 */
export function catalogMatchFacts(row: {
  themes: readonly string[];
  intents: readonly string[];
  dimensionedTraits: readonly unknown[];
  classification: unknown;
  components: readonly unknown[];
  qualityScore: number | null;
  durationMinutes: number | null;
}): ExperienceMatchFacts {
  return {
    semantic: semanticFacts(row),
    classificationState: classificationState(row.classification),
    hasResolvedGeography: hasResolvedGeography(row.components),
    qualityScore: knownQuality(row.qualityScore),
    durationMinutes:
      typeof row.durationMinutes === 'number' &&
      Number.isFinite(row.durationMinutes)
        ? row.durationMinutes
        : null,
    targetKnowledge: targetKnowledgeOf(row.components),
  };
}

/**
 * Reconciled target knowledge from a candidate's raw persisted target
 * observations (task 25.7). The raw rows are read exactly once, here at the
 * projection boundary, and each target is reconciled through the single
 * reconciliation authority; values outside the typed schema are not facts
 * and are dropped.
 */
function targetKnowledgeOf(
  components: readonly unknown[],
): ExperienceTargetKnowledge[] {
  return components.map((component) => {
    const geoEntity =
      component && typeof component === 'object'
        ? (component as { geoEntity?: unknown }).geoEntity
        : undefined;
    const rows =
      geoEntity && typeof geoEntity === 'object'
        ? (geoEntity as { targetObservations?: unknown }).targetObservations
        : undefined;
    const grouped = new Map<string, TargetObservation[]>();
    if (Array.isArray(rows)) {
      for (const row of rows) {
        const fact = targetObservation(row);
        if (!fact) continue;
        grouped.set(fact.targetKey, [
          ...(grouped.get(fact.targetKey) ?? []),
          fact.observation,
        ]);
      }
    }
    const byTarget: Record<string, TargetKnowledge> = {};
    for (const [targetKey, observations] of grouped) {
      byTarget[targetKey] = reconcileTargetKnowledge(observations);
    }
    return { byTarget };
  });
}

function targetObservation(
  row: unknown,
): { targetKey: string; observation: TargetObservation } | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const { dimension, key, state, sourceFactId } = row as {
    dimension?: unknown;
    key?: unknown;
    state?: unknown;
    sourceFactId?: unknown;
  };
  if (
    typeof dimension !== 'string' ||
    typeof key !== 'string' ||
    typeof sourceFactId !== 'string'
  ) {
    return undefined;
  }
  if (
    state !== 'SATISFIES' &&
    state !== 'DOES_NOT_SATISFY' &&
    state !== 'INCONCLUSIVE'
  ) {
    return undefined;
  }
  // Validate against the closed assertion-target schema: an out-of-schema
  // dimension/key is not a fact and is dropped, and the key is canonicalized
  // exactly like an assertion target key so both sides address the same key.
  const canonicalKey = canonicalTargetKey(dimension, key);
  if (!canonicalKey) return undefined;
  return {
    targetKey: `${dimension}:${canonicalKey}`,
    observation: { sourceFactId, state },
  };
}

/**
 * Discovery adapter: an extracted candidate's normalized themes and intents
 * (its open traits carry no typed identity). Used once per candidate by
 * deficit projection.
 */
export function discoveryCandidateSemanticFacts(candidate: {
  themes: readonly string[];
  intents?: readonly string[];
}): ExperienceSemanticFacts {
  return semanticFacts({
    themes: candidate.themes,
    intents: candidate.intents ?? [],
  });
}
