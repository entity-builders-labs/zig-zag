import * as fs from 'fs';
import { Test, TestingModule } from '@nestjs/testing';

import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/core/database/prisma.service';
import { GooglePlacesAcquisitionProvider } from 'src/modules/tours/providers/google-places-acquisition.provider';
import { OsmAcquisitionProvider } from 'src/modules/tours/providers/osm-acquisition.provider';
import { WikivoyageAcquisitionProvider } from 'src/modules/tours/providers/wikivoyage-acquisition.provider';
import { CoverageAnalyzer } from 'src/modules/tours/services/coverage-analyzer.service';
import { DestinationResolutionService } from 'src/modules/tours/services/destination-resolution.service';
import {
  ExecuteAcquisitionPlanResult,
  ExperienceAcquisitionService,
} from 'src/modules/tours/services/experience-acquisition.service';
import { ExperienceAcquisitionPlannerService } from 'src/modules/tours/services/experience-acquisition-planner.service';
import { ExperienceCatalogService } from 'src/modules/tours/services/experience-catalog.service';
import { ExperienceProposalResolverService } from 'src/modules/tours/services/experience-proposal-resolver.service';
import { GeminiDiscoveryProvider } from 'src/modules/tours/services/gemini-discovery.provider';
import { GeminiGroundedSearchService } from 'src/modules/tours/services/gemini-grounded-search.service';
import { GroqGroundedSearchService } from 'src/modules/tours/services/groq-grounded-search.service';
import { StructuredCandidateCorroborationService } from 'src/modules/tours/services/structured-candidate-corroboration.service';
import { StructuredExperienceCandidateSynthesizerService } from 'src/modules/tours/services/structured-experience-candidate-synthesizer.service';
import { TavilyGroundedSearchService } from 'src/modules/tours/services/tavily-grounded-search.service';
import {
  ExperienceDiscoveryExtractor,
  ExperienceDiscoveryRequest,
} from 'src/modules/tours/interfaces/experience-discovery.interface';
import {
  ExperienceGroundedSearchProvider,
  ExperienceGroundedSearchRequest,
  ExperienceGroundedSearchResult,
} from 'src/modules/tours/interfaces/experience-grounding.interface';
import { DestinationScaleHint } from 'src/modules/tours/interfaces/tour-generation.interface';
import {
  getFacetKeysByDimension,
  NormalizedPreferenceIntent,
} from 'src/modules/tours/interfaces/preference-interpretation.interface';
import { PreferenceFacet } from 'src/modules/tours/preferences/preference-facet.interface';
import { canonicalizeFacetKey } from 'src/modules/tours/preferences/preference-facet-vocabulary';
import { normalizeWizardFacet } from 'src/modules/tours/utils/preference-facet-merge.util';
import { boundingBoxToCenterRadius } from 'src/modules/tours/utils/geometry-search-area.util';
import { ExperienceEmbeddingIndexerService } from 'src/shared/ai/services/experience-embedding-indexer.service';
import { resetDbWith } from '../integration/support/test-db';
import { loadRootEnv } from './discovery/discovery-live.helper';

loadRootEnv();
jest.setTimeout(30 * 60 * 1000);

const RUN = process.env.RUN_LIVE_DISCOVERY_TESTS === '1';
const DESTINATION = {
  name: 'Buenos Aires',
  country: 'Argentina',
  countryCode: 'AR',
  latitude: -34.6037,
  longitude: -58.3816,
  radiusMeters: 20_000,
};

type GroundedProviderId = 'tavily' | 'groq' | 'gemini';

interface CharacterizationScenario {
  id: string;
  themes: string[];
  intents: string[];
  additionalPreferences: string;
  inferredFacets?: Array<{ dimension: string; key: string }>;
  repeat: boolean;
}

