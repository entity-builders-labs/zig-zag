import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WikidataApiService } from './services/wikidata-api.service';
import { CachedWikidataApiService } from './services/cached-wikidata-api.service';
import { IWikidataApiService } from './interfaces/wikidata.interface';

@Module({
  imports: [ConfigModule],
  providers: [
    WikidataApiService,
    CachedWikidataApiService,
    {
      provide: 'RealWikidataApiService',
      useExisting: WikidataApiService,
    },
    {
      provide: 'WikidataApiService',
      useFactory: (
        configService: ConfigService,
        real: IWikidataApiService,
        cached: CachedWikidataApiService,
      ) => {
        const useMock = configService.get('USE_MOCK_MAPS') === 'true';
        if (useMock) {
          const logger = new Logger('WikidataModule');
          const mode = configService.get('MOCK_MAPS_MODE') || 'read';
          logger.log(
            `⚠️  Using MOCK Wikidata API (USE_MOCK_MAPS=true, mode=${mode})`,
          );
        }
        return useMock ? cached : real;
      },
      inject: [
        ConfigService,
        'RealWikidataApiService',
        CachedWikidataApiService,
      ],
    },
  ],
  exports: ['WikidataApiService'],
})
export class WikidataModule {}
