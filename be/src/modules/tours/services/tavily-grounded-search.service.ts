import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ExperienceGroundedSearchProvider as GroundedSearchProvider,
  ExperienceGroundedSearchRequest as GroundedSearchRequest,
  ExperienceGroundedSearchResult as GroundedSearchResult,
  ExperienceGroundingEvidence as GroundingEvidence,
} from '../interfaces/experience-grounding.interface';

interface TavilySearchResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
}

interface TavilySearchResponse {
  query?: string;
  results?: TavilySearchResult[];
  response_time?: number;
}

// This service is the web SEARCH capability only: it turns a query into cited
// URLs plus each result's short relevance snippet.
//
// It deliberately does NOT fetch page content. That snippet is the provider's
// own "most relevant fragment" (~150-300 chars), and the detail that proves an
// experience is a sequence of stops — the actual street/plaza names, in order —
// usually sits further into the article than the fragment reaches. Retrieving
// more of an already-discovered URL's own text is a separate capability,
// `WebSourceContentProvider` (selected by WEB_SOURCE_CONTENT_PROVIDER), which
// the acquisition orchestration invokes only when search produced usable URLs
// but an evidence requirement is still unresolved. Keeping the two apart means
// any search backend can pair with any retrieval transport, and no retrieval
// call is spent when the snippet already carried enough evidence.

// destinationCountry carries Nominatim's own English-language `address.country`
// field (see DestinationResolutionAudit's own doc comment) — matched here in
// that same form, not the ISO code (which the grounded-search request doesn't
// currently carry) and not a Spanish self-name.
// Canonical theme keys -> Spanish adjective form for the walk-query phrase.
// Only the clearly-adjectival common keys; an unmapped key falls through as
// its raw form rather than being dropped, so a themed walk request never
// silently loses its theme. Local to this file — this is query phrasing, not
// a shared vocabulary.
const WALK_THEME_ADJECTIVE_ES: Record<string, string> = {
  history: 'históricas',
  culture: 'culturales',
  art: 'artísticas',
  architecture: 'arquitectónicas',
  nature: 'naturales',
  food: 'gastronómicas',
  gastronomy: 'gastronómicas',
  music: 'musicales',
  photography: 'fotográficas',
  nightlife: 'nocturnas',
};

// A themed walk query stays a single query — the request's first couple of
// themes shape the phrase, they never explode into multiple Tavily calls.
const MAX_WALK_QUERY_THEMES = 2;

const SPANISH_SPEAKING_COUNTRIES = new Set([
  'Argentina',
  'Bolivia',
  'Chile',
  'Colombia',
  'Costa Rica',
  'Cuba',
  'Dominican Republic',
  'Ecuador',
  'El Salvador',
  'Equatorial Guinea',
  'Guatemala',
  'Honduras',
  'Mexico',
  'Nicaragua',
  'Panama',
  'Paraguay',
  'Peru',
  'Spain',
  'Uruguay',
  'Venezuela',
]);

@Injectable()
export class TavilyGroundedSearchService implements GroundedSearchProvider {
  private readonly logger = new Logger(TavilyGroundedSearchService.name);
  private readonly apiUrl = 'https://api.tavily.com/search';
  private readonly timeoutMs = 15000;
  private readonly model = 'tavily-search-basic';

  constructor(private readonly config: ConfigService) {}

