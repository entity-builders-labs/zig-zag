import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  ActivityEnrichmentResult,
  ActivityPhoto,
  IPhotoEnrichmentProvider,
  PhotoEnrichmentQuery,
} from '../interfaces/photo-enrichment.interface';

interface SerpApiGoogleMapsResponse {
  place_results?: {
    title?: string;
    rating?: number;
    reviews?: number;
    thumbnail?: string;
    photos?: { thumbnail?: string; image?: string }[];
    description?: string;
    snippet?: string;
    open_state?: string;
    hours?: { [day: string]: string };
  };
  local_results?: Array<{
    title?: string;
    rating?: number;
    reviews?: number;
    thumbnail?: string;
    photos?: { thumbnail?: string; image?: string }[];
    snippet?: string;
    description?: string;
  }>;
}

@Injectable()
export class SerpApiPhotoProvider implements IPhotoEnrichmentProvider {
  readonly providerName = 'serpapi';
  private readonly logger = new Logger(SerpApiPhotoProvider.name);
  private readonly apiUrl = 'https://serpapi.com/search.json';

  constructor(private readonly config: ConfigService) {}

  async enrichActivity(
    query: PhotoEnrichmentQuery,
  ): Promise<ActivityEnrichmentResult> {
    const apiKey =
      this.config.get<string>('ai.serpApiKey') || process.env.SERPAPI_API_KEY;

    if (!apiKey) {
      this.logger.warn('SERPAPI_API_KEY not found in config/env');
      return {
        photos: [],
        highlights: [],
        status: 'failed',
        provider: this.providerName,
      };
    }

    const photos: ActivityPhoto[] = [];
    let placeTitle = query.name;
    let snippet = '';
    let rating: number | undefined;
    let reviewsCount: number | undefined;

    try {
      const q = [query.name, query.destinationName, query.destinationCountry]
        .filter(Boolean)
        .join(' ');

      const response = await axios.get<SerpApiGoogleMapsResponse>(
        this.apiUrl,
        {
          params: {
            engine: 'google_maps',
            q,
            api_key: apiKey,
            hl: 'es',
          },
          timeout: 10000,
        },
      );

      const place =
        response.data?.place_results || response.data?.local_results?.[0];

      if (place) {
        placeTitle = place.title || query.name;
        snippet = place.description || place.snippet || '';
        rating = place.rating;
        reviewsCount = place.reviews;

        if (place.photos && place.photos.length > 0) {
          for (const p of place.photos.slice(0, 4)) {
            const imgUrl = p.image || p.thumbnail;
            if (imgUrl) {
              photos.push({
                url: imgUrl,
                thumbnail: p.thumbnail || imgUrl,
                author: 'Google Maps Contributor',
                license: 'Google Maps',
                caption: placeTitle,
                sourceProvider: this.providerName,
              });
            }
          }
        } else if (place.thumbnail) {
          photos.push({
            url: place.thumbnail,
            thumbnail: place.thumbnail,
            author: 'Google Maps Contributor',
            license: 'Google Maps',
            caption: placeTitle,
            sourceProvider: this.providerName,
          });
        }
      }
    } catch (error: any) {
      this.logger.warn(
        `SerpApi photo lookup failed for ${query.name}: ${error.message}`,
      );
    }

    const highlights: string[] = [];
    if (rating && rating >= 4.0) {
      highlights.push(
        `Calificación destacada de ${rating}★ con ${reviewsCount ? reviewsCount.toLocaleString() : 'cientos de'} opiniones verificadas en Google.`,
      );
    }
    if (snippet) {
      highlights.push(snippet);
    } else {
      highlights.push(
        `Ubicación recomendada para disfrutar de ${query.category || 'la propuesta local'}.`,
      );
    }

    const curatorTip = rating
      ? `Punto muy valorado por visitantes locales. Se aconseja chequear horarios antes de asistir.`
      : undefined;

    return {
      photos,
      highlights,
      curatorTip,
      rawExtract: snippet,
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
