import { Module } from '@nestjs/common';
import { ToursController } from './controllers/tours.controller';
import { ToursService } from './services/tours.service';
import { TourGenerationService } from './services/tour-generation.service';
import { ExperienceGenerationService } from './services/experience-generation.service';
import { TourGenerationProcessorService } from './services/tour-generation-processor.service';
import { TourImageService } from './services/tour-image.service';
import { TourLocationService } from './services/tour-location.service';
import { DestinationResolutionService } from './services/destination-resolution.service';
import { CatalogRefillAnchorPlanner } from './services/catalog-refill-anchor-planner.service';
import { TourCompletenessValidator } from './services/tour-completeness-validator.service';
import { GroqGroundedSearchService } from './services/groq-grounded-search.service';
import { SerpApiGroundedSearchService } from './services/serpapi-grounded-search.service';
import { SerperGroundedSearchService } from './services/serper-grounded-search.service';
import { selectGroundedSearchProvider } from './services/grounded-search-provider-selection.util';
import { TavilyGroundedSearchService } from './services/tavily-grounded-search.service';
import { GeminiGroundedSearchService } from './services/gemini-grounded-search.service';
import {
  EXPERIENCE_WEB_SOURCE_CONTENT_PROVIDER,
  WebSourceContentProvider,
} from './interfaces/web-source-content.interface';
import { TavilyWebSourceContentProvider } from './services/tavily-extract.service';
import { CloudflareWebSourceContentProvider } from './services/cloudflare-web-source-content.provider';
import { selectWebSourceContentProvider } from './services/web-source-content-provider-selection.util';
import { CompositeGeographicValidationService } from './services/composite-geographic-validation.service';
import { GroqDiscoveryProvider } from './services/groq-discovery.provider';
import { GeminiDiscoveryProvider } from './services/gemini-discovery.provider';
import { OllamaDiscoveryProvider } from './services/ollama-discovery.provider';
import { CloudflareDiscoveryProvider } from './services/cloudflare-discovery.provider';
import { selectDiscoveryExtractor } from './services/discovery-extractor-selection.util';
import { GreedyDailyPlanningSolver } from './services/greedy-daily-planning.solver';
import { ApproximateTravelEstimateProvider } from './services/approximate-travel-estimate.provider';
import { GeoapifyTravelEstimateProvider } from './services/geoapify-travel-estimate.provider';
import { ResilientTravelEstimateProvider } from './services/resilient-travel-estimate.provider';
import { PlanningCandidateNormalizerService } from './services/planning-candidate-normalizer.service';
import { TourPlanningFeasibilityValidatorService } from './services/tour-planning-feasibility-validator.service';
import { PreferenceInterpreterService } from './services/preference-interpreter.service';
import { ExperienceProposalResolverService } from './services/experience-proposal-resolver.service';
import { ExperienceCatalogService } from './services/experience-catalog.service';
import { ExperienceAcquisitionService } from './services/experience-acquisition.service';
import { WikivoyageApiService } from './services/wikivoyage-api.service';
import { WikivoyageAcquisitionProvider } from './providers/wikivoyage-acquisition.provider';
import { GooglePlacesAcquisitionProvider } from './providers/google-places-acquisition.provider';
import { StructuredExperienceCandidateSynthesizerService } from './services/structured-experience-candidate-synthesizer.service';
import { StructuredCandidateCorroborationService } from './services/structured-candidate-corroboration.service';
import { ExperienceAcquisitionPlannerService } from './services/experience-acquisition-planner.service';
import { ExperienceClassificationService } from './services/experience-classification.service';
import { AreaRouteAnchorResolverService } from './services/area-route-anchor-resolver.service';
import { AreaRouteWalkAcquisitionService } from './services/area-route-walk-acquisition.service';
import { FacetRetrievalService } from './services/facet-retrieval.service';
import { ExperienceCompositionService } from './services/experience-composition.service';
import { VenueAnchorResolutionService } from './services/venue-anchor-resolution.service';
import {
  EXPERIENCE_GROUNDED_SEARCH_PROVIDER,
  ExperienceGroundedSearchProvider,
} from './interfaces/experience-grounding.interface';
import { EXPERIENCE_PROPOSAL_RESOLVER } from './interfaces/experience-resolution.interface';
import { COMPONENT_LOCALITY_GROUNDER } from './interfaces/component-identity-context.interface';
import { OsmComponentLocalityGrounder } from './services/osm-component-locality-grounder.service';
import {
  DAILY_PLANNING_SOLVER,
  TRAVEL_ESTIMATE_PROVIDER,
  TOUR_PLANNING_FEASIBILITY_VALIDATOR,
} from './interfaces/daily-planning.interface';
import aiConfig, { AiConfig } from '../../shared/ai/ai.config';

