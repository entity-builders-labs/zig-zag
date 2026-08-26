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
import {
  DISCOVERY_PROVIDER,
  GROUNDED_SEARCH_PROVIDER,
} from './interfaces/activity-discovery.interface';
import { PROPOSAL_RESOLVER } from './interfaces/proposal-resolution.interface';

import { ActivitiesModule } from '../activities/activities.module';
import { AiModule } from '../../shared/ai/ai.module';
import { PrismaModule } from '../../core/database/database.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    PrismaModule,
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
    {
      // SerpApi is the default grounded-search evidence provider: a plain
      // search API, so it never competes with GroqDiscoveryProvider's own
      // token/rate quota (unlike Groq's browser_search tool, which shares
      // that budget with extraction). GroqGroundedSearchService stays
      // registered above as the alternate implementation behind the same
      // interface — swap back by pointing useExisting at it.
      provide: GROUNDED_SEARCH_PROVIDER,
      useExisting: SerpApiGroundedSearchService,
    },
    {
      provide: DISCOVERY_PROVIDER,
      useExisting: GroqDiscoveryProvider,
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
