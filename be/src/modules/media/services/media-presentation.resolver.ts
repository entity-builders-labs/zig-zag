import { Injectable } from '@nestjs/common';
import {
  DocumentaryPhoto,
  MediaPresentation,
} from '../interfaces/media.interface';

// Curated high-resolution fallback collection (used purely in DTO / Presentation layer)
const CURATED_CATEGORY_FALLBACKS: Record<
  string,
  { url: string; caption: string }
> = {
  tango: {
    url: 'https://images.unsplash.com/photo-1545232979-fbf6786c572b?auto=format&fit=crop&w=1200&q=80',
    caption: 'Tradición y cultura de Tango porteño',
  },
  gastronomy: {
    url: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&q=80',
    caption: 'Gastronomía y cafés tradicionales',
  },
  food: {
    url: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&q=80',
    caption: 'Gastronomía local',
  },
  history: {
    url: 'https://images.unsplash.com/photo-1589802829985-817e51171b92?auto=format&fit=crop&w=1200&q=80',
    caption: 'Patrimonio histórico y colonial',
  },
  architecture: {
    url: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=1200&q=80',
    caption: 'Arquitectura urbana y monumentos',
  },
  museum: {
    url: 'https://images.unsplash.com/photo-1566127444979-b3d2b654e3d7?auto=format&fit=crop&w=1200&q=80',
    caption: 'Arte y colecciones culturales',
  },
  park: {
    url: 'https://images.unsplash.com/photo-1519331379826-f10be5486c6f?auto=format&fit=crop&w=1200&q=80',
    caption: 'Espacios verdes y paseos al aire libre',
  },
  default: {
    url: 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=1200&q=80',
    caption: 'Experiencia y descubrimiento turístico',
  },
};

@Injectable()
export class MediaPresentationResolver {
  /**
   * Pure deterministic presentation resolver. `media` is the canonical V2
   * persisted URL relation; `photos` remains a read-only compatibility input
   * for old DTO/tests while cutover is completed.
   */
  resolvePresentation(experience: {
    media?: any[];
    photos?: any;
    traits?: Array<string | { label?: string }>;
    metadata?: { category?: string; primaryType?: string } | null;
  }): MediaPresentation {
    const rawPhotos = experience.media?.length
      ? [...experience.media].sort(
          (left, right) => (left.position ?? 0) - (right.position ?? 0),
        )
      : experience.photos;

    if (rawPhotos) {
      let parsedPhotos: any[] = [];
      if (Array.isArray(rawPhotos)) {
        parsedPhotos = rawPhotos;
      } else if (typeof rawPhotos === 'string') {
        try {
          parsedPhotos = JSON.parse(rawPhotos);
        } catch {
          parsedPhotos = [];
        }
      }

      if (parsedPhotos.length > 0) {
        const normalizedPhotos: DocumentaryPhoto[] = parsedPhotos
          .filter((photo) => typeof photo === 'string' || photo?.url)
          .map((photo) => {
            if (typeof photo === 'string') {
              return {
                url: photo,
                provider: 'wikimedia_commons',
              };
            }
            return {
              url: photo.url,
              width: photo.width,
              height: photo.height,
              caption: photo.caption,
              author: photo.author,
              authorUrl: photo.authorUrl,
              license: photo.license,
              licenseUrl: photo.licenseUrl,
              sourceUrl: photo.sourceUrl,
              provider: photo.provider || 'wikimedia_commons',
            };
          });

        if (normalizedPhotos.length > 0) {
          const primary = normalizedPhotos[0];
          return {
            photos: normalizedPhotos,
            primaryPhoto: {
              url: primary.url,
              caption: primary.caption,
              author: primary.author,
              license: primary.license,
              licenseUrl: primary.licenseUrl,
              isFallback: false,
            },
            source: 'DOCUMENTARY',
          };
        }
      }
    }

    const categoryKey = (
      experience.metadata?.category ||
      experience.metadata?.primaryType ||
      experience.traits
        ?.map((trait) => (typeof trait === 'string' ? trait : trait.label))
        .find(Boolean) ||
      'default'
    )
      .toLowerCase()
      .trim();

    let matchedFallback = CURATED_CATEGORY_FALLBACKS[categoryKey];
    if (!matchedFallback) {
      const foundKey = Object.keys(CURATED_CATEGORY_FALLBACKS).find((key) =>
        categoryKey.includes(key),
      );
      matchedFallback = foundKey
        ? CURATED_CATEGORY_FALLBACKS[foundKey]
        : CURATED_CATEGORY_FALLBACKS.default;
    }

    return {
      photos: [],
      primaryPhoto: {
        url: matchedFallback.url,
        caption: matchedFallback.caption,
        author: 'Curated Editorial Collection',
        license: 'Unsplash / CC Editorial',
        isFallback: true,
      },
      source: 'CURATED_FALLBACK',
    };
  }
}
