import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  IWikidataApiService,
  WikidataEntitySummary,
  WikidataLookupOutcome,
  WikidataNearbyPlace,
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
    return (await this.lookupEntitySummaries(qids)).summaries;
  }

  async lookupEntitySummaries(qids: string[]): Promise<WikidataLookupOutcome> {
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
      return {
        summaries: results,
        status: 'success',
        failedQids: new Set(),
        extractFailedQids: new Set(),
      };
    }

    if (this.mode === 'strict') {
      throw new Error(
        `[CachedWikidataApiService] Strict mode: cache miss for QIDs [${missingQids.join(', ')}] and real API calls are disabled.`,
      );
    }

    this.logger.log(
      `[CachedWikidataApiService] Cache miss for ${missingQids.length} QID(s). Calling real API...`,
    );
    const freshOutcome =
      await this.realService.lookupEntitySummaries(missingQids);

    for (const [qid, summary] of freshOutcome.summaries) {
      results.set(qid, summary);
      if (
        this.mode === 'write' &&
        !freshOutcome.failedQids.has(qid) &&
        !freshOutcome.extractFailedQids.has(qid)
      ) {
        this.writeCached(summary);
      }
    }

    return { ...freshOutcome, summaries: results };
  }

  /**
   * Deliberately NOT cached — unlike the QID-keyed narrative lookups above,
   * this is a real-time geographic confirmation signal (cross-source
   * confirmation plan, 2026-09-17) and must stay fresh. Always delegates
   * straight to the real service, in every mode (including 'strict' —
   * there is no cache-miss concept here to enforce against).
   */
  async findNearbyPlaces(
    latitude: number,
    longitude: number,
    radiusMeters: number,
  ): Promise<WikidataNearbyPlace[]> {
    return this.realService.findNearbyPlaces(latitude, longitude, radiusMeters);
  }
}
