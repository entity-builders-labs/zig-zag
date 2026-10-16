/**
 * Canonical PreferenceSpec model for preference-first Experience selection.
 *
 * See docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md
 * (§3) and docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md (Task A1).
 *
 * IMPORTANT — canonical invariant (spec §3.1): `explorationStyle` is a
 * meta-preference field on `PreferenceSpec`, never a `RequestedFacet`. It
 * must never be inserted into `PreferenceSpec.facets`, never participates in
 * per-facet retrieval, sufficiency, acquisition deficits, or `unmetFacets`.
 * Do not add `'exploration_style'` as a `RequestedFacet.dimension` value
 * anywhere in this codebase.
 */
import { AcquisitionDeficit } from './experience-acquisition-plan.interface';
import {
  PreferenceAssertion,
  PreferenceEvidence,
  PreferencePolarityConflict,
  SupersededAssertion,
  PreferenceProvenance,
  SemanticTarget,
  UnresolvedPreferenceConcept,
} from '../preferences/preference-assertion.interface';
import { ExplorationSignalInput } from '../utils/exploration-signals.util';
import { GeoJsonGeometry } from '@shared/geo/geojson-geometry';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';

/**
 * A SOFT INCLUDE assertion as composition, retrieval and ranking consume it:
 * its typed target plus provenance, importance, confidence and evidence kept
 * separately. There is no combined scalar weight: the preference-utility
 * boundary weighs DIRECT by importance and INFERRED by importance x
 * confidence.
 */
export interface RequestedFacet extends SemanticTarget {
  provenance: PreferenceProvenance;
  importance: number;
  confidence: number;
  evidence: PreferenceEvidence[];
  /** Positive facets remain soft -- always false. */
  required: false;
}

/** A concrete named place/area/route the user mentioned. */
export type AnchorUsage =
  | 'geographic_scope'
  | 'specific_destination'
  | 'named_path'
  | 'unknown';
export type AnchorPriority = 'soft' | 'must';

/** Language interpretation only; it cannot assert geographic ontology. */
export interface InterpretedAnchor {
  rawName: string;
  usage: AnchorUsage;
  priority: AnchorPriority;
}

/** Canonical geographic resolution, with unresolved kept free of fake kind/identity. */
/**
 * Bounded per-branch discovery fact for one named anchor (Bitácora F3):
 * what each discovery branch (area / route / place) found, whether a
 * discovered candidate was eligible under the canonical destination-
 * compatibility policy, and what the selection decided. Deterministic
 * audit output only -- never persisted and never an input to downstream
 * acquisition or planning decisions.
 */
export type AnchorCandidateFact = {
  branch: 'area' | 'route' | 'place';
  discoveryStatus: 'match' | 'rejected' | 'no_match' | 'unavailable';
  eligibility:
    | 'ELIGIBLE'
    | 'REJECTED_DESTINATION_INCOMPATIBLE'
    | 'NO_CANDIDATE'
    | 'PROVIDER_UNAVAILABLE';
  /** Only set for discovered candidates that survived compatibility. */
  decision?:
    | 'SELECTED'
    | 'NOT_SELECTED'
    | 'AMBIGUOUS_IDENTITY'
    | 'IDENTITY_NOT_VERIFIED';
  canonicalName?: string;
  kind?: string;
  provider?: string;
  externalId?: string;
  compatibility?: {
    verdict: 'COMPATIBLE' | 'INCOMPATIBLE' | 'UNKNOWN';
    reason: string;
  };
  discoveryReason?: string;
};

export type ResolvedAnchor =
  | {
      status: 'resolved';
      rawName: string;
      usage: AnchorUsage;
      priority: AnchorPriority;
      canonicalName: string;
      kind: 'area' | 'route' | 'venue';
      geoEntityId: string;
      provider: string;
      externalId?: string;
      geometry?: GeoJsonGeometry;
      // Task A6 (2026-09-17 confirmation-collision-fix plan): only ever
      // set for kind === 'area', when the underlying resolution came from
      // a real OSM way/relation boundary (discoverArea, via
      // lookupBoundaryById). Lets a caller narrow entity resolution's own
      // local OSM pool query to this specific area instead of always the
      // whole destination -- geometry alone is not enough for that,
      // Overpass's "within area" query needs the real osmType/osmId.
      osmBoundary?: OsmCandidate;
      /** Bounded Bitácora F3 diagnostics; audit only, never persisted. */
      candidateFacts?: AnchorCandidateFact[];
    }
  | {
      status: 'unresolved';
      rawName: string;
      usage: AnchorUsage;
      priority: AnchorPriority;
      unresolvedReason: string;
      /** Bounded Bitácora F3 diagnostics; audit only, never persisted. */
      candidateFacts?: AnchorCandidateFact[];
    };

export interface PreferenceSpec {
  /**
   * Every unambiguous typed assertion of the request (INCLUDE / EXCLUDE,
   * SOFT / HARD). A target asserted with both polarities is excluded here
   * and kept in `polarityConflicts`.
   */
  assertions: PreferenceAssertion[];
  /** Targets asserted with both polarities; none of them participates. */
  polarityConflicts: PreferencePolarityConflict[];
  /**
   * Duplicates that lost to the effective assertion of their (target,
   * polarity), with the reason. Traceability only; never a policy input.
   */
  supersededAssertions: SupersededAssertion[];
  /** The SOFT INCLUDE assertions, projected for composition and ranking. */
  facets: RequestedFacet[];
  /** Concepts with no shared typed identity; never matched. */
  unresolvedConcepts: UnresolvedPreferenceConcept[];
  /** Version of the typed facet schema the assertions were validated against. */
  facetSchemaVersion: string;
  anchors: InterpretedAnchor[];
  /** Resolved geographic authority consumed by acquisition/planning. */
  resolvedAnchors?: ResolvedAnchor[];
  semanticQuery: string;

