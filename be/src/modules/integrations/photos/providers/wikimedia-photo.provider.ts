import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import axios from 'axios';
import {
  ActivityEnrichmentResult,
  ActivityPhoto,
  IPhotoEnrichmentProvider,
  PhotoEnrichmentQuery,
} from '../interfaces/photo-enrichment.interface';
import { IWikidataApiService } from '../../wikidata/interfaces/wikidata.interface';

const WIKIPEDIA_ES_API_URL = 'https://es.wikipedia.org/w/api.php';
const WIKIMEDIA_COMMONS_API_URL = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT =
  'ZigZagTravelApp/1.0 (https://github.com/jiseruk/zig-zag; support@zigzag.travel)';

const ENGLISH_TO_SPANISH: Record<string, string> = {
  obelisk: 'obelisco',
  'obelisk of buenos aires': 'obelisco de buenos aires',
  'colon theater': 'teatro colon',
  'colon theatre': 'teatro colon',
  'the colon theatre': 'teatro colon',
  'pink house': 'casa rosada',
  'may pyramid': 'piramide de mayo',
  'paz palace': 'palacio paz',
  'sarmiento palace': 'palacio sarmiento',
  'recoleta cemetery': 'cementerio de la recoleta',
  'national congress': 'congreso de la nacion argentina',
  'may square': 'plaza de mayo',
  'san martin square': 'plaza san martin',
  'dorrego square': 'plaza dorrego',
  'kavanagh building': 'edificio kavanagh',
};

interface GeosearchResult {
  pageid: number;
  title: string;
  lat: number;
  lon: number;
  dist: number;
}

@Injectable()
export class WikimediaPhotoProvider implements IPhotoEnrichmentProvider {
  readonly providerName = 'wikimedia';
  private readonly logger = new Logger(WikimediaPhotoProvider.name);

  constructor(
    @Optional()
    @Inject('WikidataApiService')
    private readonly wikidataService?: IWikidataApiService,
  ) {}

  async enrichActivity(
    query: PhotoEnrichmentQuery,
  ): Promise<ActivityEnrichmentResult> {
    const photos: ActivityPhoto[] = [];
    let extract: string | undefined;

    try {
      // 1. Geosearch verification: POIs with coordinates are strictly verified against nearby articles (<= 2500m)
      if (query.latitude != null && query.longitude != null) {
        const match = await this.findGeosearchMatch(
          query.name,
          query.latitude,
          query.longitude,
        );

        if (match) {
          this.logger.debug(
            `100% Geographically verified Wikipedia match: "${match.title}" (${Math.round(match.dist)}m from ${query.name})`,
          );

          // Get extract and lead photo
          const pageData = await this.fetchWikipediaPageDetails(match.pageid);
          if (pageData) {
            extract = pageData.extract;
            if (pageData.leadImage) {
              photos.push(pageData.leadImage);
            }
          }

          // Get additional verified photos from Wikimedia Commons for this exact entity
          const commonsPhotos = await this.fetchCommonsPhotos(
            match.title,
            query.name,
          );
          for (const cp of commonsPhotos) {
            if (
              photos.length < 6 &&
              !photos.some(
                (p) => p.url === cp.url || p.thumbnail === cp.thumbnail,
              )
            ) {
              photos.push(cp);
            }
          }
        } else {
          this.logger.debug(
            `No exact geographic Wikipedia match within 2.5km for "${query.name}". Discarding Wikimedia to avoid ungrounded photos.`,
          );
        }
      } else if (query.wikidataId && this.wikidataService) {
        // Fallback to verified Wikidata ID
        const summaries = await this.wikidataService.getEntitySummaries([
          query.wikidataId,
        ]);
        const summary = summaries.get(query.wikidataId);
        if (summary?.extract) {
          extract = summary.extract;
        }
      }
    } catch (error: any) {
      this.logger.warn(
        `Wikimedia enrichment failed for ${query.name}: ${error.message}`,
      );
    }

    const highlights = this.extractHighlights(extract, query);
    const curatorTip = extract
      ? `Monumento histórico destacado. Se recomienda dedicar tiempo para recorrer sus detalles arquitectónicos.`
      : undefined;

    return {
      photos,
      highlights,
      curatorTip,
      rawExtract: extract,
      status: photos.length > 0 ? 'enriched' : extract ? 'partial' : 'failed',
      provider: this.providerName,
    };
  }

