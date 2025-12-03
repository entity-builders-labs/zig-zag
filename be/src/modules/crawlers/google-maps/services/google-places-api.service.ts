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
export class GooglePlacesApiServiceImpl implements IPlacesApiService {
  private readonly logger = new Logger(GooglePlacesApiServiceImpl.name);

  constructor(private readonly configService: ConfigService) {}

  async searchNearby(params: PlacesSearchNearbyParams): Promise<PlaceData[]> {
    const apiKey = this.configService.get<string>('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      throw new Error('GOOGLE_MAPS_API_KEY is not defined');
    }

    const url = 'https://places.googleapis.com/v1/places:searchNearby';

    const requestBody: any = {
      maxResultCount: params.maxResultCount || 20,
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
      requestBody.includedTypes = params.includedTypes;
    }

    if (params.rankPreference) {
      requestBody.rankPreference = params.rankPreference;
    }

    try {
      const resp = await axios.post(url, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': [
            'places.id',
            'places.displayName',
            'places.formattedAddress',
            'places.location',
            'places.rating',
            'places.userRatingCount',
            'places.nationalPhoneNumber',
            'places.websiteUri',
            'places.types',
          ].join(','),
        },
      });

      return (resp.data.places || []).map(this.mapGooglePlaceToPlaceData);
    } catch (error) {
      this.logger.error(
        `Google Places API searchNearby failed: ${error.message}`,
        error.response?.data,
      );
      throw error;
    }
  }

  async searchText(params: PlacesSearchTextParams): Promise<PlaceData[]> {
    const apiKey = this.configService.get<string>('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      throw new Error('GOOGLE_MAPS_API_KEY is not defined');
    }

    const url = 'https://places.googleapis.com/v1/places:searchText';

    const requestBody: any = {
      textQuery: params.textQuery,
      maxResultCount: params.maxResultCount || 5,
    };

    if (params.latitude !== undefined && params.longitude !== undefined) {
      requestBody.locationBias = {
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
      const resp = await axios.post(url, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': [
            'places.id',
            'places.displayName',
            'places.formattedAddress',
            'places.location',
            'places.rating',
            'places.userRatingCount',
            'places.nationalPhoneNumber',
            'places.websiteUri',
            'places.types',
          ].join(','),
        },
      });

      return (resp.data.places || []).map(this.mapGooglePlaceToPlaceData);
    } catch (error) {
      this.logger.error(
        `Google Places API searchText failed: ${error.message}`,
        error.response?.data,
      );
      throw error;
    }
  }

  private mapGooglePlaceToPlaceData(p: any): PlaceData {
    return {
      id: p.id,
      displayName: p.displayName,
      formattedAddress: p.formattedAddress,
      location: p.location,
      rating: p.rating,
      userRatingCount: p.userRatingCount,
      types: p.types,
      websiteUri: p.websiteUri,
      nationalPhoneNumber: p.nationalPhoneNumber,
      name: p.displayName?.text || p.displayName, // Helper flattened field
    };
  }
}
