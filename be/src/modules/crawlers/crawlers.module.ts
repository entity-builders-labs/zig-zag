import { Module, forwardRef, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GoogleMapsService } from './google-maps/google-maps.service';
import { CrawlLocationsCommand } from './commands/crawl-locations.command';
import { PrismaService } from '../../core/database/prisma.service';
import { ActivitiesModule } from '../activities/activities.module';
import { AiModule } from '../../shared/ai/ai.module';
import { GooglePlacesApiService } from './google-maps/services/google-places-api.service';
import { CachedPlacesApiService } from './google-maps/services/cached-places-api.service';

@Module({
  imports: [ConfigModule, forwardRef(() => ActivitiesModule), AiModule],
  providers: [
    PrismaService,
    CrawlLocationsCommand,
    GooglePlacesApiService,
    CachedPlacesApiService,
    {
      provide: 'PlacesApiService',
      useFactory: (
        configService: ConfigService,
        real: GooglePlacesApiService,
        cached: CachedPlacesApiService,
      ) => {
        const useMock = configService.get('USE_MOCK_MAPS') === 'true';
        if (useMock) {
          const logger = new Logger('CrawlersModule');
          const mode = configService.get('MOCK_MAPS_MODE') || 'read';
          logger.log(
            `⚠️  Using MOCK Places API (USE_MOCK_MAPS=true, mode=${mode})`,
          );
          console.log('$$$ cached:', cached);
        }
        return useMock ? cached : real;
      },
      inject: [ConfigService, GooglePlacesApiService, CachedPlacesApiService],
    },
    GoogleMapsService,
  ],
  exports: [GoogleMapsService, CrawlLocationsCommand, 'PlacesApiService'],
})
export class CrawlersModule {}
