import {
  ExperienceDiscoveryBreadth,
  ExperienceDiscoveryScope,
} from './experience-discovery.interface';
import { CoverageDeficit } from './coverage-analysis.interface';

/**
 * A real, requested-facet deficit (cutover M2) -- `dimension`/`key` are
 * REQUIRED, never optional: this variant always names the exact facet that
 * lacks a strong catalog match.
 */
export interface PreferenceFacetDeficit {
  origin: 'preference_facet';
  dimension: string;
  key: string;
  reason: string;
}

/**
 * A genuine GLOBAL portfolio-capacity shortage (cutover M2, spec SS6.2/SS7)
 * after every requested facet is already satisfied -- the total distinct
 * eligible catalog is still below `portfolioTarget`. Deliberately
 * dimensionless: no `dimension`/`key` field exists on this variant at all,
 * so it is structurally impossible for it to masquerade as a theme/trait/
 * intent facet deficit. `lookupSourceCapabilityRoute(undefined, undefined)`
 * already routes a dimensionless deficit to the provider-neutral
 * `GENERIC_DEFICIT_ROUTE` (broad Wikivoyage SEE/DO/EAT + web discovery) --
 * no planner change needed for this origin.
 */
export interface GlobalCapacityDeficit {
  origin: 'global_capacity';
  reason: string;
  currentEligibleCount: number;
  requiredEligibleCount: number;
}

/**
 * Legacy `CoverageAnalyzer`-projected deficit. Not produced by the live
 * preference-first path (cutover M2) -- retained only for
 * `AreaRouteWalkAcquisitionService`/`experience-acquisition-planner.service
 * .ts`'s pre-existing `legacyDeficits: CoverageDeficit[]` projection, which
 * predates M2 and is not itself wired into the live orchestrator yet (M3's
 * job). `legacyDeficit` is REQUIRED on this variant (never partially
 * populated) since it is the only source of truth this projection carries.
 */
export interface CoverageAnalysisDeficit {
  origin: 'coverage_analysis';
  dimension?: string;
  key?: string;
  reason: string;
  legacyDeficit: CoverageDeficit;
}

export type AcquisitionDeficit =
  | PreferenceFacetDeficit
  | GlobalCapacityDeficit
  | CoverageAnalysisDeficit;

export interface WikivoyageSourcePlanPayload {
  sections: Array<'SEE' | 'DO' | 'EAT'>;
}

export interface OsmSourcePlanPayload {
  concepts: string[];
}

export interface PlacesSourcePlanPayload {
  searchTypes: string[];
}

export interface WebSourcePlanPayload {
  /** One coalesced plain-keyword grounded-search query (never negative text). */
  query: string;
  /**
   * Deficit context the discovery extractor needs to build its
   * `ExperienceDiscoveryRequest` — projected deterministically from the plan's
   * deficits (theme/intent/trait keys) plus the caller's positive semantic
   * query. Kept on the plan so `executePlan(plan)` stays single-arg.
   */
  requestedThemes?: string[];
  requestedIntents?: string[];
  preferredTraits?: string[];
  semanticQuery?: string;
  /**
   * Task B5 — every relevant area/route anchor name for a walk/route_like
   * deficit, preserved in full (never collapsed to one, never dropped
   * entirely when 1+ exist). Plural by design (correctness point 12).
   */
  anchorNames?: string[];
}

export interface WikivoyageSourcePlan {
  provider: 'wikivoyage';
  wikivoyage: WikivoyageSourcePlanPayload;
}

export interface OsmSourcePlan {
  provider: 'osm';
  osm: OsmSourcePlanPayload;
}

export interface GooglePlacesSourcePlan {
  provider: 'google_places';
  places: PlacesSourcePlanPayload;
}

export interface WebSourcePlan {
  provider: 'web';
  web: WebSourcePlanPayload;
}

export type SourcePlan =
  | WikivoyageSourcePlan
  | OsmSourcePlan
  | GooglePlacesSourcePlan
  | WebSourcePlan;

export interface ExperienceAcquisitionPlan {
  destination: ExperienceDiscoveryScope;
  deficits: AcquisitionDeficit[];
  sourcePlans: SourcePlan[];
  breadth: ExperienceDiscoveryBreadth;
}
