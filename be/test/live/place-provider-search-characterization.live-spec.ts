import * as fs from 'fs';
import * as path from 'path';
import axios, { InternalAxiosRequestConfig } from 'axios';
import { ConfigService } from '@nestjs/config';
import { GooglePlacesApiService } from 'src/modules/integrations/google-places/services/google-places-api.service';
import { GeoapifyPlacesApiService } from 'src/modules/integrations/google-places/services/geoapify-places-api.service';
import { PlaceData } from 'src/modules/integrations/google-places/interfaces/places-api.interface';
import { NominatimApiService } from 'src/modules/integrations/osm/services/nominatim-api.service';
import { OverpassApiService } from 'src/modules/integrations/osm/services/overpass-api.service';
import { OsmPlacesService } from 'src/modules/integrations/osm/services/osm-places.service';
import { DestinationResolutionService } from 'src/modules/tours/services/destination-resolution.service';
import { selectBestPlaceCandidate } from 'src/modules/tours/services/experience-proposal-resolver.service';
import { normalizeGeoName } from 'src/modules/tours/utils/nominatim-match.util';
import { calculateDistance } from '@shared/utils/distance.utils';
import { loadRootEnv } from './discovery/discovery-live.helper';

loadRootEnv();
jest.setTimeout(30 * 60 * 1000);

/**
 * Stage 3 provider characterization spike (2026-09-25) -- measures whether
 * PLACE misses come from the provider not knowing a place, or from the way
 * Zig-Zag calls it (endpoint, type filter, geo filter/bias, language, result
 * window). Four providers, same corpus, same geography:
 *
 *   A  Geoapify /v1/geocode/autocomplete  (current production PLACE text path)
 *   B  Geoapify /v1/geocode/search        (free-form `text=` and structured `name=`)
 *   C  Google Places  POST /v1/places:searchText (via GooglePlacesApiService)
 *   D  SerpApi engine=google_maps         (Google Maps control only)
 *
 * Characterization only: nothing is persisted, no production path is
 * rewired. The provider's own answer (is the correct object in the result
 * list, at what rank) is recorded separately from what Zig-Zag's current
 * `selectBestPlaceCandidate` would pick from it.
 *
 *   RUN_SPIKE_PREFLIGHT=1 yarn test:live:discovery --testPathPattern=place-provider-search-characterization
 *
 * SerpApi responses are cached under raw/ and reused on re-run (the account
 * has a tiny monthly quota); every other provider is always called live.
 */
const RUN = process.env.RUN_SPIKE_PREFLIGHT === '1';
const describeIfRun = RUN ? describe : describe.skip;

const OUT_DIR = path.join(
  __dirname,
  '../../../spikes/stage3-place-provider-search-characterization-2026-09-25',
);
const RAW_DIR = path.join(OUT_DIR, 'raw');

const DESTINATION_TEXT = 'Buenos Aires, Argentina';
// Same wizard-style selected point used by every prior Stage 3 BA spike.
const SELECTED_POINT = { latitude: -34.6037, longitude: -58.3816 };
// Historical characterization parameter (2026-09-25): the then-production
// 50 km Places bias. That constant was deleted by the spec 2026-10-02 Part II
// cutover (search windows now derive from scope geometry); kept here only so
// this characterization stays reproducible.
const RADIUS_METERS = 50_000;
const PRODUCTION_WINDOW = 3; // resolveViaPlaces() maxResultCount
const WIDE_WINDOW = 10;
const SERPAPI_BUDGET = 8;

// Ground truth used ONLY to label rows in this spike (never production).
// `name` is a loose label predicate; `point`/`toleranceM` pin the real
// object so a same-named neighbor (e.g. Bar Plaza Dorrego facing the plaza,
// or the Basilica sharing Farmacia la Estrella's corner) is not counted.
interface Truth {
  label: string;
  point: { latitude: number; longitude: number };
  toleranceM: number;
  name: RegExp;
  notName?: RegExp;
  expectStreet?: boolean;
}

interface Hint {
  hint: string;
  group: 'main' | 'mafalda' | 'route-control' | 'negative';
  queries: string[];
  truth?: Truth;
}

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
    queries: ['Mafalda Statue', 'Mafalda', 'Estatua de Mafalda'],
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
      /\b(bar|cafe|hotel|hostel|restaurant|restaurante|suites|apart)\b/,
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
    group: 'main',
    queries: ['Galería Güemes'],
    truth: T(
      'Galería Güemes, Florida 165 (the gallery, not its rooftop Mirador)',
      -34.6063,
      -58.3745,
      200,
      /guemes/,
      /mirador/,
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
    hint: 'Defensa Street',
    group: 'route-control',
    queries: ['Defensa Street'],
    truth: {
      label: 'calle Defensa (CABA) -- ROUTE control',
      point: { latitude: -34.6155, longitude: -58.3718 },
      toleranceM: 2500,
      name: /defensa/,
      expectStreet: true,
    },
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
  {
    // Bare, highly common name: there is no single correct answer inside
    // CABA; measured only for collisions / wrong-city leakage.
    hint: 'San Martín',
    group: 'negative',
    queries: ['San Martín'],
  },
];

type Dim = {
  family: 'geoapify' | 'google' | 'serpapi';
  endpoint: string;
  mode: 'text' | 'structured';
  type: string | null;
  filter: boolean;
  bias: boolean;
  lang: string | null;
  region: string | null;
  window: number;
  windowParam: string;
  cityInText: boolean;
  queryForm: string;
};

interface Candidate {
  rank: number;
  title?: string;
  providerId?: string;
  crossIdentity?: string | null;
  category?: string | null;
  resultType?: string | null;
  confidence?: number | null;
  matchType?: string | null;
  datasource?: string | null;
  lat?: number;
  lon?: number;
  address?: string;
  distanceFromCenterKm?: number;
  distanceFromTruthM?: number;
  isCorrect: boolean;
  outsideDestination: boolean;
}

