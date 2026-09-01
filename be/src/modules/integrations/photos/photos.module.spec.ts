import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PhotosModule } from './photos.module';
import { IPhotoEnrichmentProvider } from './interfaces/photo-enrichment.interface';
import { HybridPhotoProvider } from './providers/hybrid-photo.provider';
import { WikimediaPhotoProvider } from './providers/wikimedia-photo.provider';
import { MockPhotoProvider } from './providers/mock-photo.provider';

describe('PhotosModule (DI & Config Switching)', () => {
  it('should inject HybridPhotoProvider by default', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [PhotosModule],
    })
      .overrideProvider(ConfigService)
      .useValue({ get: jest.fn().mockReturnValue(undefined) })
      .compile();

    const provider = module.get<IPhotoEnrichmentProvider>(
      'PhotoEnrichmentProvider',
    );
    expect(provider).toBeInstanceOf(HybridPhotoProvider);
  });

  it('should inject WikimediaPhotoProvider when PHOTO_PROVIDER=wikimedia', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [PhotosModule],
    })
      .overrideProvider(ConfigService)
      .useValue({ get: jest.fn().mockReturnValue('wikimedia') })
      .compile();

    const provider = module.get<IPhotoEnrichmentProvider>(
      'PhotoEnrichmentProvider',
    );
    expect(provider).toBeInstanceOf(WikimediaPhotoProvider);
  });

  it('should inject MockPhotoProvider when PHOTO_PROVIDER=mock', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [PhotosModule],
    })
      .overrideProvider(ConfigService)
      .useValue({ get: jest.fn().mockReturnValue('mock') })
      .compile();

    const provider = module.get<IPhotoEnrichmentProvider>(
      'PhotoEnrichmentProvider',
    );
    expect(provider).toBeInstanceOf(MockPhotoProvider);
  });
});
