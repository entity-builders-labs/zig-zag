import { Command, CommandRunner, Option } from 'nest-commander';
import { Inject, Logger, forwardRef } from '@nestjs/common';
import { GoogleMapsService } from '../google-maps/google-maps.service';
import { LocationGenerator } from '../utils/location-generator';

interface CrawlCommandOptions {
  latitude: number;
  longitude: number;
  radius: number;
  pages: number;
  keyword: string;
}

@Command({
  name: 'crawl',
  description: 'Crawl locations from Google Maps',
})
export class CrawlLocationsCommand extends CommandRunner {
  private readonly logger = new Logger(CrawlLocationsCommand.name);

  constructor(
    @Inject(forwardRef(() => GoogleMapsService))
    private readonly googleMapsService: GoogleMapsService,
  ) {
    super();
  }

  async run(
    passedParams: string[],
    options?: CrawlCommandOptions,
  ): Promise<void> {
    this.logger.debug('Options:', options);
    const generator = new LocationGenerator(
      options.latitude,
      options.longitude,
      options.radius,
      options.pages,
    );

    const points = generator.generatePoints();

    for (const point of points) {
      await this.googleMapsService.crawlAndSaveActivities({
        latitude: point.latitude,
        longitude: point.longitude,
        radius: options.radius,
        keyword: options.keyword,
      });
    }

    if (!options) {
      this.logger.error('No options provided');
      return;
    }
  }

  @Option({
    flags: '-lat, --latitude <number>',
    description: 'Latitude of the center point',
  })
  parseLatitude(val: string): number {
    return Number(val);
  }

  @Option({
    flags: '-lng, --longitude <number>',
    description: 'Longitude of the center point',
  })
  parseLongitude(val: string): number {
    return Number(val);
  }

  @Option({
    flags: '-r, --radius <number>',
    description: 'Search radius in kilometers',
  })
  parseRadius(val: string): number {
    return Number(val);
  }

  @Option({
    flags: '-p, --pages <number>',
    description: 'Number of pages to crawl',
  })
  parsePages(val: string): number {
    return Number(val);
  }

  @Option({
    flags: '-k, --keyword <string>',
    description: 'Keyword to search for',
  })
  parseKeyword(val: string): string {
    return val;
  }
}