  /**
   * A meta-preference, NOT a RequestedFacet (spec §3.1). Used only as a
   * within-facet / remainder-fill ranking tilt (iconicity bias). It must
   * never appear in `facets`, never drives acquisition, sufficiency, or
   * `unmetFacets`.
   */
  explorationStyle: 'iconic' | 'local_deep_dive' | 'balanced';

  trip: {
    days: number;
    startDates: string[];
    pace: 'relaxed' | 'moderate' | 'fast';
  };
}

/** Typed catalog projection consumed by composition; persistence JSON is adapted before this boundary. */
export interface ComposableExperience {
  id: string;
  canonicalName?: string;
  description?: string | null;
  qualityScore?: number | null;
  components?: readonly {
    geoEntity?: {
      id?: string;
      name?: string | null;
      kind?: string;
      latitude?: number | null;
      longitude?: number | null;
    };
  }[];
  themes?: readonly string[];
  intents?: readonly string[];
  traits?: readonly string[];
  dimensionedTraits?: readonly {
    dimension: string;
    key: string;
    label?: string;
  }[];
  explorationFacts?: ExplorationSignalInput;
  /** Typed preference-matching facts, adapted once by the catalog. */
  matchFacts: import('./experience-match-facts.interface').ExperienceMatchFacts;
}

/** Per-facet retrieval result: strong/weak candidate ids, strongest-first. */
export interface FacetCandidates {
  facet: RequestedFacet;
  strongMatches: string[];
  weakMatches: string[];
  /** Mirrors strongMatches.length >= 1. */
  satisfied: boolean;
}

/** Global (never per-facet) portfolio-capacity sufficiency result. */
export interface PortfolioSufficiency {
  allFacetsSatisfied: boolean;
  basePortfolioTarget: number;
  portfolioTarget: number;
  distinctEligibleCount: number;
  sufficient: boolean;
}

/**
 * Canonical preference-first coverage result (spec §6.2/§7) -- the ONE live
 * sufficiency/deficit authority result shape. `totalDistinctEligibleExperiences`
 * is the GLOBAL eligible-catalog count (spec §6.2), never the union of
 * per-facet matches -- independent of which facets were requested.
 */
export interface PreferenceCoverageResult {
  facetResults: FacetCandidates[];
  allFacetsSatisfied: boolean;
  totalDistinctEligibleExperiences: number;
  portfolioTarget: number;
  sufficient: boolean;
  acquisitionDeficits: AcquisitionDeficit[];
}

export interface UnmetAnchor {
  anchor: ResolvedAnchor;
  reason: 'UNRESOLVED' | 'INFEASIBLE';
}

export interface CompositionResult {
  selected: string[];
  perFacetCoverage: Record<string, string[]>;
  unmetFacets: string[];
  mustAnchorsForced: string[];
  softAnchorsBoosted: string[];
  unmetAnchors: UnmetAnchor[];
  portfolioTarget: number;
}

/**
 * Composition facts assembled from the canonical preference utility. The
 * canonical levels arrive as `levelRank`; composition never re-derives them.
 */
export interface CompositionCandidate {
  id: string;
  componentCount: number;
  /** Requested facet keys strongly matched (from the utility boundary). */
  satisfiedFacets: string[];
  /** Dense canonical level rank (1 = best; equal levels share it). */
  levelRank: number;
  /** Composition-local tie-break inside one level rank, before id. */
  explorationTilt: number;
  explorationSignals: import('../utils/exploration-signals.util').ExplorationSignals;
  softAnchor: boolean;
  isPerformanceVenue: boolean;
}

export interface CompositionSelectionResult extends CompositionResult {
  reservoir: string[];
  /**
   * Candidate-level dispositions computed during the same canonical composeSet
   * pass. Tracing derives from these facts; it never re-runs selection policy.
   */
  decisions: CompositionCandidateDecision[];
}

export interface CompositionCandidateDecision {
  id: string;
  /** Reached the eligible set (not hard-excluded and has real components). */
  eligible: boolean;
  /** Selected into the initial portfolio. */
  initialSelected: boolean;
  /** Facet keys for which this candidate was the reserved strongest match. */
  reservedForFacets: string[];
  /** Forced by a resolved MUST venue anchor. */
  mustForced: boolean;
  /** Received a soft-anchor boost during within-facet/remainder ranking. */
  softAnchorBoosted: boolean;
  /** Filled the portfolio via the remainder pass (not a reservation). */
  remainderFill: boolean;
  /** Left over as a deterministic ranked reservoir for the planner. */
  reservoir: boolean;
  /** Dropped before composition. */
  excluded: boolean;
  excludedReason?: 'no_components';
}

/** Formats a facet-shaped `{dimension,key}` pair as `"dimension:key"`. */
export function facetKey(
  facet: Pick<RequestedFacet, 'dimension' | 'key'>,
): string {
  return `${facet.dimension}:${facet.key}`;
}
