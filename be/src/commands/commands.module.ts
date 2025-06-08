import { Module } from '@nestjs/common';
import { CrawlLocationsCommand } from '../modules/crawlers/commands/crawl-locations.command';
import { GoogleMapsCrawlerCommand } from './scripts/commands/google-maps-crawler.command';
import { CrawlersModule } from '../modules/crawlers/crawlers.module';
// Importar solo commands que no pertenecen a módulos específicos

@Module({
  imports: [CrawlersModule],
  providers: [CrawlLocationsCommand, GoogleMapsCrawlerCommand],
})
export class CommandsModule {}