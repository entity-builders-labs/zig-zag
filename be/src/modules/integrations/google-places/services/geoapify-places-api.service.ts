import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  IPlacesApiService,
  PlaceData,
  PlaceFeatureClass,
  PlaceSourceIdentity,
  PlacesApiRequestError,
  PlacesApiResult,
  PlacesProviderStatus,
  PlacesSearchNearbyParams,
  PlacesSearchTextParams,
} from '../interfaces/places-api.interface';

// Maps provider-neutral acquisition primary types to the closest truthful
// Geoapify category code(s).
// Geoapify accepts a comma-separated list of categories per request (OR semantics).
const TYPE_TO_GEOAPIFY_CATEGORIES: Record<string, string> = {
  museum: 'entertainment.museum',
  history_museum: 'entertainment.museum',
  art_museum: 'entertainment.museum',
  art_gallery: 'entertainment.culture.gallery',
  tourist_attraction: 'tourism.attraction',
  historical_landmark: 'tourism.sights',
  historical_place: 'tourism.sights',
  cultural_landmark: 'tourism.sights',
  monument: 'tourism.sights.monument',
  plaza: 'tourism.attraction',
  observation_deck: 'tourism.attraction',
  church: 'tourism.sights.place_of_worship',
  point_of_interest: 'tourism.attraction,tourism.sights',
  park: 'leisure.park',
  national_park: 'natural.protected_area',
  nature_preserve: 'natural.protected_area',
  hiking_area: 'natural.forest,natural.protected_area',
  // Geoapify has no dedicated "hiking trail" POI category; this is the
  // closest available approximation and may return sparse/irrelevant results.
  natural_feature:
    'natural.forest,natural.mountain,natural.water,natural.protected_area',
  hiking_trail: 'natural.forest,natural.protected_area',
  campground: 'camping.camp_site',
  restaurant: 'catering.restaurant',
  cafe: 'catering.cafe',
  food_court: 'catering.food_court',
  bar: 'catering.bar,catering.pub',
  night_club: 'adult.nightclub',
  amusement_park: 'entertainment.theme_park',
  movie_theater: 'entertainment.cinema',
  performing_arts_theater: 'entertainment.culture.theatre',
};

interface GeoapifyFeature {
  properties: {
    place_id: string;
    name?: string;
    formatted?: string;
    lat: number;
    lon: number;
    contact?: { phone?: string };
    website?: string;
  };
}

/**
 * One `results[]` entry of Forward Geocoding (`/v1/geocode/search`,
 * `format=json`), live-verified against the real endpoint (Stage 3 PLACE
 * characterization spike, 2026-09-25). Only the fields Zig-Zag reads are
 * typed. `category` is present on some amenity rows only; `datasource`
 * carries no raw OSM ids on this endpoint (those exist only on Place
 * Details).
 */
interface GeoapifyForwardGeocodingResult {
  place_id: string;
  name?: string;
  formatted?: string;
  lat: number;
  lon: number;
  /**
   * Geoapify's own location type: `unknown | amenity | building | street |
   * suburb | district | postcode | city | county | state | country`.
   */
  result_type?: string;
  /** Geoapify's dotted category, `;`-joined when several apply. */
  category?: string;
  rank?: {
    importance?: number;
    popularity?: number;
    confidence?: number;
    match_type?: string;
  };
  datasource?: {
    sourcename?: string;
    attribution?: string;
    license?: string;
    url?: string;
  };
}

/** Place Details `features[0].properties`, only the identity-bearing fields. */
interface GeoapifyPlaceDetailsProperties {
  place_id?: string;
  name?: string;
  contact?: { phone?: string };
  website?: string;
  opening_hours?: string;
  datasource?: {
    sourcename?: string;
    raw?: { osm_type?: unknown; osm_id?: unknown; wikidata?: unknown };
  };
  wiki_and_media?: { wikidata?: unknown };
}

const ADMINISTRATIVE_RESULT_TYPES = new Set([
  'suburb',
  'district',
  'city',
  'county',
  'state',
  'country',
]);

