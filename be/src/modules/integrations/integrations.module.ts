import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaService } from '@core/database/prisma.service';
import { AiModule } from '@shared/ai/ai.module';
import { GooglePlacesApiService } from '@integrations/google-places/services/google-places-api.service';
import { GeoapifyPlacesApiService } from '@integrations/google-places/services/geoapify-places-api.service';
import { CachedPlacesApiService } from '@integrations/google-places/services/cached-places-api.service';
import {
  IPlacesApiService,
  parsePlacesProvider,
  placesProviderLabel,
} from '@integrations/google-places/interfaces/places-api.interface';
import { OsmModule } from './osm/osm.module';
import { WikidataModule } from './wikidata/wikidata.module';
import { PhotosModule } from './photos/photos.module';
import { SerperModule } from './serper/serper.module';

export function createRealPlacesApiService(
  configService: ConfigService,
  google: GooglePlacesApiService,
  geoapify: GeoapifyPlacesApiService,
): IPlacesApiService {
  const provider = parsePlacesProvider(configService.get('PLACES_PROVIDER'));
  return provider === 'google' ? google : geoapify;
}

export function createPlacesApiService(
  configService: ConfigService,
  real: IPlacesApiService,
  cached: CachedPlacesApiService,
): IPlacesApiService {
  const cacheEnabled = configService.get('USE_MOCK_MAPS') === 'true';
  const service = cacheEnabled ? cached : real;
  const status = service.getStatus();
  const logger = new Logger('IntegrationsModule');
  logger.log(
    `Places provider: ${placesProviderLabel(status.provider)}; ` +
      `available=${status.available}; cache=${
        status.cacheEnabled ? status.cacheMode : 'disabled'
      }`,
  );
  if (!status.available) {
    logger.warn(
      `${placesProviderLabel(status.provider)} is selected but its API key is not configured.`,
    );
  }
  return service;
}

@Module({
  imports: [
    ConfigModule,
    AiModule,
    OsmModule,
    WikidataModule,
    PhotosModule,
    SerperModule,
  ],
  providers: [
    PrismaService,
    GooglePlacesApiService,
    GeoapifyPlacesApiService,
    CachedPlacesApiService,
    {
      provide: 'RealPlacesApiService',
      useFactory: createRealPlacesApiService,
      inject: [ConfigService, GooglePlacesApiService, GeoapifyPlacesApiService],
    },
    {
      provide: 'PlacesApiService',
      useFactory: createPlacesApiService,
      inject: [ConfigService, 'RealPlacesApiService', CachedPlacesApiService],
    },
  ],
  exports: [
    'PlacesApiService',
    OsmModule,
    WikidataModule,
    PhotosModule,
    SerperModule,
  ],
})
export class IntegrationsModule {}
