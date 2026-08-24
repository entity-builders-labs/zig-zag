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
  // price level — see priceLevelToNumber() in google-places.service.ts.
  priceLevel?: string;
  // One human-readable line per weekday (Google's own format, e.g.
  // "Monday: 9:00 AM – 6:00 PM"), when the provider exposes it.
  openingHoursWeekdayText?: string[];
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
