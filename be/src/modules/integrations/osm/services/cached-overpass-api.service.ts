import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  IOverpassApiService,
  OverpassElement,
  QueryBoundaryByNameParams,
  QueryContainingBoundaryParams,
  QueryStreetsParams,
  QueryByIdParams,
  QueryAdminBoundariesWithinAreaParams,
} from '../interfaces/overpass.interface';

@Injectable()
export class CachedOverpassApiService implements IOverpassApiService {
  private readonly logger = new Logger(CachedOverpassApiService.name);
  private readonly cacheDir: string;
  private readonly mode: 'read' | 'write' | 'strict';

  constructor(
    private readonly configService: ConfigService,
    @Inject('RealOverpassApiService')
    private readonly realService: IOverpassApiService,
  ) {
    const storagePath =
      this.configService.get<string>('STORAGE_PATH') ||
      path.join(process.cwd(), 'storage');
    this.cacheDir = path.join(storagePath, 'osm-cache');
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
        `[CachedOverpassApiService] Cache hit for ${method} (${key})`,
      );
      const content = fs.readFileSync(cachePath, 'utf-8');
      return JSON.parse(content);
    }

    if (this.mode === 'strict') {
      throw new Error(
        `[CachedOverpassApiService] Strict mode: Cache miss for ${method} (${key}) and real API calls are disabled.`,
      );
    }

    this.logger.log(
      `[CachedOverpassApiService] Cache miss for ${method} (${key}). Calling real API...`,
    );
    const result = await executor();

    if (this.mode === 'write') {
      try {
        fs.writeFileSync(cachePath, JSON.stringify(result, null, 2));
        this.logger.log(
          `[CachedOverpassApiService] Cached response for ${method} (${key})`,
        );
      } catch (err) {
        this.logger.error(`Failed to write cache: ${err.message}`);
      }
    }

    return result;
  }

  async queryBoundaryByName(
    params: QueryBoundaryByNameParams,
  ): Promise<OverpassElement[]> {
    return this.handleRequest('queryBoundaryByName', params, () =>
      this.realService.queryBoundaryByName(params),
    );
  }

  async queryContainingBoundary(
    params: QueryContainingBoundaryParams,
  ): Promise<OverpassElement[]> {
    return this.handleRequest('queryContainingBoundary', params, () =>
      this.realService.queryContainingBoundary(params),
    );
  }

  async queryStreets(params: QueryStreetsParams): Promise<OverpassElement[]> {
    return this.handleRequest('queryStreets', params, () =>
      this.realService.queryStreets(params),
    );
  }

  async queryBoundaryById(params: QueryByIdParams): Promise<OverpassElement[]> {
    return this.handleRequest('queryBoundaryById', params, () =>
      this.realService.queryBoundaryById(params),
    );
  }

  async queryAdminBoundariesWithinArea(
    params: QueryAdminBoundariesWithinAreaParams,
  ): Promise<OverpassElement[]> {
    return this.handleRequest('queryAdminBoundariesWithinArea', params, () =>
      this.realService.queryAdminBoundariesWithinArea(params),
    );
  }

  async queryStreetsWithinArea(
    params: QueryByIdParams,
  ): Promise<OverpassElement[]> {
    return this.handleRequest('queryStreetsWithinArea', params, () =>
      this.realService.queryStreetsWithinArea(params),
    );
  }

  async queryPoisWithinArea(
    params: QueryByIdParams,
  ): Promise<OverpassElement[]> {
    return this.handleRequest('queryPoisWithinArea', params, () =>
      this.realService.queryPoisWithinArea(params),
    );
  }
}
