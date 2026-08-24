import { Module, forwardRef } from '@nestjs/common';
import { ActivitiesController } from './controllers/activities.controller';
import { ActivitiesService } from './services/activities.service';
import { ActivityMetadataService } from './services/activity-metadata.service';
import { CompositeActivityService } from './services/composite-activity.service';
import { AiModule } from '../../shared/ai/ai.module';
import { HybridSearchService } from './services/hybrid-search.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import { ToursModule } from '../tours/tours.module';
import { CatalogCandidateValidatorService } from './services/catalog-candidate-validator.service';

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
    HybridSearchService,
    CompositeActivityService,
    CatalogCandidateValidatorService,
  ],
  exports: [
    ActivitiesService,
    ActivityMetadataService,
    CompositeActivityService,
    CatalogCandidateValidatorService,
  ],
})
export class ActivitiesModule {}
