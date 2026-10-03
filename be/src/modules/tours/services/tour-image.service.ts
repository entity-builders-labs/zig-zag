import { Injectable, Logger, Optional } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '@core/database/prisma.service';
import { ImageGenerationService } from '@shared/ai/image-generation.service';
import { OutboxService } from '../../outbox/services/outbox.service';
import { WikimediaPhotoProvider } from '../../integrations/photos/providers/wikimedia-photo.provider';
import { generateCoverImagePrompt } from '../prompts/media-generation.prompt';

export type DestinationPhotoProvider =
  | 'wikipedia_search'
  | 'wikipedia_summary'
  | 'wikipedia_geosearch'
  | 'wikimedia';

export interface DestinationPhotoResolution {
  url: string;
  provider: DestinationPhotoProvider;
}

@Injectable()
export class TourImageService {
  private readonly logger = new Logger(TourImageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageGenerationService: ImageGenerationService,
    @Optional() private readonly outboxService?: OutboxService,
    @Optional()
    private readonly wikimediaPhotoProvider?: WikimediaPhotoProvider,
  ) {}

  /**
   * Generate a cover image for a tour.
   *
   * Cover generation is best-effort presentation work, not a reason to fail an
   * otherwise valid Tour. The outcome is nevertheless persisted in Tour
   * metadata before returning/rethrowing so the generation orchestrator may
   * degrade non-fatally without turning the provider failure into a silent
   * catch-and-log only path.
   */
  async generateTourCoverImage(tourId: string): Promise<string | null> {
    const tour = await this.prisma.tour.findUnique({
      where: { id: tourId },
      include: { experiences: { include: { experience: true } } },
    });

    if (!tour) return null;
    if (tour.coverImage) return tour.coverImage;

    this.logger.debug(`Generating cover image for tour: ${tour.name}`);

    const experienceNames = tour.experiences
      .slice(0, 3)
      .map((snapshot) => snapshot.experience.canonicalName)
      .join(', ');

    const prompt = generateCoverImagePrompt(
      tour.name,
      tour.description || tour.name,
      experienceNames,
    );

    try {
      const imageUrl = await this.imageGenerationService.generateImage(prompt);
      const completedAt = new Date().toISOString();

      await this.prisma.tour.update({
        where: { id: tour.id },
        data: {
          ...(imageUrl ? { coverImage: imageUrl } : {}),
          metadata: {
            ...this.objectMetadata(tour.metadata),
            coverImageGeneration: imageUrl
              ? {
                  status: 'generated',
                  provider: 'ImageGenerationService',
                  completedAt,
                }
              : {
                  status: 'not_generated',
                  provider: 'ImageGenerationService',
                  reasonCode: 'PROVIDER_RETURNED_NO_IMAGE',
                  completedAt,
                },
          },
        },
      });

      if (imageUrl) {
        this.logger.log(`Generated and saved cover image for tour ${tourId}`);
      } else {
        this.logger.warn(
          `Cover image provider returned no image for tour ${tourId}`,
        );
      }

      return imageUrl;
    } catch (error: any) {
      const message = error?.message ?? String(error);
      const failedAt = new Date().toISOString();
      try {
        await this.prisma.tour.update({
          where: { id: tour.id },
          data: {
            metadata: {
              ...this.objectMetadata(tour.metadata),
              coverImageGeneration: {
                status: 'failed',
                provider: 'ImageGenerationService',
                reasonCode: 'COVER_IMAGE_PROVIDER_FAILED',
                error: message,
                failedAt,
              },
            },
          },
        });
      } catch (recordingError: any) {
        this.logger.error(
          `Failed to persist cover-image failure for tour ${tourId}: ${recordingError?.message ?? recordingError}`,
        );
      }
      this.logger.warn(`Failed to generate cover image: ${message}`);
      throw error;
    }
  }

