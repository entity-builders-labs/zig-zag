import { NormalizedPreferenceIntent } from '../interfaces/preference-interpretation.interface';
import {
  calculateEffectiveWeight,
  PreferenceFacet,
  PreferenceFacetSource,
} from '../preferences/preference-facet.interface';
import { candidateMatchesPreferenceFacet } from './preference-facet-matching.util';

export interface PreferenceFacetMatch {
  dimension: string;
  key: string;
  importance: number;
  confidence: number;
  effectiveWeight: number;
  source: PreferenceFacetSource;
  matched: boolean;
}

export interface PreferenceEvaluation {
  score: number;
  positiveMatches: string[];
  negativeMatches: string[];
  exclusionMatches: string[];
  reasons: string[];
  facetMatches: PreferenceFacetMatch[];
}

const ALIASES: Record<string, string[]> = {
  religion: [
    'religion',
    'religious',
    'iglesia',
    'church',
    'templo',
    'catedral',
    'cathedral',
    'mezquita',
    'mosque',
    'synagogue',
    'sinagoga',
  ],
  vegan: ['vegan', 'vegano', 'vegana', 'plant based', 'plant-based'],
  'non-vegan food': ['meat', 'carne', 'asado', 'parrilla', 'steak', 'chorizo'],
  accessibility: [
    'accessible',
    'accesible',
    'wheelchair',
    'silla de ruedas',
    'step free',
    'step-free',
  ],
  'family friendly': [
    'family friendly',
    'family-friendly',
    'kids',
    'children',
    'niños',
    'ninos',
    'familia',
  ],
  'low budget': [
    'low budget',
    'budget',
    'free',
    'gratis',
    'economical',
    'economico',
    'económico',
  ],
};

export function evaluateExperiencePreferences(
  experience: any,
  intent?: NormalizedPreferenceIntent,
): PreferenceEvaluation {
  if (!intent) {
    return {
      score: 0,
      positiveMatches: [],
      negativeMatches: [],
      exclusionMatches: [],
      reasons: [],
      facetMatches: [],
    };
  }

  const corpus = buildPreferenceCorpus(experience);

  // 1. Deduplicate preferred facets by normalized (dimension, key)
  const dedupedFacets = deduplicateFacets(intent.preferredFacets ?? []);

  // 2. Legacy positive constraint terms (dietary, accessibility, budget, group)
  const legacyPositiveTerms = unique([
    ...(intent.dietaryPreferences ?? []),
    ...(intent.accessibilityPreferences ?? []),
    ...(intent.budgetPreferences ?? []),
    ...(intent.groupPreferences ?? []),
  ]);

  let facetPossibleWeight = 0;
  let facetMatchedWeight = 0;
  const positiveMatches: string[] = [];
  const facetMatches: PreferenceFacetMatch[] = [];

  for (const facet of dedupedFacets) {
    const effectiveWeight = calculateEffectiveWeight(facet);
    facetPossibleWeight += effectiveWeight;

    const matched = candidateMatchesPreferenceFacet(experience, facet);
    if (matched) {
      facetMatchedWeight += effectiveWeight;
      positiveMatches.push(facet.key);
    }

    facetMatches.push({
      dimension: facet.dimension,
      key: facet.key,
      importance: facet.importance,
      confidence: facet.confidence,
      effectiveWeight,
      source: facet.source,
      matched,
    });
  }

  let legacyPossibleWeight = 0;
  let legacyMatchedWeight = 0;

  for (const term of legacyPositiveTerms) {
    legacyPossibleWeight += 1.0;
    if (matchesTerm(corpus, term)) {
      legacyMatchedWeight += 1.0;
      positiveMatches.push(term);
    }
  }

  const totalPossibleWeight = facetPossibleWeight + legacyPossibleWeight;
  const totalMatchedWeight = facetMatchedWeight + legacyMatchedWeight;

  const positiveRatio =
    totalPossibleWeight > 0 ? totalMatchedWeight / totalPossibleWeight : 0;

  // 3. Negative penalties (soft)
  const negative = unique([
    ...(intent.excludedThemes ?? []),
    ...(intent.excludedTraits ?? []),
    ...(intent.softConstraints ?? []),
  ]);
  const negativeMatches = negative.filter((term) => matchesTerm(corpus, term));
  const negativePenalty = negative.length
    ? negativeMatches.length / negative.length
    : 0;

  // 4. Hard exclusions
  const exclusionMatches = findHardExclusionMatches(
    experience,
    intent.hardExclusions ?? [],
  );
  const exclusionPenalty = exclusionMatches.length > 0 ? 1 : 0;

  // 5. Final clamped score
  const score = clamp01(
    positiveRatio - negativePenalty * 0.45 - exclusionPenalty * 0.8,
  );

  const uniquePositiveMatches = unique(positiveMatches);

  const reasons = [
    ...uniquePositiveMatches.map((match) => `positive:${match}`),
    ...negativeMatches.map((match) => `negative:${match}`),
    ...exclusionMatches.map((match) => `exclusion:${match}`),
  ];

  return {
    score,
    positiveMatches: uniquePositiveMatches,
    negativeMatches,
    exclusionMatches,
    reasons,
    facetMatches,
  };
}

