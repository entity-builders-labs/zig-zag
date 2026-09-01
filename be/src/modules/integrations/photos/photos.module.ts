import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WikidataModule } from '../wikidata/wikidata.module';
import { WikimediaPhotoProvider } from './providers/wikimedia-photo.provider';
import { SerpApiPhotoProvider } from './providers/serpapi-photo.provider';
import { GooglePlacesPhotoProvider } from './providers/google-places-photo.provider';
import { MockPhotoProvider } from './providers/mock-photo.provider';
import { HybridPhotoProvider } from './providers/hybrid-photo.provider';
import { IPhotoEnrichmentProvider } from './interfaces/photo-enrichment.interface';

@Global()
@Module({
  imports: [ConfigModule, WikidataModule],
  providers: [
    WikimediaPhotoProvider,
    SerpApiPhotoProvider,
    GooglePlacesPhotoProvider,
    MockPhotoProvider,
    HybridPhotoProvider,
    {
      provide: 'PhotoEnrichmentProvider',
      useFactory: (
        config: ConfigService,
        hybrid: HybridPhotoProvider,
        wikimedia: WikimediaPhotoProvider,
        serpApi: SerpApiPhotoProvider,
        googlePlaces: GooglePlacesPhotoProvider,
        mock: MockPhotoProvider,
      ): IPhotoEnrichmentProvider => {
        const providerName = (
          config.get<string>('PHOTO_PROVIDER') || 'hybrid'
        ).toLowerCase();

        switch (providerName) {
          case 'wikimedia':
            return wikimedia;
          case 'serpapi':
            return serpApi;
          case 'google_places':
          case 'places':
            return googlePlaces;
          case 'mock':
          case 'test':
            return mock;
          case 'hybrid':
          default:
            return hybrid;
        }
      },
      inject: [
        ConfigService,
        HybridPhotoProvider,
        WikimediaPhotoProvider,
        SerpApiPhotoProvider,
        GooglePlacesPhotoProvider,
        MockPhotoProvider,
      ],
    },
  ],
  exports: [
    'PhotoEnrichmentProvider',
    WikimediaPhotoProvider,
    SerpApiPhotoProvider,
    GooglePlacesPhotoProvider,
    MockPhotoProvider,
    HybridPhotoProvider,
  ],
})
export class PhotosModule {}