interface Row {
  hint: string;
  group: string;
  provider: string;
  variant: string;
  endpoint: string;
  queryMode: string;
  query: string;
  typeFilter: string | null;
  geoFilter: string | null;
  geoBias: string | null;
  language: string | null;
  region: string | null;
  resultWindow: string;
  status: number | string;
  durationMs: number;
  resultCount: number;
  providerFailure: string | null;
  correctPresent: boolean | null;
  correctRank: number | null;
  correct: Candidate | null;
  wrongCandidates: Candidate[];
  outsideDestinationCount: number;
  zigzagSelector: {
    selectedTitle?: string;
    selectedIsCorrect: boolean | null;
  } | null;
  diagnosis: string | null;
  rawFile: string | null;
  dims: Dim;
}

const slug = (s: string) =>
  normalizeGeoName(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const SECRETS = () =>
  [
    process.env.GEOAPIFY_API_KEY,
    process.env.GOOGLE_MAPS_API_KEY,
    process.env.SERPAPI_API_KEY,
  ].filter((k): k is string => !!k && k.length > 6);

function redact<T>(value: T): T {
  let json = JSON.stringify(value ?? null);
  for (const secret of SECRETS()) json = json.split(secret).join('<REDACTED>');
  json = json.replace(
    /("(?:apiKey|api_key|key|X-Goog-Api-Key)"\s*:\s*)"[^"]*"/gi,
    '$1"<REDACTED>"',
  );
  return JSON.parse(json);
}

function writeRaw(hint: string, file: string, payload: unknown): string {
  const dir = path.join(RAW_DIR, slug(hint));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, file),
    JSON.stringify(redact(payload), null, 2),
  );
  return path.relative(OUT_DIR, path.join(dir, file));
}

function label(
  truth: Truth | undefined,
  c: Omit<
    Candidate,
    | 'isCorrect'
    | 'outsideDestination'
    | 'distanceFromTruthM'
    | 'distanceFromCenterKm'
  >,
): Candidate {
  const hasPoint = Number.isFinite(c.lat) && Number.isFinite(c.lon);
  const point = hasPoint ? { latitude: c.lat!, longitude: c.lon! } : null;
  const distanceFromCenterKm = point
    ? calculateDistance(SELECTED_POINT, point)
    : undefined;
  const distanceFromTruthM =
    point && truth
      ? Math.round(calculateDistance(truth.point, point) * 1000)
      : undefined;
  const name = normalizeGeoName(c.title ?? '');
  const isStreet = /street|route|road/i.test(
    `${c.resultType ?? ''} ${c.category ?? ''}`,
  );
  // A bus stop / bike-share dock / station named after a place is a
  // different real object, never the place itself (labeling only).
  const isTransitProxy =
    /public_transport|rental\.|bus_st|transit_station|parking/i.test(
      `${c.resultType ?? ''} ${c.category ?? ''}`,
    );
  const isCorrect =
    !!truth &&
    distanceFromTruthM !== undefined &&
    distanceFromTruthM <= truth.toleranceM &&
    truth.name.test(name) &&
    !(truth.notName && truth.notName.test(name)) &&
    !isTransitProxy &&
    (!truth.expectStreet || isStreet);
  return {
    ...c,
    distanceFromCenterKm:
      distanceFromCenterKm !== undefined
        ? Math.round(distanceFromCenterKm * 10) / 10
        : undefined,
    distanceFromTruthM,
    isCorrect,
    outsideDestination:
      distanceFromCenterKm !== undefined &&
      distanceFromCenterKm * 1000 > RADIUS_METERS,
  };
}

function selectorOn(
  hintQuery: string,
  candidates: Candidate[],
): Row['zigzagSelector'] {
  const asPlaceData: PlaceData[] = candidates.map((c) => ({
    id: c.providerId ?? '',
    name: c.title,
    displayName: c.title ? { text: c.title } : undefined,
    location:
      Number.isFinite(c.lat) && Number.isFinite(c.lon)
        ? { latitude: c.lat!, longitude: c.lon! }
        : (undefined as any),
    types: [] as string[],
  }));
  const picked = selectBestPlaceCandidate(
    hintQuery,
    asPlaceData,
    SELECTED_POINT,
  );
  if (!picked) return { selectedIsCorrect: null };
  const idx = asPlaceData.indexOf(picked);
  return {
    selectedTitle: picked.displayName?.text,
    selectedIsCorrect: candidates[idx].isCorrect,
  };
}

// ---- Geoapify ------------------------------------------------------------

const GEOAPIFY_AUTOCOMPLETE =
  'https://api.geoapify.com/v1/geocode/autocomplete';
const GEOAPIFY_SEARCH = 'https://api.geoapify.com/v1/geocode/search';
const circleFilter = `circle:${SELECTED_POINT.longitude},${SELECTED_POINT.latitude},${RADIUS_METERS}`;
const proximityBias = `proximity:${SELECTED_POINT.longitude},${SELECTED_POINT.latitude}`;

function geoapifyCandidates(
  truth: Truth | undefined,
  results: any[],
): Candidate[] {
  return results.map((r, i) => {
    const raw = r.datasource?.raw ?? {};
    const osmType = raw.osm_type ?? null;
    const osmId = raw.osm_id ?? null;
    return label(truth, {
      rank: i + 1,
      title: r.name ?? r.formatted,
      providerId: r.place_id,
      // Only an EXPLICIT datasource.raw osm_type/osm_id counts; the opaque
      // place_id is never parsed.
      crossIdentity: osmType && osmId ? `osm:${osmType}/${osmId}` : null,
      category: r.category ?? null,
      resultType: r.result_type ?? null,
      confidence: r.rank?.confidence ?? null,
      matchType: r.rank?.match_type ?? null,
      datasource: r.datasource?.sourcename ?? null,
      lat: r.lat,
      lon: r.lon,
      address: r.formatted,
    });
  });
}

