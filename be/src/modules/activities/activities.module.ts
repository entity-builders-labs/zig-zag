import { Module, forwardRef } from '@nestjs/common';
import { ActivitiesController } from './controllers/activities.controller';
import { ActivitiesService } from './services/activities.service';
import { ActivityMetadataService } from './services/activity-metadata.service';
import { PrismaService } from '../../core/database/prisma.service';
import { AiModule } from '../../shared/ai/ai.module';
import { ActivityRelationshipService } from './services/activity-relationship.service';
import { HybridSearchService } from './services/hybrid-search.service';
import { CrawlersModule } from '../crawlers/crawlers.module';
import { ToursModule } from '../tours/tours.module';

@Module({
  imports: [
    AiModule,
    forwardRef(() => CrawlersModule),
    forwardRef(() => ToursModule),
  ],
  controllers: [ActivitiesController],
  providers: [
    ActivitiesService,
    ActivityMetadataService,
    PrismaService,
    ActivityRelationshipService,
    HybridSearchService,
  ],
  exports: [ActivitiesService, ActivityMetadataService],
})
export class ActivitiesModule {}