const SCENARIOS: CharacterizationScenario[] = [
  {
    id: 'traditional_bodegones',
    themes: ['food'],
    intents: ['food', 'visit'],
    additionalPreferences:
      'bodegones tradicionales porteños, cocina local con carácter barrial y tradicional',
    inferredFacets: [
      { dimension: 'trait', key: 'bodegones_tradicionales' },
      { dimension: 'local_character', key: 'traditional' },
    ],
    repeat: true,
  },
  {
    id: 'tango_classes',
    themes: ['tango'],
    intents: ['visit'],
    additionalPreferences: 'clases de tango presenciales para visitantes',
    inferredFacets: [{ dimension: 'trait', key: 'tango_classes' }],
    repeat: false,
  },
  {
    id: 'milongas',
    themes: ['tango', 'nightlife'],
    intents: ['nightlife'],
    additionalPreferences: 'milongas porteñas donde se baile tango',
    inferredFacets: [{ dimension: 'trait', key: 'milongas' }],
    repeat: true,
  },
  {
    id: 'tango_show',
    themes: ['tango', 'entertainment'],
    intents: ['performance'],
    additionalPreferences: 'tango show en Buenos Aires',
    inferredFacets: [{ dimension: 'trait', key: 'tango_show' }],
    repeat: false,
  },
  {
    id: 'historical_walks',
    themes: ['history'],
    intents: ['walk'],
    additionalPreferences: 'caminatas históricas urbanas con paradas reales',
    repeat: true,
  },
  {
    id: 'architecture_walks',
    themes: ['architecture'],
    intents: ['walk'],
    additionalPreferences: 'caminatas de arquitectura en la ciudad',
    repeat: false,
  },
  {
    id: 'craft_beer',
    themes: ['food'],
    intents: ['route_like'],
    additionalPreferences:
      'craft beer, cervecerías artesanales locales y taprooms independientes',
    inferredFacets: [{ dimension: 'trait', key: 'craft_beer' }],
    repeat: false,
  },
  {
    id: 'specialty_coffee',
    themes: ['food'],
    intents: ['route_like'],
    additionalPreferences:
      'specialty coffee, café de especialidad y tostadores locales',
    inferredFacets: [{ dimension: 'trait', key: 'specialty_coffee' }],
    repeat: false,
  },
  {
    id: 'street_art',
    themes: ['art'],
    intents: ['walk'],
    additionalPreferences: 'street art, murales y arte urbano',
    inferredFacets: [{ dimension: 'trait', key: 'street_art' }],
    repeat: false,
  },
  {
    id: 'historic_bookshops',
    themes: ['history', 'culture', 'shopping'],
    intents: ['visit', 'shopping'],
    additionalPreferences: 'librerías históricas de Buenos Aires',
    inferredFacets: [{ dimension: 'trait', key: 'historic_bookshops' }],
    repeat: false,
  },
];

function configuredProviders(): GroundedProviderId[] {
  const raw = process.env.COLD_START_GROUNDED_PROVIDERS ?? 'tavily,groq,gemini';
  const supported = new Set<GroundedProviderId>(['tavily', 'groq', 'gemini']);
  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is GroundedProviderId =>
      supported.has(value as GroundedProviderId),
    );
}

function requireDedicatedDatabase(): string {
  const value = process.env.COLD_START_DATABASE_URL;
  if (!value) {
    throw new Error(
      'Set COLD_START_DATABASE_URL to a dedicated local database named zigzag_characterization_*.',
    );
  }
  const url = new URL(value);
  const databaseName = url.pathname.replace(/^\//, '');
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !databaseName.startsWith('zigzag_characterization_')
  ) {
    throw new Error(
      'Cold-start characterization refuses cleanup unless the database is local and named zigzag_characterization_*.',
    );
  }
  return value;
}

function safeJson(value: unknown, maxChars = 16_000): unknown {
  if (value === undefined) return undefined;
  const redacted = JSON.stringify(value, (key, item) =>
    /api.?key|authorization|secret|token/i.test(key) ? '[REDACTED]' : item,
  );
  if (redacted.length <= maxChars) return JSON.parse(redacted);
  return `${redacted.slice(0, maxChars)}… [truncated]`;
}

class RecordingGroundedProvider implements ExperienceGroundedSearchProvider {
  readonly calls: Array<{
    request: ExperienceGroundedSearchRequest;
    latencyMs: number;
    result: unknown;
  }> = [];

  constructor(private readonly delegate: ExperienceGroundedSearchProvider) {}

