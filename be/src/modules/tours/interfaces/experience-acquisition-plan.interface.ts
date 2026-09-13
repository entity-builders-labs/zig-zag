import {
  ExperienceDiscoveryBreadth,
  ExperienceDiscoveryScope,
} from './experience-discovery.interface';
import { CoverageDeficit } from './coverage-analysis.interface';

export interface AcquisitionDeficit {
  dimension?: string;
  key?: string;
  reason: string;
  origin: 'coverage_analysis' | 'preference_facet';
  legacyDeficit?: CoverageDeficit;
}

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
