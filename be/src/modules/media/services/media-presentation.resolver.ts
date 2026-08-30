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
   * Pure deterministic presentation resolver.
   * Generates DTO representation without touching or mutating the database.
   */
  resolvePresentation(activity: {
    photos?: any;
    knownActivityTypeName?: string | null;
    type?: string | null;
    kind?: string | null;
  }): MediaPresentation {
    const rawPhotos = activity.photos;

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
        const normalizedPhotos: DocumentaryPhoto[] = parsedPhotos.map((p) => {
          if (typeof p === 'string') {
            return {
              url: p,
              provider: 'wikimedia_commons',
            };
          }
          return {
            url: p.url,
            width: p.width,
            height: p.height,
            caption: p.caption,
            author: p.author,
            authorUrl: p.authorUrl,
            license: p.license,
            licenseUrl: p.licenseUrl,
            sourceUrl: p.sourceUrl,
            provider: p.provider || 'wikimedia_commons',
          };
        });

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

    // Resolve curated editorial fallback based on category
    const categoryKey = (
      activity.knownActivityTypeName ||
      activity.type ||
      activity.kind ||
      'default'
    )
      .toLowerCase()
      .trim();

    let matchedFallback = CURATED_CATEGORY_FALLBACKS[categoryKey];
    if (!matchedFallback) {
      // Fuzzy match key substring
      const foundKey = Object.keys(CURATED_CATEGORY_FALLBACKS).find((k) =>
        categoryKey.includes(k),
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
