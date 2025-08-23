import { Module } from '@nestjs/common';
import { ToursController } from './controllers/tours.controller';
import { ToursService } from './services/tours.service';

import { ActivitiesModule } from '../activities/activities.module';
import { AiModule } from '../../shared/ai/ai.module';
import { PrismaModule } from '../../core/database/database.module';

@Module({
  imports: [PrismaModule, ActivitiesModule, AiModule],
  controllers: [ToursController],
  providers: [ToursService],
  exports: [ToursService],
})
export class ToursModule {}
