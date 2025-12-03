import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  IPlacesApiService,
  PlaceData,
  PlacesSearchNearbyParams,
  PlacesSearchTextParams,
} from '../interfaces/places-api.interface';
import { GooglePlacesApiServiceImpl } from './google-places-api.service';

@Injectable()
export class CachedPlacesApiServiceImpl implements IPlacesApiService {
  private readonly logger = new Logger(CachedPlacesApiServiceImpl.name);
  private readonly cacheDir: string;
  private readonly mode: 'read' | 'write' | 'strict'; // read=use cache if exists else call real; write=always call real and save; strict=only use cache, fail if missing

  constructor(private readonly realService: GooglePlacesApiServiceImpl) {
    // Default cache location
    this.cacheDir = path.join(process.cwd(), 'storage', 'places_cache');

    // Determine mode from environment or default to 'read'
    // We can inject ConfigService if we want to be more 'NestJS' compliant here, but simple env access works for this utility layer
    const envMode = process.env.PLACES_CACHE_MODE || 'read';
    this.mode = ['read', 'write', 'strict'].includes(envMode)
      ? (envMode as any)
      : 'read';

    this.ensureCacheDir();
    this.logger.log(`Initialized CachedPlacesApiService in mode: ${this.mode}`);
  }

  private ensureCacheDir() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private getCacheKey(operation: string, params: any): string {
    // Sort keys to ensure deterministic hash for same params
    const stableString = JSON.stringify(params, Object.keys(params).sort());
    const hash = crypto.createHash('md5').update(stableString).digest('hex');
    return `${operation}_${hash}.json`;
  }

  private getCachePath(key: string): string {
    return path.join(this.cacheDir, key);
  }

  async searchNearby(params: PlacesSearchNearbyParams): Promise<PlaceData[]> {
    const key = this.getCacheKey('searchNearby', params);
    const cachePath = this.getCachePath(key);

    if (this.mode === 'write') {
      if (fs.existsSync(cachePath)) {
        this.logger.debug(`[CACHE HIT] searchNearby: ${key}`);
        return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      }
      throw new Error(
        `[CACHE MISS] Strict mode enabled, no cache for searchNearby: ${JSON.stringify(params)}`,
      );
    }

    if (this.mode === 'read' && fs.existsSync(cachePath)) {
      this.logger.debug(`[CACHE HIT] searchNearby: ${key}`);
      return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    }

    this.logger.debug(`[CACHE MISS] Calling real searchNearby...`);
    const result = await this.realService.searchNearby(params);

    if (this.mode !== 'read') {
      fs.writeFileSync(cachePath, JSON.stringify(result, null, 2));
      this.logger.debug(`[CACHE SAVED] searchNearby: ${key}`);
    }

    return result;
  }

  async searchText(params: PlacesSearchTextParams): Promise<PlaceData[]> {
    const key = this.getCacheKey('searchText', params);
    const cachePath = this.getCachePath(key);

    if (this.mode === 'write') {
      if (fs.existsSync(cachePath)) {
        this.logger.debug(`[CACHE HIT] searchText: ${key}`);
        return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      }
      throw new Error(
        `[CACHE MISS] Strict mode enabled, no cache for searchText: ${JSON.stringify(params)}`,
      );
    }

    if (this.mode === 'read' && fs.existsSync(cachePath)) {
      this.logger.debug(`[CACHE HIT] searchText: ${key}`);
      return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    }

    this.logger.debug(`[CACHE MISS] Calling real searchText...`);
    const result = await this.realService.searchText(params);

    if (this.mode !== 'strict') {
      fs.writeFileSync(cachePath, JSON.stringify(result, null, 2));
      this.logger.debug(`[CACHE SAVED] searchText: ${key}`);
    }

    return result;
  }
}
