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
  ],
  exports: [
    ToursService,
    TourGenerationService,
    TourActivityGenerationService,
    TourImageService,
    TourLocationService,
    CompositeGenerationService,
  ],
})
export class ToursModule {}
