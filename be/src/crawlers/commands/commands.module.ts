import { Module, forwardRef } from '@nestjs/common';
import { CrawlLocationsCommand } from './crawl-locations.command';
import { CrawlersModule } from '../crawlers.module';

@Module({
  imports: [forwardRef(() => CrawlersModule)],
  providers: [CrawlLocationsCommand],
  exports: [CrawlLocationsCommand],
})
export class CommandsModule {}
