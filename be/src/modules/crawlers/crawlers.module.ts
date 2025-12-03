import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GoogleMapsService } from './google-maps/google-maps.service';
import { CrawlLocationsCommand } from './commands/crawl-locations.command';
import { PrismaService } from '../../core/database/prisma.service';
import { ActivitiesModule } from '../activities/activities.module';
import { AiModule } from '../../shared/ai/ai.module';
import { GooglePlacesApiServiceImpl } from './google-maps/services/google-places-api.service';
import { CachedPlacesApiServiceImpl } from './google-maps/services/cached-places-api.service';

@Module({
  imports: [ConfigModule, forwardRef(() => ActivitiesModule), AiModule],
  providers: [
    PrismaService,
    CrawlLocationsCommand,
    GooglePlacesApiServiceImpl,
    CachedPlacesApiServiceImpl,
    {
      provide: 'IPlacesApiService',
      useFactory: (
        configService: ConfigService,
        real: GooglePlacesApiServiceImpl,
        cached: CachedPlacesApiServiceImpl,
      ) => {
        const useMock = configService.get('USE_MOCK_MAPS') === 'true';
        return useMock ? cached : real;
      },
      inject: [
        ConfigService,
        GooglePlacesApiServiceImpl,
        CachedPlacesApiServiceImpl,
      ],
    },
    GoogleMapsService,
  ],
  exports: [GoogleMapsService, CrawlLocationsCommand, 'IPlacesApiService'],
})
export class CrawlersModule {}
