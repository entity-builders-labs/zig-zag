import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { SerperApiService } from 'src/modules/integrations/serper/services/serper-api.service';
import {
  SerperApiError,
  SerperCallResult,
  SerperEndpoint,
  SerperMapsRequest,
  SerperPlaceResult,
  SerperPlacesRequest,
  SerperSearchRequest,
  SerperSearchResponse,
} from 'src/modules/integrations/serper/interfaces/serper.interface';
import { SerperGroundedSearchService } from 'src/modules/tours/services/serper-grounded-search.service';
import { AiCacheService } from '@shared/ai/services/ai-cache.service';
import { normalizeGeoName } from 'src/modules/tours/utils/nominatim-match.util';
import { calculateDistance } from '@shared/utils/distance.utils';
import { loadRootEnv } from './discovery/discovery-live.helper';

loadRootEnv();
jest.setTimeout(20 * 60 * 1000);

/**
 * Stage 3 Serper characterization spike (2026-09-25).
 *
 *   A  Serper /search  through the production SerperGroundedSearchService
 *   B  Serper /maps    (Google Maps)   -- PLACE characterization only
 *   C  Serper /places  (Google local)  -- PLACE characterization only
 *
 * Nothing is persisted and no PLACE production path is rewired. Every
 * Serper response is cached under raw/ and reused on re-run, so re-running
 * the harness never re-spends credits. SerpApi / Geoapify / Google Places
 * are NEVER called: their numbers come from the frozen artifacts of
 * spikes/stage3-place-provider-search-characterization-2026-09-25 and the
 * historical generation traces.
 *
 *   RUN_SPIKE_PREFLIGHT=1 [SERPER_PHASE=probe] yarn test:live:discovery \
 *     --testPathPattern=serper-provider-characterization
 */
const RUN = process.env.RUN_SPIKE_PREFLIGHT === '1';
const PHASE = process.env.SERPER_PHASE === 'probe' ? 'probe' : 'all';
const describeIfRun = RUN ? describe : describe.skip;

const SPIKES = path.join(__dirname, '../../../spikes');
const OUT_DIR = path.join(
  SPIKES,
  'stage3-serper-provider-characterization-2026-09-25',
);
const RAW_DIR = path.join(OUT_DIR, 'raw');
const PRIOR_DIR = path.join(
  SPIKES,
  'stage3-place-provider-search-characterization-2026-09-25',
);

// Same geographic context as the prior PLACE spike and its SerpApi S1 rows.
const CENTER = { latitude: -34.6037, longitude: -58.3816 };
const RADIUS_KM = 50;
const MAPS_LL = '@-34.6037,-58.3816,12z';
const DESTINATION_TEXT = 'Buenos Aires, Argentina';
const COUNTRY_GL = 'ar'; // resolved destination countryCode (Nominatim AR)

// Historical Google identities (prior spike, SerpApi google_maps + Places API).
const HISTORICAL_GOOGLE_IDS: Record<
  string,
  { placeId: string; cid: string; osm: string }
> = {
  'Mafalda Statue': {
    placeId: 'ChIJeRQn1k01o5UR5o5Yb5aJJ5Y',
    cid: '10819767908987080422',
    osm: 'node/2472979623',
  },
  'Farmacia la Estrella': {
    placeId: 'ChIJkxt8rtTKvJURbYdelktFp-A',
    cid: '16187983576554178413',
    osm: 'node/3348573778',
  },
};

// Google identity established INSIDE this spike, used only as a label: the
// hl=es locale control returned the same placeId/cid titled "Galería Güemes"
// (Centro comercial, Florida 165) that the default-hl calls title
// "Mirador Guemes Gallery". Not historical, so no convergence is claimed.
const SPIKE_ESTABLISHED_GOOGLE_IDS: Record<
  string,
  { placeId: string; cid: string }
> = {
  'Galería Güemes': {
    placeId: 'ChIJ5TzWetLKvJURxzt1cDvPF-k',
    cid: '16796121189498305479',
  },
};

// ── Ground truth (labels only, copied from the prior PLACE spike) ─────────
interface Truth {
  label: string;
  point: { latitude: number; longitude: number };
  toleranceM: number;
  name: RegExp;
  notName?: RegExp;
  /** ROUTE control: only a street-typed object counts (spike label only). */
  expectStreet?: boolean;
}
interface Hint {
  hint: string;
  group: 'main' | 'mafalda' | 'route-control' | 'negative';
  queries: string[];
  experimental?: string[];
  truth?: Truth;
}
const VENUE = /\b(bar|cafe|hotel|hostel|restaurant|restaurante|suites|apart)\b/;
const T = (
  label: string,
  latitude: number,
  longitude: number,
  toleranceM: number,
  name: RegExp,
  notName?: RegExp,
): Truth => ({
  label,
  point: { latitude, longitude },
  toleranceM,
  name,
  notName,
});

