import { ActivityProposal, EntityHint } from './activity-discovery.interface';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { PlaceData } from '@integrations/google-places/interfaces/places-api.interface';

// ── Resolution result ──────────────────────────────────────────────

export type ResolutionStatus = 'resolved' | 'rejected' | 'unresolved';

export interface ResolvedEntityAdminContext {
  locality?: string;
  municipality?: string;
  region?: string;
  country?: string;
}

export interface ResolvedEntityEvidence {
  provider: 'google' | 'geoapify' | 'osm';
  externalId: string;
  canonicalName: string;
  latitude?: number;
  longitude?: number;
}

/**
 * Provider-specific data retained only so a later materialization stage can
 * persist an already-resolved entity without performing a second provider
 * search. Trace builders must sanitize this field rather than serializing
 * raw provider payloads.
 */
export type ResolvedEntityMaterialization =
  | { kind: 'place'; place: PlaceData }
  | { kind: 'osm'; candidate: OsmCandidate };

export interface ResolvedEntity {
  hintKey: string;
  hintName: string;
  role: EntityHint['role'];
  expectedType: string;
  status: ResolutionStatus;
  /** Resolved Activity ID when the entity already existed in the catalog. */
  activityId?: string;
  /** Resolved external provider ID (Google place_id, Geoapify id, OSM id). */
  externalId?: string;
  /** Provider type that supplied the authoritative identity. */
  provider?: 'google' | 'geoapify' | 'osm';
  canonicalName?: string;
  /** Latitude when resolved. */
  latitude?: number;
  /** Longitude when resolved. */
  longitude?: number;
  /** Canonical geometry when the provider exposes one. */
  geometry?: GeoJsonGeometry;
  /** Best-effort normalized administrative context. */
  adminContext?: ResolvedEntityAdminContext;
  /** Evidence proving that the hint resolved independently of the LLM. */
  evidence?: ResolvedEntityEvidence[];
  /** Internal materialization reference; never treat it as validation proof. */
  materialization?: ResolvedEntityMaterialization;
  /** Rejection reason when status === 'rejected' or 'unresolved'. */
  rejectionReason?: string;
  /** True when resolution failed because a provider was unavailable. */
  providerFailure?: boolean;
}

export interface ResolvedActivityProposal {
  proposal: ActivityProposal;
  /**
   * `accepted` here means entity resolution produced enough concrete data to
   * continue. It is not geographic approval and it does not imply persistence.
   */
  status: 'accepted' | 'rejected' | 'partial';
  resolvedEntities: ResolvedEntity[];
  rejectionReasons: string[];
  /** Persisted Activity ID, populated only by the later materialization stage. */
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

export interface ProposalMaterializationResponse {
  resolved: ResolvedActivityProposal[];
  totalProposals: number;
  materializedCount: number;
  rejectedCount: number;
}

export const PROPOSAL_RESOLVER = 'PROPOSAL_RESOLVER';

export interface IProposalResolver {
  resolve(
    request: ProposalResolutionRequest,
  ): Promise<ProposalResolutionResponse>;
}
