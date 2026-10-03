/**
 * Raw provider contract for Serper (https://serper.dev), a Google SERP API.
 *
 * Every field below was live-verified against the real endpoints on
 * 2026-09-25 (see spikes/stage3-serper-provider-characterization-2026-09-25).
 * These types describe what Serper returns, nothing more: evidence
 * normalization, identity verification and tour semantics belong to the
 * callers, never to this client.
 *
 * Serper exposes traditional Google results only. It has no equivalent of
 * SerpApi's `engine=google_ai_mode` (a server-side AI-generated narrative);
 * nothing here should be read or labeled as "AI Mode".
 */

export type SerperEndpoint = 'search' | 'maps' | 'places';

/** Parameters shared by the text-query endpoints. */
interface SerperLocaleParams {
  /** Google country code (e.g. "ar"). Ranking/locale context, not a boundary. */
  gl?: string;
  /** Google interface language (e.g. "es"). */
  hl?: string;
}

/** POST /search — traditional Google web results. */
export interface SerperSearchRequest extends SerperLocaleParams {
  q: string;
  /**
   * Free-text location Serper passes to Google as search context. It is not
   * a hard geographic filter.
   */
  location?: string;
  num?: number;
  page?: number;
}

/** POST /maps — Google Maps search. */
export interface SerperMapsRequest extends SerperLocaleParams {
  q: string;
  /**
   * Map viewport as "@lat,lng,<zoom>z" — ranking context for Google Maps,
   * not a boundary.
   */
  ll?: string;
  page?: number;
}

/** POST /places — Google local ("places") results. */
export interface SerperPlacesRequest extends SerperLocaleParams {
  q: string;
  location?: string;
  num?: number;
  page?: number;
}

export interface SerperOrganicResult {
  title?: string;
  link?: string;
  snippet?: string;
  position?: number;
  date?: string;
  rating?: number;
  ratingCount?: number;
  sitelinks?: Array<{ title?: string; link?: string }>;
  attributes?: Record<string, string>;
}

export interface SerperSearchResponse {
  searchParameters?: Record<string, unknown>;
  organic?: SerperOrganicResult[];
  knowledgeGraph?: Record<string, unknown>;
  answerBox?: Record<string, unknown>;
  peopleAlsoAsk?: Array<Record<string, unknown>>;
  relatedSearches?: Array<{ query?: string }>;
  credits?: number;
}

/**
 * One Google Maps / local result. `placeId` (when present) is a real Google
 * Place ID in Google's own namespace; `cid` is Google's separate customer id
 * (the "ludocid"). They are different identifiers and are never converted
 * into one another here.
 */
export interface SerperPlaceResult {
  position?: number;
  title?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  rating?: number;
  ratingCount?: number;
  priceLevel?: string;
  type?: string;
  types?: string[];
  website?: string;
  phoneNumber?: string;
  description?: string;
  openingHours?: Record<string, string>;
  thumbnailUrl?: string;
  placeId?: string;
  cid?: string;
  fid?: string;
  bookingLinks?: unknown[];
  /** /places reports its single category here; /maps uses `type`/`types`. */
  category?: string;
}

/**
 * /maps (live, 2026-09-25): results carry `placeId` (Google Place ID),
 * `cid`, `fid`, coordinates, `type`/`types`, rating, website, opening hours.
 * Reported cost: 3 credits per call.
 */
export interface SerperMapsResponse {
  searchParameters?: Record<string, unknown>;
  ll?: string;
  places?: SerperPlaceResult[];
  credits?: number;
}

/**
 * /places (live, 2026-09-25): results carry `cid`, coordinates, `category`,
 * rating — but no `placeId`. `location` is converted server-side into a
 * Google `uule` context. Reported cost: 1 credit per call.
 */
export interface SerperPlacesResponse {
  searchParameters?: Record<string, unknown>;
  places?: SerperPlaceResult[];
  credits?: number;
}

/** Transport metadata for one Serper call (never includes the API key). */
export interface SerperCallMeta {
  endpoint: SerperEndpoint;
  httpStatus: number;
  durationMs: number;
}

export interface SerperCallResult<T> {
  data: T;
  meta: SerperCallMeta;
}

export type SerperApiErrorCode =
  | 'missing_api_key'
  | 'http_error'
  | 'timeout'
  | 'network_error'
  | 'invalid_response';

export class SerperApiError extends Error {
  constructor(
    message: string,
    readonly code: SerperApiErrorCode,
    readonly endpoint: SerperEndpoint,
    readonly httpStatus?: number,
    /** Provider error body, truncated. Never contains the request key. */
    readonly responseBody?: string,
    readonly durationMs?: number,
  ) {
    super(message);
    this.name = 'SerperApiError';
  }
}
