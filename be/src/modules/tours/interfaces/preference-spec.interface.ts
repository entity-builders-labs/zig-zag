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

/** A single positive preference the user requested, always soft in v1. */
export interface RequestedFacet {
  /** e.g. 'theme' | 'intent' | 'trait' | a supported structured dimension. */
  dimension: string;
  key: string;
  /** importance x confidence, normalized 0..1. */
  weight: number;
  source: 'wizard' | 'free_text';
  /** Positive facets remain soft in v1 -- always false. */
  required: false;
}

/** A concrete named place/area/route the user mentioned. */
export interface AnchoredPlace {
  rawName: string;
  kind: 'venue' | 'area' | 'route' | 'unknown';
  priority: 'soft' | 'must';
}

export interface PreferenceSpec {
  facets: RequestedFacet[];
  exclusions: {
    themes: string[];
    traits: string[];
    hard: string[];
  };
  anchors: AnchoredPlace[];
  semanticQuery: string;

  /**
   * A meta-preference, NOT a RequestedFacet (spec §3.1). Used only as a
   * within-facet / remainder-fill ranking tilt (iconicity bias). It must
   * never appear in `facets`, never drives acquisition, sufficiency, or
   * `unmetFacets`.
   */
  explorationStyle: 'iconic' | 'local_deep_dive' | 'balanced';

  softConstraints: {
    dietary: string[];
    accessibility: string[];
    budget: string[];
    group: string[];
  };

  trip: {
    days: number;
    startDates: string[];
    pace: 'relaxed' | 'moderate' | 'fast';
  };
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

export interface UnmetAnchor {
  anchor: AnchoredPlace;
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

/** Formats a facet-shaped `{dimension,key}` pair as `"dimension:key"`. */
export function facetKey(
  facet: Pick<RequestedFacet, 'dimension' | 'key'>,
): string {
  return `${facet.dimension}:${facet.key}`;
}
