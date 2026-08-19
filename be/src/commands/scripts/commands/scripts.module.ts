import { Module } from '@nestjs/common';
import { ConfigModule } from '@core/config/config.module';
import { MetadataCheckerCommand } from './metadata-checker.command';
import { PrismaModule } from '@core/database/database.module';
import { AiModule } from '@shared/ai/ai.module';
import { ActivitiesModule } from '@activities/activities.module';
import { ToursModule } from '@tours/tours.module';
import { IntegrationsModule } from '@integrations/integrations.module';
import { EmbeddingCheckerCommand } from './embedding-checker.command';
import { ImageAuditCommand } from './image-audit.command';
import { GenerateTemplatesCommand } from './generate-templates.command';
import { SeedE2eCompositeCommand } from './seed-e2e-composite.command';

@Module({
  imports: [
    ConfigModule, // Use the global ConfigModule that loads .env from root
    PrismaModule,
    AiModule,
    ActivitiesModule,
    ToursModule,
    IntegrationsModule, // OsmPlacesService — not re-exported by ToursModule
  ],
  providers: [
    MetadataCheckerCommand,
    EmbeddingCheckerCommand,
    ImageAuditCommand,
    GenerateTemplatesCommand,
    SeedE2eCompositeCommand,
  ],
})
export class ScriptsModule {}
