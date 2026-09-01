import { ActivityKind } from '@prisma/client';
import { CoverageDeficit } from './coverage-analysis.interface';
import { ExperienceCandidate } from './experience-discovery.interface';

export type ProposalKind =
  | 'POI'
  | 'ROUTE'
  | 'AREA'
  | 'NEIGHBORHOOD_WALK'
  | 'EXPERIENCE';

export interface EntityHint {
  key: string;
  name: string;
  role: 'area' | 'waypoint' | 'route' | 'venue';
  expectedType: string;
  required: boolean;
  evidenceKeys: string[];
}

export interface GroundingEvidence {
  key: string;
  source: string;
  snippet: string;
  title?: string;
  url?: string;
}

export interface GroundedTextBlock {
  text: string;
  evidenceKeys: string[];
}

export interface ActivityProposal {
  name: string;
  kind: ProposalKind;
  themes: string[];
  entityHints: EntityHint[];
  suggestedDurationMinutes: number;
  shortReason: string;
  evidenceKeys: string[];
}

export type DiscoveryMode =
  | { type: 'bootstrap'; reason: 'new_destination' }
  | { type: 'stale_refresh'; reason: 'profile_stale' }
  | { type: 'gap_fill'; deficits: CoverageDeficit[] };

export interface GroundedSearchRequest {
  destinationName: string;
  destinationCountry?: string;
  requestedThemes: string[];
  requestedExperienceFormats?: string[];
  explorationStyle?: string;
  additionalPreferences?: string;
  query: string;
  targetKind?: ActivityKind;
}

export type GroundingStatus =
  | 'applied'
  | 'unavailable'
  | 'failed'
  | 'no_usable_evidence';

export interface GroundedSearchResult {
  provider: string;
  model: string;
  groundingStatus: GroundingStatus;
  evidence: GroundingEvidence[];
  textBlocks?: GroundedTextBlock[];
  rawOutput?: unknown;
  failureReason?: string;
}

export interface GroundedSearchProvider {
  search(request: GroundedSearchRequest): Promise<GroundedSearchResult>;
}

export interface DiscoveryRequest {
  destinationName: string;
  destinationCountry?: string;
  requestedThemes: string[];
  requestedExperienceFormats?: string[];
  explorationStyle?: string;
  additionalPreferences?: string;
  /** When gap acquisition targets a missing structural format, extraction is
   * constrained to this exact ActivityKind. Search owns evidence; the LLM may
   * only propose this kind from that evidence. */
  targetKind?: ActivityKind;
  mode: DiscoveryMode;
  maxProposals: number;
}

/** Exact provider calls made by ActivityDiscoveryService. This exists only
 * for auditability: the bitácora can show which deterministic query was sent,
 * which missing kind it targeted and what evidence came back. */
export interface DiscoverySearchTrace {
  query: string;
  targetKind?: ActivityKind;
  provider: string;
  model: string;
  groundingStatus: GroundingStatus;
  evidenceCount: number;
  failureReason?: string;
}

export interface DiscoveryResponse {
  proposals: ActivityProposal[];
  /** V2 provider-neutral view; `proposals` remains during migration. */
  experienceCandidates?: ExperienceCandidate[];
  provider: string;
  model: string;
  groundingStatus: GroundingStatus;
  groundingProvider?: string;
  groundingModel?: string;
  groundingEvidence?: GroundingEvidence[];
  rawOutput?: string;
  validationErrors?: string[];
  searchTrace?: DiscoverySearchTrace[];
}

export const DISCOVERY_PROVIDER = 'DISCOVERY_PROVIDER';
export const GROUNDED_SEARCH_PROVIDER = 'GROUNDED_SEARCH_PROVIDER';

export interface SearchGroundedDiscoveryProvider {
  discover(
    request: DiscoveryRequest,
    searchResult?: GroundedSearchResult,
  ): Promise<DiscoveryResponse>;
}
