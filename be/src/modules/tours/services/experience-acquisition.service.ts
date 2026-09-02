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

  acquireNearby(input: {
    latitude: number;
    longitude: number;
    radius: number;
    interests?: string[];
    maxResultCount?: number;
  }) {
    return this.catalog.acquireNearbyAsExperiences(input);
  }
}