const CORPUS: Hint[] = [
  {
    hint: 'Mafalda Statue',
    group: 'mafalda',
    queries: ['Mafalda Statue'],
    experimental: ['Mafalda', 'Estatua de Mafalda'],
    truth: T(
      'Mafalda statue, Defensa & Chile',
      -34.6158,
      -58.3717,
      300,
      /mafalda/,
    ),
  },
  {
    hint: 'Farmacia la Estrella',
    group: 'main',
    queries: ['Farmacia la Estrella'],
    truth: T(
      'Farmacia de la Estrella, Defensa & Alsina',
      -34.61,
      -58.3726,
      250,
      /estrella/,
    ),
  },
  {
    hint: 'Casa Mínima',
    group: 'main',
    queries: ['Casa Mínima'],
    truth: T(
      'Casa Mínima, Pasaje San Lorenzo 380',
      -34.6181,
      -58.3713,
      250,
      /minima/,
    ),
  },
  {
    hint: 'Mercado de San Telmo',
    group: 'main',
    queries: ['Mercado de San Telmo'],
    truth: T('Mercado de San Telmo', -34.6208, -58.3725, 250, /mercado/),
  },
  {
    hint: 'Plaza Dorrego',
    group: 'main',
    queries: ['Plaza Dorrego'],
    truth: T(
      'Plaza Dorrego (the square)',
      -34.6206,
      -58.3715,
      200,
      /dorrego/,
      VENUE,
    ),
  },
  {
    hint: 'El Zanjón de Granados',
    group: 'main',
    queries: ['El Zanjón de Granados'],
    truth: T(
      'El Zanjón de Granados, Defensa 755',
      -34.6157,
      -58.3718,
      250,
      /zanjon/,
    ),
  },
  {
    hint: 'Basílica de San Francisco',
    group: 'main',
    queries: ['Basílica de San Francisco'],
    truth: T(
      'Basílica de San Francisco, Alsina & Defensa',
      -34.6099,
      -58.3723,
      250,
      /francisco/,
    ),
  },
  {
    hint: 'Parque Lezama',
    group: 'main',
    queries: ['Parque Lezama'],
    truth: T(
      'Parque Lezama',
      -34.6283,
      -58.3697,
      600,
      /lezama/,
      /\b(bar|cafe|hotel|hostel|restaurant|restaurante|suites|apart|museo)\b/,
    ),
  },
  {
    hint: 'Galería Güemes',
    group: 'negative',
    queries: ['Galería Güemes'],
    truth: T(
      'Galería Güemes, Florida 165 (the gallery, not its rooftop Mirador)',
      -34.6063,
      -58.3745,
      200,
      /guemes/,
      // Sub-features/listings inside the gallery are not the gallery. Label
      // tightened after reading raw data (a "Christmas tree" scenic spot).
      /mirador|navidad/,
    ),
  },
  {
    hint: 'Cementerio de la Recoleta',
    group: 'main',
    queries: ['Cementerio de la Recoleta'],
    truth: T(
      'Cementerio de la Recoleta',
      -34.5875,
      -58.3934,
      600,
      /cementerio|cemet/,
    ),
  },
  {
    hint: 'Recoleta Cemetery',
    group: 'negative',
    queries: ['Recoleta Cemetery'],
    truth: T(
      'Cementerio de la Recoleta',
      -34.5875,
      -58.3934,
      600,
      /cementerio|cemet/,
    ),
  },
  {
    hint: 'Plaza San Martín',
    group: 'negative',
    queries: ['Plaza San Martín'],
    truth: T(
      'Plaza San Martín (Retiro, CABA)',
      -34.5955,
      -58.3754,
      400,
      /san martin/,
      /\b(bar|cafe|hotel|hostel|restaurant|restaurante|suites|apart|tower|torre)\b/,
    ),
  },
  // Bare common name: no single truth; measured for collisions/leakage.
  { hint: 'San Martín', group: 'negative', queries: ['San Martín'] },
  {
    hint: 'Defensa Street',
    group: 'route-control',
    queries: ['Defensa Street'],
    truth: {
      ...T(
        'calle Defensa (CABA) -- ROUTE control',
        -34.6155,
        -58.3718,
        2500,
        /defensa/,
      ),
      expectStreet: true,
    },
  },
];

// Geo-context controls (no ll / no location) -- bounded to three hints.
const NO_CONTEXT_CONTROLS = ['Mafalda Statue', 'San Martín', 'Galería Güemes'];
// Locale controls (hl=es): added after M1/PL1 showed Google returning
// English-localized titles ("Pharmacy Star") without `hl`.
const LOCALE_CONTROLS = ['Farmacia la Estrella', 'Galería Güemes'];

// ── /search corpus: real production discovery queries (historical traces) ──
const TRACE_FILES = [
  'stage3-buenosaires-walks-component-survey-2026-09-24/cold/generation-trace.json',
  'stage3-buenosaires-walks-component-survey-2026-09-24/cold-laboca/generation-trace.json',
  'stage3-buenosaires-walks-component-survey-2026-09-24/cold-recoleta/generation-trace.json',
  'stage3-santelmo-composite-control-2026-09-23/cold/generation-trace.json',
];

interface HistoricalGrounding {
  trace: string;
  query: string;
  destinationName: string;
  requestedThemes: string[];
  provider: string;
  model: string;
  groundingStatus: string;
  evidenceCount: number;
  evidenceKinds: Record<string, number>;
  distinctUrls: string[];
  domains: string[];
}

