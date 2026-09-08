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
  query: string;
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
