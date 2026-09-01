import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  ActivityEnrichmentResult,
  ActivityPhoto,
  IPhotoEnrichmentProvider,
  PhotoEnrichmentQuery,
} from '../interfaces/photo-enrichment.interface';

@Injectable()
export class GooglePlacesPhotoProvider implements IPhotoEnrichmentProvider {
  readonly providerName = 'google_places';
  private readonly logger = new Logger(GooglePlacesPhotoProvider.name);

  constructor(private readonly config: ConfigService) {}

  async enrichActivity(
    query: PhotoEnrichmentQuery,
  ): Promise<ActivityEnrichmentResult> {
    const apiKey =
      this.config.get<string>('googleMapsApiKey') ||
      this.config.get<string>('GOOGLE_MAPS_API_KEY') ||
      process.env.GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      this.logger.warn('GOOGLE_MAPS_API_KEY not found in config/env');
      return {
        photos: [],
        highlights: [],
        status: 'failed',
        provider: this.providerName,
      };
    }

    const photos: ActivityPhoto[] = [];

    try {
      if (query.placeId) {
        const detailsUrl = `https://places.googleapis.com/v1/places/${query.placeId}`;
        const resp = await axios.get(detailsUrl, {
          headers: {
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask':
              'photos,displayName,editorialSummary,rating,userRatingCount',
          },
          timeout: 8000,
        });

        const placeData = resp.data;
        if (placeData?.photos && placeData.photos.length > 0) {
          for (const photo of placeData.photos.slice(0, 3)) {
            const photoName = photo.name; // places/{place_id}/photos/{photo_reference}
            const photoUrl = `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=1000&maxWidthPx=1200&key=${apiKey}`;
            const thumbUrl = `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=400&maxWidthPx=400&key=${apiKey}`;

            photos.push({
              url: photoUrl,
              thumbnail: thumbUrl,
              author:
                photo.authorAttributions?.[0]?.displayName || 'Google Places',
              license: 'Google Places API',
              caption: placeData.displayName?.text || query.name,
              sourceProvider: this.providerName,
            });
          }
        }
      }
    } catch (error: any) {
      this.logger.warn(
        `Google Places photo lookup failed for ${query.name}: ${error.message}`,
      );
    }

    const highlights: string[] = [
      `Punto verificado en Google Places con alta reputación.`,
      `Ubicación: ${query.formattedAddress || query.name}`,
    ];

    return {
      photos,
      highlights,
      status: photos.length > 0 ? 'enriched' : 'failed',
      provider: this.providerName,
    };
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
