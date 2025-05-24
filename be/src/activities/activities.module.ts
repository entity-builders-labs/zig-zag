import { Module } from '@nestjs/common';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { ActivityMetadataService } from './activity-metadata.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiModule } from '../shared/ai/ai.module';
import { ActivityRelationshipService } from './activity-relationship.service';
import { ToursService } from '../tours/tours.service';

@Module({
  imports: [AiModule],
  controllers: [ActivitiesController],
  providers: [
    ActivitiesService,
    ActivityMetadataService,
    PrismaService,
    ActivityRelationshipService,
    ToursService,
  ],
  exports: [ActivitiesService, ActivityMetadataService],
})
export class ActivitiesModule {}