  async search(request: GroundedSearchRequest): Promise<GroundedSearchResult> {
    const apiKey =
      this.config.get<string>('ai.tavilyApiKey') || process.env.TAVILY_API_KEY;

    if (!apiKey) {
      return {
        provider: 'tavily',
        model: this.model,
        groundingStatus: 'unavailable',
        evidence: [],
        failureReason: 'missing_tavily_api_key',
      };
    }

    const query = this.buildSearchQuery(request);

    try {
      this.logger.debug(`Tavily search for: ${query}`);
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          search_depth: 'basic',
          // Tavily bills per request, not per result (up to its own cap of
          // 20) — raising this costs nothing extra and buys real diversity.
          // Verified live: a page enumerating three distinct themes beyond
          // the single dominant one only entered the top 10 once results
          // were raised to 20, in the exact same single call — cheaper and
          // simpler than a second discovery round for the same gap.
          max_results: 20,
          include_answer: false,
          include_raw_content: false,
          // Deliberately never passed to Tavily's own `country` boost, even
          // though destinationCountry is available: repeating the identical
          // query live showed 0-to-20 result-count variance on its own, and
          // pairing that noise with `country` occasionally returned zero
          // results outright — a worse failure than the milder, already
          // mitigated risk of some wrong-country evidence slipping through.
          // CompositeGeographicValidationService's destination_mismatch
          // check already rejects a wrong-country candidate downstream,
          // before it can ever be persisted — so the generic, unfiltered
          // search plus that existing downstream filter is more robust than
          // trying to get Tavily's own opaque relevance/boost logic to do
          // the filtering upstream.
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        const errBody = await response.text();
        this.logger.error(`Tavily search error ${response.status}: ${errBody}`);
        return {
          provider: 'tavily',
          model: this.model,
          groundingStatus: 'failed',
          evidence: [],
          failureReason:
            response.status === 429
              ? 'tavily_rate_limited'
              : `tavily_error_${response.status}`,
          rawOutput: errBody,
        };
      }

      const data = (await response.json()) as TavilySearchResponse;
      const evidence = this.extractEvidence(data.results);

      return {
        provider: 'tavily',
        model: this.model,
        groundingStatus: evidence.length > 0 ? 'applied' : 'no_usable_evidence',
        evidence,
        rawOutput: data,
      };
    } catch (error: any) {
      this.logger.error(`Tavily search failed: ${error.message}`);
      return {
        provider: 'tavily',
        model: this.model,
        groundingStatus: 'failed',
        evidence: [],
        failureReason: error.message,
      };
    }
  }

  private buildSearchQuery(request: GroundedSearchRequest): string {
    // A walk/route request gets its own phrasing — verified live against the
    // real API: ExperienceDiscoveryPlannerService's flat keyword join (e.g.
    // "Palermo, Buenos Aires ... history culture walk") returns commercial
    // tour-booking pages (GetYourGuide/Viator-style "15 BEST Walking Tours
    // (with Prices)"), not the itemized city guides that actually name a
    // route's stops. "N caminatas icónicas en {destino}" instead surfaces
    // real enumerated-walk articles (AllTrails city guides, "todos los
    // imprescindibles ... para descubrirlos a pie"). Two things about that
    // phrasing turned out to matter, both verified live, not assumed: the
    // requested count (a bare destination+theme query never reads as "give
    // me a list"), and — in Spanish specifically — "icónicas": without it,
    // "caminatas" alone reads as senderismo/trekking (hiking trails in the
    // surrounding Province), not urban walking routes in the city itself.
    // Scoped to Tavily only (not the shared planner) because Gemini's own
    // prompt already embeds `query` as one line inside a larger natural-
    // language instruction it was designed and worded around — untested
    // with this phrasing, per its own doc comment (quota exhausted every
    // live attempt this session).
    if (this.isWalkOrRouteRequest(request)) {
      return this.buildWalkQuery(request);
    }

    // Trust the caller's already-built query whenever one exists — same
    // contract as SerpApiGroundedSearchService/GroqGroundedSearchService, so
    // swapping providers is actually transparent. The previous 200-char/
    // no-newline cutoff had no basis in Tavily's own API (their guidance
    // tops out around 400 chars) and silently discarded a real, working
    // query, replacing it with a cruder fallback — verified live: it
    // returned generic government tourism-portal noise contaminated with
    // unrelated countries, worse than the query it was "protecting" against.
    const raw = request.query?.trim();
    if (raw && !raw.includes('\n')) {
      return raw;
    }
    return this.buildFallbackQuery(request);
  }

  private isWalkOrRouteRequest(request: GroundedSearchRequest): boolean {
    const intents = request.requestedIntents ?? [];
    return intents.includes('walk') || intents.includes('route_like');
  }

  // Folds the request's themes into the walk/route phrase — a history walk and
  // a food walk for the same city must not produce byte-identical queries.
  // Still ONE query, still both language branches, still the "icónicas" /
  // "iconic" disambiguator that live verification showed is load-bearing
  // (without it "caminatas" reads as senderismo/trekking in Spanish). No
  // themes -> the exact legacy phrase, unchanged.
  private buildWalkQuery(request: GroundedSearchRequest): string {
    const themeKeys = this.walkQueryThemeKeys(request);
    const spanish = this.isSpanishSpeakingCountry(request.destinationCountry);

    // Task B5 (correctness point 12): preserve EVERY relevant anchor name
    // -- 1 anchor keeps the round-3 phrasing ("San Telmo, Buenos Aires");
    // 2+ anchors join deterministically ("San Telmo a La Boca, Buenos
    // Aires" / "San Telmo to La Boca, Buenos Aires") -- never picking one
    // arbitrarily, never dropping them all when 1+ exist.
    const anchorNames = (request.anchorNames ?? [])
      .map((name) => name.trim())
      .filter(Boolean);
    const anchorPhrase =
      anchorNames.length > 0
        ? anchorNames.join(spanish ? ' a ' : ' to ')
        : undefined;
    const destination = anchorPhrase
      ? `${anchorPhrase}, ${request.destinationName}`
      : request.destinationName;

    if (themeKeys.length === 0) {
      return spanish
        ? `10 caminatas icónicas en ${destination}`
        : `10 iconic walking routes in ${destination}`;
    }

    if (spanish) {
      const adjectives = themeKeys
        .map((key) => WALK_THEME_ADJECTIVE_ES[key] ?? key)
        .join(' y ');
      return `10 caminatas ${adjectives} icónicas en ${destination}`;
    }
    return `10 iconic ${themeKeys.join(' and ')} walking routes in ${destination}`;
  }

  private walkQueryThemeKeys(request: GroundedSearchRequest): string[] {
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const raw of request.requestedThemes ?? []) {
      const key = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
      if (!key || seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
      if (keys.length >= MAX_WALK_QUERY_THEMES) break;
    }
    return keys;
  }

  private isSpanishSpeakingCountry(country: string | undefined): boolean {
    if (!country) return false;
    return SPANISH_SPEAKING_COUNTRIES.has(country.trim());
  }

  private buildFallbackQuery(request: GroundedSearchRequest): string {
    const destination = request.destinationName;
    const themes = request.requestedThemes.slice(0, 4).join(' ');
    const prefs = request.additionalPreferences
      ? request.additionalPreferences
          .replace(/[^\w\s\u00C0-\u017F]/g, ' ')
          .slice(0, 100)
      : '';
    return `${destination} ${themes} ${prefs} turismo atractivos experiencias lugares`
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractEvidence(
    results: TavilySearchResult[] | undefined,
  ): GroundingEvidence[] {
    if (!Array.isArray(results)) return [];

    return results
      .filter((result) => Boolean(result.content?.trim()))
      .map((result, index) => ({
        key: `ev-${index + 1}`,
        source: result.title || result.url || 'tavily-search',
        snippet: result.content!.trim(),
        title: result.title,
        url: result.url,
      }));
  }
}
