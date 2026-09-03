/** Provider-neutral geographic hint extracted from grounded evidence. */
export interface GeoEntityHint {
  key: string;
  name: string;
  role: 'area' | 'waypoint' | 'route' | 'venue';
  expectedKind: 'PLACE' | 'AREA' | 'ROUTE';
  required: boolean;
  evidenceKeys: string[];
}

/**
 * A grounded tourism concept. There is intentionally no structural kind here:
 * single-place visits and multi-component experiences use the same
 * acquisition/verification contract.
 */
export interface ExperienceCandidate {
  name: string;
  description?: string;
  themes: string[];
  traits: string[];
  /** Soft Experience facets only; never planner or proposal kinds. */
  intents: string[];
  suggestedDurationMinutes?: number;
  componentHints: GeoEntityHint[];
  evidenceKeys: string[];
  shortReason: string;
}

export type ExperienceDiscoveryBreadth = 'focused' | 'broad';

export interface ExperienceDiscoveryScope {
  /** The destination selected by the user. For day_trip this is also the base used by FROM-base discovery queries. */
  destinationName?: string;
}

export interface ExperienceDiscoveryRequest {
  scope: ExperienceDiscoveryScope;
  requestedThemes: string[];
  /** Soft Experience facets/intents; never structural proposal kinds. */
  requestedIntents?: string[];
  preferredTraits?: string[];
  excludedThemes?: string[];
  excludedTraits?: string[];
  semanticQuery?: string;
  coverageGaps?: string[];
  breadth: ExperienceDiscoveryBreadth;
  maxCandidates: number;
}

export interface ExperienceDiscoveryQuery {
  query: string;
  purpose: 'bootstrap' | 'coverage_gap' | 'focused_enrichment';
  expectedEvidence: string[];
}

export interface ExperienceDiscoveryPlan {
  queries: ExperienceDiscoveryQuery[];
  enrichmentAllowed: boolean;
}
