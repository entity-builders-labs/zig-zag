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
  dedupeAssertions,
  PreferenceAssertion,
  separatePolarityConflicts,
} from '../preferences/preference-assertion.interface';
import {
  PREFERENCE_DIMENSIONS,
  PREFERENCE_FACET_SCHEMA_VERSION,
} from '../preferences/preference-facet-vocabulary';
import { structuredSelectionAssertion } from './preference-facet-merge.util';

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

/** The SOFT INCLUDE projection consumed by retrieval and utility. */
function toRequestedFacet(assertion: PreferenceAssertion): RequestedFacet {
  return {
    dimension: assertion.target.dimension,
    key: assertion.target.key,
    provenance: assertion.provenance,
    importance: assertion.importance,
    confidence: assertion.confidence,
    evidence: assertion.evidence,
    required: false,
  };
}

/**
 * Builds the canonical PreferenceSpec.
 *
 * IMPORTANT (invariant #1): `explorationStyle` is read ONLY from
 * `request.intent.explorationStyle` and written ONLY to
 * `PreferenceSpec.explorationStyle`. It is never turned into an assertion or
 * a `RequestedFacet`.
 */
export function buildPreferenceSpec(
  request: TourGenerationRequest,
  interpreted: NormalizedPreferenceIntent,
): PreferenceSpec {
  const structured = [
    ...(request.intent.interests ?? []).map((key) =>
      structuredSelectionAssertion({
        field: 'intent.interests',
        dimension: PREFERENCE_DIMENSIONS.THEME,
        key,
        polarity: 'INCLUDE',
        constraint: 'SOFT',
      }),
    ),
    ...(request.intent.intents ?? []).map((key) =>
      structuredSelectionAssertion({
        field: 'intent.intents',
        dimension: PREFERENCE_DIMENSIONS.INTENT,
        key,
        polarity: 'INCLUDE',
        constraint: 'SOFT',
      }),
    ),
    // A typed dietary restriction is a HARD requirement on dietary
    // suitability, with no language interpretation.
    ...(request.dietaryRestrictions ?? []).map((key) =>
      structuredSelectionAssertion({
        field: 'dietaryRestrictions',
        dimension: PREFERENCE_DIMENSIONS.DIETARY_SUITABILITY,
        key,
        polarity: 'INCLUDE',
        constraint: 'HARD',
      }),
    ),
  ];
  // Duplicates of one polarity resolve by provenance, then weight; a
  // target asserted with both polarities is a typed conflict, never guessed.
  const { assertions, conflicts: polarityConflicts } =
    separatePolarityConflicts(
      dedupeAssertions([...structured, ...(interpreted.assertions ?? [])]),
    );
  const facets = assertions
    .filter(
      (assertion) =>
        assertion.polarity === 'INCLUDE' && assertion.constraint === 'SOFT',
    )
    .map(toRequestedFacet);

  // Each soft-constraint dimension is built from its own dedicated sources
  // only.
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
    assertions,
    polarityConflicts,
    facets,
    unresolvedConcepts: interpreted.unresolvedConcepts ?? [],
    facetSchemaVersion: PREFERENCE_FACET_SCHEMA_VERSION,
    // Anchors are already normalized/validated by PreferenceInterpreterService
    // (plan Task A2) -- pass through unchanged, do not re-normalize here.
    anchors: interpreted.anchoredPlaces ?? [],
    resolvedAnchors: [],
    semanticQuery: interpreted.positiveSemanticQuery ?? '',
    explorationStyle: mapExplorationStyle(request.intent.explorationStyle),
    softConstraints: {
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
