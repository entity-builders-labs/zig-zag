import { Injectable } from '@nestjs/common';
import { ExperienceEmbeddingIndexerService } from '@shared/ai/services/experience-embedding-indexer.service';
import { ExperienceCatalogService } from './experience-catalog.service';

/**
 * First-class acquisition boundary for the V2 catalog.
 * Tour generation may request a refill, but acquisition itself is reusable by
 * admin jobs and never owns Tour/TourExperience persistence.
 *
 * A successful catalog write is not complete until the semantic index has
 * been attempted. Provider unavailability remains retryable/observable rather
 * than being hidden as a fully indexed catalog population.
 */
@Injectable()
export class ExperienceAcquisitionService {
  constructor(
    private readonly catalog: ExperienceCatalogService,
    private readonly embeddingIndexer: ExperienceEmbeddingIndexerService,
  ) {}

  async acquireNearby(input: {
    latitude: number;
    longitude: number;
    radius: number;
    interests?: string[];
    maxResultCount?: number;
  }) {
    const result = await this.catalog.acquireNearbyAsExperiences(input);
    const embedding = await this.embeddingIndexer.index(result.experienceIds);

    return {
      ...result,
      provenance: {
        ...result.provenance,
        acceptedCount: result.experienceIds.length,
        rejectedCountByReason: {},
        embeddedCount: embedding.indexedIds.length,
        embeddingWriteStatus: embedding.status,
        embeddingFailureReason: embedding.reason,
        embeddingIdentity: embedding.identity,
      },
    };
  }
}
