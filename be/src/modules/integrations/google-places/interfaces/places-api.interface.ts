export interface PlaceData {
  id: string;
  displayName?: { text: string; languageCode?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  primaryType?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  name?: string;
  businessStatus?: string;
  // Google's New Places API returns a string enum, not the old numeric 0-4
  // price level — normalized by the active Places API adapters.
  priceLevel?: string;
  // One human-readable line per weekday (Google's own format, e.g.
  // "Monday: 9:00 AM – 6:00 PM"), when the provider exposes it.
  openingHoursWeekdayText?: string[];
  // Google's own short editorial blurb about the place (Task B1 --
  // preserved as evidence, never fabricated when the provider omits it).
  editorialSummary?: { text: string; languageCode?: string };
  // Human-readable label for `primaryType` (Task B1), e.g. "Art museum"
  // for primaryType "art_gallery".
  primaryTypeDisplayName?: { text: string; languageCode?: string };
  /**
   * The provider's own declaration of WHAT KIND of object this result is,
   * normalized once at the adapter boundary. Absent when the provider
   * declared nothing (e.g. Google Text Search, whose results are always
   * places) -- never inferred from the name.
   */
  featureClass?: PlaceFeatureClass;
  /**
   * Identities in OTHER namespaces that the provider explicitly declared for
   * this same record (e.g. Geoapify Place Details' `osm_type`/`osm_id` and
   * `wikidata`). `id` stays the provider's own handle; this never repeats
   * it, and it is never derived by parsing an opaque id.
   */
  sourceIdentities?: PlaceSourceIdentity[];
}

/**
 * Provider-declared structural class of a search result:
 *  - `point_of_interest`: a named venue/sight/amenity/natural feature;
 *  - `building`: a building without a more specific POI tag;
 *  - `street`: a street/road (a ROUTE-shaped object, never a PLACE);
 *  - `administrative_area`: a city/suburb/district/county/state/country;
 *  - `postcode`: a postcode area;
 *  - `transport_stop`: a transit stop or vehicle-sharing dock, which takes
 *    its name from the landmark it serves rather than being that landmark.
 */
export type PlaceFeatureClass =
  | 'point_of_interest'
  | 'building'
  | 'street'
  | 'administrative_area'
  | 'postcode'
  | 'transport_stop';

/**
 * One provider-declared cross-identity, already in the canonical persisted
 * form of its namespace (`osm:node:123`, `Q123`).
 */
export interface PlaceSourceIdentity {
  provider: 'openstreetmap' | 'wikidata';
  externalId: string;
}

export interface PlacesSearchNearbyParams {
  latitude: number;
  longitude: number;
  radius: number;
  includedPrimaryTypes?: string[];
  maxResultCount?: number;
  rankPreference?: 'DISTANCE' | 'POPULARITY';
}

export interface PlacesSearchTextParams {
  textQuery: string;
  includedType?: string;
  strictTypeFiltering?: boolean;
  locationRestriction?: PlacesRectangle;
  locationBias?: PlacesCircle;
  maxResultCount?: number;
}

export interface PlacesCoordinate {
  latitude: number;
  longitude: number;
}

export interface PlacesCircle {
  center: PlacesCoordinate;
  radius: number;
}

export interface PlacesRectangle {
  low: PlacesCoordinate;
  high: PlacesCoordinate;
}

export const PLACES_PROVIDERS = ['google', 'geoapify'] as const;
export type PlacesProvider = (typeof PLACES_PROVIDERS)[number];

export const PLACES_CACHE_MODES = ['read', 'write', 'strict'] as const;
export type PlacesCacheMode = (typeof PLACES_CACHE_MODES)[number];
export type PlacesCacheStatus = 'hit' | 'miss-live' | 'strict-miss';

export interface PlacesRequestProvenance {
  provider: PlacesProvider;
  cacheStatus: PlacesCacheStatus;
  requestedCount: number;
  receivedCount: number;
}

export interface PlacesApiResult<T> {
  data: T;
  provenance: PlacesRequestProvenance;
}

export interface PlacesProviderStatus {
  provider: PlacesProvider;
  available: boolean;
  cacheEnabled: boolean;
  cacheMode?: PlacesCacheMode;
  degradedReason?: PlacesApiErrorCode;
  unavailableUntil?: string;
}

export type PlacesApiOperation =
  | 'searchNearby'
  | 'searchText'
  | 'getPlaceDetails';

export type PlacesApiErrorCode =
  | 'quota_exhausted'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'strict_cache_miss'
  | 'request_failed';

export interface PlacesCrawlProvenance extends PlacesRequestProvenance {
  /** @deprecated Use persistedCount for newly created catalog rows. */
  acceptedCount: number;
  rejectedCount?: number;
  seedReceivedCount?: number;
  coverageReceivedCount?: number;
  operationGeographyRejectedCount?: number;
  validatedCount?: number;
  identityValidCount?: number;
  admittedCount?: number;
  admissionEvidenceCountByType?: Record<string, number>;
  deduplicatedCount?: number;
  existingCount?: number;
  persistedCount?: number;
  embeddedCount?: number;
  embeddingWriteStatus?: 'indexed' | 'unavailable' | 'no_work' | 'failed';
  embeddingFailureReason?: string;
  embeddingIdentity?: {
    provider: string;
    model: string;
    dimensions: number;
    documentVersion: number;
  };
  providerCallCount?: number;
  anchors?: Array<{
    id: string;
    label: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    source?: 'destination_point' | 'child_area_center' | 'boundary';
  }>;
  operations?: CatalogAcquisitionOperationProvenance[];
  rejectedCountByReason: Record<string, number>;
  /** Per-candidate rejection detail — which real place got dropped and why,
   * not just an aggregate count. Bounded (see MAX_REJECTED_CANDIDATES_IN_TRACE)
   * so a pathological run can't blow up the persisted trace. */
  rejectedCandidates?: Array<{ id: string; name: string; reasons: string[] }>;
}

export type CatalogAcquisitionPurpose =
  | 'destination_seed'
  | 'geographic_coverage'
  | 'missing_category';

export type CatalogAcquisitionGeography =
  | { kind: 'circle'; circle: PlacesCircle }
  | { kind: 'rectangle'; rectangle: PlacesRectangle };

export interface CatalogAcquisitionOperation {
  operationId: string;
  purpose: CatalogAcquisitionPurpose;
  providerOperation: 'nearby' | 'text';
  category: string;
  requestedPrimaryTypes?: string[];
  rankPreference?: 'POPULARITY';
  textQuery?: string;
  includedType?: string;
  strictTypeFiltering?: boolean;
  geographicConstraint: CatalogAcquisitionGeography;
  resultBudget: number;
  anchorId?: string;
  preferredTime: string;
  supported: boolean;
  unsupportedReason?: 'provider_capability';
}

export interface CatalogAcquisitionOperationProvenance
  extends CatalogAcquisitionOperation {
  status: 'skipped' | 'succeeded' | 'failed';
  receivedCount: number;
  rejectedCountByReason: Record<string, number>;
}

export class PlacesApiRequestError extends Error {
  constructor(
    message: string,
    readonly provenance: PlacesRequestProvenance,
    readonly originalError?: unknown,
    readonly code: PlacesApiErrorCode = 'request_failed',
    readonly operation?: PlacesApiOperation,
  ) {
    super(message);
    this.name = 'PlacesApiRequestError';
  }
}

export class PlacesCrawlError extends Error {
  constructor(
    message: string,
    readonly provenance: PlacesCrawlProvenance,
    readonly originalError?: unknown,
    readonly code: PlacesApiErrorCode = 'request_failed',
  ) {
    super(message);
    this.name = 'PlacesCrawlError';
  }
}

export function parsePlacesProvider(value: unknown): PlacesProvider {
  const provider = value == null || value === '' ? 'google' : String(value);
  if ((PLACES_PROVIDERS as readonly string[]).includes(provider)) {
    return provider as PlacesProvider;
  }
  throw new Error(
    `Invalid PLACES_PROVIDER="${provider}". Expected one of: ${PLACES_PROVIDERS.join(', ')}.`,
  );
}

export function parsePlacesCacheMode(value: unknown): PlacesCacheMode {
  const mode = value == null || value === '' ? 'read' : String(value);
  if ((PLACES_CACHE_MODES as readonly string[]).includes(mode)) {
    return mode as PlacesCacheMode;
  }
  throw new Error(
    `Invalid MOCK_MAPS_MODE="${mode}". Expected one of: ${PLACES_CACHE_MODES.join(', ')}.`,
  );
}

export function placesProviderLabel(provider: PlacesProvider): string {
  return provider === 'google' ? 'Google Places' : 'Geoapify';
}

export interface IPlacesApiService {
  readonly provider: PlacesProvider;
  /**
   * Whether `getPlaceDetails` can return `sourceIdentities` (explicit
   * cross-identities in other namespaces). A capability, so callers never
   * branch on the provider name to decide whether an identity-enrichment
   * details call is worth its cost.
   */
  readonly declaresSourceIdentitiesInDetails: boolean;
  getStatus(): PlacesProviderStatus;
  searchNearby(
    params: PlacesSearchNearbyParams,
  ): Promise<PlacesApiResult<PlaceData[]>>;
  searchText(
    params: PlacesSearchTextParams,
  ): Promise<PlacesApiResult<PlaceData[]>>;
  getPlaceDetails(
    placeId: string,
  ): Promise<PlacesApiResult<Partial<PlaceData>>>;
}