function deduplicateFacets(facets: PreferenceFacet[]): PreferenceFacet[] {
  const map = new Map<string, PreferenceFacet>();
  for (const f of facets) {
    if (!f || !f.key) {
      continue;
    }
    const dim = f.dimension.trim().toLowerCase();
    const key = f.key.trim().toLowerCase();
    const compound = `${dim}:${key}`;
    if (!map.has(compound)) {
      map.set(compound, {
        ...f,
        dimension: dim,
        key,
      });
    }
  }
  return Array.from(map.values());
}

export function buildPreferenceCorpus(experience: any): string[] {
  // Optional components must not turn a preference into a hard exclusion for
  // an Experience that does not require visiting them.
  const componentValues = Array.isArray(experience?.components)
    ? experience.components
        .filter((component: any) => component?.required !== false)
        .flatMap((component: any) => [
          component?.role,
          component?.geoEntity?.name,
          component?.geoEntity?.kind,
          component?.geoEntity?.address,
          ...stringArray(component?.geoEntity?.metadata?.types),
        ])
    : [];

  return unique([
    experience?.canonicalName,
    experience?.name,
    experience?.description,
    ...stringArray(experience?.themes),
    ...stringArray(experience?.traits),
    ...stringArray(experience?.intents),
    ...stringArray(experience?.metadata?.themes),
    ...stringArray(experience?.metadata?.traits),
    ...stringArray(experience?.metadata?.intents),
    experience?.metadata?.budgetLevel,
    experience?.metadata?.groupType,
    ...(experience?.price === 0 ? ['free'] : []),
    ...componentValues,
  ]).map(normalize);
}

/**
 * Canonical hard-exclusion matching (spec-neutral: the caller decides where
 * `exclusions` comes from -- `NormalizedPreferenceIntent.hardExclusions`
 * here in the legacy evaluator, `PreferenceSpec.exclusions.hard` for
 * preference-first eligibility, cutover M2). Returns every exclusion term
 * that matches somewhere in the Experience's own evidence. Built from
 * `buildPreferenceCorpus` + the same term-matching semantics as every other
 * call in this file -- one hard-exclusion policy, never a second matcher
 * for a second caller.
 */
export function findHardExclusionMatches(
  experience: any,
  exclusions: string[],
): string[] {
  const corpus = buildPreferenceCorpus(experience);
  return unique(exclusions).filter((term) => matchesTerm(corpus, term));
}

// ALIASES keys may contain punctuation (e.g. "non-vegan food"), but every
// lookup term is normalized (punctuation -> spaces) before matching. Build
// a normalized-key lookup once so a hyphenated key can never silently miss
// its own alias list.
const NORMALIZED_ALIASES: Record<string, string[]> = Object.fromEntries(
  Object.entries(ALIASES).map(([key, values]) => [normalize(key), values]),
);

function matchesTerm(corpus: string[], rawTerm: string): boolean {
  const term = normalize(rawTerm);
  const terms = unique([
    term,
    ...(NORMALIZED_ALIASES[term] ?? []).map(normalize),
  ]);

  // Match the requested term (or one of its explicit aliases) inside the
  // Experience evidence. Do not perform the reverse containment check:
  // generic corpus values such as "food" would otherwise match a much more
  // specific exclusion such as "non vegan food", producing false hard
  // exclusions for genuinely vegan Experiences.
  return terms.some((candidate) =>
    corpus.some((value) => value === candidate || value.includes(candidate)),
  );
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function unique(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(
      values.filter(
        (value): value is string =>
          typeof value === 'string' && value.trim().length > 0,
      ),
    ),
  ];
}

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
