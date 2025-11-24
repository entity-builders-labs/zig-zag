import { Module } from '@nestjs/common';
import { ConfigModule } from '../../../core/config/config.module';
import { MetadataCheckerCommand } from './metadata-checker.command';
import { PrismaModule } from '../../../core/database/database.module';
import { AiModule } from '../../../shared/ai/ai.module';
import { ActivitiesModule } from '../../../modules/activities/activities.module';
import { ToursModule } from '../../../modules/tours/tours.module';
import { CrawlersModule } from '../../../modules/crawlers/crawlers.module';
import { EmbeddingCheckerCommand } from './embedding-checker.command';
import { ImageAuditCommand } from './image-audit.command';

@Module({
  imports: [
    ConfigModule, // Use the global ConfigModule that loads .env from root
    PrismaModule,
    AiModule,
    ActivitiesModule,
    ToursModule,
    CrawlersModule,
  ],
  providers: [
    MetadataCheckerCommand,
    EmbeddingCheckerCommand,
    ImageAuditCommand,
  ],
})
export class ScriptsModule {}
