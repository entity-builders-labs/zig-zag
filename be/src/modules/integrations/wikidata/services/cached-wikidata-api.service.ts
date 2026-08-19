import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  IWikidataApiService,
  WikidataEntitySummary,
} from '../interfaces/wikidata.interface';

/**
 * Caches per QID individually, not per batch — unlike CachedPlacesApiService
 * / CachedOverpassApiService, where the cache key is a hash of the whole
 * request. If the cache were keyed by "the batch of QIDs requested this
 * time", any change to the candidate pool (a different set of QIDs) would
 * be a full cache miss even when most of those QIDs were already resolved
 * before — exactly the cache-defeating behavior a per-entity key avoids.
 */
@Injectable()
export class CachedWikidataApiService implements IWikidataApiService {
  private readonly logger = new Logger(CachedWikidataApiService.name);
  private readonly cacheDir: string;
  private readonly mode: 'read' | 'write' | 'strict';

  constructor(
    private readonly configService: ConfigService,
    @Inject('RealWikidataApiService')
    private readonly realService: IWikidataApiService,
  ) {
    const storagePath =
      this.configService.get<string>('STORAGE_PATH') ||
      path.join(process.cwd(), 'storage');
    this.cacheDir = path.join(storagePath, 'wikidata-cache');
    this.mode =
      (this.configService.get<string>('MOCK_MAPS_MODE') as any) || 'read';

    this.ensureCacheDir();
  }

  private ensureCacheDir() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private getCachePath(qid: string): string {
    return path.join(this.cacheDir, `${qid}.json`);
  }

  private readCached(qid: string): WikidataEntitySummary | null {
    const cachePath = this.getCachePath(qid);
    if (!fs.existsSync(cachePath)) return null;
    return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  }

  private writeCached(summary: WikidataEntitySummary): void {
    try {
      fs.writeFileSync(
        this.getCachePath(summary.qid),
        JSON.stringify(summary, null, 2),
      );
    } catch (err) {
      this.logger.error(`Failed to write cache: ${err.message}`);
    }
  }

  async getEntitySummaries(
    qids: string[],
  ): Promise<Map<string, WikidataEntitySummary>> {
    const uniqueQids = Array.from(new Set(qids)).filter(Boolean);
    const results = new Map<string, WikidataEntitySummary>();
    const missingQids: string[] = [];

    for (const qid of uniqueQids) {
      const cached = this.readCached(qid);
      if (cached) {
        this.logger.log(`[CachedWikidataApiService] Cache hit for ${qid}`);
        results.set(qid, cached);
      } else {
        missingQids.push(qid);
      }
    }

    if (missingQids.length === 0) {
      return results;
    }

    if (this.mode === 'strict') {
      throw new Error(
        `[CachedWikidataApiService] Strict mode: cache miss for QIDs [${missingQids.join(', ')}] and real API calls are disabled.`,
      );
    }

    this.logger.log(
      `[CachedWikidataApiService] Cache miss for ${missingQids.length} QID(s). Calling real API...`,
    );
    const fresh = await this.realService.getEntitySummaries(missingQids);

    for (const [qid, summary] of fresh) {
      results.set(qid, summary);
      if (this.mode === 'write') {
        this.writeCached(summary);
      }
    }

    return results;
  }
}
