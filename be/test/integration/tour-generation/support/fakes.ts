/**
 * Deterministic fake external transports for the tour-generation integration
 * suite. Every fake speaks a real domain/provider result shape; none of them
 * touches the network. The internal orchestration under test
 * (`ExperienceGenerationService` and the coverage → acquisition → resolver →
 * ranking → planner graph) always runs for real against real Postgres.
 *
 * Each fake exposes `jest.fn()` spies so specs can assert call counts
 * (catalog-first / catalog-reuse prove "zero provider calls") and drive
 * failures (acquisition-degradation).
 */
import {
  ExperienceGroundedSearchProvider,
  ExperienceGroundedSearchRequest,
  ExperienceGroundedSearchResult,
} from '../../../../src/modules/tours/interfaces/experience-grounding.interface';
import {
  ExperienceCandidate,
  ExperienceDiscoveryExtractor,
  ExperienceDiscoveryRequest,
  GeoEntityHint,
} from '../../../../src/modules/tours/interfaces/experience-discovery.interface';
import {
  IPlacesApiService,
  PlaceData,
  PlacesApiResult,
  PlacesProviderStatus,
} from '../../../../src/modules/integrations/google-places/interfaces/places-api.interface';
import {
  OsmCandidate,
  OsmLookupResult,
} from '../../../../src/modules/integrations/osm/services/osm-places.service';
import {
  INominatimApiService,
  NominatimResult,
} from '../../../../src/modules/integrations/osm/interfaces/nominatim.interface';
import {
  SpatialFootprint,
  TravelEstimate,
  TravelEstimateProvider,
} from '../../../../src/modules/tours/interfaces/daily-planning.interface';
import { TransportationMode } from '../../../../src/modules/tours/interfaces/tour-generation.interface';

/* ------------------------------------------------------------------ *
 * Grounded web search
 * ------------------------------------------------------------------ */

export interface FakeGroundedEvidence {
  key: string;
  source?: string;
  title?: string;
  snippet?: string;
  url?: string;
}

export interface FakeGroundedSearchConfig {
  provider?: string;
  model?: string;
  /** Static evidence returned for every query. `[]` => "no usable evidence". */
  evidence?: FakeGroundedEvidence[];
  /** Throw instead of returning (isolated per web SourcePlan). */
  fail?: boolean;
}

export class FakeGroundedSearchProviderImpl
  implements ExperienceGroundedSearchProvider
{
  readonly search = jest.fn(
    async (
      request: ExperienceGroundedSearchRequest,
    ): Promise<ExperienceGroundedSearchResult> => {
      if (this.config.fail) {
        throw new Error('fake grounded search transport failure');
      }
      const evidence = (this.config.evidence ?? []).map((item) => ({
        key: item.key,
        source: item.source ?? 'fake-web',
        snippet:
          item.snippet ??
          `Evidence for "${request.query}" (${request.requestedThemes.join(', ')})`,
        title: item.title ?? item.key,
        url: item.url,
      }));
      return {
        provider: this.config.provider ?? 'fake-grounded-search',
        model: this.config.model ?? 'fake-grounded-model',
        groundingStatus: evidence.length > 0 ? 'applied' : 'no_usable_evidence',
        evidence,
      };
    },
  );

  constructor(private config: FakeGroundedSearchConfig = {}) {}

  configure(next: FakeGroundedSearchConfig): void {
    this.config = next;
  }
}

/* ------------------------------------------------------------------ *
 * Discovery extractor (LLM boundary)
 * ------------------------------------------------------------------ */

export interface FakeExtractedCandidate {
  name: string;
  description?: string;
  themes?: string[];
  traits?: string[];
  intents?: string[];
  suggestedDurationMinutes?: number;
  /** Component hints — default is one required venue/PLACE hint named `name`. */
  componentHints?: GeoEntityHint[];
  evidenceKeys?: string[];
}

export interface FakeDiscoveryExtractorConfig {
  provider?: string;
  model?: string;
  /**
   * Either a static list of candidates, or a function of the request +
   * grounded evidence. Default: one venue-centric candidate per requested
   * theme, each citing all supplied evidence keys.
   */
  candidates?:
    | FakeExtractedCandidate[]
    | ((
        request: ExperienceDiscoveryRequest,
        evidenceKeys: string[],
      ) => FakeExtractedCandidate[]);
  validationErrors?: string[];
  fail?: boolean;
}

