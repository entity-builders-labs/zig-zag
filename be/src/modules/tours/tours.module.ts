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
import { TavilyGroundedSearchService } from './services/tavily-grounded-search.service';
import { GeminiGroundedSearchService } from './services/gemini-grounded-search.service';
import { TavilyExtractService } from './services/tavily-extract.service';
import { CompositeGeographicValidationService } from './services/composite-geographic-validation.service';
import { GroqDiscoveryProvider } from './services/groq-discovery.provider';
import { GeminiDiscoveryProvider } from './services/gemini-discovery.provider';
import { OllamaDiscoveryProvider } from './services/ollama-discovery.provider';
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
    TavilyGroundedSearchService,
    GeminiGroundedSearchService,
    TavilyExtractService,
    {
      provide: CompositeGeographicValidationService,
      useFactory: () => new CompositeGeographicValidationService(),
    },
    GroqDiscoveryProvider,
    GeminiDiscoveryProvider,
    OllamaDiscoveryProvider,
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
        groq: GroqGroundedSearchService,
        tavily: TavilyGroundedSearchService,
        gemini: GeminiGroundedSearchService,
      ): ExperienceGroundedSearchProvider => {
        const provider = (
          config.groundedSearchProvider ||
          process.env.GROUNDED_SEARCH_PROVIDER ||
          (config.serpApiKey ? 'serpapi' : 'groq')
        ).toLowerCase();

        switch (provider) {
          case 'groq':
            return groq;
          case 'tavily':
            return tavily;
          case 'serpapi':
            return serpApi;
          case 'gemini':
            return gemini;
          default:
            throw new Error(
              `Unsupported GROUNDED_SEARCH_PROVIDER: ${provider}`,
            );
        }
      },
      inject: [
        aiConfig.KEY,
        SerpApiGroundedSearchService,
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
      ) =>
        selectDiscoveryExtractor(config.discoveryExtractor.provider, {
          gemini,
          groq,
          ollama,
        }),
      inject: [
        aiConfig.KEY,
        GeminiDiscoveryProvider,
        GroqDiscoveryProvider,
        OllamaDiscoveryProvider,
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
  ],
})
export class ToursModule {}