function loadHistoricalGroundings(): HistoricalGrounding[] {
  const out: HistoricalGrounding[] = [];
  for (const rel of TRACE_FILES) {
    const trace = JSON.parse(fs.readFileSync(path.join(SPIKES, rel), 'utf8'));
    for (const step of trace.steps ?? []) {
      for (const plan of step.acquisition?.sourcePlans ?? []) {
        const web = plan.web;
        if (!web?.groundedProvider) continue;
        if (out.some((h) => h.query === web.query)) continue;
        const evidence: Array<{ kind?: string; url?: string }> =
          web.evidence ?? [];
        const kinds: Record<string, number> = {};
        for (const e of evidence) {
          const k = e.kind ?? 'unknown';
          kinds[k] = (kinds[k] ?? 0) + 1;
        }
        const urls = [
          ...new Set(evidence.map((e) => e.url).filter(Boolean) as string[]),
        ];
        out.push({
          trace: rel,
          query: web.query,
          destinationName: trace.canonicalRequest?.destination?.label ?? '',
          requestedThemes: web.requestedThemes ?? [],
          provider: web.groundedProvider,
          model: web.groundedModel,
          groundingStatus: web.groundingStatus,
          evidenceCount: evidence.length,
          evidenceKinds: kinds,
          distinctUrls: urls,
          domains: [...new Set(urls.map(hostOf))].sort(),
        });
        break; // first grounded plan per trace
      }
      if (out.some((h) => h.trace === rel)) break;
    }
  }
  return out;
}

// ── Prior-spike baseline (frozen, never re-called) ────────────────────────
type PriorCell = string; // "#n" | "✗" | "UNAV" | "—" | ""
function loadPriorBaseline(): (
  hint: string,
  query: string,
) => Record<string, PriorCell> {
  const prior = JSON.parse(
    fs.readFileSync(path.join(PRIOR_DIR, 'matrix.json'), 'utf8'),
  );
  const pick: Record<string, (v: string) => boolean> = {
    'Geoapify A1 (prod)': (v) => v.startsWith('A1 current production'),
    'Geoapify G1 (recommended)': (v) => v === 'G1 search text, no type',
    'Google P1 (prod shape)': (v) => v.startsWith('P1 current shape'),
    'Google P3 (es/AR)': (v) => v.startsWith('P3 '),
    'SerpApi Maps S1/S3': (v) => v.startsWith('S1 ') || v.startsWith('S3 '),
  };
  return (hint, query) => {
    const cells: Record<string, PriorCell> = {};
    for (const [label, match] of Object.entries(pick)) {
      const rows = prior.rows.filter(
        (r: any) => r.hint === hint && r.query === query && match(r.variant),
      );
      if (rows.length === 0) {
        cells[label] = '';
        continue;
      }
      const r =
        rows.find((x: any) => x.correctPresent) ??
        rows.find((x: any) => !x.providerFailure) ??
        rows[0];
      cells[label] = r.providerFailure
        ? 'UNAV'
        : r.correctRank
          ? `#${r.correctRank}${r.zigzagSelector?.selectedIsCorrect === false ? ' (sel✗)' : ''}`
          : r.correct === null && !r.correctPresent && hint === 'San Martín'
            ? '—'
            : '✗';
    }
    return cells;
  };
}

// ── Recording Serper client: raw cache on disk, fetch accounting ──────────
const hostCalls: Record<string, number> = {};
const liveCalls: Record<SerperEndpoint, number> = {
  search: 0,
  maps: 0,
  places: 0,
};
const cachedCalls: Record<SerperEndpoint, number> = {
  search: 0,
  maps: 0,
  places: 0,
};
const creditsByEndpoint: Record<SerperEndpoint, number> = {
  search: 0,
  maps: 0,
  places: 0,
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'invalid-url';
  }
}

function slug(s: string): string {
  return normalizeGeoName(s).replace(/\s+/g, '-').slice(0, 60) || 'q';
}

interface RawRecord<T> {
  endpoint: SerperEndpoint;
  request: object;
  capturedAt: string;
  meta: SerperCallResult<T>['meta'];
  data: T;
}

class RecordingSerperApiService extends SerperApiService {
  lastRawFile: string | null = null;
  lastFromCache = false;

  search(request: SerperSearchRequest) {
    return this.record('search', request, () => super.search(request));
  }
  searchMaps(request: SerperMapsRequest) {
    return this.record('maps', request, () => super.searchMaps(request));
  }
  searchPlaces(request: SerperPlacesRequest) {
    return this.record('places', request, () => super.searchPlaces(request));
  }

