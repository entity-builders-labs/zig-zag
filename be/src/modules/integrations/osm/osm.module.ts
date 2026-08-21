import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { OverpassApiService } from './services/overpass-api.service';
import { CachedOverpassApiService } from './services/cached-overpass-api.service';
import { NominatimApiService } from './services/nominatim-api.service';
import { CachedNominatimApiService } from './services/cached-nominatim-api.service';
import { OsmPlacesService } from './services/osm-places.service';
import { IOverpassApiService } from './interfaces/overpass.interface';
import { INominatimApiService } from './interfaces/nominatim.interface';

@Module({
  imports: [ConfigModule],
  providers: [
    OverpassApiService,
    CachedOverpassApiService,
    NominatimApiService,
    CachedNominatimApiService,
    {
      provide: 'RealOverpassApiService',
      useExisting: OverpassApiService,
    },
    {
      provide: 'OverpassApiService',
      useFactory: (
        configService: ConfigService,
        real: IOverpassApiService,
        cached: CachedOverpassApiService,
      ) => {
        const useMock = configService.get('USE_MOCK_MAPS') === 'true';
        if (useMock) {
          const logger = new Logger('OsmModule');
          const mode = configService.get('MOCK_MAPS_MODE') || 'read';
          logger.log(
            `⚠️  Using MOCK Overpass API (USE_MOCK_MAPS=true, mode=${mode})`,
          );
        }
        return useMock ? cached : real;
      },
      inject: [
        ConfigService,
        'RealOverpassApiService',
        CachedOverpassApiService,
      ],
    },
    {
      provide: 'RealNominatimApiService',
      useExisting: NominatimApiService,
    },
    {
      provide: 'NominatimApiService',
      useFactory: (
        configService: ConfigService,
        real: INominatimApiService,
        cached: CachedNominatimApiService,
      ) => {
        const useMock = configService.get('USE_MOCK_MAPS') === 'true';
        return useMock ? cached : real;
      },
      inject: [ConfigService, 'RealNominatimApiService', CachedNominatimApiService],
    },
    OsmPlacesService,
  ],
  // 'NominatimApiService' is exported alongside OsmPlacesService (not
  // folded behind it) because DestinationResolutionService (tours module,
  // Task 12) injects it directly — OsmPlacesService's own job is Overpass
  // geometry/boundary lookups, not name resolution, so this keeps that
  // separation instead of growing OsmPlacesService a name-search method it
  // doesn't otherwise need.
  exports: [OsmPlacesService, 'NominatimApiService'],
})
export class OsmModule {}