  async search(
    request: ExperienceGroundedSearchRequest,
  ): Promise<ExperienceGroundedSearchResult> {
    const startedAt = Date.now();
    const result = await this.delegate.search(request);
    this.calls.push({
      request,
      latencyMs: Date.now() - startedAt,
      result: {
        provider: result.provider,
        model: result.model,
        groundingStatus: result.groundingStatus,
        failureReason: result.failureReason,
        evidence: result.evidence,
        evidenceProvenance: result.evidenceProvenance,
        rawOutput: safeJson(result.rawOutput),
      },
    });
    return result;
  }
}

class RecordingExtractor implements ExperienceDiscoveryExtractor {
  readonly calls: Array<{
    request: ExperienceDiscoveryRequest;
    latencyMs: number;
    result: unknown;
  }> = [];

  constructor(private readonly delegate: ExperienceDiscoveryExtractor) {}

  async extractExperiences(
    request: ExperienceDiscoveryRequest,
    searchResult: ExperienceGroundedSearchResult,
    options?: { bypassCache?: boolean },
  ) {
    const startedAt = Date.now();
    const result = await this.delegate.extractExperiences(
      request,
      searchResult,
      options,
    );
    this.calls.push({
      request,
      latencyMs: Date.now() - startedAt,
      result: {
        provider: result.provider,
        model: result.model,
        candidateCount: result.candidates.length,
        candidates: result.candidates,
        validationErrors: result.validationErrors,
        rawOutput: safeJson(result.rawOutput),
      },
    });
    return result;
  }
}

function wizardFacets(scenario: CharacterizationScenario): PreferenceFacet[] {
  return [
    ...scenario.themes.map((key) => normalizeWizardFacet('theme', key)),
    ...scenario.intents.map((key) => normalizeWizardFacet('intent', key)),
  ].filter((facet): facet is PreferenceFacet => Boolean(facet));
}

function normalizedPreferences(
  scenario: CharacterizationScenario,
): NormalizedPreferenceIntent {
  const inferredFacets = (scenario.inferredFacets ?? [])
    .map(({ dimension, key }): PreferenceFacet | undefined => {
      const canonicalKey = canonicalizeFacetKey(dimension, key);
      return canonicalKey
        ? {
            dimension,
            key: canonicalKey,
            importance: 1,
            confidence: 1,
            source: 'free_text',
          }
        : undefined;
    })
    .filter((facet): facet is PreferenceFacet => Boolean(facet));

  return {
    preferredFacets: [...wizardFacets(scenario), ...inferredFacets],
    excludedThemes: [],
    excludedTraits: [],
    hardExclusions: [],
    softConstraints: [],
    ambiguities: [],
    dietaryPreferences: [],
    accessibilityPreferences: [],
    budgetPreferences: [],
    groupPreferences: [],
    positiveSemanticQuery: scenario.additionalPreferences,
    notes: [],
  };
}

function coverageCandidates(experiences: any[]): any[] {
  return experiences.map((experience) => ({
    id: experience.id,
    name: experience.canonicalName ?? experience.name,
    description: experience.description,
    source: experience.source ?? experience.metadata?.source ?? 'db',
    weightedScore: experience.weightedScore ?? experience.qualityScore ?? null,
    distanceKm: experience.distance ?? null,
    durationMinutes: experience.durationMinutes ?? null,
    themes: experience.themes ?? experience.metadata?.themes ?? [],
    traits: experience.traits ?? experience.metadata?.traits ?? [],
    intents:
      experience.intents ??
      experience.metadata?.intents ??
      experience.metadata?.archetypes ??
      [],
    metadata: experience.metadata,
  }));
}

function webUnavailable(
  execution: ExecuteAcquisitionPlanResult,
): string | null {
  const web = execution.webResults?.[0];
  if (!web) return 'web_source_plan_not_executed';
  const reason = `${web.failureReason ?? ''} ${web.groundingStatus ?? ''}`;
  return /missing_|quota|resource.?exhausted|rate.?limit|429/i.test(reason)
    ? reason.trim() || 'provider_unavailable'
    : null;
}

