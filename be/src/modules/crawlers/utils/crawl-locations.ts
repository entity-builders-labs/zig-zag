import { NestFactory } from '@nestjs/core';
import ora from 'ora';
import { GoogleMapsService } from '../google-maps/google-maps.service';
import { LocationGenerator } from './location-generator';
import { Command, CommandRunner, Option } from 'nest-commander';
import { CrawlersModule } from '../crawlers.module';
import { Logger } from '@nestjs/common';

interface CrawlCommandOptions {
  radius: number;
  points: number;
  delay: number;
}

@Command({
  name: 'crawl',
  description: 'Crawl locations in a given radius around a center point',
})
export class CrawlLocationsCommand extends CommandRunner {
  private readonly logger = new Logger(CrawlLocationsCommand.name);

  constructor(private readonly googleMapsService: GoogleMapsService) {
    super();
  }

  @Option({
    flags: '-lat, --latitude <latitude>',
    description: 'Center latitude',
    required: true,
  })
  parseLatitude(val: string): number {
    const lat = Number(val);
    if (isNaN(lat) || lat < -90 || lat > 90) {
      throw new Error('Invalid latitude. Must be between -90 and 90');
    }
    return lat;
  }

  @Option({
    flags: '-lng, --longitude <longitude>',
    description: 'Center longitude',
    required: true,
  })
  parseLongitude(val: string): number {
    const lng = Number(val);
    if (isNaN(lng) || lng < -180 || lng > 180) {
      throw new Error('Invalid longitude. Must be between -180 and 180');
    }
    return lng;
  }

  @Option({
    flags: '-r, --radius <radius>',
    description: 'Radius in kilometers',
    defaultValue: 5,
  })
  parseRadius(val: string): number {
    const radius = Number(val);
    if (isNaN(radius) || radius <= 0) {
      throw new Error('Invalid radius. Must be greater than 0');
    }
    return radius;
  }

  @Option({
    flags: '-p, --points <points>',
    description: 'Number of points to generate',
    defaultValue: 8,
  })
  parsePoints(val: string): number {
    const points = Number(val);
    if (isNaN(points) || points < 1) {
      throw new Error('Invalid points. Must be at least 1');
    }
    return points;
  }

  @Option({
    flags: '-d, --delay <delay>',
    description: 'Delay between requests in milliseconds',
    defaultValue: 2000,
  })
  parseDelay(val: string): number {
    const delay = Number(val);
    if (isNaN(delay) || delay < 0) {
      throw new Error('Invalid delay. Must be non-negative');
    }
    return delay;
  }

  async run(
    passedParams: string[],
    options: CrawlCommandOptions & { latitude: number; longitude: number },
  ): Promise<void> {
    try {
      const spinner = ora('Generating location points...').start();
      const generator = new LocationGenerator(
        options.latitude,
        options.longitude,
        options.radius,
        options.points,
      );

      const points = generator.generatePoints();
      spinner.succeed(`Generated ${points.length} points`);

      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        spinner.start(
          `Crawling point ${i + 1}/${points.length} (${point.latitude.toFixed(
            4,
          )}, ${point.longitude.toFixed(4)})`,
        );

        try {
          await this.googleMapsService.crawlAndSaveActivities({
            latitude: point.latitude,
            longitude: point.longitude,
            radius: 1000,
            fetchDetails: true,
            language: 'es',
          });

          spinner.succeed(
            `Completed point ${i + 1}/${points.length} (${point.latitude.toFixed(
              4,
            )}, ${point.longitude.toFixed(4)})`,
          );

          if (i < points.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, options.delay));
          }
        } catch (error) {
          spinner.fail(
            `Failed at point ${i + 1}/${points.length}: ${error.message}`,
          );
          this.logger.error(error);
        }
      }
    } catch (error) {
      this.logger.error('Failed to execute crawl command:', error);
      throw error;
    }
  }
}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(CrawlersModule);
  try {
    await app.select(CrawlLocationsCommand).init();
  } catch (error) {
    console.error('Failed to initialize the CLI:', error);
    await app.close();
    process.exit(1);
  }
}

bootstrap();

export async function crawlArea(
  googleMapsService: GoogleMapsService,
  centerLat: number,
  centerLng: number,
  radiusKm: number,
  pointsPerRadius: number = 8,
) {
  const generator = new LocationGenerator(
    centerLat,
    centerLng,
    radiusKm,
    pointsPerRadius,
  );
  const points = generator.generatePoints();

  for (const point of points) {
    await googleMapsService.crawlAndSaveActivities({
      latitude: point.latitude,
      longitude: point.longitude,
      radius: 1000, // Radio de búsqueda en metros para cada punto
      fetchDetails: true,
      language: 'es',
    });

    // Esperar entre solicitudes para respetar límites de API
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
