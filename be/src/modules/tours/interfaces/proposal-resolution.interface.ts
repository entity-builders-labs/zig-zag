import { ActivityProposal, EntityHint } from './activity-discovery.interface';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';

// ── Resolution result ──────────────────────────────────────────────

export type ResolutionStatus = 'resolved' | 'rejected' | 'unresolved';

export interface ResolvedEntity {
  hintKey: string;
  hintName: string;
  role: EntityHint['role'];
  expectedType: string;
  status: ResolutionStatus;
  /** Resolved Activity ID (for POIs/venues or AREAs that now exist). */
  activityId?: string;
  /** Resolved external provider ID (Google place_id, OSM id). */
  externalId?: string;
  /** Provider type that supplied the authoritative identity. */
  provider?: 'google' | 'geoapify' | 'osm';
  /** Latitude when resolved */
  latitude?: number;
  /** Longitude when resolved */
  longitude?: number;
  /** Rejection reason when status === 'rejected' */
  rejectionReason?: string;
}

export interface ResolvedActivityProposal {
  proposal: ActivityProposal;
  status: 'accepted' | 'rejected' | 'partial';
  resolvedEntities: ResolvedEntity[];
  rejectionReasons: string[];
  /** Persisted Activity ID (only for accepted proposals after persistence) */
  persistedActivityId?: string;
}

// ── Resolution request ─────────────────────────────────────────────

export interface ProposalResolutionRequest {
  proposals: ActivityProposal[];
  destinationName: string;
  destinationCountry?: string;
  /** Authoritative city boundary geometry (from DestinationResolutionService). */
  destinationBoundary?: OsmCandidate;
}

// ── Resolution response ────────────────────────────────────────────

export interface ProposalResolutionResponse {
  resolved: ResolvedActivityProposal[];
  totalProposals: number;
  acceptedCount: number;
  rejectedCount: number;
}

export const PROPOSAL_RESOLVER = 'PROPOSAL_RESOLVER';

export interface IProposalResolver {
  resolve(
    request: ProposalResolutionRequest,
  ): Promise<ProposalResolutionResponse>;
}
