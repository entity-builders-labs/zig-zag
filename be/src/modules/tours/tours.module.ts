import { Module, forwardRef } from '@nestjs/common';
import { ToursController } from './controllers/tours.controller';
import { ToursService } from './services/tours.service';
import { TourGenerationService } from './services/tour-generation.service';
import { TourActivityGenerationService } from './services/tour-activity-generation.service';
import { TourGenerationProcessorService } from './services/tour-generation-processor.service';
import { TourImageService } from './services/tour-image.service';
import { TourLocationService } from './services/tour-location.service';
import { CompositeGenerationService } from './services/composite-generation.service';
import { DestinationResolutionService } from './services/destination-resolution.service';
import { CatalogRefillAnchorPlanner } from './services/catalog-refill-anchor-planner.service';
import { CoverageAnalyzer } from './services/coverage-analyzer.service';
import { TourCompletenessValidator } from './services/tour-completeness-validator.service';
import { TourFormatCoverageValidator } from './services/tour-format-coverage-validator.service';
import { ActivityDiscoveryService } from './services/activity-discovery.service';
import { GroqGroundedSearchService } from './services/groq-grounded-search.service';
import { SerpApiGroundedSearchService } from './services/serpapi-grounded-search.service';
import { TavilyGroundedSearchService } from './services/tavily-grounded-search.service';
import { ActivityProposalResolutionService } from './services/activity-proposal-resolution.service';
import { ActivityProposalMaterializationService } from './services/activity-proposal-materialization.service';
import { ActivityProposalPipelineService } from './services/activity-proposal-pipeline.service';
import { CompositeGeographicValidationService } from './services/composite-geographic-validation.service';
import { GroqDiscoveryProvider } from './services/groq-discovery.provider';
import { GeminiDiscoveryProvider } from './services/gemini-discovery.provider';
import { GreedyDailyPlanningSolver } from './services/greedy-daily-planning.solver';
import { ApproximateTravelEstimateProvider } from './services/approximate-travel-estimate.provider';
import { PlanningCandidateNormalizerService } from './services/planning-candidate-normalizer.service';
import { TourPlanningFeasibilityValidatorService } from './services/tour-planning-feasibility-validator.service';
import { PreferenceInterpreterService } from './services/preference-interpreter.service';
import { ExperienceDiscoveryPlannerService } from './services/experience-discovery-planner.service';
import {
  DISCOVERY_PROVIDER,
  GROUNDED_SEARCH_PROVIDER,
  GroundedSearchProvider,
  SearchGroundedDiscoveryProvider,
} from './interfaces/activity-discovery.interface';
import { PROPOSAL_RESOLVER } from './interfaces/proposal-resolution.interface';
import {
  DAILY_PLANNING_SOLVER,
  TRAVEL_ESTIMATE_PROVIDER,
  TOUR_PLANNING_FEASIBILITY_VALIDATOR,
} from './interfaces/daily-planning.interface';
import aiConfig, { AiConfig } from '../../shared/ai/ai.config';

import { ActivitiesModule } from '../activities/activities.module';
import { AiModule } from '../../shared/ai/ai.module';
import { PrismaModule } from '../../core/database/database.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AuthModule } from '../auth/auth.module';
import { OutboxModule } from '../outbox/outbox.module';

@Module({
  imports: [
    PrismaModule,
    OutboxModule,
    forwardRef(() => ActivitiesModule),
    AiModule,
    IntegrationsModule,
    AuthModule,
  ],
  controllers: [ToursController],
  providers: [
    ToursService,
    TourGenerationService,
    TourActivityGenerationService,
    TourGenerationProcessorService,
    TourImageService,
    TourLocationService,
    CompositeGenerationService,
    DestinationResolutionService,
    CatalogRefillAnchorPlanner,
    CoverageAnalyzer,
    TourCompletenessValidator,
    TourFormatCoverageValidator,
    ActivityDiscoveryService,
    GroqGroundedSearchService,
    SerpApiGroundedSearchService,
    TavilyGroundedSearchService,
    ActivityProposalResolutionService,
    ActivityProposalMaterializationService,
    ActivityProposalPipelineService,
    {
      provide: CompositeGeographicValidationService,
      useFactory: () => new CompositeGeographicValidationService(),
    },
    GroqDiscoveryProvider,
    GeminiDiscoveryProvider,
    GreedyDailyPlanningSolver,
    ApproximateTravelEstimateProvider,
    PlanningCandidateNormalizerService,
    TourPlanningFeasibilityValidatorService,
    PreferenceInterpreterService,
    ExperienceDiscoveryPlannerService,
    {
      provide: TRAVEL_ESTIMATE_PROVIDER,
      useExisting: ApproximateTravelEstimateProvider,
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
      provide: GROUNDED_SEARCH_PROVIDER,
      useFactory: (
        config: AiConfig,
        serpApi: SerpApiGroundedSearchService,
        groq: GroqGroundedSearchService,
        tavily: TavilyGroundedSearchService,
      ): GroundedSearchProvider => {
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
      ],
    },
    {
      provide: DISCOVERY_PROVIDER,
      useFactory: (
        config: AiConfig,
        gemini: GeminiDiscoveryProvider,
        groq: GroqDiscoveryProvider,
      ): SearchGroundedDiscoveryProvider => {
        switch (config.discoveryExtractor.provider) {
          case 'gemini':
            return gemini;
          case 'groq':
            return groq;
          default:
            throw new Error(
              `Unsupported DISCOVERY_EXTRACTOR_PROVIDER: ${config.discoveryExtractor.provider}`,
            );
        }
      },
      inject: [aiConfig.KEY, GeminiDiscoveryProvider, GroqDiscoveryProvider],
    },
    {
      provide: PROPOSAL_RESOLVER,
      useExisting: ActivityProposalPipelineService,
    },
  ],
  exports: [
    ToursService,
    TourGenerationService,
    TourActivityGenerationService,
    TourImageService,
    TourLocationService,
    CompositeGenerationService,
    ActivityDiscoveryService,
    ActivityProposalResolutionService,
    ActivityProposalMaterializationService,
    CompositeGeographicValidationService,
    PreferenceInterpreterService,
  ],
})
export class ToursModule {}
