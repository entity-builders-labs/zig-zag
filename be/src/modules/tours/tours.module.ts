import { Module, forwardRef } from '@nestjs/common';
import { ToursController } from './controllers/tours.controller';
import { ToursService } from './services/tours.service';
import { TourGenerationService } from './services/tour-generation.service';
import { TourActivityGenerationService } from './services/tour-activity-generation.service';
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
import { ActivityProposalResolutionService } from './services/activity-proposal-resolution.service';
import { GroqDiscoveryProvider } from './services/groq-discovery.provider';
import { GeminiDiscoveryProvider } from './services/gemini-discovery.provider';
import { GreedyDailyPlanningSolver } from './services/greedy-daily-planning.solver';
import { ApproximateTravelEstimateProvider } from './services/approximate-travel-estimate.provider';
import { PlanningCandidateNormalizerService } from './services/planning-candidate-normalizer.service';
import { TourPlanningFeasibilityValidatorService } from './services/tour-planning-feasibility-validator.service';
import {
  DISCOVERY_PROVIDER,
  GROUNDED_SEARCH_PROVIDER,
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
    ActivityProposalResolutionService,
    GroqDiscoveryProvider,
    GeminiDiscoveryProvider,
    GreedyDailyPlanningSolver,
    ApproximateTravelEstimateProvider,
    PlanningCandidateNormalizerService,
    TourPlanningFeasibilityValidatorService,
    {
      provide: TRAVEL_ESTIMATE_PROVIDER,
      useExisting: ApproximateTravelEstimateProvider,
    },
    {
      // Only one V1 implementation — swappable for a future OR-Tools solver
      // without changing any caller, matching the existing
      // GROUNDED_SEARCH_PROVIDER static-swap pattern.
      provide: DAILY_PLANNING_SOLVER,
      useExisting: GreedyDailyPlanningSolver,
    },
    {
      provide: TOUR_PLANNING_FEASIBILITY_VALIDATOR,
      useExisting: TourPlanningFeasibilityValidatorService,
    },
    {
      // SerpApi is the default grounded-search evidence provider: a plain
      // search API, so it never competes with the discovery-extraction
      // provider's own token/rate quota (unlike Groq's browser_search tool,
      // which shares that budget with extraction). GroqGroundedSearchService
      // stays registered above as the alternate implementation behind the
      // same interface — swap back by pointing useExisting at it.
      provide: GROUNDED_SEARCH_PROVIDER,
      useExisting: SerpApiGroundedSearchService,
    },
    {
      // Config-driven (DISCOVERY_EXTRACTOR_PROVIDER), unlike
      // GROUNDED_SEARCH_PROVIDER's static useExisting swap above — Gemini
      // is the default (moves discovery extraction off Groq's shared
      // TPM budget entirely), Groq stays available as a config-selected
      // alternative. Fails fast on an unrecognized value rather than
      // silently falling back.
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
      useExisting: ActivityProposalResolutionService,
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
  ],
})
export class ToursModule {}
