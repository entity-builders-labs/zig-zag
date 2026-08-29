import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  INominatimApiService,
  NominatimResult,
} from '../interfaces/nominatim.interface';

@Injectable()
export class CachedNominatimApiService implements INominatimApiService {
  private readonly logger = new Logger(CachedNominatimApiService.name);
  private readonly cacheDir: string;
  private readonly mode: 'read' | 'write' | 'strict';

  constructor(
    private readonly configService: ConfigService,
    @Inject('RealNominatimApiService')
    private readonly realService: INominatimApiService,
  ) {
    const storagePath =
      this.configService.get<string>('STORAGE_PATH') ||
      path.join(process.cwd(), 'storage');
    this.cacheDir = path.join(storagePath, 'nominatim-cache');
    this.mode =
      (this.configService.get<string>('MOCK_MAPS_MODE') as any) || 'read';

    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private getCachePath(query: string): string {
    const hash = crypto.createHash('md5').update(query).digest('hex');
    return path.join(this.cacheDir, `search-${hash}.json`);
  }

  private getReverseCachePath(latitude: number, longitude: number): string {
    return this.getCachePath(
      `reverse:${latitude.toFixed(6)},${longitude.toFixed(6)}`,
    );
  }

  async search(query: string): Promise<NominatimResult[]> {
    const cachePath = this.getCachePath(query);

    if (fs.existsSync(cachePath)) {
      this.logger.log(`[CachedNominatimApiService] Cache hit for "${query}"`);
      return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    }

    if (this.mode === 'strict') {
      throw new Error(
        `[CachedNominatimApiService] Strict mode: cache miss for "${query}" and real API calls are disabled.`,
      );
    }

    this.logger.log(
      `[CachedNominatimApiService] Cache miss for "${query}". Calling real API...`,
    );
    const result = await this.realService.search(query);

    if (this.mode === 'write') {
      try {
        fs.writeFileSync(cachePath, JSON.stringify(result, null, 2));
      } catch (err: any) {
        this.logger.error(`Failed to write Nominatim cache: ${err.message}`);
      }
    }

    return result;
  }

  async reverse(
    latitude: number,
    longitude: number,
  ): Promise<NominatimResult | null> {
    const cachePath = this.getReverseCachePath(latitude, longitude);

    if (fs.existsSync(cachePath)) {
      this.logger.log(
        `[CachedNominatimApiService] Reverse cache hit for ${latitude},${longitude}`,
      );
      return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    }

    if (this.mode === 'strict') {
      throw new Error(
        `[CachedNominatimApiService] Strict mode: reverse cache miss for ${latitude},${longitude} and real API calls are disabled.`,
      );
    }

    const result = await this.realService.reverse(latitude, longitude);
    if (this.mode === 'write') {
      try {
        fs.writeFileSync(cachePath, JSON.stringify(result, null, 2));
      } catch (err: any) {
        this.logger.error(
          `Failed to write Nominatim reverse cache: ${err.message}`,
        );
      }
    }

    return result;
  }
}