import { AiModule } from '../../shared/ai/ai.module';
import { PrismaModule } from '../../core/database/database.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AuthModule } from '../auth/auth.module';
import { OutboxModule } from '../outbox/outbox.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [
    PrismaModule,
    OutboxModule,
    AiModule,
    IntegrationsModule,
    AuthModule,
    MediaModule,
  ],
  controllers: [ToursController],
  providers: [
    ToursService,
    TourGenerationService,
    ExperienceGenerationService,
    TourGenerationProcessorService,
    TourImageService,
    TourLocationService,
    DestinationResolutionService,
    CatalogRefillAnchorPlanner,
    TourCompletenessValidator,
    GroqGroundedSearchService,
    SerpApiGroundedSearchService,
    SerperGroundedSearchService,
    TavilyGroundedSearchService,
    GeminiGroundedSearchService,
    TavilyWebSourceContentProvider,
    CloudflareWebSourceContentProvider,
    {
      provide: EXPERIENCE_WEB_SOURCE_CONTENT_PROVIDER,
      useFactory: (
        config: AiConfig,
        tavily: TavilyWebSourceContentProvider,
        cloudflare: CloudflareWebSourceContentProvider,
      ): WebSourceContentProvider | undefined => {
        const providerName = config.webSourceContent?.provider;
        if (!providerName) {
          return undefined;
        }
        return selectWebSourceContentProvider(providerName, {
          tavily,
          cloudflare,
        });
      },
      inject: [
        aiConfig.KEY,
        TavilyWebSourceContentProvider,
        CloudflareWebSourceContentProvider,
      ],
    },
    {
      provide: CompositeGeographicValidationService,
      useFactory: () => new CompositeGeographicValidationService(),
    },
    GroqDiscoveryProvider,
    GeminiDiscoveryProvider,
    OllamaDiscoveryProvider,
    CloudflareDiscoveryProvider,
    GreedyDailyPlanningSolver,
    ApproximateTravelEstimateProvider,
    GeoapifyTravelEstimateProvider,
    ResilientTravelEstimateProvider,
    PlanningCandidateNormalizerService,
    TourPlanningFeasibilityValidatorService,
    PreferenceInterpreterService,
    ExperienceProposalResolverService,
    ExperienceCatalogService,
    ExperienceAcquisitionService,
    WikivoyageApiService,
    WikivoyageAcquisitionProvider,
    GooglePlacesAcquisitionProvider,
    {
      provide: 'VenueAnchorLookupCapability',
      useExisting: GooglePlacesAcquisitionProvider,
    },
    StructuredExperienceCandidateSynthesizerService,
    StructuredCandidateCorroborationService,
    ExperienceAcquisitionPlannerService,
    ExperienceClassificationService,
    AreaRouteAnchorResolverService,
    AreaRouteWalkAcquisitionService,
    FacetRetrievalService,
    ExperienceCompositionService,
    VenueAnchorResolutionService,
    {
      provide: EXPERIENCE_PROPOSAL_RESOLVER,
      useExisting: ExperienceProposalResolverService,
    },
    {
      provide: COMPONENT_LOCALITY_GROUNDER,
      useClass: OsmComponentLocalityGrounder,
    },
    {
      provide: TRAVEL_ESTIMATE_PROVIDER,
      useExisting: ResilientTravelEstimateProvider,
    },
    {
      provide: DAILY_PLANNING_SOLVER,
      useExisting: GreedyDailyPlanningSolver,
    },
    {
      provide: TOUR_PLANNING_FEASIBILITY_VALIDATOR,
      useExisting: TourPlanningFeasibilityValidatorService,
    },
    {
      provide: EXPERIENCE_GROUNDED_SEARCH_PROVIDER,
      useFactory: (
        config: AiConfig,
        serpApi: SerpApiGroundedSearchService,
        serper: SerperGroundedSearchService,
        groq: GroqGroundedSearchService,
        tavily: TavilyGroundedSearchService,
        gemini: GeminiGroundedSearchService,
      ): ExperienceGroundedSearchProvider =>
        // The name is resolved by ai.config (explicit
        // GROUNDED_SEARCH_PROVIDER, else serpapi-if-key, else groq). A
        // SERPER_API_KEY alone never changes the selection.
        selectGroundedSearchProvider(
          (
            config.groundedSearchProvider ||
            process.env.GROUNDED_SEARCH_PROVIDER ||
            (config.serpApiKey ? 'serpapi' : 'groq')
          ).toLowerCase(),
          { serpapi: serpApi, serper, groq, tavily, gemini },
        ),
      inject: [
        aiConfig.KEY,
        SerpApiGroundedSearchService,
        SerperGroundedSearchService,
        GroqGroundedSearchService,
        TavilyGroundedSearchService,
        GeminiGroundedSearchService,
      ],
    },
    {
      provide: 'EXPERIENCE_DISCOVERY_PROVIDER',
      // Keyed on DISCOVERY_EXTRACTOR_PROVIDER only — never AI_PROVIDER.
      useFactory: (
        config: AiConfig,
        gemini: GeminiDiscoveryProvider,
        groq: GroqDiscoveryProvider,
        ollama: OllamaDiscoveryProvider,
        cloudflare: CloudflareDiscoveryProvider,
      ) =>
        selectDiscoveryExtractor(config.discoveryExtractor.provider, {
          gemini,
          groq,
          ollama,
          cloudflare,
        }),
      inject: [
        aiConfig.KEY,
        GeminiDiscoveryProvider,
        GroqDiscoveryProvider,
        OllamaDiscoveryProvider,
        CloudflareDiscoveryProvider,
      ],
    },
  ],
  exports: [
    ToursService,
    TourGenerationService,
    ExperienceGenerationService,
    TourImageService,
    TourLocationService,
    CompositeGeographicValidationService,
    PreferenceInterpreterService,
    ExperienceAcquisitionService,
    WikivoyageApiService,
    WikivoyageAcquisitionProvider,
    GooglePlacesAcquisitionProvider,
    StructuredExperienceCandidateSynthesizerService,
    StructuredCandidateCorroborationService,
    ExperienceAcquisitionPlannerService,
    ExperienceClassificationService,
    AreaRouteAnchorResolverService,
    AreaRouteWalkAcquisitionService,
    TavilyWebSourceContentProvider,
    CloudflareWebSourceContentProvider,
    EXPERIENCE_WEB_SOURCE_CONTENT_PROVIDER,
  ],
})
export class ToursModule {}
