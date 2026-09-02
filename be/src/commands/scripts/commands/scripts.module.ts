import { Module } from '@nestjs/common';
import { ConfigModule } from '@core/config/config.module';
import { PrismaModule } from '@core/database/database.module';
import { AiModule } from '@shared/ai/ai.module';
import { ToursModule } from '@tours/tours.module';
import { IntegrationsModule } from '@integrations/integrations.module';

@Module({
  imports: [
    ConfigModule, // Use the global ConfigModule that loads .env from root
    PrismaModule,
    AiModule,
    ToursModule,
    IntegrationsModule, // OsmPlacesService — not re-exported by ToursModule
  ],
  providers: [],
})
export class ScriptsModule {}
