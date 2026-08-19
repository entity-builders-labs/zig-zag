import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  IWikidataApiService,
  WikidataEntitySummary,
} from '../interfaces/wikidata.interface';

const DEFAULT_WIKIDATA_API_URL = 'https://www.wikidata.org/w/api.php';
const WIKIPEDIA_API_URL = 'https://en.wikipedia.org/w/api.php';
// wbgetentities and action=query&prop=extracts both cap out at 50 ids/titles
// per request — chunk rather than fail on a large candidate pool.
const MAX_IDS_PER_BATCH = 50;

// Wikimedia's API policy flatly rejects generic/bot-looking clients (a 403,
// not a 429/throttle) — same requirement as Overpass, every client must
// self-identify. No env var: it doesn't vary by deployment.
const USER_AGENT = 'ZigZagApp/1.0 (+https://github.com/jiseruk/zig-zag)';

interface WbGetEntitiesResponse {
  entities?: Record<
    string,
    {
      id: string;
      labels?: Record<string, { value: string }>;
      descriptions?: Record<string, { value: string }>;
      sitelinks?: Record<string, { title: string }>;
    }
  >;
}

interface WikipediaExtractsResponse {
  query?: {
    pages?: Record<string, { title: string; extract?: string }>;
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

@Injectable()
export class WikidataApiService implements IWikidataApiService {
  private readonly logger = new Logger(WikidataApiService.name);

  constructor(private readonly configService: ConfigService) {}

  private get apiUrl(): string {
    return (
      this.configService.get<string>('WIKIDATA_API_URL') ||
      DEFAULT_WIKIDATA_API_URL
    );
  }

  /**
   * Resolves all requested QIDs in exactly 2 HTTP calls per batch of up to
   * 50 (not one wbgetentities + one extracts call per QID) — one to
   * wbgetentities for labels/descriptions/sitelinks, one to Wikipedia's
   * action API (prop=extracts, batched by title — NOT the REST summary
   * endpoint, which is per-article and has no batch mode) for the longer
   * intro extract of whichever entities have an `enwiki` sitelink.
   */
  async getEntitySummaries(
    qids: string[],
  ): Promise<Map<string, WikidataEntitySummary>> {
    const uniqueQids = Array.from(new Set(qids)).filter(Boolean);
    if (uniqueQids.length === 0) return new Map();

    const summaries = new Map<string, WikidataEntitySummary>();
    for (const batch of chunk(uniqueQids, MAX_IDS_PER_BATCH)) {
      await this.resolveBatch(batch, summaries);
    }
    return summaries;
  }

  private async resolveBatch(
    qids: string[],
    summaries: Map<string, WikidataEntitySummary>,
  ): Promise<void> {
    let entities: WbGetEntitiesResponse['entities'];
    try {
      const response = await axios.get<WbGetEntitiesResponse>(this.apiUrl, {
        params: {
          action: 'wbgetentities',
          ids: qids.join('|'),
          props: 'labels|descriptions|sitelinks',
          languages: 'en',
          sitefilter: 'enwiki',
          format: 'json',
        },
        headers: { 'User-Agent': USER_AGENT },
      });
      entities = response.data?.entities;
    } catch (error) {
      this.logger.error(`wbgetentities batch failed: ${error.message}`);
      return;
    }
    if (!entities) return;

    // Maps the enwiki title back to its owning QID, so the second (extracts)
    // call's response — keyed by title, not QID — can be merged back in.
    const titleToQid = new Map<string, string>();

    for (const [qid, entity] of Object.entries(entities)) {
      const label = entity.labels?.en?.value;
      const description = entity.descriptions?.en?.value;
      const enwikiTitle = entity.sitelinks?.enwiki?.title;

      // Wikidata echoes back an unresolved id as just `{ id, missing: '' }`
      // with none of these fields — that's a real "no such QID", not an
      // error, so it's simply absent from the returned Map.
      if (!label && !description && !enwikiTitle) continue;

      summaries.set(qid, { qid, label, description });
      if (enwikiTitle) titleToQid.set(enwikiTitle, qid);
    }

    if (titleToQid.size > 0) {
      await this.resolveExtracts(titleToQid, summaries);
    }
  }

  private async resolveExtracts(
    titleToQid: Map<string, string>,
    summaries: Map<string, WikidataEntitySummary>,
  ): Promise<void> {
    try {
      const response = await axios.get<WikipediaExtractsResponse>(
        WIKIPEDIA_API_URL,
        {
          params: {
            action: 'query',
            prop: 'extracts',
            titles: Array.from(titleToQid.keys()).join('|'),
            exintro: true,
            explaintext: true,
            format: 'json',
          },
          headers: { 'User-Agent': USER_AGENT },
        },
      );

      const pages = response.data?.query?.pages || {};
      for (const page of Object.values(pages)) {
        if (!page.extract) continue;
        const qid = titleToQid.get(page.title);
        if (!qid) continue;
        const existing = summaries.get(qid);
        if (existing) existing.extract = page.extract;
      }
    } catch (error) {
      // Extracts are additive on top of label/description (already stored)
      // — a failure here degrades gracefully instead of losing everything.
      this.logger.warn(`Wikipedia extracts batch failed: ${error.message}`);
    }
  }
}
