import {
  CatalogAcquisitionOperation,
  PlacesProvider,
} from '@integrations/google-places/interfaces/places-api.interface';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';

export type CatalogCandidateRejectionReason =
  | 'empty_name'
  | 'missing_provider_id'
  | 'invalid_coordinates'
  | 'outside_destination_boundary'
  | 'permanently_closed'
  | 'unsupported_type'
  | 'unsupported_primary_type'
  | 'conflicting_provider_types'
  | 'generic_name'
  | 'address_only'
  | 'insufficient_review_confidence'
  | 'missing_institutional_corroboration'
  | 'insufficient_provider_evidence';

export interface CatalogCandidate {
  provider: PlacesProvider;
  externalId?: string | null;
  name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  providerTypes?: string[];
  providerPrimaryType?: string | null;
  formattedAddress?: string | null;
  businessStatus?: string | null;
  rating?: number | null;
  ratingCount?: number | null;
  website?: string | null;
  phoneNumber?: string | null;
  openingHours?: unknown;
}

export interface CatalogCandidateValidationContext {
  destinationBoundary?: GeoJsonGeometry;
  acquisitionOperation?: CatalogAcquisitionOperation;
  /** The user's requested interests for this crawl — lets a Text Search
   * candidate be validated against every acquisition category those
   * interests actually cover, not only the single category of whichever
   * operation happened to return it first (a real place can legitimately
   * satisfy more than one category, e.g. a history_museum also counts as a
   * visitor_landmarks match). */
  requestedInterests?: string[];
}

export type CatalogAdmissionEvidence =
  | 'review_confidence'
  | 'institutional_corroboration'
  | 'provider_specific';

export interface CatalogCandidateValidationResult {
  accepted: boolean;
  identityAccepted: boolean;
  admissionAccepted: boolean;
  admissionEvidence?: CatalogAdmissionEvidence;
  normalizedName: string;
  rejectionReasons: CatalogCandidateRejectionReason[];
}
