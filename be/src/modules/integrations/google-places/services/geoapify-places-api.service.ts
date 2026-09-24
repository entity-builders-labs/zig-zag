import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  IPlacesApiService,
  PlaceData,
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

// Shape of one `results[]` entry from /v1/geocode/autocomplete — a
// different response envelope than the /v2/places `features[]` shape
// above (this is the Geocoding API, not the Places API), live-verified
// against the real endpoint (2026-09-17).
interface GeoapifyAutocompleteResult {
  place_id: string;
  name?: string;
  formatted?: string;
  lat: number;
  lon: number;
  // Geoapify's own dotted category taxonomy (e.g. "entertainment.museum"),
  // present on every real amenity-type autocomplete result — live-verified
  // against the real endpoint (2026-09-24). Previously read by nothing,
  // so every Geoapify PlaceData silently reported `types: []` regardless
  // of the provider's own real category classification.
  category?: string;
}

@Injectable()
export class GeoapifyPlacesApiService implements IPlacesApiService {
  readonly provider = 'geoapify' as const;
  private readonly logger = new Logger(GeoapifyPlacesApiService.name);
  private readonly placesUrl = 'https://api.geoapify.com/v2/places';
  private readonly placeDetailsUrl =
    'https://api.geoapify.com/v2/place-details';
  private readonly autocompleteUrl =
    'https://api.geoapify.com/v1/geocode/autocomplete';
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

  private mapAutocompleteResultToPlaceData(
    result: GeoapifyAutocompleteResult,
    includedType: string | undefined,
  ): PlaceData {
    return {
      id: result.place_id,
      name: result.name,
      displayName: result.name ? { text: result.name } : undefined,
      formattedAddress: result.formatted,
      location: { latitude: result.lat, longitude: result.lon },
      types: result.category
        ? [result.category]
        : includedType
          ? [includedType]
          : [],
      primaryType: result.category,
      rating: undefined,
      userRatingCount: undefined,
      priceLevel: undefined,
      openingHoursWeekdayText: undefined,
    };
  }

  /**
   * Live-confirmed against the real Geoapify Autocomplete API (2026-09-17,
   * see docs/superpowers/characterization/2026-09-15-composite-experience-adversarial-review.md
   * Root Cause #3): Geoapify DOES support finding a specific named
   * venue/business (`type=amenity` on /v1/geocode/autocomplete) — the
   * previous "no descriptive Text Search capability" stub was an
   * incomplete implementation, not a real product limitation.
   *
   * A hard geographic `filter` (not just a `bias`) is mandatory whenever a
   * location is known. Live-confirmed: searching "San Ignacio Church" with
   * only `bias=proximity` (no `filter`) ranked churches in Puerto Rico and
   * New Mexico above the real Buenos Aires one — proximity bias only
   * reorders global results, it does not restrict them. Adding
   * `filter=circle:...` around the same point correctly returned the real
   * "Parroquia San Ignacio de Loyola" first. Fail-closed: without a
   * `locationBias` to build that hard filter from, this never searches
   * globally — same principle already applied to the local OSM matcher.
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
      const response = await axios.get(this.autocompleteUrl, {
        params: {
          text: params.textQuery,
          type: 'amenity',
          filter: `circle:${center.longitude},${center.latitude},${radius}`,
          bias: `proximity:${center.longitude},${center.latitude}`,
          limit: maxResultCount,
          format: 'json',
          apiKey,
        },
        timeout: this.requestTimeoutMs,
      });

      const results: GeoapifyAutocompleteResult[] =
        response.data?.results || [];
      return this.result(
        results.map((r) =>
          this.mapAutocompleteResultToPlaceData(r, params.includedType),
        ),
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

  async getPlaceDetails(
    placeId: string,
  ): Promise<PlacesApiResult<Partial<PlaceData>>> {
    try {
      const apiKey = this.getApiKey();
      const response = await axios.get(this.placeDetailsUrl, {
        params: { id: placeId, apiKey },
        timeout: this.requestTimeoutMs,
      });

      const p = response.data?.features?.[0]?.properties || {};
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