  private async record<T>(
    endpoint: SerperEndpoint,
    request: { q: string },
    live: () => Promise<SerperCallResult<T>>,
  ): Promise<SerperCallResult<T>> {
    const hash = crypto
      .createHash('sha1')
      .update(JSON.stringify(request))
      .digest('hex')
      .slice(0, 10);
    const file = path.join(
      RAW_DIR,
      endpoint,
      `${slug(request.q)}-${hash}.json`,
    );
    this.lastRawFile = path.relative(OUT_DIR, file);
    if (fs.existsSync(file)) {
      const rec = JSON.parse(fs.readFileSync(file, 'utf8')) as RawRecord<T>;
      cachedCalls[endpoint] += 1;
      this.lastFromCache = true;
      return { data: rec.data, meta: rec.meta };
    }
    this.lastFromCache = false;
    liveCalls[endpoint] += 1;
    const result = await live();
    const credits = (result.data as { credits?: number }).credits;
    creditsByEndpoint[endpoint] += typeof credits === 'number' ? credits : 0;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const rec: RawRecord<T> = {
      endpoint,
      request,
      capturedAt: new Date().toISOString(),
      meta: result.meta,
      data: result.data,
    };
    fs.writeFileSync(file, redact(JSON.stringify(rec, null, 2)) + '\n');
    return result;
  }
}

function redact(text: string): string {
  const key = process.env.SERPER_API_KEY;
  return key ? text.split(key).join('<redacted>') : text;
}

class InMemoryAiCache {
  readonly store = new Map<string, string>();
  writes = 0;
  hits = 0;
  async getCachedResponse(prompt: string, options?: unknown) {
    const v = this.store.get(JSON.stringify([prompt, options]));
    if (v) this.hits += 1;
    return v ?? null;
  }
  async cacheResponse(prompt: string, response: string, options?: unknown) {
    this.writes += 1;
    this.store.set(JSON.stringify([prompt, options]), response);
  }
}

function configFromEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    get: (key: string) =>
      key in overrides ? overrides[key] : process.env[key],
  } as unknown as ConfigService;
}

// ── PLACE row evaluation ──────────────────────────────────────────────────
interface CandidateRow {
  matchedBy: 'google-identity' | 'geo+name' | null;
  rank: number;
  title?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  distanceFromCenterKm?: number;
  distanceFromTruthM?: number;
  outside50km: boolean;
  type?: string;
  types?: string[];
  placeId?: string;
  cid?: string;
  fid?: string;
  rating?: number;
  ratingCount?: number;
  website?: string;
  extraFields: string[];
  isCorrect: boolean;
}

const KNOWN_PLACE_FIELDS = new Set([
  'position',
  'title',
  'address',
  'latitude',
  'longitude',
  'type',
  'types',
  'placeId',
  'cid',
  'fid',
  'rating',
  'ratingCount',
  'website',
]);

/**
 * A candidate is correct when it is (a) within the truth tolerance with a
 * matching normalized name, or (b) exactly the historical Google identity
 * (same placeId or cid) measured in the prior spike -- Google may return a
 * localized title the loose name label cannot match ("Pharmacy Star").
 */
function evaluate(
  places: SerperPlaceResult[] | undefined,
  truth?: Truth,
  historical?: { placeId: string; cid: string },
): CandidateRow[] {
  return (places ?? []).map((p, i) => {
    const hasPoint =
      typeof p.latitude === 'number' && typeof p.longitude === 'number';
    const point = hasPoint
      ? { latitude: p.latitude!, longitude: p.longitude! }
      : null;
    const dCenter = point ? calculateDistance(CENTER, point) : undefined;
    const dTruth =
      point && truth ? calculateDistance(truth.point, point) * 1000 : undefined;
    const name = normalizeGeoName(p.title ?? '');
    const typeText = [p.type, p.category, ...(p.types ?? [])].join(' ');
    const byGeoName =
      !!truth &&
      dTruth !== undefined &&
      dTruth <= truth.toleranceM &&
      truth.name.test(name) &&
      !(truth.notName && truth.notName.test(name)) &&
      (!truth.expectStreet || /\b(route|street)\b/i.test(typeText));
    const byGoogleIdentity =
      !!historical &&
      ((!!p.placeId && p.placeId === historical.placeId) ||
        (!!p.cid && p.cid === historical.cid));
    const isCorrect = byGeoName || byGoogleIdentity;
    return {
      rank: p.position ?? i + 1,
      title: p.title,
      address: p.address,
      latitude: p.latitude,
      longitude: p.longitude,
      distanceFromCenterKm:
        dCenter !== undefined ? round(dCenter, 2) : undefined,
      distanceFromTruthM: dTruth !== undefined ? Math.round(dTruth) : undefined,
      outside50km: dCenter !== undefined && dCenter > RADIUS_KM,
      type: p.type ?? p.category,
      types: p.types,
      placeId: p.placeId,
      cid: p.cid,
      fid: p.fid,
      rating: p.rating,
      ratingCount: p.ratingCount,
      website: p.website,
      extraFields: Object.keys(p)
        .filter((k) => !KNOWN_PLACE_FIELDS.has(k))
        .sort(),
      isCorrect,
      matchedBy: byGoogleIdentity
        ? 'google-identity'
        : byGeoName
          ? 'geo+name'
          : null,
    };
  });
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, idx)];
}

