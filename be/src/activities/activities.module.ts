import { Module, forwardRef } from '@nestjs/common';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { ActivityMetadataService } from './activity-metadata.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiModule } from '../shared/ai/ai.module';
import { ActivityRelationshipService } from './activity-relationship.service';
import { ToursService } from '../tours/tours.service';
import { HybridSearchService } from './hybrid-search.service';
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
  ],
  exports: [ActivitiesService, ActivityMetadataService],
})
export class ActivitiesModule {}
