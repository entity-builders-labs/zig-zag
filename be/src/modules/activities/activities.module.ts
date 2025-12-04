import { Module, forwardRef } from '@nestjs/common';
import { ActivitiesController } from './controllers/activities.controller';
import { ActivitiesService } from './services/activities.service';
import { ActivityMetadataService } from './services/activity-metadata.service';
import { PrismaService } from '../../core/database/prisma.service';
import { AiModule } from '../../shared/ai/ai.module';
import { HybridSearchService } from './services/hybrid-search.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import { ToursModule } from '../tours/tours.module';

@Module({
  imports: [
    AiModule,
    forwardRef(() => IntegrationsModule),
    forwardRef(() => ToursModule),
  ],
  controllers: [ActivitiesController],
  providers: [
    ActivitiesService,
    ActivityMetadataService,
    PrismaService,
    HybridSearchService,
  ],
  exports: [ActivitiesService, ActivityMetadataService],
})
export class ActivitiesModule {}
