import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MetadataCheckerCommand } from './metadata-checker.command';
import { PrismaModule } from '../../prisma/prisma.module';
import { AiModule } from '../../shared/ai/ai.module';
import { ActivitiesModule } from '../../activities/activities.module';
import { CrawlersModule } from '../../crawlers/crawlers.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AiModule,
    ActivitiesModule,
    CrawlersModule,
  ],
  providers: [MetadataCheckerCommand],
})
export class ScriptsModule {}