/**
 * Geoapify categories of an `amenity` result that name a stop/dock serving a
 * landmark rather than the landmark itself -- only the two live-observed in
 * the PLACE characterization spike ("Parque Lezama"/"Plaza Dorrego" bus
 * stops, the "345 - Plaza Mafalda" bike dock). Provider taxonomy
 * translation, deliberately kept at this adapter boundary.
 */
const TRANSPORT_STOP_CATEGORIES = ['public_transport.bus', 'rental.bicycle'];

const OSM_TYPE_BY_GEOAPIFY_CODE: Record<string, 'node' | 'way' | 'relation'> = {
  n: 'node',
  w: 'way',
  r: 'relation',
};

@Injectable()
export class GeoapifyPlacesApiService implements IPlacesApiService {
  readonly provider = 'geoapify' as const;
  readonly declaresSourceIdentitiesInDetails = true;
  private readonly logger = new Logger(GeoapifyPlacesApiService.name);
  private readonly placesUrl = 'https://api.geoapify.com/v2/places';
  private readonly placeDetailsUrl =
    'https://api.geoapify.com/v2/place-details';
  private readonly forwardGeocodingUrl =
    'https://api.geoapify.com/v1/geocode/search';
  private readonly requestTimeoutMs = 5_000;

  constructor(private readonly configService: ConfigService) {}

  getStatus(): PlacesProviderStatus {
    return {
      provider: this.provider,
      available: !!this.configService.get<string>('GEOAPIFY_API_KEY'),
      cacheEnabled: false,
    };
  }

  private result<T>(data: T, requestedCount: number): PlacesApiResult<T> {
    return {
      data,
      provenance: {
        provider: this.provider,
        cacheStatus: 'miss-live',
        requestedCount,
        receivedCount: Array.isArray(data) ? data.length : data ? 1 : 0,
      },
    };
  }

  private requestError(
    message: string,
    requestedCount: number,
    error: unknown,
  ): PlacesApiRequestError {
    return new PlacesApiRequestError(
      message,
      {
        provider: this.provider,
        cacheStatus: 'miss-live',
        requestedCount,
        receivedCount: 0,
      },
      error,
    );
  }

  private getApiKey(): string {
    const key = this.configService.get<string>('GEOAPIFY_API_KEY');
    if (!key) {
      throw new Error('GEOAPIFY_API_KEY is not configured');
    }
    return key;
  }

  private mapFeatureToPlaceData(
    feature: GeoapifyFeature,
    types: string[],
  ): PlaceData {
    const { properties: p } = feature;
    return {
      id: p.place_id,
      name: p.name,
      displayName: p.name ? { text: p.name } : undefined,
      formattedAddress: p.formatted,
      location: { latitude: p.lat, longitude: p.lon },
      // Echo back the Google-style type(s) the caller requested rather than
      // Geoapify's own category codes, so GooglePlacesService.findMatchingActivityType()
      // keeps working unchanged and doesn't fall back to an AI classification call
      // for every single Geoapify-sourced place.
      types,
      // Geoapify never exposes rating/review-count or a structured price
      // level, on any endpoint or plan (confirmed against their official
      // docs). Opening hours DO exist, but only on Place Details
      // (v2/place-details), not on this Places Search response — see
      // getPlaceDetails() below.
      rating: undefined,
      userRatingCount: undefined,
      priceLevel: undefined,
      openingHoursWeekdayText: undefined,
    };
  }

  private async searchByCategory(
    categories: string,
    latitude: number,
    longitude: number,
    radius: number,
    maxResultCount: number,
    types: string[],
  ): Promise<PlacesApiResult<PlaceData[]>> {
    try {
      const apiKey = this.getApiKey();
      const response = await axios.get(this.placesUrl, {
        params: {
          categories,
          // Geoapify's circle filter takes lon,lat (reversed from the usual lat,lng).
          filter: `circle:${longitude},${latitude},${radius}`,
          limit: maxResultCount,
          apiKey,
        },
        timeout: this.requestTimeoutMs,
      });

      const features: GeoapifyFeature[] = response.data?.features || [];
      return this.result(
        features.map((f) => this.mapFeatureToPlaceData(f, types)),
        maxResultCount,
      );
    } catch (error) {
      this.logger.error(
        `Error searching Geoapify places (categories=${categories}): ${error.message}`,
        error.response?.data,
      );
      throw this.requestError(
        `Geoapify category search failed: ${error.message}`,
        maxResultCount,
        error,
      );
    }
  }

