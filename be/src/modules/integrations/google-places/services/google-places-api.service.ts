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

@Injectable()
export class GooglePlacesApiService implements IPlacesApiService {
  readonly provider = 'google' as const;
  private readonly logger = new Logger(GooglePlacesApiService.name);
  private readonly baseUrl = 'https://places.googleapis.com/v1/places';

  constructor(private readonly configService: ConfigService) {}

  getStatus(): PlacesProviderStatus {
    return {
      provider: this.provider,
      available: !!this.configService.get<string>('GOOGLE_MAPS_API_KEY'),
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
    const key = this.configService.get<string>('GOOGLE_MAPS_API_KEY');
    if (!key) {
      throw new Error('GOOGLE_MAPS_API_KEY is not configured');
    }
    return key;
  }

  private getFieldMask(): string {
    return [
      'places.id',
      'places.displayName',
      'places.formattedAddress',
      'places.location',
      'places.rating',
      'places.userRatingCount',
      'places.types',
      'places.websiteUri',
      'places.nationalPhoneNumber',
      'places.priceLevel',
      'places.regularOpeningHours',
    ].join(',');
  }

  async searchNearby(
    params: PlacesSearchNearbyParams,
  ): Promise<PlacesApiResult<PlaceData[]>> {
    const requestedCount = params.maxResultCount || 20;

    const body: any = {
      maxResultCount: params.maxResultCount || 20,
      rankPreference: params.rankPreference || 'DISTANCE',
      locationRestriction: {
        circle: {
          center: {
            latitude: params.latitude,
            longitude: params.longitude,
          },
          radius: params.radius,
        },
      },
    };

    if (params.includedTypes && params.includedTypes.length > 0) {
      body.includedTypes = params.includedTypes;
    }

    try {
      const apiKey = this.getApiKey();
      const response = await axios.post(`${this.baseUrl}:searchNearby`, body, {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': this.getFieldMask(),
        },
      });

      return this.result(
        this.mapResponse(response.data?.places || []),
        requestedCount,
      );
    } catch (error) {
      this.logger.error(
        `Error in searchNearby: ${error.message}`,
        error.response?.data,
      );
      throw this.requestError(
        `Google Places searchNearby failed: ${error.message}`,
        requestedCount,
        error,
      );
    }
  }

  async searchText(
    params: PlacesSearchTextParams,
  ): Promise<PlacesApiResult<PlaceData[]>> {
    const requestedCount = params.maxResultCount || 5;

    const body: any = {
      textQuery: params.textQuery,
      maxResultCount: params.maxResultCount || 5,
    };

    if (params.latitude && params.longitude) {
      body.locationBias = {
        circle: {
          center: {
            latitude: params.latitude,
            longitude: params.longitude,
          },
          radius: params.radius || 5000,
        },
      };
    }

    try {
      const apiKey = this.getApiKey();
      const response = await axios.post(`${this.baseUrl}:searchText`, body, {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': this.getFieldMask(),
        },
      });

      return this.result(
        this.mapResponse(response.data?.places || []),
        requestedCount,
      );
    } catch (error) {
      this.logger.error(
        `Error in searchText: ${error.message}`,
        error.response?.data,
      );
      throw this.requestError(
        `Google Places searchText failed: ${error.message}`,
        requestedCount,
        error,
      );
    }
  }

  async getPlaceDetails(
    placeId: string,
  ): Promise<PlacesApiResult<Partial<PlaceData>>> {
    try {
      const apiKey = this.getApiKey();
      const response = await axios.get(
        `${this.baseUrl}/${placeId}?fields=id,nationalPhoneNumber,websiteUri,displayName,formattedAddress`,
        {
          headers: {
            'X-Goog-Api-Key': apiKey,
          },
        },
      );

      const p = response.data;
      return this.result(
        {
          id: p.id,
          nationalPhoneNumber: p.nationalPhoneNumber,
          websiteUri: p.websiteUri,
          displayName: p.displayName,
          formattedAddress: p.formattedAddress,
          name: p.displayName?.text || p.displayName,
        },
        1,
      );
    } catch (error) {
      this.logger.error(`Error fetching place details for ${placeId}:`, error);
      throw this.requestError(
        `Google Places details failed for ${placeId}: ${error.message}`,
        1,
        error,
      );
    }
  }

  private mapResponse(places: any[]): PlaceData[] {
    return places.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      formattedAddress: p.formattedAddress,
      location: p.location,
      rating: p.rating,
      userRatingCount: p.userRatingCount,
      types: p.types,
      websiteUri: p.websiteUri,
      nationalPhoneNumber: p.nationalPhoneNumber,
      name: p.displayName?.text || p.displayName,
      priceLevel: p.priceLevel,
      openingHoursWeekdayText: p.regularOpeningHours?.weekdayDescriptions,
    }));
  }
}
