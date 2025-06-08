import { Command, CommandRunner, Option } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { GoogleMapsService } from '../../../modules/crawlers/google-maps/google-maps.service';

interface CrawlOptions {
  startLat: number;
  startLng: number;
  gridSize: number;
  stepSize: number;
  delay: number;
}

@Injectable()
@Command({
  name: 'crawl-maps',
  description: 'Crawl Google Maps in a grid pattern',
})
export class GoogleMapsCrawlerCommand extends CommandRunner {
  private readonly logger = new Logger(GoogleMapsCrawlerCommand.name);

  constructor(private readonly googleMapsService: GoogleMapsService) {
    super();
  }

  @Option({
    flags: '-lat, --latitude <number>',
    description: 'Starting latitude',
    defaultValue: '40.7128',
  })
  parseLatitude(val: string): number {
    return Number(val);
  }

  @Option({
    flags: '-lng, --longitude <number>',
    description: 'Starting longitude',
    defaultValue: '-74.006',
  })
  parseLongitude(val: string): number {
    return Number(val);
  }

  @Option({
    flags: '-g, --grid-size <number>',
    description: 'Grid size (NxN)',
    defaultValue: '3',
  })
  parseGridSize(val: string): number {
    return Number(val);
  }

  @Option({
    flags: '-s, --step-size <number>',
    description: 'Step size in kilometers',
    defaultValue: '10',
  })
  parseStepSize(val: string): number {
    return Number(val);
  }

  @Option({
    flags: '-d, --delay <number>',
    description: 'Delay between requests in milliseconds',
    defaultValue: '5000',
  })
  parseDelay(val: string): number {
    return Number(val);
  }

  async run(passedParams: string[], options?: CrawlOptions): Promise<void> {
    const config = {
      startLat: options.startLat,
      startLng: options.startLng,
      gridSize: options.gridSize,
      stepSizeKm: options.stepSize,
      delayBetweenRequests: options.delay,
    };

    try {
      for (let i = 0; i < config.gridSize; i++) {
        for (let j = 0; j < config.gridSize; j++) {
          // Implement the logic to crawl Google Maps for each cell in the grid
          this.logger.log(`Crawling cell ${i},${j}`);
          await this.googleMapsService.crawlAndSaveActivities({
            latitude: config.startLat + i * config.stepSizeKm,
            longitude: config.startLng + j * config.stepSizeKm,
            radius: 5000,
          });
          await new Promise((resolve) =>
            setTimeout(resolve, config.delayBetweenRequests),
          );
        }
      }
    } catch (error) {
      this.logger.error('Error during crawling:', error);
      throw error;
    }
  }
}