// ---- Google Places (through the existing GooglePlacesApiService) ----------

// Pro-SKU identity fields only. Production's getFieldMask() additionally
// requests Enterprise-tier fields (rating, userRatingCount, priceLevel,
// regularOpeningHours, websiteUri), which bills the whole call as
// Enterprise -- overridden here, recorded in assessment.md.
const LEAN_GOOGLE_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.types',
  'places.primaryType',
].join(',');

// Per-call body/field-mask override applied by an axios request interceptor
// so every Google call still goes through GooglePlacesApiService.searchText
// (its own URL, auth, body shape, error classification) -- the service has
// no languageCode/regionCode/pageSize parameters of its own.
let googleOverride: {
  body?: Record<string, unknown>;
  dropMaxResultCount?: boolean;
} | null = null;
let lastGoogle: { requestBody: unknown; status: number; data: unknown } | null =
  null;

function googleCandidates(
  truth: Truth | undefined,
  places: any[],
): Candidate[] {
  return places.map((p, i) =>
    label(truth, {
      rank: i + 1,
      title: p.displayName?.text,
      providerId: p.id,
      crossIdentity: null,
      category: p.primaryType ?? (p.types ?? [])[0] ?? null,
      resultType: (p.types ?? []).join('|') || null,
      lat: p.location?.latitude,
      lon: p.location?.longitude,
      address: p.formattedAddress,
    }),
  );
}

// ---- SerpApi -------------------------------------------------------------

let serpApiLiveCalls = 0;

function serpCandidates(truth: Truth | undefined, data: any): Candidate[] {
  const list: any[] =
    data?.local_results ?? (data?.place_results ? [data.place_results] : []);
  return list.map((r, i) =>
    label(truth, {
      rank: r.position ?? i + 1,
      title: r.title,
      providerId: r.place_id,
      crossIdentity:
        [
          r.data_id ? `data_id:${r.data_id}` : null,
          r.data_cid ? `cid:${r.data_cid}` : null,
        ]
          .filter(Boolean)
          .join(' ') || null,
      category: r.type ?? (r.types ?? [])[0] ?? null,
      resultType: (r.types ?? []).join('|') || null,
      lat: r.gps_coordinates?.latitude,
      lon: r.gps_coordinates?.longitude,
      address: r.address,
    }),
  );
}

// ---- Diagnosis -----------------------------------------------------------

/**
 * Classifies a failing row by comparing it with successful sibling rows of
 * the same hint in the same provider family: the dimension whose change
 * turned a miss into a hit is the cause. Coverage gap only when no variant
 * of that provider family found the object at all.
 */
function diagnose(row: Row, all: Row[]): string | null {
  if (row.providerFailure) return 'PROVIDER_UNAVAILABLE';
  if (row.correctPresent === null) return null; // no ground truth (bare name)
  if (row.correctPresent) {
    if (row.zigzagSelector && row.zigzagSelector.selectedIsCorrect === false) {
      return 'ZIGZAG_SELECTION_BUG';
    }
    return null;
  }
  const d = row.dims;
  const hits = all.filter(
    (r) =>
      r.hint === row.hint &&
      r.dims.family === d.family &&
      r.correctPresent === true,
  );
  if (hits.length === 0) return 'PROVIDER_COVERAGE_GAP';
  const diffs = (o: Dim) => {
    const out: string[] = [];
    if (o.endpoint !== d.endpoint || o.mode !== d.mode) out.push('endpoint');
    if (o.type !== d.type) out.push('type');
    if (o.filter !== d.filter) out.push('filter');
    if (o.bias !== d.bias) out.push('bias');
    if (o.lang !== d.lang || o.region !== d.region) out.push('lang');
    if (o.window !== d.window || o.windowParam !== d.windowParam) {
      out.push('window');
    }
    if (o.cityInText !== d.cityInText) out.push('city');
    return out;
  };
  // Same query form first: a different wording succeeding is only the
  // explanation when no parameter change of THIS wording succeeds.
  const sameForm = hits.filter((r) => r.dims.queryForm === d.queryForm);
  if (sameForm.length === 0) return 'LANGUAGE_QUERY_MISMATCH';
  const byDiff = sameForm
    .map((r) => diffs(r.dims))
    .sort((a, b) => a.length - b.length);
  const minimal = byDiff[0];
  const has = (k: string) => minimal.includes(k);
  // Removing the result cap alone recovers it: result window.
  if (minimal.length === 1 && has('window')) return 'RESULT_WINDOW / RANKING';
  if (has('endpoint')) return 'WRONG_ENDPOINT';
  // Only a type filter being PRESENT can over-restrict; a miss WITHOUT the
  // filter that the filtered call finds is unfiltered noise displacing the
  // object out of the window. Blamed only when it is the sole difference.
  const typeCause = d.type
    ? 'OVER_RESTRICTIVE_TYPE_FILTER'
    : 'RESULT_WINDOW / RANKING';
  if (minimal.length === 1 && has('type')) return typeCause;
  if (has('filter') && d.filter) return 'OVER_RESTRICTIVE_GEO_FILTER';
  if (has('city') || has('bias') || has('filter')) {
    return 'INSUFFICIENT_GEO_CONTEXT';
  }
  if (has('lang')) return 'LANGUAGE_QUERY_MISMATCH';
  if (has('type')) return typeCause;
  if (has('window')) return 'RESULT_WINDOW / RANKING';
  return 'UNKNOWN';
}

