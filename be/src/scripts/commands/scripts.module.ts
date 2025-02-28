import { Module } from '@nestjs/common';
import { EmbeddingCheckerCommand } from './embedding-checker.command';
import { MetadataCheckerCommand } from './metadata-checker.command';
import { GoogleMapsCrawlerCommand } from './google-maps-crawler.command';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AiModule } from 'src/shared/ai/ai.module';
import { ActivitiesModule } from 'src/activities/activities.module';
import { CrawlersModule } from 'src/crawlers/crawlers.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AiModule,
    ActivitiesModule,
    CrawlersModule,
  ],
  providers: [
    EmbeddingCheckerCommand,
    MetadataCheckerCommand,
    GoogleMapsCrawlerCommand,
  ],
})
export class ScriptsModule {}
