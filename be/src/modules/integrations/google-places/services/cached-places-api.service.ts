import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  IPlacesApiService,
  PlaceData,
  PlacesSearchNearbyParams,
  PlacesSearchTextParams,
} from '../interfaces/places-api.interface';

@Injectable()
export class CachedPlacesApiService implements IPlacesApiService {
  private readonly logger = new Logger(CachedPlacesApiService.name);
  private readonly cacheDir: string;
  private readonly mode: 'read' | 'write' | 'strict';

  constructor(
    private readonly configService: ConfigService,
    @Inject('RealPlacesApiService')
    private readonly realService: IPlacesApiService,
  ) {
    const storagePath =
      this.configService.get<string>('STORAGE_PATH') ||
      path.join(process.cwd(), 'storage');
    this.cacheDir = path.join(storagePath, 'maps-cache');
    this.mode =
      (this.configService.get<string>('MOCK_MAPS_MODE') as any) || 'read'; // read, write, strict

    this.ensureCacheDir();
  }

  private ensureCacheDir() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private getCacheKey(method: string, params: any): string {
    const hash = crypto
      .createHash('md5')
      .update(JSON.stringify(params))
      .digest('hex');
    return `${method}-${hash}.json`;
  }

  private getCachePath(key: string): string {
    return path.join(this.cacheDir, key);
  }

  private async handleRequest<T>(
    method: string,
    params: any,
    executor: () => Promise<T>,
  ): Promise<T> {
    const key = this.getCacheKey(method, params);
    const cachePath = this.getCachePath(key);

    if (fs.existsSync(cachePath)) {
      this.logger.log(
        `[CachedPlacesApiService] Cache hit for ${method} (${key})`,
      );
      const content = fs.readFileSync(cachePath, 'utf-8');
      return JSON.parse(content);
    }

    if (this.mode === 'strict') {
      throw new Error(
        `[CachedPlacesApiService] Strict mode: Cache miss for ${method} (${key}) and real API calls are disabled.`,
      );
    }

    this.logger.log(
      `[CachedPlacesApiService] Cache miss for ${method} (${key}). Calling real API...`,
    );
    const result = await executor();

    if (this.mode === 'write') {
      // Save to cache
      try {
        fs.writeFileSync(cachePath, JSON.stringify(result, null, 2));
        this.logger.log(
          `[CachedPlacesApiService] Cached response for ${method} (${key})`,
        );
      } catch (err) {
        this.logger.error(`Failed to write cache: ${err.message}`);
      }
    }

    return result;
  }

  async searchNearby(params: PlacesSearchNearbyParams): Promise<PlaceData[]> {
    return this.handleRequest('searchNearby', params, () =>
      this.realService.searchNearby(params),
    );
  }

  async searchText(params: PlacesSearchTextParams): Promise<PlaceData[]> {
    return this.handleRequest('searchText', params, () =>
      this.realService.searchText(params),
    );
  }

  async getPlaceDetails(placeId: string): Promise<Partial<PlaceData>> {
    return this.handleRequest('getPlaceDetails', { placeId }, () =>
      this.realService.getPlaceDetails(placeId),
    );
  }
}
