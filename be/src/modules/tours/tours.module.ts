import { Module, forwardRef } from '@nestjs/common';
import { ToursController } from './controllers/tours.controller';
import { ToursService } from './services/tours.service';
import { TourGenerationService } from './services/tour-generation.service';
import { TourActivityGenerationService } from './services/tour-activity-generation.service';
import { TourImageService } from './services/tour-image.service';
import { TourLocationService } from './services/tour-location.service';

import { ActivitiesModule } from '../activities/activities.module';
import { AiModule } from '../../shared/ai/ai.module';
import { PrismaModule } from '../../core/database/database.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => ActivitiesModule),
    AiModule,
    IntegrationsModule,
  ],
  controllers: [ToursController],
  providers: [
    ToursService,
    TourGenerationService,
    TourActivityGenerationService,
    TourImageService,
    TourLocationService,
  ],
  exports: [
    ToursService,
    TourGenerationService,
    TourActivityGenerationService,
    TourImageService,
    TourLocationService,
  ],
})
export class ToursModule {}
