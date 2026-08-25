import { CoverageDeficit } from './coverage-analysis.interface';

// ── Proposal kinds ──────────────────────────────────────────────────

export type ProposalKind =
  | 'POI'
  | 'ROUTE'
  | 'AREA'
  | 'NEIGHBORHOOD_WALK'
  | 'EXPERIENCE';

// ── Entity hints ───────────────────────────────────────────────────

export interface EntityHint {
  key: string;
  name: string;
  role: 'area' | 'waypoint' | 'route' | 'venue';
  expectedType: string;
}

// ── Grounding evidence ─────────────────────────────────────────────

export interface GroundingEvidence {
  source: string;
  snippet: string;
  url?: string;
}

// ── Activity proposal ──────────────────────────────────────────────

export interface ActivityProposal {
  name: string;
  kind: ProposalKind;
  themes: string[];
  entityHints: EntityHint[];
  suggestedDurationMinutes: number;
  shortReason: string;
  groundingEvidence: GroundingEvidence[];
}

// ── Discovery mode ─────────────────────────────────────────────────

export type DiscoveryMode =
  | { type: 'bootstrap'; reason: 'new_destination' }
  | { type: 'stale_refresh'; reason: 'profile_stale' }
  | { type: 'gap_fill'; deficits: CoverageDeficit[] };

// ── Discovery request ──────────────────────────────────────────────

export interface DiscoveryRequest {
  destinationName: string;
  destinationCountry?: string;
  requestedThemes: string[];
  mode: DiscoveryMode;
  maxProposals: number;
}

// ── Discovery response ─────────────────────────────────────────────

export interface DiscoveryResponse {
  proposals: ActivityProposal[];
  provider: string;
  model: string;
  rawOutput?: string;
  validationErrors?: string[];
}

// ── Provider-neutral interface ─────────────────────────────────────

export const DISCOVERY_PROVIDER = 'DISCOVERY_PROVIDER';

export interface SearchGroundedDiscoveryProvider {
  discover(request: DiscoveryRequest): Promise<DiscoveryResponse>;
}
