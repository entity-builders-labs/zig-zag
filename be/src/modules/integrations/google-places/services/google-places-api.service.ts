import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  IPlacesApiService,
  PlaceData,
  PlacesSearchNearbyParams,
  PlacesSearchTextParams,
} from '../interfaces/places-api.interface';

@Injectable()
export class GooglePlacesApiService implements IPlacesApiService {
  private readonly logger = new Logger(GooglePlacesApiService.name);
  private readonly baseUrl = 'https://places.googleapis.com/v1/places';

  constructor(private readonly configService: ConfigService) {}

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
    ].join(',');
  }

  async searchNearby(params: PlacesSearchNearbyParams): Promise<PlaceData[]> {
    const apiKey = this.getApiKey();

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
      const response = await axios.post(`${this.baseUrl}:searchNearby`, body, {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': this.getFieldMask(),
        },
      });

      return this.mapResponse(response.data?.places || []);
    } catch (error) {
      this.logger.error(
        `Error in searchNearby: ${error.message}`,
        error.response?.data,
      );
      throw error;
    }
  }

  async searchText(params: PlacesSearchTextParams): Promise<PlaceData[]> {
    const apiKey = this.getApiKey();

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
      const response = await axios.post(`${this.baseUrl}:searchText`, body, {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': this.getFieldMask(),
        },
      });

      return this.mapResponse(response.data?.places || []);
    } catch (error) {
      this.logger.error(
        `Error in searchText: ${error.message}`,
        error.response?.data,
      );
      throw error;
    }
  }

  async getPlaceDetails(placeId: string): Promise<Partial<PlaceData>> {
    const apiKey = this.getApiKey();
    try {
      const response = await axios.get(
        `${this.baseUrl}/${placeId}?fields=id,nationalPhoneNumber,websiteUri,displayName,formattedAddress`,
        {
          headers: {
            'X-Goog-Api-Key': apiKey,
          },
        },
      );

      const p = response.data;
      return {
        id: p.id,
        nationalPhoneNumber: p.nationalPhoneNumber,
        websiteUri: p.websiteUri,
        displayName: p.displayName,
        formattedAddress: p.formattedAddress,
        name: p.displayName?.text || p.displayName,
      };
    } catch (error) {
      this.logger.error(`Error fetching place details for ${placeId}:`, error);
      throw error;
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
    }));
  }
}
