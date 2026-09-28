/**
 * Web source content retrieval — the second of three deliberately separate
 * web capabilities:
 *
 * 1. web search            -> `ExperienceGroundedSearchProvider` (discovers URLs)
 * 2. web source content    -> `WebSourceContentProvider` (this file)
 * 3. semantic extraction   -> `ExperienceDiscoveryExtractor`
 *
 * A source-content provider is a pure TRANSPORT for URLs a grounded search
 * already discovered. It never searches, ranks, filters by relevance, or
 * interprets content, and it contributes no candidate, facet, or preference
 * semantics. Its only job is to return more of a page's own text than the
 * search snippet carried, so the existing semantic extractor can see detail
 * (a walking route's actual stops) that a ~200-char snippet never contains.
 *
 * SOURCE IDENTITY: the identity of retrieved content is always the
 * `requestedUrl` — the URL the grounded search discovered and cited. A
 * provider may follow a redirect and report where it landed (`finalUrl`),
 * but that is provenance only: evidence keys, citation URLs, and the
 * candidate's own source URL stay the original discovered URL. Tavily and
 * Cloudflare are retrieval transports, never sources.
 *
 * NO FALLBACK: exactly one provider is selected by explicit configuration
 * (`WEB_SOURCE_CONTENT_PROVIDER`). There is no fallback chain, racing,
 * fanout, health scoring, or provider priority. A selected provider's
 * failure is reported as that provider's failure, per URL, and the evidence
 * keeps the original search snippet as degraded evidence — the gap stays
 * observable instead of being silently papered over by another vendor.
 */
export type WebSourceContentProviderName = 'tavily' | 'cloudflare';

/**
 * What the provider actually returned. Provider-neutral: a markdown-capable
 * transport reports `markdown`, a raw-text transport reports `text`. Nothing
 * downstream branches on this — it is provenance, recorded in the generation
 * trace so a reviewer can see what kind of text the extractor was given.
 */
export type WebSourceContentType = 'markdown' | 'text';

export type WebSourceContentStatus = 'retrieved' | 'failed';

/**
 * Typed failure reasons, normalized at the adapter boundary so domain code
 * never string-matches a vendor's own error text. `source_http_error` is
 * distinct from `http_error`: the first means the retrieval transport itself
 * succeeded but the PAGE it fetched answered 4xx/5xx. That distinction matters
 * because a rendering transport answers HTTP 200 even for a missing page and
 * then returns tens of thousands of characters of the site's own 404 chrome —
 * text that must never reach the extractor as if it were the source's content.
 */
export type WebSourceContentFailureReason =
  | 'missing_credentials'
  | 'invalid_url'
  | 'auth_error'
  | 'rate_limited'
  | 'timeout'
  | 'http_error'
  | 'source_http_error'
  | 'empty_content'
  | 'provider_error';

export interface WebSourceContentRequest {
  /**
   * URLs already discovered by grounded search. Bounded by the caller; a
   * provider additionally applies its own transport bound and de-duplicates,
   * returning one item per distinct URL.
   */
  urls: string[];
  /**
   * Maximum characters retained per source. The caller (acquisition
   * orchestration) owns this bound so several enriched evidence entries in
   * one query cannot blow up the extractor's own prompt budget. Absent ->
   * `DEFAULT_WEB_SOURCE_CONTENT_MAX_CHARS`.
   */
  maxContentChars?: number;
}

export interface WebSourceContentResultItem {
  /** The URL grounded search discovered — the identity of this content. */
  requestedUrl: string;
  /** Where the transport actually landed after redirects (provenance only). */
  finalUrl?: string;
  status: WebSourceContentStatus;
  /**
   * The page's own readable content, bounded by `maxContentChars`. Present
   * only when `status === 'retrieved'`.
   */
  content?: string;
  contentType?: WebSourceContentType;
  /** Characters retained after the bound was applied. */
  contentChars?: number;
  /**
   * True when the adapter cut the retrieved content down to `maxContentChars`.
   * Optional because a transport that bounds content on its own side cannot
   * report whether it did, and reporting `false` there would assert an unknown
   * as a fact. Both current adapters bound client-side, so they always set it.
   */
  truncated?: boolean;
  /** The provider that answered. Never a fallback — see the file header. */
  provider: WebSourceContentProviderName;
  failureReason?: WebSourceContentFailureReason;
  /** Vendor detail for diagnostics; never a secret, never parsed downstream. */
  failureDetail?: string;
  /** Transport duration for this URL, when the provider measured it. */
  durationMs?: number;
}

export interface WebSourceContentResult {
  provider: WebSourceContentProviderName;
  /** Distinct URLs actually requested from the transport. */
  requestedCount: number;
  retrievedCount: number;
  /** One entry per distinct requested URL — never a silent drop. */
  items: WebSourceContentResultItem[];
  totalDurationMs: number;
}

export interface WebSourceContentProvider {
  readonly providerName: WebSourceContentProviderName;
  retrieve(request: WebSourceContentRequest): Promise<WebSourceContentResult>;
}

/**
 * DI token. The env var that SELECTS the implementation is
 * `WEB_SOURCE_CONTENT_PROVIDER`; this token is named after the
 * `EXPERIENCE_GROUNDED_SEARCH_PROVIDER` precedent so the injected capability
 * and the config key never collide in code.
 */
export const EXPERIENCE_WEB_SOURCE_CONTENT_PROVIDER =
  'EXPERIENCE_WEB_SOURCE_CONTENT_PROVIDER';

/**
 * Default per-source character bound. Generous enough to cover a listicle's
 * itemized stops (which sit well before this point in a real travel article),
 * small enough that enriching several evidence entries in one query does not
 * blow up the extractor prompt. Same bound the pre-capability Tavily search
 * enrichment used, so the extractor's prompt budget is unchanged.
 */
export const DEFAULT_WEB_SOURCE_CONTENT_MAX_CHARS = 6000;
