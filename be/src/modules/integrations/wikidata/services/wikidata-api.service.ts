import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  IWikidataApiService,
  WikidataEntitySummary,
  WikidataLookupOutcome,
  WikidataNearbyPlace,
} from '../interfaces/wikidata.interface';

const DEFAULT_WIKIDATA_API_URL = 'https://www.wikidata.org/w/api.php';
const SPARQL_API_URL = 'https://query.wikidata.org/sparql';
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
      aliases?: Record<string, Array<{ value: string }>>;
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
    return (await this.lookupEntitySummaries(qids)).summaries;
  }

  async lookupEntitySummaries(qids: string[]): Promise<WikidataLookupOutcome> {
    const uniqueQids = Array.from(new Set(qids)).filter(Boolean);
    if (uniqueQids.length === 0) {
      return {
        summaries: new Map(),
        status: 'success',
        failedQids: new Set(),
        extractFailedQids: new Set(),
      };
    }

    const summaries = new Map<string, WikidataEntitySummary>();
    const failedQids = new Set<string>();
    const extractFailedQids = new Set<string>();
    for (const batch of chunk(uniqueQids, MAX_IDS_PER_BATCH)) {
      const batchOutcome = await this.resolveBatch(batch, summaries);
      batchOutcome.failedQids.forEach((qid) => failedQids.add(qid));
      batchOutcome.extractFailedQids.forEach((qid) =>
        extractFailedQids.add(qid),
      );
    }

    const affectedCount = failedQids.size + extractFailedQids.size;
    return {
      summaries,
      status:
        failedQids.size === uniqueQids.length
          ? 'failed'
          : affectedCount > 0
            ? 'partial'
            : 'success',
      failedQids,
      extractFailedQids,
    };
  }

  private async resolveBatch(
    qids: string[],
    summaries: Map<string, WikidataEntitySummary>,
  ): Promise<Pick<WikidataLookupOutcome, 'failedQids' | 'extractFailedQids'>> {
    const failedQids = new Set<string>();
    const extractFailedQids = new Set<string>();
    let entities: WbGetEntitiesResponse['entities'];
    try {
      const response = await axios.get<WbGetEntitiesResponse>(this.apiUrl, {
        params: {
          action: 'wbgetentities',
          ids: qids.join('|'),
          props: 'labels|descriptions|sitelinks|aliases',
          // `es` alongside `en`: confirming a hint against this entity's
          // recorded names needs the Spanish primary label as a candidate
          // too, not only genuine skos:altLabel aliases — a Spanish-only
          // OSM/hint name legitimately has no English alias, only a
          // Spanish primary label.
          languages: 'en|es',
          // No `sitefilter` -- restricting to enwiki would also restrict
          // the sitelinks map used to count `sitelinkCount` below to at
          // most 1, silently destroying the real notability signal. The
          // enwiki-specific extract flow just below still reads
          // `entity.sitelinks.enwiki` out of the now-unfiltered map.
          format: 'json',
        },
        headers: { 'User-Agent': USER_AGENT },
      });
      entities = response.data?.entities;
    } catch (error) {
      this.logger.error(`wbgetentities batch failed: ${error.message}`);
      qids.forEach((qid) => failedQids.add(qid));
      return { failedQids, extractFailedQids };
    }
    if (!entities) return { failedQids, extractFailedQids };

    // Maps the enwiki title back to its owning QID, so the second (extracts)
    // call's response — keyed by title, not QID — can be merged back in.
    const titleToQid = new Map<string, string>();

    for (const [qid, entity] of Object.entries(entities)) {
      const label = entity.labels?.en?.value;
      const description = entity.descriptions?.en?.value;
      const enwikiTitle = entity.sitelinks?.enwiki?.title;
      // Real count of every sitelink Wikidata returned (enwiki, eswiki,
      // commonswiki, ...), never restricted to enwiki -- see the request's
      // own comment for why `sitefilter` was removed. 0 is a real, valid
      // count (a resolved entity with no sitelinks), not "unknown".
      const sitelinkCount = Object.keys(entity.sitelinks ?? {}).length;

      const altNames = new Set<string>();
      if (entity.labels?.es?.value) altNames.add(entity.labels.es.value);
      for (const langAliases of Object.values(entity.aliases ?? {})) {
        for (const alias of langAliases) {
          if (alias.value) altNames.add(alias.value);
        }
      }
      const aliases = altNames.size > 0 ? Array.from(altNames) : undefined;

      // Wikidata echoes back an unresolved id as just `{ id, missing: '' }`
      // with none of these fields — that's a real "no such QID", not an
      // error, so it's simply absent from the returned Map. This gate is
      // IDENTITY admission (a textually identifiable entity), deliberately
      // unchanged by sitelinkCount: IdentityEvidenceCollector treats any
      // returned summary as a Wikidata identity attempt
      // (WIKIDATA_IDENTITY_MATCH, hintMatched/candidateMatched derived from
      // label/aliases), so admitting a sitelink-only entity with no usable
      // textual identity here would turn "has sitelinks" into a spurious
      // identity claim and could get a real candidate wrongly REJECTED
      // instead of falling through to the nearby-Wikidata path. sitelinkCount
      // itself is QUALITY/notability evidence on an already-valid summary,
      // never what makes a summary valid.
      if (!label && !description && !enwikiTitle && !aliases) continue;

      summaries.set(qid, { qid, label, description, aliases, sitelinkCount });
      if (enwikiTitle) titleToQid.set(enwikiTitle, qid);
    }

    if (titleToQid.size > 0) {
      const failedExtracts = await this.resolveExtracts(titleToQid, summaries);
      failedExtracts.forEach((qid) => extractFailedQids.add(qid));
    }
    return { failedQids, extractFailedQids };
  }

  private async resolveExtracts(
    titleToQid: Map<string, string>,
    summaries: Map<string, WikidataEntitySummary>,
  ): Promise<Set<string>> {
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
      return new Set();
    } catch (error) {
      // Extracts are additive on top of label/description (already stored)
      // — a failure here degrades gracefully instead of losing everything.
      this.logger.warn(`Wikipedia extracts batch failed: ${error.message}`);
      return new Set(titleToQid.values());
    }
  }

  /**
   * Live-validated against the real SPARQL endpoint before this was
   * written: `wikibase:around` correctly found the real MALBA museum
   * entity within 200m of its OSM-derived coordinate, and correctly found
   * nothing relevant within 350m of a real known-wrong OSM match. Never
   * throws — a provider outage returns [], which callers must treat as
   * "cannot confirm", never as "confirmed absent".
   */
  async findNearbyPlaces(
    latitude: number,
    longitude: number,
    radiusMeters: number,
  ): Promise<WikidataNearbyPlace[]> {
    const radiusKm = radiusMeters / 1000;
    const query = `
SELECT ?item ?itemLabel ?location WHERE {
  SERVICE wikibase:around {
    ?item wdt:P625 ?location.
    bd:serviceParam wikibase:center "Point(${longitude} ${latitude})"^^geo:wktLiteral.
    bd:serviceParam wikibase:radius "${radiusKm}".
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,es". }
}
LIMIT 30`;
    try {
      const response = await axios.get<WikidataSparqlResponse>(SPARQL_API_URL, {
        params: { format: 'json', query },
        headers: { 'User-Agent': USER_AGENT },
        timeout: 10_000,
      });
      const bindings = response.data?.results?.bindings || [];
      const places: WikidataNearbyPlace[] = [];
      for (const binding of bindings) {
        const pointMatch = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(
          binding.location?.value || '',
        );
        const qidMatch = /Q\d+$/.exec(binding.item?.value || '');
        if (!pointMatch || !qidMatch) continue;
        places.push({
          qid: qidMatch[0],
          label: binding.itemLabel?.value || '',
          longitude: Number(pointMatch[1]),
          latitude: Number(pointMatch[2]),
        });
      }
      return places;
    } catch (error: any) {
      this.logger.warn(
        `Wikidata proximity lookup failed (${latitude},${longitude},${radiusMeters}m): ${error.message}`,
      );
      return [];
    }
  }
}

interface WikidataSparqlResponse {
  results?: {
    bindings?: Array<{
      item?: { value?: string };
      itemLabel?: { value?: string };
      location?: { value?: string };
    }>;
  };
}
