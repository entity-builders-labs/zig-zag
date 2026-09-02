import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import {
  DocumentaryPhoto,
  MediaLookupResult,
} from '../interfaces/media.interface';
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
   * Resolves authentic documentary photos using two isolated strategies.
   * A valid empty provider response is cacheable; provider failures are not.
   */
  async findPhotosForExperience(params: {
    name: string;
    destinationLabel?: string;
    latitude: number;
    longitude: number;
  }): Promise<MediaLookupResult> {
    const { name, destinationLabel, latitude, longitude } = params;
    const failures: Array<Extract<MediaLookupResult, { error: string }>> = [];

    const titleKey = `${name} ${destinationLabel || ''}`.trim();
    const isTitleNegative = await this.negativeCache.isNegative(
      'wikimedia_commons',
      'title_search',
      titleKey,
    );

    if (!isTitleNegative) {
      const titleResult = await this.searchByTitle(titleKey);
      if (titleResult.outcome === 'FOUND') return titleResult;
      if (titleResult.outcome === 'AUTHORITATIVE_EMPTY') {
        await this.negativeCache.recordNegative(
          'wikimedia_commons',
          'title_search',
          titleKey,
        );
      } else {
        failures.push(titleResult);
      }
    }

    const geoKey = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    const isGeoNegative = await this.negativeCache.isNegative(
      'wikimedia_commons',
      'geosearch',
      geoKey,
    );

    if (!isGeoNegative) {
      const geoResult = await this.searchByCoordinates(latitude, longitude);
      if (geoResult.outcome === 'FOUND') return geoResult;
      if (geoResult.outcome === 'AUTHORITATIVE_EMPTY') {
        await this.negativeCache.recordNegative(
          'wikimedia_commons',
          'geosearch',
          geoKey,
        );
      } else {
        failures.push(geoResult);
      }
    }

    const retryable = failures.find(
      (result) => result.outcome === 'RETRYABLE_FAILURE',
    );
    if (retryable) return retryable;

    const permanent = failures.find(
      (result) => result.outcome === 'PERMANENT_FAILURE',
    );
    if (permanent) return permanent;

    return { outcome: 'AUTHORITATIVE_EMPTY', photos: [] };
  }

  private async searchByTitle(query: string): Promise<MediaLookupResult> {
    try {
      const response = await axios.get(COMMONS_API_URL, {
        params: {
          action: 'query',
          generator: 'search',
          gsrsearch: query,
          gsrnamespace: 6,
          gsrlimit: 5,
          prop: 'imageinfo',
          iiprop: 'url|size|extmetadata',
          iiurlwidth: 1200,
          format: 'json',
        },
        headers: { 'User-Agent': USER_AGENT },
        timeout: 6000,
      });

      return this.resultFromPhotos(this.parseImageInfoResponse(response.data));
    } catch (error) {
      return this.failureResult(error, `title search "${query}"`);
    }
  }

  private async searchByCoordinates(
    lat: number,
    lon: number,
  ): Promise<MediaLookupResult> {
    try {
      const response = await axios.get(COMMONS_API_URL, {
        params: {
          action: 'query',
          generator: 'geosearch',
          ggscoord: `${lat}|${lon}`,
          ggsradius: 1000,
          ggsnamespace: 6,
          ggslimit: 5,
          prop: 'imageinfo',
          iiprop: 'url|size|extmetadata',
          iiurlwidth: 1200,
          format: 'json',
        },
        headers: { 'User-Agent': USER_AGENT },
        timeout: 6000,
      });

      return this.resultFromPhotos(this.parseImageInfoResponse(response.data));
    } catch (error) {
      return this.failureResult(error, `geosearch [${lat}, ${lon}]`);
    }
  }

  private resultFromPhotos(photos: DocumentaryPhoto[]): MediaLookupResult {
    return photos.length > 0
      ? { outcome: 'FOUND', photos }
      : { outcome: 'AUTHORITATIVE_EMPTY', photos: [] };
  }

  private failureResult(error: unknown, operation: string): MediaLookupResult {
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;
    const code = axiosError.code;
    const errorMessage = String(
      axiosError.message || error || 'Unknown Wikimedia error',
    );
    const retryable =
      status === 429 ||
      (typeof status === 'number' && status >= 500) ||
      code === 'ECONNABORTED' ||
      code === 'ETIMEDOUT' ||
      !status;
    const outcome = retryable ? 'RETRYABLE_FAILURE' : 'PERMANENT_FAILURE';

    this.logger.warn(
      `[WikimediaCommons] ${operation} failed (${outcome}): ${errorMessage}`,
    );
    return { outcome, photos: [], error: errorMessage };
  }

  private parseImageInfoResponse(data: any): DocumentaryPhoto[] {
    const pages = data?.query?.pages;
    if (!pages) return [];

    const photos: DocumentaryPhoto[] = [];
    const nonImageExtensions =
      /\.(pdf|djvu|ogg|ogv|webm|mid|midi|wav|mp3|flac|tiff|tif)$/i;

    for (const pageId of Object.keys(pages)) {
      const page = pages[pageId];
      if (page.title && nonImageExtensions.test(page.title)) {
        continue;
      }

      const imageinfo = page.imageinfo?.[0];
      if (!imageinfo || !imageinfo.thumburl) continue;

      const meta = imageinfo.extmetadata || {};
      const author = stripHtml(
        meta.Artist?.value ||
          meta.Credit?.value ||
          'Wikimedia Commons Contributor',
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
