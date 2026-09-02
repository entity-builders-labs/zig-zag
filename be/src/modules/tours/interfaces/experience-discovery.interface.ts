/** Provider-neutral geographic hint extracted from grounded evidence. */
export interface GeoEntityHintV2 {
  key: string;
  name: string;
  role: 'area' | 'waypoint' | 'route' | 'venue';
  expectedKind: 'PLACE' | 'AREA' | 'ROUTE';
  required: boolean;
  evidenceKeys: string[];
}

/**
 * A grounded tourism concept. There is intentionally no structural Activity
 * kind here: single-place visits and multi-component experiences use the same
 * acquisition/verification contract.
 */
export interface ExperienceCandidate {
  name: string;
  kind?: 'POI' | 'ROUTE' | 'AREA' | 'NEIGHBORHOOD_WALK' | 'EXPERIENCE';
  description?: string;
  themes: string[];
  traits: string[];
  suggestedDurationMinutes?: number;
  entityHints?: Array<{
    key: string;
    name: string;
    role: 'area' | 'waypoint' | 'route' | 'venue';
    expectedType: string;
    required: boolean;
    evidenceKeys: string[];
  }>;
  componentHints: GeoEntityHintV2[];
  evidenceKeys: string[];
  shortReason: string;
}

export type ExperienceDiscoveryBreadth = 'focused' | 'broad';

export interface ExperienceDiscoveryScope {
  destinationName?: string;
  originName?: string;
  maxOutboundTravelMinutes?: number;
  sameDayReturn?: boolean;
}

export interface ExperienceDiscoveryRequest {
  scope: ExperienceDiscoveryScope;
  requestedThemes: string[];
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
