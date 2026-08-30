import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { DocumentaryPhoto } from '../interfaces/media.interface';
import { NegativeCacheService } from './negative-cache.service';

const COMMONS_API_URL = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'ZigZagApp/1.0 (+https://github.com/jiseruk/zig-zag)';

function stripHtml(html?: string): string | undefined {
  if (!html) return undefined;
  return html.replace(/<[^>]*>?/gm, '').trim();
}

@Injectable()
export class WikimediaCommonsService {
  private readonly logger = new Logger(WikimediaCommonsService.name);

  constructor(private readonly negativeCache: NegativeCacheService) {}

  /**
   * Resolves authentic documentary photos for a given POI/activity.
   * Uses multi-strategy lookup:
   * Strategy 1: Search by exact name & destination label.
   * Strategy 2: Geo-search around coordinates if title yields nothing.
   */
  async findPhotosForActivity(params: {
    name: string;
    destinationLabel?: string;
    latitude: number;
    longitude: number;
  }): Promise<DocumentaryPhoto[]> {
    const { name, destinationLabel, latitude, longitude } = params;

    // 1. Try Title Search Strategy
    const titleKey = `${name} ${destinationLabel || ''}`.trim();
    const isTitleNegative = await this.negativeCache.isNegative(
      'wikimedia_commons',
      'title_search',
      titleKey,
    );

    if (!isTitleNegative) {
      const titlePhotos = await this.searchByTitle(titleKey);
      if (titlePhotos.length > 0) {
        return titlePhotos;
      }
      // Negative cache for title search
      await this.negativeCache.recordNegative(
        'wikimedia_commons',
        'title_search',
        titleKey,
      );
    }

    // 2. Try Geo-search Strategy
    const geoKey = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    const isGeoNegative = await this.negativeCache.isNegative(
      'wikimedia_commons',
      'geosearch',
      geoKey,
    );

    if (!isGeoNegative) {
      const geoPhotos = await this.searchByCoordinates(latitude, longitude);
      if (geoPhotos.length > 0) {
        return geoPhotos;
      }
      // Negative cache for geosearch
      await this.negativeCache.recordNegative(
        'wikimedia_commons',
        'geosearch',
        geoKey,
      );
    }

    return [];
  }

  /**
   * Searches Wikimedia Commons by title query.
   */
  private async searchByTitle(query: string): Promise<DocumentaryPhoto[]> {
    try {
      const response = await axios.get(COMMONS_API_URL, {
        params: {
          action: 'query',
          generator: 'search',
          gsrsearch: query,
          gsrnamespace: 6, // File namespace
          gsrlimit: 5,
          prop: 'imageinfo',
          iiprop: 'url|size|extmetadata',
          iiurlwidth: 1200,
          format: 'json',
        },
        headers: { 'User-Agent': USER_AGENT },
        timeout: 6000,
      });

      return this.parseImageInfoResponse(response.data);
    } catch (error) {
      this.logger.warn(
        `[WikimediaCommons] Title search failed for "${query}": ${error?.message || error}`,
      );
      return [];
    }
  }

  /**
   * Searches Wikimedia Commons by GPS coordinates (radius 1000m).
   */
  private async searchByCoordinates(
    lat: number,
    lon: number,
  ): Promise<DocumentaryPhoto[]> {
    try {
      const response = await axios.get(COMMONS_API_URL, {
        params: {
          action: 'query',
          generator: 'geosearch',
          ggscoord: `${lat}|${lon}`,
          ggsradius: 1000, // 1000 meters radius
          ggsnamespace: 6, // File namespace
          ggslimit: 5,
          prop: 'imageinfo',
          iiprop: 'url|size|extmetadata',
          iiurlwidth: 1200,
          format: 'json',
        },
        headers: { 'User-Agent': USER_AGENT },
        timeout: 6000,
      });

      return this.parseImageInfoResponse(response.data);
    } catch (error) {
      this.logger.warn(
        `[WikimediaCommons] Geo-search failed for [${lat}, ${lon}]: ${error?.message || error}`,
      );
      return [];
    }
  }

  private parseImageInfoResponse(data: any): DocumentaryPhoto[] {
    const pages = data?.query?.pages;
    if (!pages) return [];

    const photos: DocumentaryPhoto[] = [];
    const nonImageExtensions = /\.(pdf|djvu|ogg|ogv|webm|mid|midi|wav|mp3|flac|tiff|tif)$/i;

    for (const pageId of Object.keys(pages)) {
      const page = pages[pageId];
      if (page.title && nonImageExtensions.test(page.title)) {
        continue; // Skip non-image files
      }

      const imageinfo = page.imageinfo?.[0];
      if (!imageinfo || !imageinfo.thumburl) continue;

      const meta = imageinfo.extmetadata || {};
      const author = stripHtml(
        meta.Artist?.value || meta.Credit?.value || 'Wikimedia Commons Contributor',
      );
      const license = meta.LicenseShortName?.value || 'Creative Commons';
      const licenseUrl = meta.LicenseUrl?.value;
      const caption = stripHtml(
        meta.ObjectName?.value || meta.ImageDescription?.value || page.title,
      );

      photos.push({
        url: imageinfo.thumburl,
        width: imageinfo.thumbwidth || imageinfo.width,
        height: imageinfo.thumbheight || imageinfo.height,
        caption,
        author,
        authorUrl: undefined,
        license,
        licenseUrl,
        sourceUrl: imageinfo.descriptionurl,
        provider: 'wikimedia_commons',
      });
    }

    return photos;
  }
}
