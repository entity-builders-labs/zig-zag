/**
 * Builds the canonical PreferenceSpec (spec §3) from a validated wizard
 * request plus the LLM-interpreted free-text intent.
 *
 * See docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md
 * (§3, §4) and docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md (Task A3).
 */
import {
  ExplorationStyle,
  TourGenerationRequest,
  TravelPace,
} from '../interfaces/tour-generation.interface';
import { NormalizedPreferenceIntent } from '../interfaces/preference-interpretation.interface';
import {
  PreferenceSpec,
  RequestedFacet,
} from '../interfaces/preference-spec.interface';
import {
  PreferenceAssertion,
  resolveAssertions,
  separatePolarityConflicts,
} from '../preferences/preference-assertion.interface';
import {
  PREFERENCE_DIMENSIONS,
  PREFERENCE_FACET_SCHEMA_VERSION,
} from '../preferences/preference-facet-vocabulary';
import { structuredSelectionAssertion } from './preference-facet-merge.util';

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
    // A typed accessibility need is a HARD requirement on the accessibility
    // dimension, with no language interpretation (task 25.3).
    ...(request.mobility.accessibilityNeeds ?? []).map((key) =>
      structuredSelectionAssertion({
        field: 'mobility.accessibilityNeeds',
        dimension: PREFERENCE_DIMENSIONS.ACCESSIBILITY,
        key,
        polarity: 'INCLUDE',
        constraint: 'HARD',
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
  // Duplicates of one (target, polarity) resolve once, by the canonical
  // rule (HARD, then DIRECT, then magnitude); the losers are kept for the
  // trace only. A target asserted with both polarities is a typed conflict,
  // never guessed.
  const resolved = resolveAssertions([
    ...structured,
    ...(interpreted.assertions ?? []),
  ]);
  const { assertions, conflicts: polarityConflicts } =
    separatePolarityConflicts(resolved.effective);
  const facets = assertions
    .filter(
      (assertion) =>
        assertion.polarity === 'INCLUDE' && assertion.constraint === 'SOFT',
    )
    .map(toRequestedFacet);

  // Typed request context (budget level, group type) is not a preference
  // assertion: it participates in preference utility only once a typed
  // relation to Experience knowledge exists (task 25.9). Typed values are
  // never turned into phrases for the semantic machinery (task 25.5).
  return {
    assertions,
    supersededAssertions: resolved.superseded,
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
    trip: {
      days: request.days,
      startDates: request.startDates ?? [],
      pace: mapPace(request.mobility.travelPace),
    },
  };
}
