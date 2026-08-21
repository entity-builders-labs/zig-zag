import { Inject, Injectable, Logger } from '@nestjs/common';
import { Activity } from '@prisma/client';
import {
  OsmPlacesService,
  OsmCandidate,
} from '@integrations/osm/services/osm-places.service';
import { CompositeActivityService } from '@activities/services/composite-activity.service';
import { INominatimApiService } from '@integrations/osm/interfaces/nominatim.interface';

// Nominatim's own place classification for a destination big enough to have
// internal structure worth exploring — see docs/superpowers/specs/
// 2026-08-21-activity-engine-design.md, "Destination resolution". Anything
// finer-grained (a house, a specific amenity) or a state/country (out of
// scope per the design) falls back to point-scale.
const AREA_SCALE_ADDRESS_TYPES = new Set(['city', 'town', 'village']);

export type DestinationResolution =
  | { scale: 'point' }
  | { scale: 'area'; areaActivity: Activity; boundary: OsmCandidate };

@Injectable()
export class DestinationResolutionService {
  private readonly logger = new Logger(DestinationResolutionService.name);

  constructor(
    @Inject('NominatimApiService')
    private readonly nominatimApi: INominatimApiService,
    private readonly osmPlacesService: OsmPlacesService,
    private readonly compositeActivityService: CompositeActivityService,
  ) {}

  /**
   * Point-scale vs. area-scale, per the design's core reframing: a city
   * should never collapse to a point+radius. Degrades to point-scale (never
   * throws) on any failure — this must never block the point-scale flow
   * that already works today.
   */
  async resolveDestination(
    destinationText: string | undefined,
  ): Promise<DestinationResolution> {
    if (!destinationText) return { scale: 'point' };

    try {
      const results = await this.nominatimApi.search(destinationText);
      const best = results[0];
      if (!best || !AREA_SCALE_ADDRESS_TYPES.has(best.addresstype)) {
        return { scale: 'point' };
      }

      const boundary = await this.osmPlacesService.getBoundaryById(
        best.osmType as 'way' | 'relation',
        best.osmId,
      );
      if (!boundary) return { scale: 'point' };

      const areaActivity =
        await this.compositeActivityService.resolveArea(boundary);
      return { scale: 'area', areaActivity, boundary };
    } catch (error: any) {
      this.logger.warn(
        `Destination resolution failed for "${destinationText}", falling back to point-scale: ${error.message}`,
      );
      return { scale: 'point' };
    }
  }
}
