import { Injectable } from '@nestjs/common';
import { ExperienceCatalogService } from './experience-catalog.service';

/**
 * First-class acquisition boundary for the V2 catalog.
 * Tour generation may request a refill, but acquisition itself is reusable by
 * admin jobs and never owns Tour/TourExperience persistence.
 */
@Injectable()
export class ExperienceAcquisitionService {
  constructor(private readonly catalog: ExperienceCatalogService) {}

  async acquireNearby(input: {
    latitude: number;
    longitude: number;
    radius: number;
    interests?: string[];
    maxResultCount?: number;
  }) {
    const result = await this.catalog.acquireNearbyAsExperiences(input);
    return {
      ...result,
      provenance: {
        ...result.provenance,
        acceptedCount: result.experienceIds.length,
        rejectedCountByReason: {},
      },
    };
  }
}