  async searchNearby(
    params: PlacesSearchNearbyParams,
  ): Promise<PlacesApiResult<PlaceData[]>> {
    const requestedTypes = params.includedPrimaryTypes || [];
    const categories = [
      ...new Set(
        requestedTypes.flatMap((type) =>
          (TYPE_TO_GEOAPIFY_CATEGORIES[type] ?? '').split(',').filter(Boolean),
        ),
      ),
    ].join(',');

    if (!categories) {
      this.logger.warn(
        `No Geoapify category mapping found for types: ${requestedTypes.join(', ')}`,
      );
      return this.result([], params.maxResultCount || 20);
    }

    return this.searchByCategory(
      categories,
      params.latitude,
      params.longitude,
      params.radius,
      params.maxResultCount || 20,
      requestedTypes,
    );
  }

  private mapForwardGeocodingResultToPlaceData(
    result: GeoapifyForwardGeocodingResult,
  ): PlaceData {
    return {
      id: result.place_id,
      name: result.name,
      displayName: result.name ? { text: result.name } : undefined,
      formattedAddress: result.formatted,
      location: { latitude: result.lat, longitude: result.lon },
      // Only what Geoapify itself declared -- no Google-style type is
      // invented for a result that carries no category.
      types: result.category ? [result.category] : [],
      primaryType: result.category,
      featureClass: this.featureClassOf(result),
      rating: undefined,
      userRatingCount: undefined,
      priceLevel: undefined,
      openingHoursWeekdayText: undefined,
    };
  }

  /** `result_type` (+ `category` for amenities) -> provider-neutral class. */
  private featureClassOf(
    result: GeoapifyForwardGeocodingResult,
  ): PlaceFeatureClass | undefined {
    const resultType = result.result_type;
    if (resultType === 'street') return 'street';
    if (resultType === 'building') return 'building';
    if (resultType === 'postcode') return 'postcode';
    if (resultType && ADMINISTRATIVE_RESULT_TYPES.has(resultType)) {
      return 'administrative_area';
    }
    if (resultType === 'amenity') {
      const categories = (result.category ?? '').split(';');
      return categories.some((category) =>
        TRANSPORT_STOP_CATEGORIES.some(
          (stop) => category === stop || category.startsWith(`${stop}.`),
        ),
      )
        ? 'transport_stop'
        : 'point_of_interest';
    }
    return undefined;
  }

  /**
   * Forward Geocoding with the hint as free-form `text` (never mixed with
   * structured `name/street/city/...` fields, which the docs declare
   * mutually exclusive), NO `type`, a hard circle `filter` and a proximity
   * `bias`. Stage 3 PLACE characterization (spikes/stage3-place-provider-
   * search-characterization-2026-09-25/assessment.md): this shape returned
   * the correct object for 11/12 PLACE hints vs 8/12 for the former
   * Autocomplete + `type=amenity` shape, which cannot match a descriptive
   * gloss like "Mafalda Statue" and whose `amenity` class excludes
   * `landuse=cemetery` and untagged building ways. Without `type`, streets,
   * administrative areas and transit stops are in the result universe too:
   * each result's `featureClass` declares that, and PLACE resolution must
   * reject what cannot be a PLACE.
   *
   * A hard geographic `filter` (not just a `bias`) is mandatory. Live-
   * confirmed: proximity bias alone only reorders global results (a
   * same-named church in Puerto Rico ranked above the real Buenos Aires
   * one). Fail-closed: without a `locationBias` to build that filter from,
   * this never searches globally.
   */
  async searchText(
    params: PlacesSearchTextParams,
  ): Promise<PlacesApiResult<PlaceData[]>> {
    if (!params.locationBias) {
      this.logger.warn(
        `Geoapify Places text search requires a locationBias to search safely; skipped query: "${params.textQuery}"`,
      );
      return this.result([], params.maxResultCount || 5);
    }

    const { center, radius } = params.locationBias;
    const maxResultCount = params.maxResultCount || 5;
    try {
      const apiKey = this.getApiKey();
      const response = await axios.get(this.forwardGeocodingUrl, {
        params: {
          text: params.textQuery,
          filter: `circle:${center.longitude},${center.latitude},${radius}`,
          bias: `proximity:${center.longitude},${center.latitude}`,
          limit: maxResultCount,
          format: 'json',
          apiKey,
        },
        timeout: this.requestTimeoutMs,
      });

      const results: GeoapifyForwardGeocodingResult[] =
        response.data?.results || [];
      return this.result(
        results.map((r) => this.mapForwardGeocodingResultToPlaceData(r)),
        maxResultCount,
      );
    } catch (error) {
      this.logger.error(
        `Error in Geoapify text search (query="${params.textQuery}"): ${error.message}`,
        error.response?.data,
      );
      throw this.requestError(
        `Geoapify text search failed: ${error.message}`,
        maxResultCount,
        error,
      );
    }
  }

