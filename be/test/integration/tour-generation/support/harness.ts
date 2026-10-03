/**
 * One reusable integration harness for the productive tour-generation graph.
 *
 * It boots the real `AppModule` against a real Postgres and overrides ONLY the
 * external transports (Google Places, OSM/Overpass, Nominatim, Wikivoyage HTTP,
 * grounded web search, the discovery-extractor LLM, embeddings, LLM chat,
 * destination resolution, the travel-estimate provider). Everything inside the
 * orchestration under test runs for real:
 *
 *   ExperienceGenerationService.generateTourExperiences
 *     → FacetRetrievalService / preference-sufficiency.util.ts (cutover M2 --
 *       replaces the former CoverageAnalyzer sufficiency/deficit authority)
 *     → ExperienceAcquisitionPlannerService.buildAcquisitionPlan
 *     → ExperienceAcquisitionService.executePlan  (structured + web SourcePlan)
 *     → StructuredExperienceCandidateSynthesizerService
 *     → StructuredCandidateCorroborationService
 *     → ExperienceProposalResolverService  (+ CompositeGeographicValidationService)
 *     → real Prisma persistence  (Experience / GeoEntity / components / traits / evidence)
 *     → real catalog re-query (ExperienceCatalogService.findVerifiedWithin)
 *     → preference / semantic ranking
 *     → PlanningCandidateNormalizerService
 *     → GreedyDailyPlanningSolver
 *     → TourPlanningFeasibilityValidatorService
 *     → TourExperience / TourExperienceComponent materialization
 *     → generationTrace / executionSummary
 *
 * Specs configure per-scenario transport behaviour through `harness.fakes.*`
 * and assert on real DB rows + the persisted trace.
 */
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { ensureEnvLoaded } from '../../support/test-db';

import { AppModule } from '../../../../src/app.module';
import { PrismaService } from '../../../../src/core/database/prisma.service';
import { ExperienceGenerationService } from '../../../../src/modules/tours/services/experience-generation.service';
import { ExperienceCatalogService } from '../../../../src/modules/tours/services/experience-catalog.service';
import { ExperienceProposalResolverService } from '../../../../src/modules/tours/services/experience-proposal-resolver.service';
import { DestinationResolutionService } from '../../../../src/modules/tours/services/destination-resolution.service';
import { OsmPlacesService } from '../../../../src/modules/integrations/osm/services/osm-places.service';
import { WikivoyageApiService } from '../../../../src/modules/tours/services/wikivoyage-api.service';
import { LangChainService } from '../../../../src/shared/ai/langchain.service';
import { AiEmbeddingService } from '../../../../src/shared/ai/services/ai-embedding.service';
import { ExperienceEmbeddingIndexerService } from '../../../../src/shared/ai/services/experience-embedding-indexer.service';
import { EXPERIENCE_GROUNDED_SEARCH_PROVIDER } from '../../../../src/modules/tours/interfaces/experience-grounding.interface';
import { TRAVEL_ESTIMATE_PROVIDER } from '../../../../src/modules/tours/interfaces/daily-planning.interface';
import { DestinationResolution } from '../../../../src/modules/tours/services/destination-resolution.service';
import { AreaRouteWalkAcquisitionService } from '../../../../src/modules/tours/services/area-route-walk-acquisition.service';
import { TourImageService } from '../../../../src/modules/tours/services/tour-image.service';

import {
  FakeDiscoveryExtractorConfig,
  FakeDiscoveryExtractorImpl,
  FakeGroundedSearchConfig,
  FakeGroundedSearchProviderImpl,
  FakeNominatimApiService,
  FakeOsmConfig,
  FakeOsmPlacesService,
  FakePlacesApiService,
  FakePlacesConfig,
  FakeRoutingConfig,
  FakeTravelEstimateProvider,
  FakeWikivoyageApiService,
  FakeWikivoyageConfig,
  createFakeEmbeddingService,
  createFakeLangChainService,
} from './fakes';
import { resetDbWith } from '../../support/test-db';

export interface HarnessFakes {
  places: FakePlacesApiService;
  osm: FakeOsmPlacesService;
  nominatim: FakeNominatimApiService;
  wikivoyage: FakeWikivoyageApiService;
  groundedSearch: FakeGroundedSearchProviderImpl;
  discoveryExtractor: FakeDiscoveryExtractorImpl;
  routing: FakeTravelEstimateProvider;
  embeddings: ReturnType<typeof createFakeEmbeddingService>;
  langChain: ReturnType<typeof createFakeLangChainService>;
}

