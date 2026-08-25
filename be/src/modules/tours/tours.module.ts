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
import { ActivityDiscoveryService } from './services/activity-discovery.service';
import { GroqDiscoveryProvider } from './services/groq-discovery.provider';
import { DISCOVERY_PROVIDER } from './interfaces/activity-discovery.interface';

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
    ActivityDiscoveryService,
    GroqDiscoveryProvider,
    {
      provide: DISCOVERY_PROVIDER,
      useExisting: GroqDiscoveryProvider,
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
  ],
})
export class ToursModule {}
