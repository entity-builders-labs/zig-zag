import { Module } from '@nestjs/common';
import { AppController } from './app.controller';

// Core modules
import { PrismaModule } from './core/database/database.module';
import { ConfigModule } from './core/config/config.module';

// Shared modules
import { AiModule } from './shared/ai/ai.module';

// Domain modules
import { ActivitiesModule } from './modules/activities/activities.module';
import { ToursModule } from './modules/tours/tours.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { AuthModule } from './modules/auth/auth.module';
import { QueueModule } from './modules/queue/queue.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { MediaModule } from './modules/media/media.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

// Commands globales
import { CommandsModule } from './commands/commands.module';
import { ScriptsModule } from './commands/scripts/commands/scripts.module';

// Health
// import { HealthModule } from './health/health.module';

@Module({
  imports: [
    // Core (always first)
    ConfigModule, // Must be imported before PrismaModule for ConfigService
    PrismaModule,

    // Shared
    AiModule,
    QueueModule,
    OutboxModule,
    MediaModule,
    NotificationsModule,

    // Domain (estos módulos ya incluyen sus commands)
    AuthModule,
    ActivitiesModule,
    ToursModule,
    IntegrationsModule,

    // Commands globales únicamente
    CommandsModule,
    ScriptsModule,
    // HealthModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
