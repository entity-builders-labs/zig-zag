import {
  ExperienceDiscoveryBreadth,
  ExperienceDiscoveryScope,
} from './experience-discovery.interface';
import { AcquisitionEvidenceRequirement } from './acquisition-evidence-requirement.interface';
import { ResolvedAnchor } from './preference-spec.interface';

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

export type AcquisitionDeficit = PreferenceFacetDeficit | GlobalCapacityDeficit;

export interface WikivoyageSourcePlanPayload {
  sections: Array<'SEE' | 'DO' | 'EAT'>;
  articleTargets?: string[];
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
   * deficits (theme/intent keys) plus the caller's positive semantic
   * query. Kept on the plan so `executePlan(plan)` stays single-arg.
   */
  requestedThemes?: string[];
  requestedIntents?: string[];
  semanticQuery?: string;
  /**
   * Task B5 — every relevant area/route anchor name for a walk/route_like
   * deficit, preserved in full (never collapsed to one, never dropped
   * entirely when 1+ exist). Plural by design (correctness point 12).
   */
  anchorNames?: string[];
}

export interface StructuredPoiSourcePlanPayload {
  /** An explicit caller-resolved destination window; never defaulted here. */
  radiusMeters: number;
  sourceClass: 'STRUCTURED_POI';
  routingPolicyVersion: string;
  /** Destination-wide base discovery (a global capacity gap). */
  baseDiscovery: boolean;
  /** Typed place-class coverage requested by preference-facet gaps. */
  coverage: import('../constants/acquisition-source-routing').StructuredPlaceCoverage[];
  /**
   * The router's dependent STRUCTURED_ENTITY_FACTS strategy (design C17): the
   * identity-linked encyclopedic facts of the QIDs the STRUCTURED_POI
   * candidates carry. Absent when the route does not include it.
   */
  entityFacts?: {
    sourceClass: 'STRUCTURED_ENTITY_FACTS';
    provider: 'wikidata';
  };
}

export interface WikivoyageSourcePlan {
  provider: 'wikivoyage';
  wikivoyage: WikivoyageSourcePlanPayload;
}

export interface GooglePlacesSourcePlan {
  provider: 'google_places';
  places: PlacesSourcePlanPayload;
}

export interface WebSourcePlan {
  provider: 'web';
  web: WebSourcePlanPayload;
}

/** Destination-bounded structured physical-place discovery capability. */
export interface StructuredPoiSourcePlan {
  provider: 'structured_poi';
  structuredPoi: StructuredPoiSourcePlanPayload;
}

export type SourcePlan =
  | WikivoyageSourcePlan
  | GooglePlacesSourcePlan
  | StructuredPoiSourcePlan
  | WebSourcePlan;

export interface ExperienceAcquisitionPlan {
  destination: ExperienceDiscoveryScope;
  deficits: AcquisitionDeficit[];
  evidenceRequirements: AcquisitionEvidenceRequirement[];
  sourcePlans: SourcePlan[];
  breadth: ExperienceDiscoveryBreadth;
  /** Canonical anchor context used by execution identity/dedupe. */
  relevantAnchors?: ResolvedAnchor[];
}
