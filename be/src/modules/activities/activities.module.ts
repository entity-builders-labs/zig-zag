import { Module, forwardRef } from '@nestjs/common';
import { ActivitiesController } from './controllers/activities.controller';
import { ActivitiesService } from './services/activities.service';
import { ActivityMetadataService } from './services/activity-metadata.service';
import { PrismaService } from '../../core/database/prisma.service';
import { AiModule } from '../../shared/ai/ai.module';
import { ActivityRelationshipService } from './services/activity-relationship.service';
import { ToursService } from '../tours/services/tours.service';
import { HybridSearchService } from './services/hybrid-search.service';
import { AiProspectorService } from './services/ai-prospector.service';
import { CrawlersModule } from '../crawlers/crawlers.module';

@Module({
  imports: [AiModule, forwardRef(() => CrawlersModule)],
  controllers: [ActivitiesController],
  providers: [
    ActivitiesService,
    ActivityMetadataService,
    PrismaService,
    ActivityRelationshipService,
    ToursService,
    HybridSearchService,
    AiProspectorService,
  ],
  exports: [ActivitiesService, ActivityMetadataService],
})
export class ActivitiesModule {}
