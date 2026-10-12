import { SerperApiService } from '../../../../be/src/modules/integrations/serper/services/serper-api.service';
import { KnowledgeGap } from '../contracts';
import { Recorder } from '../recording';
import { CatalogSnapshot } from '../stores';
import { FetchedDocument, documentFromHtml } from './documents';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export class ToolFailure extends Error {}

/** Search + fetch, the only external tools research and grounding use. */
export interface WebTools {
  search(query: string): Promise<SearchResult[]>;
  /** `purpose` separates research fetches from grounding re-fetches. */
  fetch(url: string, purpose: 'research' | 'grounding'): Promise<FetchedDocument>;
}

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 2_000_000;

/**
 * Serper web search (never SerpApi) and plain HTTP fetch, both through the
 * Recorder. Provider-neutral contract: the agent sees titles, URLs and
 * snippets; nothing here prefers or excludes a site.
 */
export function liveWebTools(
  recorder: Recorder,
  serper: SerperApiService,
  /** Destination country code as ranking locale (not a filter, not a site bias). */
  countryCode?: string,
): WebTools {
  return {
    async search(query) {
      const request = { q: query, num: 10, ...(countryCode ? { gl: countryCode.toLowerCase() } : {}) };
      const result = await recorder.call('serper', 'search', request, async () => {
        const response = await serper.search(request);
        return (response.data.organic ?? []).map((o) => ({ title: o.title ?? '', url: o.link ?? '', snippet: o.snippet ?? '' }));
      });
      return result.filter((r) => r.url.startsWith('http'));
    },
    async fetch(url, purpose) {
      return recorder.call('web', `fetch-${purpose}`, { url }, async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
          const response = await fetch(url, {
            signal: controller.signal,
            redirect: 'follow',
            headers: { 'user-agent': 'Mozilla/5.0 (zig-zag research spike)', accept: 'text/html,application/xhtml+xml' },
          });
          if (!response.ok) throw new ToolFailure(`HTTP ${response.status}`);
          const type = response.headers.get('content-type') ?? '';
          if (!type.includes('html')) throw new ToolFailure(`unsupported content-type ${type}`);
          const html = (await response.text()).slice(0, MAX_HTML_BYTES);
          return documentFromHtml(url, html, new Date().toISOString());
        } finally {
          clearTimeout(timer);
        }
      });
    },
  };
}

/** Bounded, read-only catalog excerpt handed to research for one gap. */
export interface CatalogExcerpt {
  destinationName: string;
  gap: { type: string; facet: string; scopeName: string };
  knownRelevantAreas: string[];
  excludedAreas: string[];
  knownPlacesInScope: string[];
  knownCorridors: string[];
}

export function catalogRead(snapshot: CatalogSnapshot, gap: KnowledgeGap, destinationId: string): CatalogExcerpt {
  const name = (id: string) => snapshot.geoEntities[id]?.name ?? id;
  const assertions = Object.values(snapshot.assertions).filter((a) => a.status === 'ACTIVE' && a.destinationId === destinationId);
  const placesInScope = assertions
    .filter((a) => a.subject.kind === 'PLACE_IN_AREA' && a.subject.areaGeoEntityId === gap.scopeGeoEntityId)
    .map((a) => (a.subject.kind === 'PLACE_IN_AREA' ? name(a.subject.placeGeoEntityId) : ''));
  const corridors = assertions
    .filter((a) => a.subject.kind === 'CORRIDOR')
    .map((a) => (a.subject.kind === 'CORRIDOR' ? name(a.subject.corridor.routeGeoEntityId) : ''));
  return {
    destinationName: name(destinationId),
    gap: { type: gap.type, facet: gap.facetKey, scopeName: name(gap.scopeGeoEntityId) },
    knownRelevantAreas: gap.relevantAreaIds.map(name).sort(),
    excludedAreas: gap.type === 'SCHEDULE_CAPACITY' ? gap.knownAreaIds.map(name).sort() : [],
    knownPlacesInScope: [...new Set(placesInScope)].sort(),
    knownCorridors: [...new Set(corridors)].sort(),
  };
}
