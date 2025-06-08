import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

// Core modules
import { PrismaModule } from './core/database/database.module';
import { ConfigModule } from './core/config/config.module';

// Shared modules
import { AiModule } from './shared/ai/ai.module';

// Domain modules
import { ActivitiesModule } from './modules/activities/activities.module';
import { ToursModule } from './modules/tours/tours.module';
import { CrawlersModule } from './modules/crawlers/crawlers.module';

// Commands globales
import { CommandsModule } from './commands/commands.module';
import { ScriptsModule } from './commands/scripts/commands/scripts.module';

// Health
// import { HealthModule } from './health/health.module';

@Module({
  imports: [
    // Core (always first)
    PrismaModule,
    ConfigModule,
    
    // Shared
    AiModule,
    
    // Domain (estos módulos ya incluyen sus commands)
    ActivitiesModule,
    ToursModule,
    CrawlersModule,
    
    // Commands globales únicamente
    CommandsModule,
    ScriptsModule,
    // HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
