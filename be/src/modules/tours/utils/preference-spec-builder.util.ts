/**
 * Builds the canonical PreferenceSpec (spec §3) from a validated wizard
 * request plus the LLM-interpreted free-text intent.
 *
 * See docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md
 * (§3, §4) and docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md (Task A3).
 */
import {
  BudgetLevel,
  ExplorationStyle,
  GroupType,
  TourGenerationRequest,
  TravelPace,
} from '../interfaces/tour-generation.interface';
import { NormalizedPreferenceIntent } from '../interfaces/preference-interpretation.interface';
import {
  PreferenceSpec,
  RequestedFacet,
} from '../interfaces/preference-spec.interface';
import {
  calculateEffectiveWeight,
  PreferenceFacet,
} from '../preferences/preference-facet.interface';
import { normalizeWizardFacet } from './preference-facet-merge.util';

function unique(values: (string | undefined | null)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    if (typeof raw !== 'string') {
      continue;
    }
    const value = raw.trim().toLowerCase();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function mapExplorationStyle(
  style: ExplorationStyle,
): PreferenceSpec['explorationStyle'] {
  switch (style) {
    case ExplorationStyle.ICONIC:
      return 'iconic';
    case ExplorationStyle.LOCAL_DEEP_DIVE:
      return 'local_deep_dive';
    case ExplorationStyle.BALANCED:
    default:
      return 'balanced';
  }
}

function mapPace(pace: TravelPace): PreferenceSpec['trip']['pace'] {
  switch (pace) {
    case TravelPace.RELAXED:
      return 'relaxed';
    case TravelPace.FAST:
      return 'fast';
    case TravelPace.MODERATE:
    default:
      return 'moderate';
  }
}

/**
 * Deduplicates facets by (dimension,key), keeping the entry with the
 * highest effective weight (importance x confidence) -- spec §4 / plan Task
 * A3. Ties keep the first-seen entry. Wizard facets are always pushed first
 * and always carry the maximum possible effective weight (1.0 x 1.0 = 1.0),
 * so a wizard facet naturally wins over a same-key free-text facet without
 * needing a separate source-precedence rule.
 *
 * All results are always `required: false` -- positive facets remain soft
 * in v1 (spec §3, plan invariant).
 */
function dedupeFacetsByHighestEffectiveWeight(
  facets: (PreferenceFacet | undefined | null)[],
): RequestedFacet[] {
  const best = new Map<string, PreferenceFacet>();

  for (const facet of facets) {
    if (!facet || !facet.dimension || !facet.key) {
      continue;
    }
    const key = `${facet.dimension}:${facet.key}`;
    const existing = best.get(key);
    if (
      !existing ||
      calculateEffectiveWeight(facet) > calculateEffectiveWeight(existing)
    ) {
      best.set(key, facet);
    }
  }

  return Array.from(best.values()).map((facet) => ({
    dimension: facet.dimension,
    key: facet.key,
    weight: calculateEffectiveWeight(facet),
    source: facet.source,
    required: false,
  }));
}

/**
 * Builds the canonical PreferenceSpec.
 *
 * IMPORTANT (invariant #1): `explorationStyle` is read ONLY from
 * `request.intent.explorationStyle` and written ONLY to
 * `PreferenceSpec.explorationStyle`. It is never turned into a
 * `RequestedFacet` here -- unlike the legacy
 * `ExperienceGenerationService.mergeStructuredPreferences`, this builder
 * never calls `normalizeWizardFacet('exploration_style', ...)`.
 */
export function buildPreferenceSpec(
  request: TourGenerationRequest,
  interpreted: NormalizedPreferenceIntent,
): PreferenceSpec {
  const wizardThemeFacets = (request.intent.interests ?? []).map((interest) =>
    normalizeWizardFacet('theme', interest),
  );
  const wizardIntentFacets = (request.intent.intents ?? []).map((intent) =>
    normalizeWizardFacet('intent', intent),
  );

  const facets = dedupeFacetsByHighestEffectiveWeight([
    ...wizardThemeFacets,
    ...wizardIntentFacets,
    ...(interpreted.preferredFacets ?? []),
  ]);

  // Each soft-constraint dimension is built from its own dedicated sources
  // only -- do not repeat the previous bug that copied dietary restrictions
  // into budget.
  const dietary = unique([
    ...(request.dietaryRestrictions ?? []),
    ...(interpreted.dietaryPreferences ?? []),
  ]);
  const accessibility = unique([
    ...(request.mobility.accessibilityNeeds ?? []),
    ...(interpreted.accessibilityPreferences ?? []),
  ]);
  const budget = unique([
    ...(interpreted.budgetPreferences ?? []),
    ...(request.budgetLevel === BudgetLevel.LOW ? ['low budget'] : []),
  ]);
  const group = unique([
    ...(interpreted.groupPreferences ?? []),
    ...(request.groupType === GroupType.FAMILY ? ['family friendly'] : []),
  ]);

  return {
    facets,
    exclusions: {
      themes: unique(interpreted.excludedThemes),
      traits: unique(interpreted.excludedTraits),
      hard: unique(interpreted.hardExclusions),
    },
    // Anchors are already normalized/validated by PreferenceInterpreterService
    // (plan Task A2) -- pass through unchanged, do not re-normalize here.
    anchors: interpreted.anchoredPlaces ?? [],
    semanticQuery: interpreted.positiveSemanticQuery ?? '',
    explorationStyle: mapExplorationStyle(request.intent.explorationStyle),
    softConstraints: {
      dietary,
      accessibility,
      budget,
      group,
    },
    trip: {
      days: request.days,
      startDates: request.startDates ?? [],
      pace: mapPace(request.mobility.travelPace),
    },
  };
}