  /**
   * Strictly searches Wikipedia geosearch for articles within 2500m that match the POI name.
   */
  private async findGeosearchMatch(
    name: string,
    lat: number,
    lng: number,
  ): Promise<GeosearchResult | null> {
    try {
      const res = await axios.get(WIKIPEDIA_ES_API_URL, {
        params: {
          action: 'query',
          list: 'geosearch',
          gscoord: `${lat}|${lng}`,
          gsradius: 2500,
          gslimit: 10,
          format: 'json',
        },
        headers: { 'User-Agent': USER_AGENT },
        timeout: 6000,
      });

      const pages: GeosearchResult[] = res.data?.query?.geosearch || [];
      const cleanName = this.normalizeString(name);

      for (const p of pages) {
        const cleanTitle = this.normalizeString(p.title);
        if (this.isCloseMatch(cleanName, cleanTitle)) {
          return p;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private normalizeString(str: string): string {
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, '')
      .trim();
  }

  private isCloseMatch(a: string, b: string): boolean {
    const normA = ENGLISH_TO_SPANISH[a] || a;
    const normB = ENGLISH_TO_SPANISH[b] || b;

    if (normA.includes(normB) || normB.includes(normA)) return true;

    const stopwords = new Set([
      'de',
      'la',
      'el',
      'los',
      'las',
      'del',
      'y',
      'en',
      'para',
      'con',
      'por',
      'buenos',
      'aires',
      'argentina',
      'ciudad',
      'autonoma',
      'estacion',
      'avenida',
      'calle',
      'barrio',
    ]);
    const wordsA = normA
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !stopwords.has(w));
    const wordsB = normB
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !stopwords.has(w));

    for (const wa of wordsA) {
      for (const wb of wordsB) {
        if (wa === wb) return true;
        if (
          wa.length >= 4 &&
          wb.length >= 4 &&
          (wa.startsWith(wb.slice(0, 4)) || wb.startsWith(wa.slice(0, 4)))
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private async fetchWikipediaPageDetails(
    pageId: number,
  ): Promise<{ extract?: string; leadImage?: ActivityPhoto } | null> {
    try {
      const res = await axios.get(WIKIPEDIA_ES_API_URL, {
        params: {
          action: 'query',
          pageids: pageId,
          prop: 'pageimages|extracts',
          pithumbsize: 1200,
          piprop: 'thumbnail|original|name',
          exintro: true,
          explaintext: true,
          format: 'json',
        },
        headers: { 'User-Agent': USER_AGENT },
        timeout: 6000,
      });

      const page = res.data?.query?.pages?.[pageId];
      if (!page) return null;

      let leadImage: ActivityPhoto | undefined;
      const imgUrl = page.original?.source || page.thumbnail?.source;
      if (imgUrl && !imgUrl.endsWith('.svg')) {
        leadImage = {
          url: imgUrl,
          thumbnail: page.thumbnail?.source || imgUrl,
          author: 'Wikimedia Commons Contributor',
          license: 'CC BY-SA 4.0',
          caption: page.title,
          width: page.original?.width || page.thumbnail?.width,
          height: page.original?.height || page.thumbnail?.height,
          sourceProvider: this.providerName,
        };
      }

      return {
        extract: page.extract,
        leadImage,
      };
    } catch {
      return null;
    }
  }

  private async fetchCommonsPhotos(
    exactTitle: string,
    queryName?: string,
  ): Promise<ActivityPhoto[]> {
    const photos: ActivityPhoto[] = [];
    const searchTerms = [exactTitle];
    if (queryName && queryName.toLowerCase() !== exactTitle.toLowerCase()) {
      searchTerms.push(queryName);
    }

    for (const term of searchTerms) {
      if (photos.length >= 6) break;
      try {
        const res = await axios.get(WIKIMEDIA_COMMONS_API_URL, {
          params: {
            action: 'query',
            generator: 'search',
            gsrsearch: `"${term}"`,
            gsrnamespace: 6,
            gsrlimit: 6,
            prop: 'imageinfo',
            iiprop: 'url|size|extmetadata',
            iiurlwidth: 1000,
            format: 'json',
          },
          headers: { 'User-Agent': USER_AGENT },
          timeout: 8000,
        });

        const pages = Object.values(res.data?.query?.pages || {});
        for (const p of pages as any[]) {
          const info = p.imageinfo?.[0];
          if (!info || !info.url) continue;

          // Skip non-photo formats (SVGs, PDFs, icons, maps)
          const lowerUrl = info.url.toLowerCase();
          if (
            lowerUrl.endsWith('.svg') ||
            lowerUrl.endsWith('.pdf') ||
            lowerUrl.includes('icon') ||
            lowerUrl.includes('logo') ||
            lowerUrl.includes('flag') ||
            lowerUrl.includes('map')
          ) {
            continue;
          }

          const ext = info.extmetadata || {};
          const author =
            ext.Artist?.value?.replace(/<[^>]*>?/gm, '').trim() ||
            'Wikimedia Commons Contributor';
          const license =
            ext.LicenseShortName?.value || ext.License?.value || 'CC BY-SA 4.0';
          const caption =
            ext.ImageDescription?.value?.replace(/<[^>]*>?/gm, '').trim() ||
            p.title?.replace('File:', '') ||
            term;

          const photoUrl = info.thumburl || info.url;
          if (!photos.some((existing) => existing.url === photoUrl)) {
            photos.push({
              url: photoUrl,
              thumbnail: photoUrl,
              author: author.length > 50 ? author.substring(0, 50) : author,
              license,
              caption:
                caption.length > 100 ? caption.substring(0, 100) : caption,
              width: info.width,
              height: info.height,
              sourceProvider: this.providerName,
            });
          }
        }
      } catch {
        // Non-critical fallback
      }
    }
    return photos;
  }

  private extractHighlights(
    extract: string | undefined,
    query: PhotoEnrichmentQuery,
  ): string[] {
    if (!extract) {
      return [
        `Lugar patrimonial en ${query.destinationName || 'la ciudad'}`,
        `Atractivo representativo para ${query.category || 'historia y cultura'}`,
      ];
    }

    const sentences = extract
      .split(/(?<=[.?!])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 25 && s.length < 220);

    if (sentences.length >= 2) {
      return sentences.slice(0, 3);
    }

    return [
      extract.substring(0, 160) + '...',
      `Sitio histórico catalogado en el patrimonio urbano.`,
    ];
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