  /**
   * Explicit cross-identities declared by Place Details: the OSM object
   * (`datasource.raw.osm_type` n/w/r + `osm_id`, only when the datasource IS
   * OpenStreetMap) and the Wikidata QID. The opaque `place_id` is never
   * parsed -- the spike measured the same OSM node under different
   * `place_id`s across search modes, so only these fields are stable keys.
   */
  private sourceIdentitiesOf(
    p: GeoapifyPlaceDetailsProperties,
  ): PlaceSourceIdentity[] | undefined {
    const identities: PlaceSourceIdentity[] = [];
    const raw = p.datasource?.raw;
    if (p.datasource?.sourcename === 'openstreetmap' && raw) {
      const osmType =
        typeof raw.osm_type === 'string'
          ? OSM_TYPE_BY_GEOAPIFY_CODE[raw.osm_type]
          : undefined;
      const osmId =
        typeof raw.osm_id === 'number' || typeof raw.osm_id === 'string'
          ? String(raw.osm_id)
          : undefined;
      if (osmType && osmId && /^[1-9]\d*$/.test(osmId)) {
        identities.push({
          provider: 'openstreetmap',
          externalId: `osm:${osmType}:${osmId}`,
        });
      }
    }
    const qid = p.wiki_and_media?.wikidata ?? raw?.wikidata;
    if (typeof qid === 'string' && /^Q[1-9]\d*$/.test(qid)) {
      identities.push({ provider: 'wikidata', externalId: qid });
    }
    return identities.length > 0 ? identities : undefined;
  }

  async getPlaceDetails(
    placeId: string,
  ): Promise<PlacesApiResult<Partial<PlaceData>>> {
    try {
      const apiKey = this.getApiKey();
      const response = await axios.get(this.placeDetailsUrl, {
        params: { id: placeId, apiKey },
        timeout: this.requestTimeoutMs,
      });

      const p: GeoapifyPlaceDetailsProperties =
        response.data?.features?.[0]?.properties || {};
      const sourceIdentities = this.sourceIdentitiesOf(p);
      return this.result(
        {
          id: p.place_id,
          name: p.name,
          nationalPhoneNumber: p.contact?.phone,
          websiteUri: p.website,
          // Raw OSM-syntax string (e.g. "Mo-Fr 09:00-18:00; Sa 10:00-14:00").
          // Wrapped in a single-element array to fit the `weekdayText`
          // shape activity-prompt-formatter.util.ts already expects — the LLM
          // can reasonably interpret the OSM format as-is.
          openingHoursWeekdayText: p.opening_hours
            ? [p.opening_hours]
            : undefined,
          ...(sourceIdentities ? { sourceIdentities } : {}),
        },
        1,
      );
    } catch (error) {
      this.logger.error(
        `Error fetching Geoapify place details for ${placeId}:`,
        error.response?.data || error.message,
      );
      throw this.requestError(
        `Geoapify details failed for ${placeId}: ${error.message}`,
        1,
        error,
      );
    }
  }
}
