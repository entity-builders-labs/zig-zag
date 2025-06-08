import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MetadataCheckerCommand } from './metadata-checker.command';
import { PrismaModule } from '../../../core/database/database.module';
import { AiModule } from '../../../shared/ai/ai.module';
import { ActivitiesModule } from '../../../modules/activities/activities.module';
import { CrawlersModule } from '../../../modules/crawlers/crawlers.module';
import { EmbeddingCheckerCommand } from './embedding-checker.command';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AiModule,
    ActivitiesModule,
    CrawlersModule,
  ],
  providers: [MetadataCheckerCommand, EmbeddingCheckerCommand],
})
export class ScriptsModule {}
