import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  IPlacesApiService,
  PlaceData,
  PlacesApiRequestError,
  PlacesApiResult,
  PlacesCacheMode,
  PlacesProviderStatus,
  PlacesSearchNearbyParams,
  PlacesSearchTextParams,
  parsePlacesCacheMode,
} from '../interfaces/places-api.interface';

@Injectable()
export class CachedPlacesApiService implements IPlacesApiService {
  // v3 records primaryType and separates Nearby includedPrimaryTypes from
  // Text Search's singular includedType/location contract.
  private static readonly CACHE_SCHEMA_VERSION = 'v3';
  private readonly logger = new Logger(CachedPlacesApiService.name);
  private readonly cacheDir: string;
  private readonly mode: PlacesCacheMode;

  constructor(
    private readonly configService: ConfigService,
    @Inject('RealPlacesApiService')
    private readonly realService: IPlacesApiService,
  ) {
    const storagePath =
      this.configService.get<string>('STORAGE_PATH') ||
      path.join(process.cwd(), 'storage');
    this.cacheDir = path.join(storagePath, 'maps-cache');
    this.mode = parsePlacesCacheMode(
      this.configService.get<string>('MOCK_MAPS_MODE'),
    );

    this.ensureCacheDir();
  }

  get provider() {
    return this.realService.provider;
  }

  get declaresSourceIdentitiesInDetails() {
    return this.realService.declaresSourceIdentitiesInDetails;
  }

  getStatus(): PlacesProviderStatus {
    return {
      ...this.realService.getStatus(),
      cacheEnabled: true,
      cacheMode: this.mode,
    };
  }

  private ensureCacheDir() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private normalizeParams(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) => this.normalizeParams(entry));
    }
    if (value && typeof value === 'object') {
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((normalized, key) => {
          const entry = (value as Record<string, unknown>)[key];
          if (entry !== undefined) {
            normalized[key] = this.normalizeParams(entry);
          }
          return normalized;
        }, {});
    }
    return value;
  }

  private getCacheKey(method: string, params: unknown): string {
    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(this.normalizeParams(params)))
      .digest('hex');
    return `${this.provider}-${CachedPlacesApiService.CACHE_SCHEMA_VERSION}-${method}-${hash}.json`;
  }

  private getCachePath(key: string): string {
    return path.join(this.cacheDir, key);
  }

  private async handleRequest<T>(
    method: string,
    params: unknown,
    requestedCount: number,
    executor: () => Promise<PlacesApiResult<T>>,
  ): Promise<PlacesApiResult<T>> {
    const key = this.getCacheKey(method, params);
    const cachePath = this.getCachePath(key);

    if (fs.existsSync(cachePath)) {
      this.logger.log(
        `[CachedPlacesApiService] Cache hit for ${method} (${key})`,
      );
      const content = fs.readFileSync(cachePath, 'utf-8');
      const data = JSON.parse(content) as T;
      return {
        data,
        provenance: {
          provider: this.provider,
          cacheStatus: 'hit',
          requestedCount,
          receivedCount: Array.isArray(data) ? data.length : data ? 1 : 0,
        },
      };
    }

    if (this.mode === 'strict') {
      throw new PlacesApiRequestError(
        `[CachedPlacesApiService] Strict mode: cache miss for ${this.provider}.${method} (${key}); live API calls are disabled.`,
        {
          provider: this.provider,
          cacheStatus: 'strict-miss',
          requestedCount,
          receivedCount: 0,
        },
        undefined,
        'strict_cache_miss',
        method as 'searchNearby' | 'searchText' | 'getPlaceDetails',
      );
    }

    this.logger.log(
      `[CachedPlacesApiService] Cache miss for ${method} (${key}). Calling real API...`,
    );
    const result = await executor();

    if (this.mode === 'write') {
      // Save to cache
      try {
        fs.writeFileSync(cachePath, JSON.stringify(result.data, null, 2));
        this.logger.log(
          `[CachedPlacesApiService] Cached response for ${method} (${key})`,
        );
      } catch (err) {
        this.logger.error(`Failed to write cache: ${err.message}`);
      }
    }

    return result;
  }

  async searchNearby(
    params: PlacesSearchNearbyParams,
  ): Promise<PlacesApiResult<PlaceData[]>> {
    return this.handleRequest(
      'searchNearby',
      params,
      params.maxResultCount || 20,
      () => this.realService.searchNearby(params),
    );
  }

  async searchText(
    params: PlacesSearchTextParams,
  ): Promise<PlacesApiResult<PlaceData[]>> {
    return this.handleRequest(
      'searchText',
      params,
      params.maxResultCount || 5,
      () => this.realService.searchText(params),
    );
  }

  async getPlaceDetails(
    placeId: string,
  ): Promise<PlacesApiResult<Partial<PlaceData>>> {
    return this.handleRequest('getPlaceDetails', { placeId }, 1, () =>
      this.realService.getPlaceDetails(placeId),
    );
  }
}