export function venueHint(name: string, evidenceKeys: string[]): GeoEntityHint {
  return {
    key: `hint:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    role: 'venue',
    expectedKind: 'PLACE',
    evidenceKeys,
  };
}

export class FakeDiscoveryExtractorImpl
  implements ExperienceDiscoveryExtractor
{
  readonly extractExperiences = jest.fn(
    async (
      request: ExperienceDiscoveryRequest,
      searchResult: ExperienceGroundedSearchResult,
    ) => {
      if (this.config.fail) {
        throw new Error('fake discovery extractor transport failure');
      }
      const evidenceKeys = (searchResult.evidence ?? []).map((e) => e.key);
      const raw: FakeExtractedCandidate[] =
        typeof this.config.candidates === 'function'
          ? this.config.candidates(request, evidenceKeys)
          : (this.config.candidates ??
            request.requestedThemes.map(
              (theme): FakeExtractedCandidate => ({
                name: `${theme} discovery ${request.scope.destinationName ?? ''}`.trim(),
                themes: [theme],
              }),
            ));

      const candidates: ExperienceCandidate[] = raw.map((candidate) => {
        const keys = candidate.evidenceKeys ?? evidenceKeys;
        return {
          name: candidate.name,
          description: candidate.description ?? `Discovered: ${candidate.name}`,
          themes: candidate.themes ?? [],
          traits: candidate.traits ?? [],
          intents: candidate.intents ?? request.requestedIntents ?? [],
          suggestedDurationMinutes: candidate.suggestedDurationMinutes ?? 90,
          componentHints: candidate.componentHints ?? [
            venueHint(candidate.name, keys),
          ],
          evidenceKeys: keys,
          shortReason: `fake extractor: ${candidate.name}`,
          orderedByEvidence: false,
        };
      });

      return {
        candidates,
        validationErrors: this.config.validationErrors ?? [],
        provider: this.config.provider ?? 'fake-discovery-extractor',
        model: this.config.model ?? 'fake-extractor-model',
        rawOutput: JSON.stringify({ candidates: raw }),
      };
    },
  );

  constructor(private config: FakeDiscoveryExtractorConfig = {}) {}

  configure(next: FakeDiscoveryExtractorConfig): void {
    this.config = next;
  }
}

/* ------------------------------------------------------------------ *
 * Google Places transport
 * ------------------------------------------------------------------ */

export interface FakePlacesConfig {
  nearby?: PlaceData[];
  text?: PlaceData[];
  fail?: boolean;
}

export function placeData(
  overrides: Partial<PlaceData> & { id: string; text: string },
): PlaceData {
  const { text, ...rest } = overrides;
  return {
    displayName: { text },
    name: text,
    location: { latitude: 0, longitude: 0 },
    types: [],
    ...rest,
  };
}

export class FakePlacesApiService implements IPlacesApiService {
  readonly provider = 'google' as const;

  readonly searchNearby = jest.fn(
    async (): Promise<PlacesApiResult<PlaceData[]>> => {
      if (this.config.fail) {
        throw new Error('fake Google Places transport failure');
      }
      return { data: this.config.nearby ?? [] } as PlacesApiResult<PlaceData[]>;
    },
  );

  readonly searchText = jest.fn(
    async (): Promise<PlacesApiResult<PlaceData[]>> => {
      if (this.config.fail) {
        throw new Error('fake Google Places transport failure');
      }
      return {
        data: this.config.text ?? this.config.nearby ?? [],
      } as PlacesApiResult<PlaceData[]>;
    },
  );

  readonly getPlaceDetails = jest.fn(
    async (): Promise<PlacesApiResult<Partial<PlaceData>>> =>
      ({ data: {} }) as PlacesApiResult<Partial<PlaceData>>,
  );

  getStatus(): PlacesProviderStatus {
    return {
      provider: 'google',
      available: true,
      cacheEnabled: false,
    } as PlacesProviderStatus;
  }

  constructor(private config: FakePlacesConfig = {}) {}

  configure(next: FakePlacesConfig): void {
    this.config = next;
  }
}

/* ------------------------------------------------------------------ *
 * OSM / Overpass transport
 * ------------------------------------------------------------------ */

export function osmPoi(
  name: string,
  latitude: number,
  longitude: number,
  tags: Record<string, string> = {},
): OsmCandidate {
  return {
    id: `osm:node:${Math.abs(hashString(name)) % 900000000}`,
    name,
    osmType: 'node',
    osmId: Math.abs(hashString(name)) % 900000000,
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
    tags: { name, ...tags },
  };
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

export interface FakeOsmConfig {
  /** POIs returned by lookupPoisNear / lookupPoisWithin (resolver PLACE match). */
  pois?: OsmCandidate[];
  /** Streets returned by lookupStreetsNear / lookupStreetsWithin (ROUTE match). */
  streets?: OsmCandidate[];
  /** Features returned by lookupFeaturesNear (OsmAcquisitionProvider). */
  features?: OsmCandidate[];
  /** 'failed' status from POI/street/feature lookups. */
  failPois?: boolean;
  failStreets?: boolean;
  failFeatures?: boolean;
  boundary?: OsmCandidate;
}

type OsmFeatureLookupResult = OsmLookupResult<OsmCandidate[]> & {
  rawResultCount: number;
};

/**
 * Only the `OsmPlacesService` methods the resolver + OSM acquisition provider
 * actually call. Boundary/settlement lookups are unused because
 * `DestinationResolutionService` is faked at a higher level.
 */
export class FakeOsmPlacesService {
  readonly lookupBoundaryById = jest.fn(
    async (): Promise<OsmLookupResult<OsmCandidate | undefined>> => ({
      status: 'success',
      value: this.config.boundary,
    }),
  );
  readonly lookupPoisNear = jest.fn(
    async (): Promise<OsmLookupResult<OsmCandidate[]>> =>
      this.config.failPois
        ? { status: 'failed', value: [], failureReason: 'fake overpass down' }
        : { status: 'success', value: this.config.pois ?? [] },
  );

  readonly lookupPoisWithin = jest.fn(
    async (): Promise<OsmLookupResult<OsmCandidate[]>> =>
      this.config.failPois
        ? { status: 'failed', value: [], failureReason: 'fake overpass down' }
        : { status: 'success', value: this.config.pois ?? [] },
  );

  readonly lookupStreetsNear = jest.fn(
    async (): Promise<OsmLookupResult<OsmCandidate[]>> =>
      this.config.failStreets
        ? { status: 'failed', value: [], failureReason: 'fake overpass down' }
        : { status: 'success', value: this.config.streets ?? [] },
  );

  readonly lookupStreetsWithin = jest.fn(
    async (): Promise<OsmLookupResult<OsmCandidate[]>> =>
      this.config.failStreets
        ? { status: 'failed', value: [], failureReason: 'fake overpass down' }
        : { status: 'success', value: this.config.streets ?? [] },
  );

  readonly lookupFeaturesNear = jest.fn(
    async (): Promise<OsmFeatureLookupResult> =>
      this.config.failFeatures
        ? {
            status: 'failed',
            value: [],
            failureReason: 'fake overpass down',
            rawResultCount: 0,
          }
        : {
            status: 'success',
            value: this.config.features ?? [],
            rawResultCount: (this.config.features ?? []).length,
          },
  );

  readonly findPoisNear = jest.fn(
    async () => (this.config.pois ?? []) as OsmCandidate[],
  );
  readonly findStreetsNear = jest.fn(
    async () => (this.config.streets ?? []) as OsmCandidate[],
  );

  constructor(private config: FakeOsmConfig = {}) {}

  configure(next: FakeOsmConfig): void {
    this.config = next;
  }
}

/* ------------------------------------------------------------------ *
 * Nominatim transport (resolver global-hint fallback only)
 * ------------------------------------------------------------------ */

export class FakeNominatimApiService implements INominatimApiService {
  private results: NominatimResult[] = [];
  readonly search = jest.fn(
    async (): Promise<NominatimResult[]> => this.results,
  );
  readonly reverse = jest.fn(async (): Promise<NominatimResult | null> => null);

  configure(results: NominatimResult[] = []): void {
    this.results = results;
  }
}

/* ------------------------------------------------------------------ *
 * Wikivoyage transport
 * ------------------------------------------------------------------ */

export interface FakeWikivoyageEntry {
  name: string;
  description?: string;
  lat?: number;
  long?: number;
  wikidata?: string;
  sectionType?: 'SEE' | 'DO' | 'EAT' | 'OTHER';
  templateName?: string;
}

export interface FakeWikivoyageConfig {
  status?: 'ok' | 'not_found' | 'failed';
  title?: string;
  entries?: FakeWikivoyageEntry[];
  failureReason?: string;
}

export class FakeWikivoyageApiService {
  readonly fetchArticle = jest.fn(async (pageTitle: string) => {
    const status = this.config.status ?? 'not_found';
    if (status === 'failed') {
      return {
        status: 'failed' as const,
        failureReason: this.config.failureReason ?? 'fake wikivoyage down',
      };
    }
    if (status === 'not_found') {
      return { status: 'not_found' as const };
    }
    return {
      status: 'found' as const,
      title: this.config.title ?? pageTitle,
      entries: (this.config.entries ?? []).map((entry) => ({
        name: entry.name,
        description: entry.description ?? `Wikivoyage listing: ${entry.name}`,
        lat: entry.lat,
        long: entry.long,
        wikidata: entry.wikidata,
        sectionType: entry.sectionType ?? 'SEE',
        templateName: entry.templateName ?? 'see',
      })),
    };
  });

  constructor(private config: FakeWikivoyageConfig = {}) {}

  configure(next: FakeWikivoyageConfig): void {
    this.config = next;
  }
}

/* ------------------------------------------------------------------ *
 * Travel estimate provider (routing boundary)
 * ------------------------------------------------------------------ */

export interface FakeRoutingConfig {
  /** When true, every leg returns an approximate fallback estimate. */
  fallback?: boolean;
  provider?: string;
  fallbackProvider?: string;
  fallbackReason?: string;
}

const centroidOf = (footprint: SpatialFootprint) => footprint.centroid;

export class FakeTravelEstimateProvider implements TravelEstimateProvider {
  readonly estimate = jest.fn(
    async (
      from: SpatialFootprint,
      to: SpatialFootprint,
      allowedModes: TransportationMode[],
    ): Promise<TravelEstimate> => {
      const a = centroidOf(from);
      const b = centroidOf(to);
      const dLat = (b.lat - a.lat) * 111_000;
      const dLng =
        (b.lng - a.lng) * 111_000 * Math.cos((a.lat * Math.PI) / 180);
      const distanceMeters = Math.sqrt(dLat * dLat + dLng * dLng);
      const mode = allowedModes.includes(TransportationMode.WALKING)
        ? TransportationMode.WALKING
        : allowedModes[0];
      const durationMinutes = (distanceMeters / 1000 / 4.8) * 60;
      const walking = mode === TransportationMode.WALKING;

      if (this.config.fallback) {
        return {
          mode,
          durationMinutes,
          distanceMeters,
          walkingMinutes: walking ? durationMinutes : 0,
          walkingDistanceMeters: walking ? distanceMeters : 0,
          approximate: true,
          provider: this.config.fallbackProvider ?? 'approximate',
          fallbackReason:
            this.config.fallbackReason ?? 'primary_routing_unavailable',
        };
      }

      return {
        mode,
        durationMinutes,
        distanceMeters,
        walkingMinutes: walking ? durationMinutes : 0,
        walkingDistanceMeters: walking ? distanceMeters : 0,
        approximate: false,
        provider: this.config.provider ?? 'fixture-real-routing',
      };
    },
  );

  constructor(private config: FakeRoutingConfig = {}) {}

  configure(next: FakeRoutingConfig): void {
    this.config = next;
  }
}

/* ------------------------------------------------------------------ *
 * Embedding transport (real ExperienceVectorStoreService runs on top)
 * ------------------------------------------------------------------ */

export function createFakeEmbeddingService(dimensions = 256) {
  const vector = Array.from({ length: dimensions }, () => 0.01);
  const embeddings = {
    embedQuery: jest.fn(async () => [...vector]),
    embedDocuments: jest.fn(async (texts: string[]) =>
      texts.map(() => [...vector]),
    ),
  };
  return {
    ensureInitialized: jest.fn(async (): Promise<void> => undefined),
    getIndexIdentity: jest.fn(() => ({
      provider: 'integration',
      model: 'fake-embeddings',
      dimensions,
      documentVersion: 1,
    })),
    getStatus: jest.fn(() => ({
      status: 'ready',
      identity: {
        provider: 'integration',
        model: 'fake-embeddings',
        dimensions,
        documentVersion: 1,
      },
    })),
    getEmbeddings: jest.fn(() => embeddings),
  };
}

/* ------------------------------------------------------------------ *
 * LangChain transport (preference interpreter fallback path)
 * ------------------------------------------------------------------ */

export function createFakeLangChainService() {
  return {
    generateChatResponse: jest.fn(async () => '{}'),
    getProviderMetadata: jest.fn(() => ({
      provider: 'integration-fake',
      model: 'fake-chat',
    })),
  };
}
