import { NormalizedPreferenceIntent } from '../interfaces/preference-interpretation.interface';

export interface PreferenceEvaluation {
  score: number;
  positiveMatches: string[];
  negativeMatches: string[];
  exclusionMatches: string[];
  reasons: string[];
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
  'non-vegan food': [
    'meat',
    'carne',
    'asado',
    'parrilla',
    'steak',
    'chorizo',
  ],
  accessibility: [
    'accessible',
    'accesible',
    'wheelchair',
    'silla de ruedas',
    'step free',
    'step-free',
  ],
  'family friendly': ['family friendly', 'family-friendly', 'kids', 'children', 'niños', 'ninos', 'familia'],
  'low budget': ['low budget', 'budget', 'free', 'gratis', 'economical', 'economico', 'económico'],
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
    };
  }

  const corpus = buildPreferenceCorpus(experience);
  const preferred = unique([
    ...(intent.preferredThemes ?? []),
    ...(intent.preferredTraits ?? []),
    ...(intent.preferredIntents ?? []),
    ...(intent.dietaryPreferences ?? []),
    ...(intent.accessibilityPreferences ?? []),
    ...(intent.budgetPreferences ?? []),
    ...(intent.groupPreferences ?? []),
  ]);
  const negative = unique([
    ...(intent.excludedThemes ?? []),
    ...(intent.excludedTraits ?? []),
    ...(intent.softConstraints ?? []),
  ]);
  const exclusions = unique(intent.hardExclusions ?? []);

  const positiveMatches = preferred.filter((term) => matchesTerm(corpus, term));
  const negativeMatches = negative.filter((term) => matchesTerm(corpus, term));
  const exclusionMatches = exclusions.filter((term) => matchesTerm(corpus, term));

  const positiveRatio = preferred.length
    ? positiveMatches.length / preferred.length
    : 0;
  const negativePenalty = negative.length
    ? negativeMatches.length / negative.length
    : 0;
  const exclusionPenalty = exclusionMatches.length > 0 ? 1 : 0;
  const score = clamp01(
    positiveRatio - negativePenalty * 0.45 - exclusionPenalty * 0.8,
  );

  const reasons = [
    ...positiveMatches.map((match) => `positive:${match}`),
    ...negativeMatches.map((match) => `negative:${match}`),
    ...exclusionMatches.map((match) => `exclusion:${match}`),
  ];

  return {
    score,
    positiveMatches,
    negativeMatches,
    exclusionMatches,
    reasons,
  };
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

function matchesTerm(corpus: string[], rawTerm: string): boolean {
  const term = normalize(rawTerm);
  const terms = unique([term, ...(ALIASES[term] ?? []).map(normalize)]);
  return terms.some((candidate) =>
    corpus.some(
      (value) =>
        value === candidate ||
        value.includes(candidate) ||
        candidate.includes(value),
    ),
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
