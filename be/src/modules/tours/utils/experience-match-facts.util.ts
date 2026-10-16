import {
  ExperienceClassificationState,
  ExperienceMatchFacts,
  ExperienceSemanticFacts,
} from '../interfaces/experience-match-facts.interface';
import { SemanticTarget } from '../preferences/preference-assertion.interface';
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
 * quality and duration. Used once, by the catalog projection.
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