// ── Spike ─────────────────────────────────────────────────────────────────
describeIfRun('Serper provider characterization (live, bounded)', () => {
  const realFetch = global.fetch;

  beforeAll(() => {
    fs.mkdirSync(RAW_DIR, { recursive: true });
    global.fetch = (async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input.url;
      const host = hostOf(url);
      hostCalls[host] = (hostCalls[host] ?? 0) + 1;
      return realFetch(input, init);
    }) as typeof fetch;
    if (!process.env.SERPER_API_KEY) {
      throw new Error('SERPER_API_KEY is required for this live spike');
    }
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  it('characterizes /search, /maps and /places', async () => {
    const serper = new RecordingSerperApiService(configFromEnv());
    const aiCache = new InMemoryAiCache();
    const grounded = new SerperGroundedSearchService(
      serper,
      aiCache as unknown as AiCacheService,
    );
    const prior = loadPriorBaseline();
    const history = loadHistoricalGroundings();

    // ── A. /search through the production adapter ────────────────────────
    const searchRows: any[] = [];
    const searchCorpus = PHASE === 'probe' ? history.slice(0, 1) : history;
    for (const h of searchCorpus) {
      const result = await grounded.search({
        destinationName: h.destinationName,
        requestedThemes: h.requestedThemes,
        query: h.query,
      });
      const raw = result.rawOutput as SerperSearchResponse | undefined;
      const rawFile = serper.lastRawFile;
      const rec = rawFile
        ? (JSON.parse(
            fs.readFileSync(path.join(OUT_DIR, rawFile), 'utf8'),
          ) as RawRecord<SerperSearchResponse>)
        : undefined;
      const urls = [
        ...new Set(
          result.evidence.map((e) => e.url).filter(Boolean) as string[],
        ),
      ];
      searchRows.push({
        query: h.query,
        request: rec?.request,
        provider: result.provider,
        model: result.model,
        groundingStatus: result.groundingStatus,
        failureReason: result.failureReason,
        httpStatus: rec?.meta.httpStatus,
        durationMs: rec?.meta.durationMs,
        credits: raw?.credits ?? null,
        searchParameters: raw?.searchParameters,
        organicCount: raw?.organic?.length ?? 0,
        usableEvidence: result.evidence.length,
        evidenceKinds: [...new Set(result.evidence.map((e) => e.kind))],
        normalization: (result.normalizationAudit?.decisions ?? []).reduce(
          (acc: Record<string, number>, d) => ({
            ...acc,
            [d.reason]: (acc[d.reason] ?? 0) + 1,
          }),
          {},
        ),
        nonOrganicSections: Object.keys(raw ?? {}).filter(
          (k) => !['organic', 'searchParameters', 'credits'].includes(k),
        ),
        urls,
        domains: [...new Set(urls.map(hostOf))].sort(),
        historical: {
          ...h,
          comparability:
            h.model === 'google-ai-mode'
              ? 'NOT APPLES TO APPLES (historical = SerpApi google_ai_mode narrative; Serper = organic SERP)'
              : 'comparable (both organic SERP)',
          sharedDomains: h.domains.filter((d) => urls.map(hostOf).includes(d)),
        },
        rawFile,
      });
    }

    // Adapter cache: a repeated identical request must be served from the
    // Serper-namespaced cache with no new provider request.
    const liveBeforeRepeat = liveCalls.search + cachedCalls.search;
    const repeat = await grounded.search({
      destinationName: searchCorpus[0].destinationName,
      requestedThemes: searchCorpus[0].requestedThemes,
      query: searchCorpus[0].query,
    });
    const cacheCheck = {
      aiCacheWrites: aiCache.writes,
      aiCacheHits: aiCache.hits,
      repeatStatus: repeat.groundingStatus,
      serperRequestsForRepeat:
        liveCalls.search + cachedCalls.search - liveBeforeRepeat,
      cacheKeys: [...aiCache.store.keys()].map((k) =>
        JSON.parse(k)[0].slice(0, 40),
      ),
    };
    expect(cacheCheck.serperRequestsForRepeat).toBe(0);

    // Locale characterization (one call): what Serper echoes/applies for
    // gl/hl/location on the same real query.
    let localeProbe: any = null;
    if (PHASE === 'all') {
      const q = history[history.length - 1].query;
      const { data, meta } = await serper.search({
        q,
        gl: COUNTRY_GL,
        hl: 'es',
        location: DESTINATION_TEXT,
        num: 10,
      });
      const urls = (data.organic ?? [])
        .map((o) => o.link)
        .filter(Boolean) as string[];
      const baseline = searchRows.find((r) => r.query === q);
      localeProbe = {
        query: q,
        request: {
          gl: COUNTRY_GL,
          hl: 'es',
          location: DESTINATION_TEXT,
          num: 10,
        },
        httpStatus: meta.httpStatus,
        durationMs: meta.durationMs,
        credits: data.credits ?? null,
        searchParameters: data.searchParameters,
        organicCount: data.organic?.length ?? 0,
        domains: [...new Set(urls.map(hostOf))].sort(),
        overlapWithBaselineUrls: urls.filter((u) => baseline?.urls.includes(u))
          .length,
        rawFile: serper.lastRawFile,
      };
    }

    // Error contract: invalid key (one call) and missing key (no call).
    let errorProbes: any[] = [];
    if (PHASE === 'all') {
      const bad = new SerperApiService(
        configFromEnv({ SERPER_API_KEY: 'invalid-key-for-spike' }),
      );
      // Recorded once; re-runs reuse it instead of re-sending a bad key.
      const errorFile = path.join(RAW_DIR, 'errors', 'invalid-key.json');
      const e1: Partial<SerperApiError> = fs.existsSync(errorFile)
        ? JSON.parse(fs.readFileSync(errorFile, 'utf8'))
        : await bad.search({ q: 'Plaza Dorrego' }).catch((e) => {
            fs.mkdirSync(path.dirname(errorFile), { recursive: true });
            const rec = {
              code: e.code,
              httpStatus: e.httpStatus,
              responseBody: redact(e.responseBody ?? ''),
              durationMs: e.durationMs,
            };
            fs.writeFileSync(errorFile, JSON.stringify(rec, null, 2) + '\n');
            return rec;
          });
      const none = new SerperApiService(
        configFromEnv({ SERPER_API_KEY: undefined }),
      );
      const e2 = await none.search({ q: 'Plaza Dorrego' }).catch((e) => e);
      const g2 = await new SerperGroundedSearchService(
        none,
        new InMemoryAiCache() as unknown as AiCacheService,
      ).search({
        destinationName: 'Buenos Aires',
        requestedThemes: [],
        query: 'x',
      });
      errorProbes = [
        {
          case: 'invalid key',
          code: e1.code,
          httpStatus: e1.httpStatus,
          body: redact(e1.responseBody ?? ''),
          durationMs: e1.durationMs,
        },
        { case: 'missing key (client)', code: (e2 as SerperApiError).code },
        {
          case: 'missing key (grounded adapter)',
          groundingStatus: g2.groundingStatus,
          failureReason: g2.failureReason,
        },
      ];
    }

    // ── B/C. /maps and /places ────────────────────────────────────────────
    const placeRows: any[] = [];
    const corpus = PHASE === 'probe' ? CORPUS.slice(0, 1) : CORPUS;
    const runPlace = async (
      hint: Hint,
      query: string,
      endpoint: 'maps' | 'places',
      variant: string,
      request: SerperMapsRequest | SerperPlacesRequest,
      role:
        | 'production-hint'
        | 'experimental-control'
        | 'geo-context-control'
        | 'locale-control',
    ) => {
      let data: {
        places?: SerperPlaceResult[];
        searchParameters?: unknown;
        ll?: string;
        credits?: number;
      } | null = null;
      let meta: SerperCallResult<unknown>['meta'] | null = null;
      let failure: string | null = null;
      try {
        const res =
          endpoint === 'maps'
            ? await serper.searchMaps(request as SerperMapsRequest)
            : await serper.searchPlaces(request as SerperPlacesRequest);
        data = res.data;
        meta = res.meta;
      } catch (e: any) {
        failure = `${e.code ?? 'error'}:${e.httpStatus ?? ''}`;
      }
      const hist = HISTORICAL_GOOGLE_IDS[hint.hint];
      const candidates = evaluate(
        data?.places,
        hint.truth,
        hist ?? SPIKE_ESTABLISHED_GOOGLE_IDS[hint.hint],
      );
      const correct = candidates.find((c) => c.isCorrect);
      placeRows.push({
        hint: hint.hint,
        group: hint.group,
        role,
        endpoint,
        variant,
        query,
        request,
        httpStatus: meta?.httpStatus ?? null,
        durationMs: meta?.durationMs ?? null,
        credits: data?.credits ?? null,
        failure,
        searchParameters: data?.searchParameters,
        responseLl: data?.ll,
        resultCount: candidates.length,
        singleResult: candidates.length === 1,
        correctPresent: !!correct,
        correctRank: correct?.rank ?? null,
        correct: correct ?? null,
        topIsCorrect: candidates[0]?.isCorrect ?? false,
        outside50kmCount: candidates.filter((c) => c.outside50km).length,
        maxDistanceFromCenterKm: Math.max(
          0,
          ...candidates.map((c) => c.distanceFromCenterKm ?? 0),
        ),
        withPlaceId: candidates.filter((c) => c.placeId).length,
        withCid: candidates.filter((c) => c.cid).length,
        withCoordinates: candidates.filter((c) => c.latitude !== undefined)
          .length,
        identity: hist
          ? {
              historicalPlaceId: hist.placeId,
              historicalCid: hist.cid,
              osm: hist.osm,
              placeIdConverges: correct?.placeId === hist.placeId,
              cidConverges: correct?.cid === hist.cid,
              correctPlaceId: correct?.placeId ?? null,
              correctCid: correct?.cid ?? null,
            }
          : undefined,
        prior: prior(hint.hint, query),
        candidates,
        rawFile: serper.lastRawFile,
        fromRawCache: serper.lastFromCache,
      });
    };

    for (const hint of corpus) {
      const queries = [
        ...hint.queries.map((q) => ({ q, role: 'production-hint' as const })),
        ...(PHASE === 'all' ? (hint.experimental ?? []) : []).map((q) => ({
          q,
          role: 'experimental-control' as const,
        })),
      ];
      for (const { q, role } of queries) {
        await runPlace(
          hint,
          q,
          'maps',
          'M1 ll=@BA,12z gl=ar',
          { q, ll: MAPS_LL, gl: COUNTRY_GL },
          role,
        );
        await runPlace(
          hint,
          q,
          'places',
          'PL1 location="Buenos Aires, Argentina" gl=ar',
          { q, location: DESTINATION_TEXT, gl: COUNTRY_GL },
          role,
        );
      }
      if (PHASE === 'all' && LOCALE_CONTROLS.includes(hint.hint)) {
        const q = hint.queries[0];
        await runPlace(
          hint,
          q,
          'maps',
          'M1-es ll=@BA,12z gl=ar hl=es',
          { q, ll: MAPS_LL, gl: COUNTRY_GL, hl: 'es' },
          'locale-control',
        );
        await runPlace(
          hint,
          q,
          'places',
          'PL1-es location gl=ar hl=es',
          { q, location: DESTINATION_TEXT, gl: COUNTRY_GL, hl: 'es' },
          'locale-control',
        );
      }
      if (PHASE === 'all' && NO_CONTEXT_CONTROLS.includes(hint.hint)) {
        const q = hint.queries[0];
        await runPlace(
          hint,
          q,
          'maps',
          'M0 no ll/gl',
          { q },
          'geo-context-control',
        );
        await runPlace(
          hint,
          q,
          'places',
          'PL0 no location/gl',
          { q },
          'geo-context-control',
        );
      }
    }

    // ── Performance summary ───────────────────────────────────────────────
    const perf = (['search', 'maps', 'places'] as SerperEndpoint[]).map(
      (endpoint) => {
        const durations = [
          ...(endpoint === 'search'
            ? [...searchRows.map((r) => r.durationMs), localeProbe?.durationMs]
            : placeRows
                .filter((r) => r.endpoint === endpoint)
                .map((r) => r.durationMs)),
        ].filter((d): d is number => typeof d === 'number');
        const failures =
          endpoint === 'search'
            ? searchRows.filter((r) => r.groundingStatus === 'failed').length
            : placeRows.filter((r) => r.endpoint === endpoint && r.failure)
                .length;
        return {
          endpoint,
          samples: durations.length,
          medianMs: percentile(durations, 50),
          p95Ms: durations.length >= 20 ? percentile(durations, 95) : null,
          maxMs: durations.length ? Math.max(...durations) : null,
          failures,
        };
      },
    );

    // Every raw file is exactly one successful live Serper request across
    // all runs of this harness (re-runs reuse raw/ instead of re-calling).
    const cumulative = (['search', 'maps', 'places'] as SerperEndpoint[]).map(
      (endpoint) => {
        const dir = path.join(RAW_DIR, endpoint);
        const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
        const credits = files.reduce((sum, f) => {
          const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          return (
            sum + (typeof rec.data?.credits === 'number' ? rec.data.credits : 0)
          );
        }, 0);
        return {
          endpoint,
          successfulRequests: files.length,
          creditsReported: credits,
        };
      },
    );

    const matrix = {
      generatedAt: new Date().toISOString(),
      phase: PHASE,
      geographicContext: {
        center: CENTER,
        radiusKm: RADIUS_KM,
        mapsLl: MAPS_LL,
        placesLocation: DESTINATION_TEXT,
        gl: COUNTRY_GL,
        note: 'Same center/radius as the prior PLACE spike; M1 mirrors its SerpApi S1 viewport.',
      },
      requestCounts: {
        cumulativeAcrossRuns: cumulative,
        liveThisRun: liveCalls,
        reusedFromRawCache: cachedCalls,
        creditsReportedThisRun: creditsByEndpoint,
        errorProbeCalls: PHASE === 'all' ? 1 : 0,
      },
      hostCallsThisRun: hostCalls,
      serpApiCallsThisRun: hostCalls['serpapi.com'] ?? 0,
      performance: perf,
      search: { rows: searchRows, localeProbe, cacheCheck, errorProbes },
      places: placeRows,
    };
    expect(matrix.serpApiCallsThisRun).toBe(0);

    fs.writeFileSync(
      path.join(
        OUT_DIR,
        PHASE === 'probe' ? 'matrix.probe.json' : 'matrix.json',
      ),
      JSON.stringify(matrix, null, 2) + '\n',
    );
    if (PHASE === 'all') {
      fs.writeFileSync(path.join(OUT_DIR, 'summary.md'), renderSummary(matrix));
    }
  });
});

// ── summary.md (generated) ────────────────────────────────────────────────
function cell(r: any): string {
  if (!r) return '';
  if (r.failure) return 'FAIL';
  if (r.hint === 'San Martín') return `— (${r.resultCount})`;
  if (!r.correctPresent) return `✗ (${r.resultCount})`;
  return `#${r.correctRank}/${r.resultCount}`;
}

function renderSummary(m: any): string {
  const lines: string[] = [];
  lines.push('# Serper provider characterization -- summary', '');
  lines.push(
    `Generated by \`be/test/live/serper-provider-characterization.live-spec.ts\` (${m.generatedAt}). ` +
      'Cell = rank of the correct real object / result count (`✗` = not returned, `—` = no single ground truth). ' +
      'Prior-provider columns are read from the frozen `stage3-place-provider-search-characterization-2026-09-25/matrix.json`; none of them were called.',
    '',
  );
  lines.push(
    '## /search (production adapter, `GROUNDED_SEARCH_PROVIDER=serper`)',
    '',
  );
  lines.push(
    '| query | status | organic | usable evidence | credits | ms | historical SerpApi | shared domains |',
  );
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const r of m.search.rows) {
    lines.push(
      `| ${r.query} | ${r.groundingStatus} | ${r.organicCount} | ${r.usableEvidence} | ${r.credits ?? ''} | ${r.durationMs ?? ''} | ${r.historical.model}: ${r.historical.evidenceCount} ev / ${r.historical.distinctUrls.length} urls — **NOT APPLES TO APPLES** | ${r.historical.sharedDomains.join(', ') || '—'} |`,
    );
  }
  lines.push('');
  lines.push(`Cache check: ${JSON.stringify(m.search.cacheCheck)}`, '');
  if (m.search.localeProbe) {
    lines.push(
      `Locale probe: ${JSON.stringify({ ...m.search.localeProbe, domains: undefined })}`,
      '',
    );
  }
  lines.push('## PLACE: Serper Maps vs Places vs frozen baselines', '');
  const prodRows = m.places.filter(
    (r: any) =>
      r.role === 'production-hint' || r.role === 'experimental-control',
  );
  const keys = [
    ...new Set(prodRows.map((r: any) => `${r.hint}\u0000${r.query}`)),
  ] as string[];
  lines.push(
    '| hint | query | role | Serper Maps M1 | Serper Places PL1 | Geoapify A1 (prod) | Geoapify G1 | Google P1 | Google P3 | SerpApi Maps |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const key of keys) {
    const [hint, query] = key.split('\u0000');
    const maps = prodRows.find(
      (r: any) => r.hint === hint && r.query === query && r.endpoint === 'maps',
    );
    const places = prodRows.find(
      (r: any) =>
        r.hint === hint && r.query === query && r.endpoint === 'places',
    );
    const p = maps?.prior ?? {};
    lines.push(
      `| ${hint} | ${query} | ${maps?.role ?? ''} | ${cell(maps)} | ${cell(places)} | ${p['Geoapify A1 (prod)'] ?? ''} | ${p['Geoapify G1 (recommended)'] ?? ''} | ${p['Google P1 (prod shape)'] ?? ''} | ${p['Google P3 (es/AR)'] ?? ''} | ${p['SerpApi Maps S1/S3'] ?? ''} |`,
    );
  }
  lines.push('', '## Locale controls (hl=es vs default)', '');
  lines.push(
    '| hint | endpoint | variant | cell | top result (type) | correct object title | matchedBy |',
  );
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of m.places.filter(
    (x: any) =>
      LOCALE_CONTROLS.includes(x.hint) &&
      (x.role === 'locale-control' || x.role === 'production-hint'),
  )) {
    lines.push(
      `| ${r.hint} | ${r.endpoint} | ${r.variant} | ${cell(r)} | ${r.candidates[0]?.title ?? ''} (${r.candidates[0]?.type ?? ''}) | ${r.correct?.title ?? ''} | ${r.correct?.matchedBy ?? ''} |`,
    );
  }
  lines.push('', '## Geo-context controls (no ll / no location)', '');
  lines.push(
    '| hint | endpoint | cell | results | outside 50 km | max km from BA | top result |',
  );
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of m.places.filter(
    (x: any) => x.role === 'geo-context-control',
  )) {
    lines.push(
      `| ${r.hint} | ${r.endpoint} | ${cell(r)} | ${r.resultCount} | ${r.outside50kmCount} | ${r.maxDistanceFromCenterKm} | ${r.candidates[0]?.title ?? ''} — ${r.candidates[0]?.address ?? ''} |`,
    );
  }
  lines.push(
    '',
    '## Identity fields per endpoint (production-hint + control rows)',
    '',
  );
  lines.push(
    '| endpoint | rows | results | with placeId | with cid | with coordinates | single-result rows | outside 50 km |',
  );
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const ep of ['maps', 'places']) {
    const rows = m.places.filter((r: any) => r.endpoint === ep);
    const sum = (f: (r: any) => number) =>
      rows.reduce((a: number, r: any) => a + f(r), 0);
    lines.push(
      `| ${ep} | ${rows.length} | ${sum((r) => r.resultCount)} | ${sum((r) => r.withPlaceId)} | ${sum((r) => r.withCid)} | ${sum((r) => r.withCoordinates)} | ${rows.filter((r: any) => r.singleResult).length} | ${sum((r) => r.outside50kmCount)} |`,
    );
  }
  lines.push('', '## Requests and latency', '');
  lines.push(`Requests: ${JSON.stringify(m.requestCounts)}`, '');
  lines.push(
    `Hosts contacted this run: ${JSON.stringify(m.hostCallsThisRun)} — SerpApi calls: **${m.serpApiCallsThisRun}**`,
    '',
  );
  lines.push('| endpoint | samples | median ms | p95 ms | max ms | failures |');
  lines.push('|---|---|---|---|---|---|');
  for (const p of m.performance) {
    lines.push(
      `| ${p.endpoint} | ${p.samples} | ${p.medianMs ?? ''} | ${p.p95Ms ?? 'n<20'} | ${p.maxMs ?? ''} | ${p.failures} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
