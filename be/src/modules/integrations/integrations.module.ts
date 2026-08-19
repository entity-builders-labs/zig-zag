import { Module, forwardRef, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GooglePlacesService } from './google-places/google-places.service';
import { PrismaService } from '@core/database/prisma.service';
import { ActivitiesModule } from '@activities/activities.module';
import { AiModule } from '@shared/ai/ai.module';
import { GooglePlacesApiService } from '@integrations/google-places/services/google-places-api.service';
import { GeoapifyPlacesApiService } from '@integrations/google-places/services/geoapify-places-api.service';
import { CachedPlacesApiService } from '@integrations/google-places/services/cached-places-api.service';
import { IPlacesApiService } from '@integrations/google-places/interfaces/places-api.interface';
import { OsmModule } from './osm/osm.module';
import { WikidataModule } from './wikidata/wikidata.module';

@Module({
  imports: [
    ConfigModule,
    forwardRef(() => ActivitiesModule),
    AiModule,
    OsmModule,
    WikidataModule,
  ],
  providers: [
    PrismaService,
    GooglePlacesApiService,
    GeoapifyPlacesApiService,
    CachedPlacesApiService,
    {
      provide: 'RealPlacesApiService',
      useFactory: (
        configService: ConfigService,
        google: GooglePlacesApiService,
        geoapify: GeoapifyPlacesApiService,
      ): IPlacesApiService => {
        const provider = configService.get('PLACES_PROVIDER') || 'google';
        if (provider === 'geoapify') {
          new Logger('IntegrationsModule').log(
            '🗺️  Using Geoapify as the Places API provider (PLACES_PROVIDER=geoapify)',
          );
          return geoapify;
        }
        return google;
      },
      inject: [ConfigService, GooglePlacesApiService, GeoapifyPlacesApiService],
    },
    {
      provide: 'PlacesApiService',
      useFactory: (
        configService: ConfigService,
        real: IPlacesApiService,
        cached: CachedPlacesApiService,
      ) => {
        const useMock = configService.get('USE_MOCK_MAPS') === 'true';
        if (useMock) {
          const logger = new Logger('IntegrationsModule');
          const mode = configService.get('MOCK_MAPS_MODE') || 'read';
          logger.log(
            `⚠️  Using MOCK Places API (USE_MOCK_MAPS=true, mode=${mode})`,
          );
        }
        return useMock ? cached : real;
      },
      inject: [ConfigService, 'RealPlacesApiService', CachedPlacesApiService],
    },
    GooglePlacesService,
  ],
  exports: [GooglePlacesService, 'PlacesApiService', OsmModule, WikidataModule],
})
export class IntegrationsModule {}