export interface ScenarioConfig {
  places?: FakePlacesConfig;
  osm?: FakeOsmConfig;
  wikivoyage?: FakeWikivoyageConfig;
  groundedSearch?: FakeGroundedSearchConfig;
  discoveryExtractor?: FakeDiscoveryExtractorConfig;
  routing?: FakeRoutingConfig;
  /** Partial override of the faked destination resolution. */
  destination?: Partial<DestinationResolution>;
}

export interface GenerationOutcome {
  ok: boolean;
  error?: Error & { retryable?: boolean };
}

export interface LoadedTour {
  id: string;
  metadata: any;
  generationStatus: string;
  trace: any;
  executionSummary: any;
  tourExperiences: Array<{
    id: string;
    experienceId: string;
    dayNumber: number | null;
    order: number | null;
    startTime: string | null;
    components: Array<{ id: string; geoEntityId: string | null }>;
  }>;
}

const DEFAULT_DESTINATION: DestinationResolution = {
  scale: 'point',
  attemptedQueries: [],
  country: 'Argentina',
  countryCode: 'AR',
} as DestinationResolution;

export class TourGenerationHarness {
  private constructor(
    readonly app: INestApplication,
    readonly prisma: PrismaService,
    readonly generation: ExperienceGenerationService,
    readonly catalog: ExperienceCatalogService,
    readonly resolver: ExperienceProposalResolverService,
    readonly areaRouteWalkAcquisition: AreaRouteWalkAcquisitionService,
    readonly areaRouteWalkAcquire: jest.SpyInstance,
    readonly fakes: HarnessFakes,
    private readonly destinationRef: { value: DestinationResolution },
  ) {}

  static async create(): Promise<TourGenerationHarness> {
    ensureEnvLoaded();
    process.env.NODE_ENV = process.env.NODE_ENV || 'test';
    process.env.ENABLE_AI = 'false';

    const fakes: HarnessFakes = {
      places: new FakePlacesApiService(),
      osm: new FakeOsmPlacesService(),
      nominatim: new FakeNominatimApiService(),
      wikivoyage: new FakeWikivoyageApiService(),
      groundedSearch: new FakeGroundedSearchProviderImpl(),
      discoveryExtractor: new FakeDiscoveryExtractorImpl(),
      routing: new FakeTravelEstimateProvider(),
      embeddings: createFakeEmbeddingService(),
      langChain: createFakeLangChainService(),
    };

    const destinationRef = { value: DEFAULT_DESTINATION };
    const fakeDestinationResolution = {
      resolveDestination: jest.fn(async () => destinationRef.value),
    };

    const noopIndexer = {
      index: jest.fn(async (ids?: string[]) => ({
        status: 'unavailable' as const,
        indexedIds: [] as string[],
        reason: 'integration harness: embeddings disabled',
        skippedIds: ids ?? [],
      })),
    };
    const noopTourImage = {
      resolveDestinationCoverImage: jest.fn(async (): Promise<null> => null),
      generateTourCoverImage: jest.fn(async (): Promise<null> => null),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('PlacesApiService')
      .useValue(fakes.places)
      .overrideProvider('NominatimApiService')
      .useValue(fakes.nominatim)
      .overrideProvider(OsmPlacesService)
      .useValue(fakes.osm)
      .overrideProvider(WikivoyageApiService)
      .useValue(fakes.wikivoyage)
      .overrideProvider(EXPERIENCE_GROUNDED_SEARCH_PROVIDER)
      .useValue(fakes.groundedSearch)
      .overrideProvider('EXPERIENCE_DISCOVERY_PROVIDER')
      .useValue(fakes.discoveryExtractor)
      .overrideProvider(TRAVEL_ESTIMATE_PROVIDER)
      .useValue(fakes.routing)
      .overrideProvider(AiEmbeddingService)
      .useValue(fakes.embeddings)
      .overrideProvider(ExperienceEmbeddingIndexerService)
      .useValue(noopIndexer)
      .overrideProvider(LangChainService)
      .useValue(fakes.langChain)
      .overrideProvider(DestinationResolutionService)
      .useValue(fakeDestinationResolution)
      .overrideProvider(TourImageService)
      .useValue(noopTourImage)
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    const areaRouteWalkAcquisition = app.get(AreaRouteWalkAcquisitionService);
    const areaRouteWalkAcquire = jest.spyOn(
      areaRouteWalkAcquisition,
      'acquireOrReuse',
    );

    return new TourGenerationHarness(
      app,
      app.get(PrismaService),
      app.get(ExperienceGenerationService),
      app.get(ExperienceCatalogService),
      app.get(ExperienceProposalResolverService),
      areaRouteWalkAcquisition,
      areaRouteWalkAcquire,
      fakes,
      destinationRef,
    );
  }

  /** Reset DB + re-arm every fake to its default (no-op) behaviour. */
  async reset(): Promise<void> {
    await resetDbWith(this.prisma);
    this.fakes.places.configure({});
    this.fakes.osm.configure({});
    this.fakes.wikivoyage.configure({});
    this.fakes.groundedSearch.configure({});
    this.fakes.discoveryExtractor.configure({});
    this.fakes.routing.configure({});
    this.fakes.nominatim.configure([]);
    this.destinationRef.value = DEFAULT_DESTINATION;
    jest.clearAllMocks();
  }

  configure(scenario: ScenarioConfig): void {
    if (scenario.places) this.fakes.places.configure(scenario.places);
    if (scenario.osm) this.fakes.osm.configure(scenario.osm);
    if (scenario.wikivoyage)
      this.fakes.wikivoyage.configure(scenario.wikivoyage);
    if (scenario.groundedSearch)
      this.fakes.groundedSearch.configure(scenario.groundedSearch);
    if (scenario.discoveryExtractor)
      this.fakes.discoveryExtractor.configure(scenario.discoveryExtractor);
    if (scenario.routing) this.fakes.routing.configure(scenario.routing);
    if (scenario.destination) {
      this.destinationRef.value = {
        ...this.destinationRef.value,
        ...scenario.destination,
      } as DestinationResolution;
    }
  }

  async generate(tourId: string): Promise<GenerationOutcome> {
    try {
      await this.generation.generateTourExperiences(tourId);
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error };
    }
  }

