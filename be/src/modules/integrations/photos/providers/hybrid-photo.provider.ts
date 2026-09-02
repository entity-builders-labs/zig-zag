import { Injectable, Logger } from '@nestjs/common';
import {
  ExperienceEnrichmentResult,
  IPhotoEnrichmentProvider,
  PhotoEnrichmentQuery,
} from '../interfaces/photo-enrichment.interface';
import { WikimediaPhotoProvider } from './wikimedia-photo.provider';
import { SerpApiPhotoProvider } from './serpapi-photo.provider';

@Injectable()
export class HybridPhotoProvider implements IPhotoEnrichmentProvider {
  readonly providerName = 'hybrid';
  private readonly logger = new Logger(HybridPhotoProvider.name);

  constructor(
    private readonly wikimediaProvider: WikimediaPhotoProvider,
    private readonly serpApiProvider: SerpApiPhotoProvider,
  ) {}

  async enrichExperience(
    query: PhotoEnrichmentQuery,
  ): Promise<ExperienceEnrichmentResult> {
    // 1. If activity has coordinates or wikidataId, prioritize Wikimedia Commons verified photos
    if (
      (query.latitude != null && query.longitude != null) ||
      query.wikidataId
    ) {
      this.logger.debug(
        `[HybridPhotoProvider] Checking Wikimedia Commons for "${query.name}"`,
      );
      const wikiResult = await this.wikimediaProvider.enrichExperience(query);
      if (wikiResult.photos.length > 0) {
        return wikiResult;
      }
    }

    // 2. Query SerpApi / Google Maps for verified business / place photos
    this.logger.debug(
      `[HybridPhotoProvider] Checking SerpApi Google Maps for "${query.name}"`,
    );
    const serpResult = await this.serpApiProvider.enrichExperience(query);
    if (serpResult.photos.length > 0) {
      return serpResult;
    }

    // 3. Strict discard policy: If no verified photos are found, return empty array (NEVER inject fake/generic photos)
    this.logger.debug(
      `[HybridPhotoProvider] No verified photos found for "${query.name}". Discarding to avoid incorrect photos.`,
    );
    return {
      photos: [],
      highlights: [],
      status: 'failed',
      provider: this.providerName,
    };
  }

  async enrichBatch(
    queries: PhotoEnrichmentQuery[],
  ): Promise<Map<string, ExperienceEnrichmentResult>> {
    const results = new Map<string, ExperienceEnrichmentResult>();
    for (const q of queries) {
      const key = q.id || q.name;
      results.set(key, await this.enrichExperience(q));
    }
    return results;
  }
}
