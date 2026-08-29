import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import axios from 'axios';
import {
  ActivityEnrichmentResult,
  ActivityPhoto,
  IPhotoEnrichmentProvider,
  PhotoEnrichmentQuery,
} from '../interfaces/photo-enrichment.interface';
import { IWikidataApiService } from '../../wikidata/interfaces/wikidata.interface';

const WIKIPEDIA_API_URL = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = 'ZigZagApp/1.0 (+https://github.com/jiseruk/zig-zag)';

interface WikipediaPageImagesResponse {
  query?: {
    pages?: Record<
      string,
      {
        pageid?: number;
        title?: string;
        extract?: string;
        thumbnail?: { source: string; width: number; height: number };
        original?: { source: string; width: number; height: number };
      }
    >;
  };
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
      // 1. If wikidataId is present and wikidataService is available, try getting summary
      if (query.wikidataId && this.wikidataService) {
        const summaries = await this.wikidataService.getEntitySummaries([
          query.wikidataId,
        ]);
        const summary = summaries.get(query.wikidataId);
        if (summary?.extract) {
          extract = summary.extract;
        }
      }

      // 2. Query Wikipedia API directly for images and extracts if needed
      const searchTitle = query.name;
      const wpResponse = await axios.get<WikipediaPageImagesResponse>(
        WIKIPEDIA_API_URL,
        {
          params: {
            action: 'query',
            generator: 'search',
            gsrsearch: searchTitle,
            gsrlimit: 1,
            prop: 'pageimages|extracts',
            pithumbsize: 1000,
            piprop: 'thumbnail|original|name',
            exintro: true,
            explaintext: true,
            format: 'json',
          },
          headers: { 'User-Agent': USER_AGENT },
          timeout: 8000,
        },
      );

      const pages = wpResponse.data?.query?.pages || {};
      const firstPage = Object.values(pages)[0];

      if (firstPage) {
        if (!extract && firstPage.extract) {
          extract = firstPage.extract;
        }

        const imgUrl = firstPage.original?.source || firstPage.thumbnail?.source;
        if (imgUrl) {
          photos.push({
            url: imgUrl,
            thumbnail: firstPage.thumbnail?.source || imgUrl,
            author: 'Wikimedia Commons Contributor',
            license: 'CC BY-SA 4.0',
            caption: firstPage.title || query.name,
            width: firstPage.original?.width || firstPage.thumbnail?.width,
            height: firstPage.original?.height || firstPage.thumbnail?.height,
            sourceProvider: this.providerName,
          });
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

  private extractHighlights(
    extract: string | undefined,
    query: PhotoEnrichmentQuery,
  ): string[] {
    if (!extract) {
      return [
        `Lugar patrimonial y de gran valor cultural en ${query.destinationName || 'la ciudad'}`,
        `Atractivo representativo para la categoría ${query.category || 'arquitectura e historia'}`,
      ];
    }

    // Split into sentences and take the 3 most informative ones
    const sentences = extract
      .split(/(?<=[.?!])s+/)
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
