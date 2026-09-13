import { ExperienceCandidate } from './experience-discovery.interface';
import { DedupeEvidence } from '../utils/experience-dedupe.util';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';

/**
 * Task B5 — a request-level, non-authoritative geographic scope resolved
 * BEFORE acquisition even runs (e.g. a real "San Telmo" AREA polygon or a
 * real "Caminito" ROUTE LineString), threaded through to gate persistence
 * regardless of whether the ACQUIRED candidate's own componentHints happen
 * to include a matching AREA/ROUTE hint. `geometry` is required —
 * `AreaRouteAnchorResolverService`'s `resolved: true` contract guarantees
 * it is always populated when a scope is supplied at all; a caller that
 * somehow constructs one without usable geometry gets a conservative
 * rejection (fail closed), never a silently skipped check.
 */
export interface ExperienceValidationScope {
  kind: 'AREA' | 'ROUTE';
  anchorName: string;
  geoEntityId: string;
  geometry: GeoJsonGeometry;
}

export type ResolvedGeoEntityStatus = 'resolved' | 'unresolved';

export interface ResolvedGeoEntity {
  hintKey: string;
  hintName: string;
  provider: string;
  externalId?: string;
  /** Present when status === 'resolved' — see persistOsmEntity/resolveViaNominatim/resolveViaPlaces, each of which attaches this via Object.assign after upserting the real GeoEntity. */
  geoEntityId?: string;
  canonicalName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geometry?: unknown;
  role: 'area' | 'waypoint' | 'route' | 'venue';
  expectedType?: string;
  status: ResolvedGeoEntityStatus;
  reason?: string;
  adminContext?: {
    country?: string;
    region?: string;
    locality?: string;
    municipality?: string;
  };
}

export interface ResolvedExperienceCandidate {
  candidate: ExperienceCandidate;
  status: 'accepted' | 'rejected';
  resolvedEntities: ResolvedGeoEntity[];
  rejectionReasons: string[];
  /**
   * Internal verification signal: referenced grounded evidence explicitly
   * associates this Experience with the requested destination/base. It lets
   * geographic validation verify an Experience's own coherent geography
   * without incorrectly requiring every associated Experience to lie inside
   * the destination polygon.
   */
  destinationAssociationVerified?: boolean;
  experienceId?: string;
  dedupeDecision?: 'SAME' | 'NEW' | 'AMBIGUOUS';
  dedupeEvidence?: DedupeEvidence;
  dedupeCandidates?: string[];
}

export interface ExperienceResolutionRequest {
  candidates: ExperienceCandidate[];
  destinationName?: string;
  /**
   * ISO 3166-1 alpha-2 country code of the resolved destination, when known.
   * Threaded into every Nominatim hint lookup to prevent a generic/common
   * place name from matching a same-named place in an unrelated country —
   * verified live against the real API (see nominatim.interface.ts).
   */
  destinationCountryCode?: string;
  destinationBoundary: unknown;
  /**
   * Present only when the destination degraded to point-scale (no real OSM
   * area/relation was found — see DestinationResolutionService). Tells the
   * resolver to scope its own street/POI lookups by radius
   * (OsmPlacesService.lookupStreetsNear/lookupPoisNear) instead of "within"
   * a boundary — destinationBoundary in that case is a synthetic
   * point-radius placeholder (`osmId: 0`) that a real "within area" Overpass
   * query rejects outright (verified live: `relation(0)` returns a hard
   * HTTP 400, "only positive integers are allowed" — not a slow query or an
   * empty result). Without this, every ROUTE/AREA componentHint for a
   * point-scale destination was unconditionally unresolvable, since PLACE
   * hints alone have a global Nominatim/Places fallback for exactly this gap.
   */
  destinationPointRadius?: {
    latitude: number;
    longitude: number;
    radiusMeters: number;
  };
  traceContext?: Record<string, unknown>;
  evidence?: Array<{
    key?: string;
    source: string;
    url?: string;
    title?: string;
    snippet?: string;
  }>;
  /** Task B5 — see ExperienceValidationScope. Absent for every caller other
   * than AreaRouteWalkAcquisitionService (ordinary generation-loop
   * deficits, acquireNearby) — no behavior change there. */
  validationScope?: ExperienceValidationScope;
  /**
   * Task B5 — the REQUEST's own acquisition intent ('walk'/'route_like'),
   * used ONLY to select a geographic threshold policy (routeScale) inside
   * CompositeGeographicValidationService. Never derived from anything the
   * extractor/candidate claims, never persisted, never used to satisfy
   * candidateMatchesPreferenceFacet, and never treated as Experience
   * semantic truth.
   */
  validationIntent?: 'walk' | 'route_like';
}

export interface ExperienceGeographicValidationResult {
  proposalName: string;
  /** Keep this aligned with the validator boundary. Candidate extraction owns
   * the finite proposal vocabulary; geographic validation reports what it
   * actually evaluated instead of narrowing the runtime result a second time. */
  kind: string;
  status:
    | 'UNVERIFIED'
    | 'GROUNDED'
    | 'GEO_VERIFIED'
    | 'AUTHORITATIVELY_VERIFIED'
    | 'REJECTED';
  accepted: boolean;
  strategy?:
    | 'canonical_entity'
    | 'canonical_area'
    | 'compact_anchors'
    | 'canonical_geometry'
    | 'component_defined'
    | 'venue_centric';
  canonicalEntity?: ResolvedGeoEntity;
  anchors: ResolvedGeoEntity[];
  coherence?: {
    centroid: { latitude: number; longitude: number };
    radiusMeters: number;
    maxPairwiseDistanceMeters: number;
  };
  groundedEvidenceKeys: string[];
  rejectionReasons: string[];
  validatorVersion: number;
}

export interface ExperienceGeographicValidationBatchResult {
  results: ExperienceGeographicValidationResult[];
  acceptedCount: number;
  rejectedCount: number;
  resolved?: ResolvedExperienceCandidate[];
}

export interface ExperienceMaterializationResponse {
  resolved: ResolvedExperienceCandidate[];
}

export interface ExperienceEntityResolutionResponse {
  totalCandidates: number;
  acceptedCount: number;
  rejectedCount: number;
  resolved: ResolvedExperienceCandidate[];
}

/**
 * Shared resolution shape used by intermediate trace/test fixtures. The final
 * V2 resolver result is refined below so geographic validation cannot be
 * omitted from the canonical pipeline.
 */
export interface ExperienceResolutionResponse {
  totalCandidates: number;
  acceptedCount: number;
  rejectedCount: number;
  resolved: ResolvedExperienceCandidate[];
  entityResolution?: ExperienceEntityResolutionResponse;
  geographicValidation?: ExperienceGeographicValidationBatchResult;
  materialization?: ExperienceMaterializationResponse;
}

export interface FinalExperienceResolutionResponse
  extends ExperienceResolutionResponse {
  geographicValidation: ExperienceGeographicValidationBatchResult;
}

export interface ExperienceProposalResolver {
  resolve(
    request: ExperienceResolutionRequest,
  ): Promise<FinalExperienceResolutionResponse>;
}

export const EXPERIENCE_PROPOSAL_RESOLVER = 'EXPERIENCE_PROPOSAL_RESOLVER';