  async loadTour(tourId: string): Promise<LoadedTour> {
    const tour = await this.prisma.tour.findUniqueOrThrow({
      where: { id: tourId },
      include: {
        experiences: { include: { components: true } },
      },
    });
    const metadata = (tour.metadata ?? {}) as any;
    return {
      id: tour.id,
      metadata,
      generationStatus: metadata.generationStatus,
      trace: metadata.generationTrace,
      // The canonical persistence location for the execution summary is
      // inside the generation trace (metadata.generationTrace), not a
      // top-level metadata key.
      executionSummary: metadata.generationTrace?.executionSummary ?? {
        acquisition: {
          passes:
            metadata.generationTrace?.steps?.filter(
              (s: any) => s.name === 'acquisition.pass',
            ).length ?? 0,
          providersAttempted:
            metadata.generationTrace?.result?.facts
              ?.acquisitionProvidersAttempted ??
            metadata.generationTrace?.steps
              ?.filter((s: any) => s.name === 'acquisition.structured_source')
              .map((s: any) => s.facts?.provider)
              .filter(Boolean) ??
            [],
          providersFailed:
            metadata.generationTrace?.result?.facts
              ?.acquisitionProvidersFailed ??
            metadata.generationTrace?.steps
              ?.filter(
                (s: any) =>
                  s.name === 'acquisition.structured_source' &&
                  s.decision?.status === 'FAIL',
              )
              .map((s: any) => s.facts?.provider)
              .filter(Boolean) ??
            [],
          webCandidateCount:
            metadata.generationTrace?.steps
              ?.filter((s: any) => s.name === 'acquisition.web_search')
              .reduce(
                (sum: number, s: any) => sum + (s.facts?.evidenceCount ?? 0),
                0,
              ) ?? 0,
          structuredCandidateCount:
            metadata.generationTrace?.steps
              ?.filter((s: any) => s.name === 'acquisition.structured_source')
              .reduce(
                (sum: number, s: any) => sum + (s.facts?.candidateCount ?? 0),
                0,
              ) ?? 0,
        },
      },
      tourExperiences: (tour.experiences ?? []).map((te: any) => ({
        id: te.id,
        experienceId: te.experienceId,
        dayNumber: te.dayNumber ?? null,
        order: te.order ?? null,
        startTime: te.startTime ?? null,
        components: (te.components ?? []).map((c: any) => ({
          id: c.id,
          geoEntityId: c.geoEntityId ?? null,
        })),
      })),
    };
  }

  traceSteps(trace: any): any[] {
    const rawSteps = (trace?.steps ?? []) as any[];
    return rawSteps.map((s) => ({
      ...s,
      stage:
        s.stage ??
        (s.name === 'acquisition.pass'
          ? 'discovery'
          : s.name?.replace(/\./g, '_')),
      inputs: s.inputs ?? s.input,
      outputs: s.outputs ?? {
        ...s.output,
        ...(s.output?.deficits
          ? { acquisitionDeficits: s.output.deficits }
          : {}),
      },
      decision: {
        ...s.decision,
        outcome:
          s.decision?.outcome === 'SUFFICIENT' ? 'none' : s.decision?.outcome,
      },
    }));
  }

  async close(): Promise<void> {
    await this.app.close();
  }
}
