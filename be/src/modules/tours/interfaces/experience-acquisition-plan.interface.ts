import { CoverageDeficit } from './coverage-analysis.interface';

export interface AcquisitionDeficit {
  dimension?: string;
  key?: string;
  reason: string;
  origin: 'coverage_analysis' | 'preference_facet';
  legacyDeficit?: CoverageDeficit;
}

export interface WikivoyageSourcePlan {
  provider: 'wikivoyage';
  sections: Array<'SEE' | 'DO' | 'EAT'>;
}

export interface OsmSourcePlan {
  provider: 'osm';
  concepts: string[];
}

export interface GooglePlacesSourcePlan {
  provider: 'google_places';
  searchTypes: string[];
}

export interface WebSourcePlan {
  provider: 'web';
  query: string;
}

export interface SourcePlans {
  wikivoyage?: WikivoyageSourcePlan;
  osm?: OsmSourcePlan;
  googlePlaces?: GooglePlacesSourcePlan;
  web?: WebSourcePlan;
}

export interface ExperienceAcquisitionPlan {
  destination: string;
  deficits: AcquisitionDeficit[];
  sources: SourcePlans;
}
