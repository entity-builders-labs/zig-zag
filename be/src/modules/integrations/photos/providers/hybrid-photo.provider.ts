import { Injectable, Logger } from "@nestjs/common";
import {
  ActivityEnrichmentResult,
  IPhotoEnrichmentProvider,
  PhotoEnrichmentQuery,
} from "../interfaces/photo-enrichment.interface";
import { WikimediaPhotoProvider } from "./wikimedia-photo.provider";
import { SerpApiPhotoProvider } from "./serpapi-photo.provider";
import { MockPhotoProvider } from "./mock-photo.provider";

const CULTURAL_CATEGORIES = new Set([
  "cultural",
  "history",
  "museum",
  "monument",
  "architecture",
  "park",
  "outdoor",
  "church",
  "plaza",
]);

@Injectable()
export class HybridPhotoProvider implements IPhotoEnrichmentProvider {
  readonly providerName = "hybrid";
  private readonly logger = new Logger(HybridPhotoProvider.name);

  constructor(
    private readonly wikimediaProvider: WikimediaPhotoProvider,
    private readonly serpApiProvider: SerpApiPhotoProvider,
    private readonly mockProvider: MockPhotoProvider,
  ) {}

  async enrichActivity(
    query: PhotoEnrichmentQuery,
  ): Promise<ActivityEnrichmentResult> {
    const categoryLower = (query.category || "").toLowerCase();
    const isCultural =
      Boolean(query.wikidataId) ||
      CULTURAL_CATEGORIES.has(categoryLower) ||
      categoryLower.includes("art") ||
      categoryLower.includes("hist") ||
      categoryLower.includes("cultur") ||
      categoryLower.includes("monum");

    // 1. If cultural, query Wikimedia first (Free / CC)
    if (isCultural) {
      this.logger.debug(
        `[HybridPhotoProvider] Routing "${query.name}" to Wikimedia Commons (Cultural)`,
      );
      const wikiResult = await this.wikimediaProvider.enrichActivity(query);
      if (wikiResult.photos.length > 0) {
        return wikiResult;
      }
      this.logger.debug(
        `[HybridPhotoProvider] Wikimedia had no photos for "${query.name}", cascading to SerpApi`,
      );
    }

    // 2. Query SerpApi for commercial/gastronomy or cascade
    this.logger.debug(
      `[HybridPhotoProvider] Routing "${query.name}" to SerpApi (Google Maps Engine)`,
    );
    const serpResult = await this.serpApiProvider.enrichActivity(query);
    if (serpResult.photos.length > 0) {
      return serpResult;
    }

    // 3. Fallback to mock provider to guarantee clean UI experience
    this.logger.debug(
      `[HybridPhotoProvider] Falling back to MockProvider for "${query.name}"`,
    );
    return this.mockProvider.enrichActivity(query);
  }

  async enrichBatch(
    queries: PhotoEnrichmentQuery[],
  ): Promise<Map<string, ActivityEnrichmentResult>> {
    const results = new Map<string, ActivityEnrichmentResult>();
    for (const q of queries) {
      const key = q.id || q.name;
      results.set(key, await this.enrichActivity(q));
    }
    return results;
  }
}