(RUN ? describe : describe.skip)(
  'LIVE cold-start Experience acquisition characterization',
  () => {
    let moduleRef: TestingModule;
    let prisma: PrismaService;
    let destinationResolution: any;
    let destinationScope: any;
    let searchArea: {
      latitude: number;
      longitude: number;
      radiusMeters: number;
    };
    let normalizedByScenario: Map<
      string,
      { intent: NormalizedPreferenceIntent; interpretation: unknown }
    >;
    const results: any[] = [];

    beforeAll(async () => {
      const databaseUrl = requireDedicatedDatabase();
      process.env.NODE_ENV = 'test';
      process.env.DATABASE_URL = databaseUrl;
      process.env.DIRECT_URL = databaseUrl;

      const noopIndexer = {
        index: jest.fn(async (ids?: string[]) => ({
          status: 'unavailable' as const,
          indexedIds: [] as string[],
          skippedIds: ids ?? [],
          reason:
            'cold-start characterization: embeddings intentionally disabled',
        })),
      };
      moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(ExperienceEmbeddingIndexerService)
        .useValue(noopIndexer)
        .compile();

      prisma = moduleRef.get(PrismaService);
      await prisma.$connect();
      const current = await prisma.$queryRawUnsafe<Array<{ database: string }>>(
        'SELECT current_database() AS database',
      );
      if (
        !current[0]?.database.startsWith('zigzag_characterization_') ||
        !new URL(databaseUrl).pathname.endsWith(current[0].database)
      ) {
        throw new Error(
          'Connected database failed the characterization safety check.',
        );
      }

      destinationResolution = await moduleRef
        .get(DestinationResolutionService)
        .resolveDestination(
          `${DESTINATION.name}, ${DESTINATION.country}`,
          {
            latitude: DESTINATION.latitude,
            longitude: DESTINATION.longitude,
          },
          DestinationScaleHint.SETTLEMENT,
        );
      if (destinationResolution.scale !== 'area') {
        throw new Error(
          `Buenos Aires did not resolve to an authoritative area boundary: ${JSON.stringify(
            destinationResolution,
          )}`,
        );
      }
      destinationScope = destinationResolution.boundary;
      searchArea = boundingBoxToCenterRadius(
        destinationResolution.boundary.geometry,
      );

      normalizedByScenario = new Map();
      for (const scenario of SCENARIOS) {
        normalizedByScenario.set(scenario.id, {
          intent: normalizedPreferences(scenario),
          interpretation: {
            status: 'characterization_fixture',
            note: 'Uses the real PreferenceFacet vocabulary/contract with explicit open traits to keep normalized preferences identical across retrieval providers.',
          },
        });
      }
    });

    afterAll(async () => {
      if (prisma) await resetDbWith(prisma);
      if (moduleRef) await moduleRef.close();
    });

    it('records bounded scenario/provider acquisition runs without quality assertions', async () => {
      const providers = configuredProviders();
      const providerServices: Record<
        GroundedProviderId,
        ExperienceGroundedSearchProvider
      > = {
        tavily: moduleRef.get(TavilyGroundedSearchService),
        groq: moduleRef.get(GroqGroundedSearchService),
        gemini: moduleRef.get(GeminiGroundedSearchService),
      };
      const unavailableProviders = new Map<GroundedProviderId, string>();

      const catalog = moduleRef.get(ExperienceCatalogService);
      const coverage = moduleRef.get(CoverageAnalyzer);
      const planner = moduleRef.get(ExperienceAcquisitionPlannerService);
      const extractor = moduleRef.get(GeminiDiscoveryProvider);

      for (const providerId of providers) {
        const runQueue = SCENARIOS.flatMap((scenario) => [
          { scenario, run: 1 },
          ...(scenario.repeat ? [{ scenario, run: 2 }] : []),
        ]);

        for (const { scenario, run } of runQueue) {
          const unavailableReason = unavailableProviders.get(providerId);
          if (unavailableReason) {
            results.push({
              scenarioId: scenario.id,
              run,
              groundedProvider: providerId,
              status: 'not_run',
              reason: unavailableReason,
              humanEvaluation: 'UNREVIEWED',
            });
            continue;
          }

          await resetDbWith(prisma);
          const initialCatalog = await catalog.findVerifiedWithin(
            searchArea.latitude,
            searchArea.longitude,
            searchArea.radiusMeters,
            250,
          );
          if (initialCatalog.length !== 0) {
            throw new Error(
              `Cold-start invariant failed for ${scenario.id}/${providerId}/run-${run}: ${initialCatalog.length} initial rows.`,
            );
          }

          const normalized = normalizedByScenario.get(scenario.id)!;
          const requestedThemes = getFacetKeysByDimension(
            normalized.intent.preferredFacets,
            'theme',
          );
          const requestedTraits = getFacetKeysByDimension(
            normalized.intent.preferredFacets,
            'trait',
          );
          const requestedIntents = getFacetKeysByDimension(
            normalized.intent.preferredFacets,
            'intent',
          );
          const initialCoverage = coverage.analyze({
            candidates: [],
            requestedThemes,
            requestedTraits,
            requestedIntents,
            days: 1,
            travelPace: 'moderate',
            semanticCoverage: {
              status: 'not_requested',
              eligibleCandidateCount: 0,
              indexedCandidateCount: 0,
            },
            offeredCandidateCount: 0,
            providerHealth: { status: 'healthy' },
          });
          const plan = planner.buildAcquisitionPlan({
            destination: {
              destinationName: DESTINATION.name,
              latitude: searchArea.latitude,
              longitude: searchArea.longitude,
              radiusMeters: searchArea.radiusMeters,
            },
            breadth: 'focused',
            legacyDeficits: initialCoverage.deficits.filter(
              (deficit) => deficit.severity === 'blocking',
            ),
            preferredFacets: normalized.intent.preferredFacets,
            candidates: [],
            semanticQuery:
              normalized.intent.positiveSemanticQuery ||
              scenario.additionalPreferences,
          });

          const groundedRecorder = new RecordingGroundedProvider(
            providerServices[providerId],
          );
          const extractorRecorder = new RecordingExtractor(extractor);
          const acquisition = new ExperienceAcquisitionService(
            catalog,
            moduleRef.get(ExperienceEmbeddingIndexerService),
            moduleRef.get(GooglePlacesAcquisitionProvider),
            moduleRef.get(WikivoyageAcquisitionProvider),
            moduleRef.get(StructuredExperienceCandidateSynthesizerService),
            moduleRef.get(StructuredCandidateCorroborationService),
            moduleRef.get(ExperienceProposalResolverService),
            moduleRef.get(OsmAcquisitionProvider),
            groundedRecorder,
            extractorRecorder,
          );

          const startedAt = Date.now();
          const execution = await acquisition.executePlan(plan);
          const resolution =
            execution.candidates.length > 0
              ? await acquisition.materializeExecution(execution, {
                  destinationName: DESTINATION.name,
                  destinationCountryCode: DESTINATION.countryCode,
                  destinationBoundary: destinationScope,
                })
              : undefined;
          const elapsedMs = Date.now() - startedAt;

          const refreshed = await catalog.findVerifiedWithin(
            searchArea.latitude,
            searchArea.longitude,
            searchArea.radiusMeters,
            250,
          );
          const finalCoverage = coverage.analyze({
            candidates: coverageCandidates(refreshed),
            requestedThemes,
            requestedTraits,
            requestedIntents,
            days: 1,
            travelPace: 'moderate',
            semanticCoverage: {
              status: 'not_requested',
              eligibleCandidateCount: refreshed.length,
              indexedCandidateCount: 0,
            },
            offeredCandidateCount: refreshed.length,
            providerHealth: { status: 'healthy' },
          });
          const persisted = await prisma.experience.findMany({
            where: { status: 'VERIFIED' },
            include: {
              evidence: true,
              traits: { include: { traitDefinition: true } },
              components: {
                include: {
                  geoEntity: { include: { identities: true } },
                },
              },
            },
            orderBy: { canonicalName: 'asc' },
          });

          const result = {
            scenarioId: scenario.id,
            run,
            groundedProvider: providerId,
            status: 'completed',
            humanEvaluation: 'UNREVIEWED',
            input: {
              destination: DESTINATION,
              rawPreferences: {
                themes: scenario.themes,
                intents: scenario.intents,
                additionalPreferences: scenario.additionalPreferences,
              },
              normalizedPreferences: normalized.intent,
              interpretation: normalized.interpretation,
              requestedThemes,
              requestedTraits,
              requestedIntents,
            },
            destinationResolution: {
              scale: destinationResolution.scale,
              selectedResult: destinationResolution.selectedResult,
              attemptedQueries: destinationResolution.attemptedQueries,
              boundary: {
                id: destinationResolution.boundary.id,
                name: destinationResolution.boundary.name,
                osmType: destinationResolution.boundary.osmType,
                osmId: destinationResolution.boundary.osmId,
              },
              searchArea,
            },
            coverage: {
              initialCatalogCount: initialCatalog.length,
              initial: initialCoverage,
              final: finalCoverage,
            },
            acquisitionPlan: plan,
            groundedRetrieval: groundedRecorder.calls,
            extraction: extractorRecorder.calls,
            execution: {
              elapsedMs,
              providerResults: safeJson(execution.providerResults),
              observationCount: execution.observations.length,
              observations: safeJson(execution.observations),
              structuredCandidateCount: execution.structuredCandidateCount,
              webCandidateCount: execution.webCandidateCount,
              candidates: safeJson(execution.candidates),
              webResults: safeJson(execution.webResults),
              outboundGroundedSearchCalls: groundedRecorder.calls.length,
              extractorCalls: extractorRecorder.calls.length,
            },
            resolution: resolution
              ? {
                  totalCandidates: resolution.totalCandidates,
                  acceptedCount: resolution.acceptedCount,
                  rejectedCount: resolution.rejectedCount,
                  resolved: safeJson(resolution.resolved),
                  geographicValidation: safeJson(
                    resolution.geographicValidation,
                  ),
                }
              : {
                  totalCandidates: 0,
                  acceptedCount: 0,
                  rejectedCount: 0,
                  resolved: [] as unknown[],
                },
            persistedCatalog: persisted.map((experience) => ({
              id: experience.id,
              canonicalName: experience.canonicalName,
              status: experience.status,
              qualityScore: experience.qualityScore,
              metadata: experience.metadata,
              themes: (experience.metadata as any)?.themes ?? [],
              traits: experience.traits.map((item) => ({
                dimension: item.traitDefinition.dimension,
                key: item.traitDefinition.key,
              })),
              intents: (experience.metadata as any)?.intents ?? [],
              componentCount: experience.components.length,
              components: experience.components.map((component) => ({
                order: component.order,
                role: component.role,
                geoEntity: {
                  name: component.geoEntity.name,
                  kind: component.geoEntity.kind,
                  latitude: component.geoEntity.latitude,
                  longitude: component.geoEntity.longitude,
                  identities: component.geoEntity.identities.map(
                    (identity) => ({
                      provider: identity.provider,
                      externalId: identity.externalId,
                    }),
                  ),
                },
              })),
              evidence: experience.evidence.map((item) => ({
                source: item.source,
                url: item.url,
                title: item.title,
                snippet: item.snippet,
                discoveredAt: item.discoveredAt,
              })),
            })),
          };
          results.push(result);

          const unavailable = webUnavailable(execution);
          if (unavailable) unavailableProviders.set(providerId, unavailable);

          // eslint-disable-next-line no-console
          console.info(
            `COLD_START ${providerId}/${scenario.id}/run-${run}: ` +
              `evidence=${groundedRecorder.calls[0] ? ((groundedRecorder.calls[0].result as any).evidence?.length ?? 0) : 0} ` +
              `webCandidates=${execution.webCandidateCount ?? 0} ` +
              `accepted=${resolution?.acceptedCount ?? 0} persisted=${persisted.length} ` +
              `elapsedMs=${elapsedMs}`,
          );
        }
      }

      const outputPath =
        process.env.COLD_START_CHARACTERIZATION_OUTPUT ??
        '/tmp/zigzag-buenos-aires-cold-start-characterization.json';
      fs.writeFileSync(
        outputPath,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            extractor: {
              provider: 'gemini',
              implementation: 'GeminiDiscoveryProvider',
              model:
                process.env.GEMINI_DISCOVERY_MODEL ?? 'gemini-3.5-flash-lite',
              embeddings: 'intentionally unavailable in characterization',
            },
            providersRequested: providers,
            destinationResolution: safeJson(destinationResolution),
            scenarios: SCENARIOS,
            runs: results,
          },
          null,
          2,
        ),
      );
      // eslint-disable-next-line no-console
      console.info(`COLD_START_REPORT_JSON=${outputPath}`);
      expect(results.length).toBeGreaterThan(0);
    });
  },
);