  /**
   * Resolve an authentic destination cover image asynchronously.
   *
   * Queries verified sources (Wikimedia Commons, Wikipedia) using the destination
   * coordinates and label. Persists the photo as `coverImage` on the Tour and
   * dispatches an outbox `TourProgressUpdated` event carrying `coverImage` directly
   * so SSE clients receive it with zero round-trip delay.
   */
  async resolveDestinationCoverImage(
    tourId: string,
    destination: { label?: string; latitude?: number; longitude?: number },
  ): Promise<string | null> {
    const tour = await this.prisma.tour.findUnique({
      where: { id: tourId },
      select: {
        id: true,
        name: true,
        ownerId: true,
        coverImage: true,
        metadata: true,
      },
    });

    if (!tour) return null;
    if (tour.coverImage) return tour.coverImage;

    const destinationLabel = destination.label || tour.name;
    this.logger.debug(
      `[TourImageService] Resolving authentic destination photo for tour "${tour.name}" (${destinationLabel})...`,
    );

    try {
      const photoResult = await this.fetchDestinationPhoto(
        destinationLabel,
        destination.latitude,
        destination.longitude,
      );

      const completedAt = new Date().toISOString();

      if (photoResult) {
        await this.prisma.$transaction(async (tx) => {
          const latest = await tx.tour.findUnique({
            where: { id: tour.id },
            select: {
              id: true,
              ownerId: true,
              coverImage: true,
              metadata: true,
            },
          });

          if (!latest) return;
          if (latest.coverImage) {
            // Tour already has a coverImage set; keep it without overwriting.
            return;
          }

          const latestMetadata = this.objectMetadata(latest.metadata);
          const currentStatus =
            typeof latestMetadata.generationStatus === 'string'
              ? latestMetadata.generationStatus
              : 'generating';

          await tx.tour.update({
            where: { id: tour.id },
            data: {
              coverImage: photoResult.url,
              metadata: {
                ...latestMetadata,
                coverImageResolution: {
                  status: 'resolved',
                  provider: photoResult.provider,
                  url: photoResult.url,
                  completedAt,
                },
              },
            },
          });

          if (this.outboxService) {
            await this.outboxService.createInTx(tx, {
              eventType: 'TourProgressUpdated',
              payload: {
                tourId: latest.id,
                userId: latest.ownerId || undefined,
                status: currentStatus,
                coverImage: photoResult.url,
                message: `Foto de ${destinationLabel} obtenida`,
              },
            });
          }
        });

        this.logger.log(
          `[TourImageService] Resolved and saved authentic destination photo for tour ${tourId}: ${photoResult.url}`,
        );
        return photoResult.url;
      }

      await this.prisma.$transaction(async (tx) => {
        const latest = await tx.tour.findUnique({
          where: { id: tour.id },
          select: {
            id: true,
            coverImage: true,
            metadata: true,
          },
        });

        if (!latest) return;
        if (latest.coverImage) return;

        const latestMetadata = this.objectMetadata(latest.metadata);
        await tx.tour.update({
          where: { id: tour.id },
          data: {
            metadata: {
              ...latestMetadata,
              coverImageResolution: {
                status: 'not_resolved',
                reasonCode: 'NO_VERIFIED_PHOTO_FOUND',
                completedAt,
              },
            },
          },
        });
      });

      this.logger.warn(
        `[TourImageService] No verified destination photo found for "${destinationLabel}"`,
      );
      return null;
    } catch (error: any) {
      this.logger.warn(
        `[TourImageService] Failed to resolve destination photo for tour ${tourId}: ${error?.message ?? error}`,
      );
      return null;
    }
  }

