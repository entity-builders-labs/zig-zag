import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  IPlacesApiService,
  PlaceData,
  PlacesSearchNearbyParams,
  PlacesSearchTextParams,
} from '../interfaces/places-api.interface';

// Maps the Google-Places-style type strings used by GooglePlacesService's
// `placesToSearch` config to the closest Geoapify category code(s).
// Geoapify accepts a comma-separated list of categories per request (OR semantics).
const TYPE_TO_GEOAPIFY_CATEGORIES: Record<string, string> = {
  museum: 'entertainment.museum',
  art_gallery: 'entertainment.culture.gallery',
  tourist_attraction: 'tourism.attraction',
  church: 'tourism.sights.place_of_worship',
  point_of_interest: 'tourism.attraction,tourism.sights',
  park: 'leisure.park',
  // Geoapify has no dedicated "hiking trail" POI category; this is the
  // closest available approximation and may return sparse/irrelevant results.
  natural_feature:
    'natural.forest,natural.mountain,natural.water,natural.protected_area',
  hiking_trail: 'natural.forest,natural.protected_area',
  campground: 'camping.camp_site',
  restaurant: 'catering.restaurant',
  cafe: 'catering.cafe',
  bar: 'catering.bar,catering.pub',
  amusement_park: 'entertainment.theme_park',
  movie_theater: 'entertainment.cinema',
};

// Geoapify's Places API has no free-text search endpoint (that's a separate
// Geocoding/Autocomplete product). searchText() is only ever called by
// GooglePlacesService for the three types Google's nearby search doesn't
// support (point_of_interest, natural_feature, hiking_trail) — this table
// recovers the intended category from the composed textQuery as a best effort.
const TEXT_SEARCH_KEYWORD_CATEGORIES: Array<{
  match: string;
  categories: string;
}> = [
  {
    match: 'hikingtrail',
    categories: TYPE_TO_GEOAPIFY_CATEGORIES.hiking_trail,
  },
  {
    match: 'naturalfeature',
    categories: TYPE_TO_GEOAPIFY_CATEGORIES.natural_feature,
  },
  {
    match: 'pointofinterest',
    categories: TYPE_TO_GEOAPIFY_CATEGORIES.point_of_interest,
  },
];

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

@Injectable()
export class GeoapifyPlacesApiService implements IPlacesApiService {
  private readonly logger = new Logger(GeoapifyPlacesApiService.name);
  private readonly placesUrl = 'https://api.geoapify.com/v2/places';
  private readonly placeDetailsUrl =
    'https://api.geoapify.com/v2/place-details';

  constructor(private readonly configService: ConfigService) {}

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
      // Geoapify doesn't expose rating/review-count, structured price level,
      // or opening hours data on any endpoint this integration calls.
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
  ): Promise<PlaceData[]> {
    const apiKey = this.getApiKey();

    try {
      const response = await axios.get(this.placesUrl, {
        params: {
          categories,
          // Geoapify's circle filter takes lon,lat (reversed from the usual lat,lng).
          filter: `circle:${longitude},${latitude},${radius}`,
          limit: maxResultCount,
          apiKey,
        },
      });

      const features: GeoapifyFeature[] = response.data?.features || [];
      return features.map((f) => this.mapFeatureToPlaceData(f, types));
    } catch (error) {
      this.logger.error(
        `Error searching Geoapify places (categories=${categories}): ${error.message}`,
        error.response?.data,
      );
      throw error;
    }
  }

  async searchNearby(params: PlacesSearchNearbyParams): Promise<PlaceData[]> {
    const requestedTypes = params.includedTypes || [];
    const categories = requestedTypes
      .map((t) => TYPE_TO_GEOAPIFY_CATEGORIES[t])
      .filter(Boolean)
      .join(',');

    if (!categories) {
      this.logger.warn(
        `No Geoapify category mapping found for types: ${requestedTypes.join(', ')}`,
      );
      return [];
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

  async searchText(params: PlacesSearchTextParams): Promise<PlaceData[]> {
    const normalizedQuery = params.textQuery
      .toLowerCase()
      .replace(/[^a-z]/g, '');
    const match = TEXT_SEARCH_KEYWORD_CATEGORIES.find((entry) =>
      normalizedQuery.includes(entry.match),
    );

    if (!match) {
      this.logger.warn(
        `Geoapify has no free-text search; no category approximation found for query: "${params.textQuery}"`,
      );
      return [];
    }

    if (params.latitude === undefined || params.longitude === undefined) {
      this.logger.warn(
        `searchText requires latitude/longitude for Geoapify (category-based approximation): "${params.textQuery}"`,
      );
      return [];
    }

    return this.searchByCategory(
      match.categories,
      params.latitude,
      params.longitude,
      params.radius || 5000,
      params.maxResultCount || 20,
      [],
    );
  }

  async getPlaceDetails(placeId: string): Promise<Partial<PlaceData>> {
    const apiKey = this.getApiKey();

    try {
      const response = await axios.get(this.placeDetailsUrl, {
        params: { id: placeId, apiKey },
      });

      const p = response.data?.features?.[0]?.properties || {};
      return {
        id: p.place_id,
        name: p.name,
        nationalPhoneNumber: p.contact?.phone,
        websiteUri: p.website,
      };
    } catch (error) {
      this.logger.error(
        `Error fetching Geoapify place details for ${placeId}:`,
        error.response?.data || error.message,
      );
      return {};
    }
  }
}
