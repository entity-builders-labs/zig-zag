import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GoogleMapsService } from './google-maps/google-maps.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActivitiesModule } from '../activities/activities.module';
import { AiModule } from '../shared/ai/ai.module';

@Module({
  imports: [ConfigModule, forwardRef(() => ActivitiesModule), AiModule],
  providers: [GoogleMapsService, PrismaService],
  exports: [GoogleMapsService],
})
export class CrawlersModule {}
