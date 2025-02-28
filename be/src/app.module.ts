import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ActivitiesModule } from './activities/activities.module';
import { ToursModule } from './tours/tours.module';
import { CrawlersModule } from './crawlers/crawlers.module';
import { CommandsModule } from './crawlers/commands/commands.module';
import { CrawlLocationsCommand } from './crawlers/commands/crawl-locations.command';
import { AiModule } from './shared/ai/ai.module';
import { ScriptsModule } from './scripts/commands/scripts.module';
@Module({
  imports: [
    ActivitiesModule,
    ToursModule,
    CrawlersModule,
    CommandsModule,
    AiModule,
    ScriptsModule,
  ],
  controllers: [AppController],
  providers: [AppService, CrawlLocationsCommand],
})
export class AppModule {}