describeIfRun('PLACE provider search characterization (real providers)', () => {
  const config = new ConfigService();
  const google = new GooglePlacesApiService(config);
  const geoapify = new GeoapifyPlacesApiService(config);
  const rows: Row[] = [];
  const requestCounts: Record<string, number> = {};
  let destination: Record<string, unknown> = {};
  const availability: Record<string, string> = {};

  const count = (k: string) => (requestCounts[k] = (requestCounts[k] ?? 0) + 1);

  beforeAll(() => {
    axios.interceptors.request.use((cfg: InternalAxiosRequestConfig) => {
      if (cfg.url?.includes('places.googleapis.com') && googleOverride) {
        const body = { ...(cfg.data as Record<string, unknown>) };
        if (googleOverride.dropMaxResultCount) delete body.maxResultCount;
        Object.assign(body, googleOverride.body ?? {});
        cfg.data = body;
        cfg.headers.set('X-Goog-FieldMask', LEAN_GOOGLE_FIELD_MASK);
      }
      return cfg;
    });
    axios.interceptors.response.use(
      (res) => {
        if (res.config.url?.includes('places.googleapis.com')) {
          lastGoogle = {
            requestBody: res.config.data,
            status: res.status,
            data: res.data,
          };
        }
        return res;
      },
      (err) => {
        if (err.config?.url?.includes('places.googleapis.com')) {
          lastGoogle = {
            requestBody: err.config.data,
            status: err.response?.status ?? 'network',
            data: err.response?.data ?? { message: err.message },
          };
        }
        return Promise.reject(err);
      },
    );
  });

  afterAll(() => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const r of rows) r.diagnosis = diagnose(r, rows);
    const perf: Record<string, unknown> = {};
    for (const variantKey of [...new Set(rows.map((r) => `${r.provider}`))]) {
      const ds = rows
        .filter(
          (r) => r.provider === variantKey && !r.rawFile?.includes('(cached)'),
        )
        .map((r) => r.durationMs)
        .filter((d) => d > 0)
        .sort((a, b) => a - b);
      const q = (p: number) =>
        ds.length
          ? ds[Math.min(ds.length - 1, Math.floor(p * ds.length))]
          : null;
      perf[variantKey] = {
        samples: ds.length,
        medianMs: q(0.5),
        p95Ms: ds.length >= 20 ? q(0.95) : null,
        failures: rows.filter(
          (r) => r.provider === variantKey && r.providerFailure,
        ).length,
      };
    }
    fs.writeFileSync(
      path.join(OUT_DIR, 'matrix.json'),
      JSON.stringify(
        redact({
          generatedAt: new Date().toISOString(),
          destination,
          availability,
          requestCounts,
          serpApiLiveCalls,
          crossIdentity,
          googleFieldMask: LEAN_GOOGLE_FIELD_MASK,
          performance: perf,
          rows: rows.map(({ dims, ...r }) => ({ ...r, dims })),
        }),
        null,
        2,
      ),
    );
    // eslint-disable-next-line no-console
    console.info(
      `Wrote ${rows.length} rows to ${OUT_DIR}/matrix.json`,
      requestCounts,
    );
  });

  function push(
    h: Hint,
    query: string,
    provider: string,
    variant: string,
    dims: Dim,
    meta: Partial<Row>,
    candidates: Candidate[],
    opts: {
      status: number | string;
      durationMs: number;
      failure?: string | null;
      rawFile: string | null;
      selector: boolean;
    },
  ) {
    const correct = candidates.find((c) => c.isCorrect) ?? null;
    rows.push({
      hint: h.hint,
      group: h.group,
      provider,
      variant,
      endpoint: dims.endpoint,
      queryMode: dims.mode,
      query,
      typeFilter: dims.type,
      geoFilter: dims.filter ? `circle ${RADIUS_METERS}m @ BA` : null,
      geoBias: dims.bias ? 'proximity/circle @ BA' : null,
      language: dims.lang,
      region: dims.region,
      resultWindow: `${dims.windowParam}=${dims.window}`,
      status: opts.status,
      durationMs: opts.durationMs,
      resultCount: candidates.length,
      providerFailure: opts.failure ?? null,
      correctPresent: opts.failure ? null : h.truth ? !!correct : null,
      correctRank: correct?.rank ?? null,
      correct,
      wrongCandidates: candidates.filter((c) => !c.isCorrect),
      outsideDestinationCount: candidates.filter((c) => c.outsideDestination)
        .length,
      zigzagSelector:
        opts.selector && !opts.failure && h.truth
          ? selectorOn(query, candidates)
          : null,
      diagnosis: null,
      rawFile: opts.rawFile,
      dims,
      ...meta,
    });
  }

  it('resolves the shared Buenos Aires destination once via DestinationResolutionService', async () => {
    const nominatim = new NominatimApiService(config);
    const overpass = new OverpassApiService(config);
    const osmPlaces = new OsmPlacesService(overpass as any, config);
    const resolver = new DestinationResolutionService(
      nominatim as any,
      osmPlaces,
    );
    const t0 = Date.now();
    const resolution: any = await resolver.resolveDestination(
      DESTINATION_TEXT,
      SELECTED_POINT,
    );
    destination = {
      destinationName: DESTINATION_TEXT,
      selectedPoint: SELECTED_POINT,
      radiusMeters: RADIUS_METERS,
      scale: resolution.scale,
      countryCode: resolution.countryCode,
      country: resolution.country,
      selectedResult: resolution.selectedResult,
      settlementResult: resolution.settlementResult,
      degradationReason: resolution.degradationReason ?? null,
      boundaryName: resolution.boundary?.name,
      durationMs: Date.now() - t0,
      note: 'Search center is the wizard-selected point (what resolveViaPlaces receives as destinationPoint); radius is the historical 50 km bias (deleted 2026-10-02). San Telmo is NOT used as a hard scope.',
    };
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(RAW_DIR, '..', 'destination.json'), '');
    fs.mkdirSync(RAW_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(RAW_DIR, 'destination-resolution.json'),
      JSON.stringify(redact(resolution), null, 2),
    );
    fs.rmSync(path.join(RAW_DIR, '..', 'destination.json'));
    availability.GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY
      ? 'present'
      : 'UNAVAILABLE';
    availability.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY
      ? 'present'
      : 'UNAVAILABLE';
    availability.SERPAPI_API_KEY = process.env.SERPAPI_API_KEY
      ? 'present'
      : 'UNAVAILABLE';
    expect(resolution.scale).toBeDefined();
  });

  it('Geoapify autocomplete + forward geocoding matrix', async () => {
    for (const h of CORPUS) {
      for (const query of h.queries) {
        const qf = query;
        const base: Omit<
          Dim,
          'endpoint' | 'mode' | 'type' | 'filter' | 'bias' | 'lang' | 'window'
        > = {
          family: 'geoapify',
          region: null,
          windowParam: 'limit',
          cityInText: false,
          queryForm: qf,
        };

        // A1 -- EXACT production path: GeoapifyPlacesApiService.searchText,
        // same params resolveViaPlaces sends. Raw is re-fetched below with
        // identical params only to keep the provider's unmapped fields.
        {
          const t0 = Date.now();
          let failure: string | null = null;
          let mapped: PlaceData[] = [];
          try {
            count('geoapify.autocomplete');
            mapped = (
              await geoapify.searchText({
                textQuery: query,
                maxResultCount: PRODUCTION_WINDOW,
                locationBias: { center: SELECTED_POINT, radius: RADIUS_METERS },
              })
            ).data;
          } catch (e: any) {
            failure = e.message;
          }
          const durationMs = Date.now() - t0;
          const candidates = mapped.map((p, i) =>
            label(h.truth, {
              rank: i + 1,
              title: p.displayName?.text ?? p.name,
              providerId: p.id,
              crossIdentity: null,
              category: p.primaryType ?? null,
              lat: p.location?.latitude,
              lon: p.location?.longitude,
              address: p.formattedAddress,
            }),
          );
          const rawFile = writeRaw(
            h.hint,
            `geoapify-autocomplete-A1-current-mapped-${slug(query)}.json`,
            {
              note: 'PlaceData[] exactly as GeoapifyPlacesApiService.searchText returns it (production path)',
              mapped,
              failure,
            },
          );
          push(
            h,
            query,
            'geoapify-autocomplete',
            'A1 current production (service, limit=3)',
            {
              ...base,
              endpoint: 'autocomplete',
              mode: 'text',
              type: 'amenity',
              filter: true,
              bias: true,
              lang: null,
              window: PRODUCTION_WINDOW,
            },
            {},
            candidates,
            {
              status: failure ? 'error' : 200,
              durationMs,
              failure,
              rawFile,
              selector: true,
            },
          );
        }

        const variants: Array<{
          id: string;
          endpoint: 'autocomplete' | 'search';
          mode: 'text' | 'structured';
          params: Record<string, unknown>;
          dims: Partial<Dim>;
          only?: boolean;
        }> = [
          {
            id: 'A1w current params, limit=10',
            endpoint: 'autocomplete',
            mode: 'text',
            params: {
              text: query,
              type: 'amenity',
              filter: circleFilter,
              bias: proximityBias,
            },
            dims: { type: 'amenity', filter: true, bias: true },
          },
          {
            id: 'A2 no type',
            endpoint: 'autocomplete',
            mode: 'text',
            params: { text: query, filter: circleFilter, bias: proximityBias },
            dims: { type: null, filter: true, bias: true },
          },
          {
            id: 'A3 filter only',
            endpoint: 'autocomplete',
            mode: 'text',
            params: { text: query, filter: circleFilter },
            dims: { type: null, filter: true, bias: false },
          },
          {
            id: 'A4 bias only',
            endpoint: 'autocomplete',
            mode: 'text',
            params: { text: query, bias: proximityBias },
            dims: { type: null, filter: false, bias: true },
          },
          {
            id: 'G1 search text, no type',
            endpoint: 'search',
            mode: 'text',
            params: { text: query, filter: circleFilter, bias: proximityBias },
            dims: { type: null, filter: true, bias: true },
          },
          {
            id: 'G2 search text, type=amenity',
            endpoint: 'search',
            mode: 'text',
            params: {
              text: query,
              type: 'amenity',
              filter: circleFilter,
              bias: proximityBias,
            },
            dims: { type: 'amenity', filter: true, bias: true },
          },
          {
            id: 'G3 structured name+city+country',
            endpoint: 'search',
            mode: 'structured',
            params: { name: query, city: 'Buenos Aires', country: 'Argentina' },
            dims: { type: null, filter: false, bias: false },
          },
          {
            id: 'G4 structured name+city+country + filter/bias',
            endpoint: 'search',
            mode: 'structured',
            params: {
              name: query,
              city: 'Buenos Aires',
              country: 'Argentina',
              filter: circleFilter,
              bias: proximityBias,
            },
            dims: { type: null, filter: true, bias: true },
          },
          {
            id: 'G5 structured name + filter/bias (no city)',
            endpoint: 'search',
            mode: 'structured',
            params: { name: query, filter: circleFilter, bias: proximityBias },
            dims: { type: null, filter: true, bias: true },
          },
        ];
        if (
          h.group === 'mafalda' ||
          h.hint === 'Farmacia la Estrella' ||
          h.hint === 'Recoleta Cemetery'
        ) {
          for (const lang of ['es', 'en']) {
            variants.push({
              id: `A5 no type, lang=${lang}`,
              endpoint: 'autocomplete',
              mode: 'text',
              params: {
                text: query,
                filter: circleFilter,
                bias: proximityBias,
                lang,
              },
              dims: { type: null, filter: true, bias: true, lang },
            });
            variants.push({
              id: `G1 lang=${lang}`,
              endpoint: 'search',
              mode: 'text',
              params: {
                text: query,
                filter: circleFilter,
                bias: proximityBias,
                lang,
              },
              dims: { type: null, filter: true, bias: true, lang },
            });
          }
        }

        for (const v of variants) {
          const url =
            v.endpoint === 'autocomplete'
              ? GEOAPIFY_AUTOCOMPLETE
              : GEOAPIFY_SEARCH;
          const params = {
            ...v.params,
            limit: WIDE_WINDOW,
            format: 'json',
            apiKey: process.env.GEOAPIFY_API_KEY,
          };
          const t0 = Date.now();
          let status: number | string = 0;
          let data: any = null;
          let failure: string | null = null;
          try {
            count(`geoapify.${v.endpoint}`);
            const res = await axios.get(url, { params, timeout: 10_000 });
            status = res.status;
            data = res.data;
          } catch (e: any) {
            status = e.response?.status ?? 'network';
            data = e.response?.data ?? null;
            failure = `${status} ${e.message}`;
          }
          const durationMs = Date.now() - t0;
          const rawFile = writeRaw(
            h.hint,
            `geoapify-${v.endpoint}-${slug(v.id.split(' ')[0])}${v.dims.lang ? '-' + v.dims.lang : ''}-${slug(query)}.json`,
            { request: { url, params }, status, durationMs, response: data },
          );
          const candidates = geoapifyCandidates(h.truth, data?.results ?? []);
          push(
            h,
            query,
            `geoapify-${v.endpoint}`,
            v.id,
            {
              ...base,
              endpoint: v.endpoint,
              mode: v.mode,
              type: v.dims.type ?? null,
              filter: !!v.dims.filter,
              bias: !!v.dims.bias,
              lang: v.dims.lang ?? null,
              window: WIDE_WINDOW,
            },
            {},
            candidates,
            { status, durationMs, failure, rawFile, selector: true },
          );
        }
      }
    }
  });

  const crossIdentity: Array<Record<string, unknown>> = [];

  it('Geoapify explicit OSM cross-identity probe (no opaque-id parsing)', async () => {
    for (const h of CORPUS.filter((c) => c.truth)) {
      const hit = rows.find(
        (r) => r.hint === h.hint && r.dims.family === 'geoapify' && r.correct,
      );
      if (!hit?.correct?.providerId) continue;
      // 1. Place Details by the provider's own place_id.
      const t0 = Date.now();
      let status: number | string = 0;
      let data: any = null;
      try {
        count('geoapify.place-details');
        const res = await axios.get(
          'https://api.geoapify.com/v2/place-details',
          {
            params: {
              id: hit.correct.providerId,
              apiKey: process.env.GEOAPIFY_API_KEY,
            },
            timeout: 10_000,
          },
        );
        status = res.status;
        data = res.data;
      } catch (e: any) {
        status = e.response?.status ?? 'network';
        data = e.response?.data ?? null;
      }
      const durationMs = Date.now() - t0;
      const rawFile = writeRaw(h.hint, 'geoapify-place-details.json', {
        request: { id: hit.correct.providerId },
        status,
        durationMs,
        response: data,
      });
      const features: any[] = data?.features ?? [];
      const self =
        features.find((f) => f.properties?.feature_type === 'details') ??
        features[0];
      const raw = self?.properties?.datasource?.raw ?? {};
      crossIdentity.push({
        hint: h.hint,
        geoapifyName: hit.correct.title,
        geoapifyPlaceId: hit.correct.providerId,
        foundVia: hit.variant,
        placeDetailsStatus: status,
        durationMs,
        explicitOsmType: raw.osm_type ?? null,
        explicitOsmId: raw.osm_id ?? null,
        rawTags: Object.fromEntries(
          Object.entries(raw).filter(([k]) =>
            /^(name|name:\w+|tourism|amenity|historic|leisure|landuse|artwork_type|wikidata|wikipedia|building|shop|healthcare)$/.test(
              k,
            ),
          ),
        ),
        categories: self?.properties?.categories ?? null,
        rawFile,
      });
    }
    // 2. Does the Geocoding API's geojson format expose datasource.raw?
    for (const text of ['Farmacia la Estrella', 'Mafalda Statue']) {
      count('geoapify.search');
      const res = await axios.get(GEOAPIFY_SEARCH, {
        params: {
          text,
          filter: circleFilter,
          bias: proximityBias,
          limit: 3,
          format: 'geojson',
          apiKey: process.env.GEOAPIFY_API_KEY,
        },
        timeout: 10_000,
      });
      const hint = CORPUS.find((c) => c.queries.includes(text))!;
      const top = res.data?.features?.[0]?.properties ?? {};
      crossIdentity.push({
        hint: hint.hint,
        probe: 'geocode/search format=geojson',
        topName: top.name,
        datasourceKeys: Object.keys(top.datasource ?? {}),
        explicitOsmType: top.datasource?.raw?.osm_type ?? null,
        explicitOsmId: top.datasource?.raw?.osm_id ?? null,
        rawFile: writeRaw(
          hint.hint,
          `geoapify-search-geojson-${slug(text)}.json`,
          {
            request: { text, format: 'geojson' },
            status: res.status,
            response: res.data,
          },
        ),
      });
    }
    expect(crossIdentity.length).toBeGreaterThan(0);
  });

  it('Google Places Text Search matrix (via GooglePlacesApiService)', async () => {
    for (const h of CORPUS) {
      for (const query of h.queries) {
        type GV = {
          id: string;
          text: string;
          bias: boolean;
          override: NonNullable<typeof googleOverride>;
          maxResultCount: number;
          dims: Partial<Dim>;
          includedType?: string;
          strict?: boolean;
        };
        const variants: GV[] = [
          {
            id: 'P1 current shape (maxResultCount=3, locationBias 50km)',
            text: query,
            bias: true,
            override: {},
            maxResultCount: PRODUCTION_WINDOW,
            dims: { window: PRODUCTION_WINDOW, windowParam: 'maxResultCount' },
          },
          {
            id: 'P1w current shape, maxResultCount=10',
            text: query,
            bias: true,
            override: {},
            maxResultCount: WIDE_WINDOW,
            dims: { window: WIDE_WINDOW, windowParam: 'maxResultCount' },
          },
          {
            id: 'P6 pageSize=10 (no maxResultCount)',
            text: query,
            bias: true,
            override: {
              dropMaxResultCount: true,
              body: { pageSize: WIDE_WINDOW },
            },
            maxResultCount: WIDE_WINDOW,
            dims: { window: WIDE_WINDOW, windowParam: 'pageSize' },
          },
          {
            id: 'P2 explicit city in text, no locationBias',
            text: `${query}, Buenos Aires, Argentina`,
            bias: false,
            override: {
              dropMaxResultCount: true,
              body: { pageSize: WIDE_WINDOW },
            },
            maxResultCount: WIDE_WINDOW,
            dims: {
              window: WIDE_WINDOW,
              windowParam: 'pageSize',
              cityInText: true,
            },
          },
          {
            id: 'P3 languageCode=es regionCode=AR',
            text: query,
            bias: true,
            override: {
              dropMaxResultCount: true,
              body: {
                pageSize: WIDE_WINDOW,
                languageCode: 'es',
                regionCode: 'AR',
              },
            },
            maxResultCount: WIDE_WINDOW,
            dims: {
              window: WIDE_WINDOW,
              windowParam: 'pageSize',
              lang: 'es',
              region: 'AR',
            },
          },
          {
            id: 'P4 languageCode=en regionCode=AR',
            text: query,
            bias: true,
            override: {
              dropMaxResultCount: true,
              body: {
                pageSize: WIDE_WINDOW,
                languageCode: 'en',
                regionCode: 'AR',
              },
            },
            maxResultCount: WIDE_WINDOW,
            dims: {
              window: WIDE_WINDOW,
              windowParam: 'pageSize',
              lang: 'en',
              region: 'AR',
            },
          },
        ];
        const runVariant = async (v: GV) => {
          const rawName = `google-places-${slug(v.id.split(' ')[0])}${v.strict ? '-strict' : ''}-${slug(query)}.json`;
          const rawPath = path.join(RAW_DIR, slug(h.hint), rawName);
          // Reuse a previously SUCCESSFUL raw response (the project's daily
          // searchText quota is small); failed/quota rows are always retried.
          const saved = fs.existsSync(rawPath)
            ? JSON.parse(fs.readFileSync(rawPath, 'utf8'))
            : null;
          googleOverride = v.override;
          lastGoogle = null;
          const t0 = Date.now();
          let places: PlaceData[] = [];
          let failure: string | null = null;
          let cached = false;
          if (saved?.status === 200) {
            cached = true;
            lastGoogle = {
              requestBody: saved.request?.body,
              status: 200,
              data: saved.response,
            };
          } else
            try {
              places = (
                await google.searchText({
                  textQuery: v.text,
                  maxResultCount: v.maxResultCount,
                  locationBias: v.bias
                    ? { center: SELECTED_POINT, radius: RADIUS_METERS }
                    : undefined,
                  includedType: v.includedType,
                  strictTypeFiltering: v.strict,
                })
              ).data;
            } catch (e: any) {
              failure = `${(e as any).code ?? ''} ${e.message}`.trim();
            }
          const durationMs = cached ? saved.durationMs : Date.now() - t0;
          // Real HTTP calls only: the service short-circuits locally once it
          // has seen a daily-quota 429, and cached rows cost nothing.
          if (cached) count('google.searchText (reused cached 200)');
          else if (lastGoogle) count('google.searchText');
          else count('google.searchText (blocked locally, no HTTP)');
          googleOverride = null;
          const rawPlaces = ((lastGoogle as any)?.data?.places ?? []) as any[];
          const rawFile = cached
            ? path.relative(OUT_DIR, rawPath) + ' (cached)'
            : writeRaw(h.hint, rawName, {
                request: {
                  url: 'POST https://places.googleapis.com/v1/places:searchText',
                  fieldMask: LEAN_GOOGLE_FIELD_MASK,
                  body: (lastGoogle as any)?.requestBody,
                },
                status: (lastGoogle as any)?.status,
                durationMs,
                response: (lastGoogle as any)?.data,
              });
          const candidates = googleCandidates(
            h.truth,
            rawPlaces.length ? rawPlaces : places,
          );
          push(
            h,
            v.text,
            'google-places',
            v.id,
            {
              family: 'google',
              endpoint: 'places:searchText',
              mode: 'text',
              type: v.includedType
                ? `${v.includedType}${v.strict ? ' (strict)' : ''}`
                : null,
              filter: false,
              bias: v.bias,
              lang: v.dims.lang ?? null,
              region: v.dims.region ?? null,
              window: v.dims.window!,
              windowParam: v.dims.windowParam!,
              cityInText: !!v.dims.cityInText,
              queryForm: query,
            },
            {},
            candidates,
            {
              status: (lastGoogle as any)?.status ?? (failure ? 'error' : 200),
              durationMs,
              failure,
              rawFile,
              selector: true,
            },
          );
          return { candidates, failure };
        };
        let providerNativeType: string | undefined;
        for (const v of variants) {
          const { candidates } = await runVariant(v);
          const hit = candidates.find((c) => c.isCorrect);
          if (!providerNativeType && hit?.category)
            providerNativeType = hit.category;
        }
        // P5 -- type filtering, using ONLY the type Google itself assigned
        // to the correct object (never a hand list keyed on the name).
        if (providerNativeType) {
          for (const strict of [false, true]) {
            await runVariant({
              id: `P5 includedType=${providerNativeType}${strict ? ' strict' : ''}`,
              text: query,
              bias: true,
              override: {
                dropMaxResultCount: true,
                body: { pageSize: WIDE_WINDOW },
              },
              maxResultCount: WIDE_WINDOW,
              includedType: providerNativeType,
              strict,
              dims: { window: WIDE_WINDOW, windowParam: 'pageSize' },
            });
          }
        }
      }
    }
  });

  it('SerpApi Google Maps control (budget-capped, cached)', async () => {
    const ll = `@${SELECTED_POINT.latitude},${SELECTED_POINT.longitude},12z`;
    const plan: Array<{
      hint: string;
      q: string;
      id: string;
      params: Record<string, string>;
      dims: Partial<Dim>;
    }> = [
      {
        hint: 'Mafalda Statue',
        q: 'Mafalda Statue',
        id: 'S1 ll, hl=en gl=ar',
        params: { ll, hl: 'en', gl: 'ar' },
        dims: { bias: true, lang: 'en', region: 'ar' },
      },
      {
        hint: 'Mafalda Statue',
        q: 'Mafalda',
        id: 'S1 ll, hl=en gl=ar',
        params: { ll, hl: 'en', gl: 'ar' },
        dims: { bias: true, lang: 'en', region: 'ar' },
      },
      {
        hint: 'Mafalda Statue',
        q: 'Estatua de Mafalda',
        id: 'S3 ll, hl=es gl=ar',
        params: { ll, hl: 'es', gl: 'ar' },
        dims: { bias: true, lang: 'es', region: 'ar' },
      },
      {
        hint: 'Mafalda Statue',
        q: 'Mafalda Statue',
        id: 'S3 ll, hl=es gl=ar',
        params: { ll, hl: 'es', gl: 'ar' },
        dims: { bias: true, lang: 'es', region: 'ar' },
      },
      {
        hint: 'Mafalda Statue',
        q: 'Mafalda Statue Buenos Aires',
        id: 'S2 city in q, no ll, hl=en gl=ar',
        params: { hl: 'en', gl: 'ar' },
        dims: { bias: false, lang: 'en', region: 'ar', cityInText: true },
      },
      {
        hint: 'Farmacia la Estrella',
        q: 'Farmacia la Estrella',
        id: 'S1 ll, hl=es gl=ar',
        params: { ll, hl: 'es', gl: 'ar' },
        dims: { bias: true, lang: 'es', region: 'ar' },
      },
      {
        hint: 'Recoleta Cemetery',
        q: 'Recoleta Cemetery',
        id: 'S1 ll, hl=en gl=ar',
        params: { ll, hl: 'en', gl: 'ar' },
        dims: { bias: true, lang: 'en', region: 'ar' },
      },
      {
        hint: 'San Martín',
        q: 'San Martín',
        id: 'S1 ll, hl=es gl=ar',
        params: { ll, hl: 'es', gl: 'ar' },
        dims: { bias: true, lang: 'es', region: 'ar' },
      },
    ];
    expect(plan.length).toBeLessThanOrEqual(SERPAPI_BUDGET);
    for (const p of plan) {
      const h = CORPUS.find((c) => c.hint === p.hint)!;
      const file = `serpapi-maps-${slug(p.id.split(' ')[0])}-${p.params.hl}-${slug(p.q)}.json`;
      const full = path.join(RAW_DIR, slug(h.hint), file);
      let data: any;
      let status: number | string = 200;
      let durationMs = 0;
      let cached = false;
      let failure: string | null = null;
      if (fs.existsSync(full)) {
        const saved = JSON.parse(fs.readFileSync(full, 'utf8'));
        data = saved.response;
        status = saved.status;
        durationMs = saved.durationMs;
        cached = true;
      } else if (!process.env.SERPAPI_API_KEY) {
        failure = 'UNAVAILABLE: SERPAPI_API_KEY missing';
      } else {
        const params = {
          engine: 'google_maps',
          type: 'search',
          q: p.q,
          ...p.params,
          api_key: process.env.SERPAPI_API_KEY,
        };
        const t0 = Date.now();
        try {
          serpApiLiveCalls++;
          count('serpapi.google_maps');
          const res = await axios.get('https://serpapi.com/search.json', {
            params,
            timeout: 60_000,
          });
          status = res.status;
          data = res.data;
        } catch (e: any) {
          status = e.response?.status ?? 'network';
          data = e.response?.data ?? null;
          failure = `${status} ${data?.error ?? e.message}`;
        }
        durationMs = Date.now() - t0;
        writeRaw(h.hint, file, {
          request: { url: 'https://serpapi.com/search.json', params },
          status,
          durationMs,
          response: data,
        });
      }
      const candidates = serpCandidates(h.truth, data);
      push(
        h,
        p.q,
        'serpapi-google-maps',
        p.id,
        {
          family: 'serpapi',
          endpoint: 'google_maps/search',
          mode: 'text',
          type: null,
          filter: false,
          bias: !!p.dims.bias,
          lang: p.dims.lang ?? null,
          region: p.dims.region ?? null,
          window: 20,
          windowParam: 'default',
          cityInText: !!p.dims.cityInText,
          queryForm: p.q.replace(/ Buenos Aires$/, ''),
        },
        {},
        candidates,
        {
          status,
          durationMs: cached ? 0 : durationMs,
          failure,
          rawFile: path.relative(OUT_DIR, full) + (cached ? ' (cached)' : ''),
          selector: false,
        },
      );
    }
  });
});
