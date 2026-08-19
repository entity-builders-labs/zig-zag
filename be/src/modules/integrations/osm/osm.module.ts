import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { OverpassApiService } from './services/overpass-api.service';
import { CachedOverpassApiService } from './services/cached-overpass-api.service';
import { OsmPlacesService } from './services/osm-places.service';
import { IOverpassApiService } from './interfaces/overpass.interface';

@Module({
  imports: [ConfigModule],
  providers: [
    OverpassApiService,
    CachedOverpassApiService,
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
    OsmPlacesService,
  ],
  exports: [OsmPlacesService],
})
export class OsmModule {}
