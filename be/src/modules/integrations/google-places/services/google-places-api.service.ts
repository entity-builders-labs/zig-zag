import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  IPlacesApiService,
  PlaceData,
  PlacesApiErrorCode,
  PlacesApiOperation,
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
  private readonly requestTimeoutMs = 5_000;
  private readonly quotaUnavailableUntil = new Map<PlacesApiOperation, Date>();

  constructor(private readonly configService: ConfigService) {}

  getStatus(): PlacesProviderStatus {
    const hasApiKey = !!this.configService.get<string>('GOOGLE_MAPS_API_KEY');
    const unavailableUntil = this.getActiveQuotaBlock('searchNearby');
    return {
      provider: this.provider,
      available: hasApiKey && !unavailableUntil,
      cacheEnabled: false,
      ...(!hasApiKey
        ? { degradedReason: 'provider_unavailable' as const }
        : unavailableUntil
          ? {
              degradedReason: 'quota_exhausted' as const,
              unavailableUntil: unavailableUntil.toISOString(),
            }
          : {}),
    };
  }

  private getActiveQuotaBlock(operation: PlacesApiOperation): Date | null {
    const unavailableUntil = this.quotaUnavailableUntil.get(operation);
    if (!unavailableUntil) return null;
    if (unavailableUntil.getTime() <= Date.now()) {
      this.quotaUnavailableUntil.delete(operation);
      return null;
    }
    return unavailableUntil;
  }

  private getGoogleErrorMetadata(error: any): Record<string, string> {
    const details = error?.response?.data?.error?.details;
    if (!Array.isArray(details)) return {};
    return details.find((detail: any) => detail?.metadata)?.metadata ?? {};
  }

  private classifyError(error: any): PlacesApiErrorCode {
    if (!this.configService.get<string>('GOOGLE_MAPS_API_KEY')) {
      return 'provider_unavailable';
    }
    if (error?.response?.status !== 429) return 'request_failed';

    const metadata = this.getGoogleErrorMetadata(error);
    const dailyQuota =
      metadata.quota_unit?.includes('/d/') ||
      metadata.quota_limit?.toLowerCase().includes('perday');
    return dailyQuota ? 'quota_exhausted' : 'rate_limited';
  }

  private rememberQuotaBlock(operation: PlacesApiOperation, error: any): Date {
    const metadata = this.getGoogleErrorMetadata(error);
    const windowStartSeconds = Number(metadata.window_start_time);
    const unavailableUntil = Number.isFinite(windowStartSeconds)
      ? new Date((windowStartSeconds + 24 * 60 * 60) * 1000)
      : new Date(Date.now() + 24 * 60 * 60 * 1000);
    this.quotaUnavailableUntil.set(operation, unavailableUntil);
    return unavailableUntil;
  }

  private assertOperationAvailable(
    operation: PlacesApiOperation,
    requestedCount: number,
  ): void {
    const unavailableUntil = this.getActiveQuotaBlock(operation);
    if (!unavailableUntil) return;
    throw new PlacesApiRequestError(
      `Google Places ${operation} daily quota is exhausted until ${unavailableUntil.toISOString()}.`,
      {
        provider: this.provider,
        cacheStatus: 'miss-live',
        requestedCount,
        receivedCount: 0,
      },
      undefined,
      'quota_exhausted',
      operation,
    );
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
    operation: PlacesApiOperation,
  ): PlacesApiRequestError {
    const code = this.classifyError(error);
    if (code === 'quota_exhausted') {
      this.rememberQuotaBlock(operation, error);
    }
    return new PlacesApiRequestError(
      message,
      {
        provider: this.provider,
        cacheStatus: 'miss-live',
        requestedCount,
        receivedCount: 0,
      },
      error,
      code,
      operation,
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
      'places.primaryType',
      'places.priceLevel',
      'places.regularOpeningHours',
      'places.businessStatus',
    ].join(',');
  }

  async searchNearby(
    params: PlacesSearchNearbyParams,
  ): Promise<PlacesApiResult<PlaceData[]>> {
    // Google Places Nearby accepts only 1..20 results per request. Callers may
    // ask for a larger catalog pool, but that must never leak into the API
    // payload (a previous 250-result request caused a deterministic 400).
    const requestedCount = Math.min(
      Math.max(params.maxResultCount ?? 20, 1),
      20,
    );
    this.assertOperationAvailable('searchNearby', requestedCount);

    const body: any = {
      maxResultCount: requestedCount,
      rankPreference: params.rankPreference || 'POPULARITY',
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

    if (params.includedPrimaryTypes && params.includedPrimaryTypes.length > 0) {
      body.includedPrimaryTypes = params.includedPrimaryTypes;
    }

    try {
      const apiKey = this.getApiKey();
      const response = await axios.post(`${this.baseUrl}:searchNearby`, body, {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': this.getFieldMask(),
        },
        timeout: this.requestTimeoutMs,
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
        'searchNearby',
      );
    }
  }

  async searchText(
    params: PlacesSearchTextParams,
  ): Promise<PlacesApiResult<PlaceData[]>> {
    const requestedCount = params.maxResultCount || 5;
    this.assertOperationAvailable('searchText', requestedCount);

    const body: any = {
      textQuery: params.textQuery,
      maxResultCount: params.maxResultCount || 5,
    };

    if (params.locationRestriction) {
      body.locationRestriction = {
        rectangle: params.locationRestriction,
      };
    } else if (params.locationBias) {
      body.locationBias = {
        circle: params.locationBias,
      };
    }
    if (params.includedType) body.includedType = params.includedType;
    if (params.strictTypeFiltering !== undefined) {
      body.strictTypeFiltering = params.strictTypeFiltering;
    }

    try {
      const apiKey = this.getApiKey();
      const response = await axios.post(`${this.baseUrl}:searchText`, body, {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': this.getFieldMask(),
        },
        timeout: this.requestTimeoutMs,
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
        'searchText',
      );
    }
  }

  async getPlaceDetails(
    placeId: string,
  ): Promise<PlacesApiResult<Partial<PlaceData>>> {
    this.assertOperationAvailable('getPlaceDetails', 1);
    try {
      const apiKey = this.getApiKey();
      const response = await axios.get(
        `${this.baseUrl}/${placeId}?fields=id,nationalPhoneNumber,websiteUri,displayName,formattedAddress`,
        {
          headers: {
            'X-Goog-Api-Key': apiKey,
          },
          timeout: this.requestTimeoutMs,
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
        'getPlaceDetails',
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
      primaryType: p.primaryType,
      websiteUri: p.websiteUri,
      nationalPhoneNumber: p.nationalPhoneNumber,
      name: p.displayName?.text || p.displayName,
      priceLevel: p.priceLevel,
      openingHoursWeekdayText: p.regularOpeningHours?.weekdayDescriptions,
      businessStatus: p.businessStatus,
    }));
  }
}