  private async fetchDestinationPhoto(
    label?: string,
    latitude?: number,
    longitude?: number,
  ): Promise<DestinationPhotoResolution | null> {
    const USER_AGENT =
      'ZigZagTravelApp/1.0 (https://zigzag.travel; contact@zigzag.travel)';
    const headers = { 'User-Agent': USER_AGENT };

    // 1. Search Wikipedia articles by destination label (prominence search).
    // This finds the main encyclopedic city/region article with its primary landmark/skyline photo,
    // avoiding non-iconic nearby geo-indexed places like football stadiums or local facilities.
    if (label) {
      const parts = label
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const city = parts[0];
      const country = parts.length > 1 ? parts[parts.length - 1] : '';
      const searchQuery =
        country && country.toLowerCase() !== city.toLowerCase()
          ? `${city} ${country}`
          : city;

      if (searchQuery) {
        try {
          const res = await axios.get('https://es.wikipedia.org/w/api.php', {
            params: {
              action: 'query',
              generator: 'search',
              gsrsearch: searchQuery,
              gsrlimit: 6,
              prop: 'pageimages',
              pithumbsize: 1200,
              format: 'json',
            },
            headers,
            timeout: 5000,
          });

          const pages = (
            Object.values(res.data?.query?.pages || {}) as any[]
          ).sort((a, b) => (a.index || 0) - (b.index || 0));

          for (const p of pages) {
            const imgUrl = p.thumbnail?.source || p.originalimage?.source;
            if (imgUrl && this.isIconicDestinationPage(p.title, imgUrl)) {
              return {
                url: imgUrl,
                provider: 'wikipedia_search',
              };
            }
          }
        } catch (err: any) {
          this.logger.debug(
            `[TourImageService] Wikipedia prominence search error for "${searchQuery}": ${err?.message}`,
          );
        }
      }
    }

    // 2. Wikipedia page summary lookup by cleaned city name
    if (label) {
      const cleanCityName = label.split(',')[0].trim();
      if (cleanCityName) {
        try {
          const res = await axios.get(
            `https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanCityName)}`,
            { headers, timeout: 5000 },
          );
          const candidate =
            res.data?.originalimage?.source || res.data?.thumbnail?.source;
          if (
            candidate &&
            this.isIconicDestinationPage(res.data?.title, candidate)
          ) {
            return {
              url: candidate,
              provider: 'wikipedia_summary',
            };
          }
        } catch (err: any) {
          this.logger.debug(
            `[TourImageService] Wikipedia summary lookup error for "${cleanCityName}": ${err?.message}`,
          );
        }
      }
    }

    // 3. Geosearch around coordinates via Wikipedia API (tertiary fallback)
    if (
      latitude != null &&
      longitude != null &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude)
    ) {
      try {
        const res = await axios.get('https://es.wikipedia.org/w/api.php', {
          params: {
            action: 'query',
            generator: 'geosearch',
            ggscoord: `${latitude}|${longitude}`,
            ggsradius: 10000,
            prop: 'pageimages',
            pithumbsize: 1200,
            format: 'json',
          },
          headers,
          timeout: 5000,
        });

        const pages = Object.values(res.data?.query?.pages || {}) as any[];
        for (const p of pages) {
          const imgUrl = p.thumbnail?.source || p.originalimage?.source;
          if (imgUrl && this.isIconicDestinationPage(p.title, imgUrl)) {
            return {
              url: imgUrl,
              provider: 'wikipedia_geosearch',
            };
          }
        }
      } catch (err: any) {
        this.logger.debug(
          `[TourImageService] Wikimedia geosearch error: ${err?.message}`,
        );
      }
    }

    // 4. Fallback to WikimediaPhotoProvider if injected
    if (this.wikimediaPhotoProvider) {
      try {
        const enrichment = await this.wikimediaPhotoProvider.enrichExperience({
          name: label || 'Destino',
          latitude,
          longitude,
        });
        if (enrichment?.photos?.length) {
          const photo = enrichment.photos.find((p: any) =>
            this.isIconicDestinationPage(p.caption || p.title || p.url, p.url),
          );
          if (photo) {
            return {
              url: photo.url,
              provider: 'wikimedia',
            };
          }
        }
      } catch (err: any) {
        this.logger.debug(
          `[TourImageService] WikimediaPhotoProvider fallback error: ${err?.message}`,
        );
      }
    }

    return null;
  }

  private isIconicDestinationPage(title: string, url: string): boolean {
    if (!this.isValidPhotoUrl(url)) return false;
    const lowerTitle = (title || '').toLowerCase();
    const lowerUrl = (url || '').toLowerCase();

    // Reject sports stadiums, football fields, clubs, non-iconic facilities
    const excludedTerms = [
      'estadio',
      'stadium',
      'cancha',
      'arena',
      'club_atletico',
      'club atlético',
      'newell',
      'bielsa',
      'futbol',
      'football',
      'soccer',
      'cementerio',
      'cemetery',
      'hospital',
      'policia',
      'comisaria',
      'penal',
      'carcel',
      'subestacion',
      'apeadero',
    ];

    for (const term of excludedTerms) {
      if (lowerTitle.includes(term) || lowerUrl.includes(term)) {
        return false;
      }
    }

    return true;
  }

  private isValidPhotoUrl(url: string): boolean {
    if (!url) return false;
    const lower = url.toLowerCase();
    return (
      !lower.endsWith('.svg') &&
      !lower.includes('.svg.') &&
      !lower.includes('.svg.png') &&
      !lower.includes('flag_of_') &&
      !lower.includes('bandera_de_') &&
      !lower.includes('escudo_de_') &&
      !lower.includes('coat_of_arms') &&
      !lower.includes('location_map') &&
      !lower.includes('locator_map') &&
      !lower.includes('/logo') &&
      !lower.includes('_logo.')
    );
  }

  private objectMetadata(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
