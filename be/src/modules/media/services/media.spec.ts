import { Test, TestingModule } from '@nestjs/testing';
import { NegativeCacheService } from './negative-cache.service';
import { MediaPresentationResolver } from './media-presentation.resolver';
import { MediaEnrichmentProcessorService } from './media-enrichment-processor.service';
import { WikimediaCommonsService } from './wikimedia-commons.service';
import { OutboxService } from '../../outbox/services/outbox.service';
import { PrismaService } from '../../../core/database/prisma.service';
import { MESSAGE_QUEUE_SERVICE } from '../../queue/interfaces/message-queue.interface';

describe('MediaModule Services', () => {
  let negativeCache: NegativeCacheService;
  let presentationResolver: MediaPresentationResolver;
  let enrichmentProcessor: MediaEnrichmentProcessorService;
  let wikimediaCommonsMock: any;
  let outboxServiceMock: any;
  let prismaMock: any;
  let queueMock: any;

  beforeEach(async () => {
    prismaMock = {
      $transaction: jest.fn(async (cb: any) => cb(prismaMock)),
      negativeMediaLookup: {
        findFirst: jest.fn(),
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
      activity: {
        update: jest.fn(),
      },
    };

    wikimediaCommonsMock = {
      findPhotosForActivity: jest.fn(),
    };

    outboxServiceMock = {
      createInTx: jest.fn(),
    };

    queueMock = {
      publish: jest.fn(),
      subscribe: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NegativeCacheService,
        MediaPresentationResolver,
        MediaEnrichmentProcessorService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: WikimediaCommonsService, useValue: wikimediaCommonsMock },
        { provide: OutboxService, useValue: outboxServiceMock },
        { provide: MESSAGE_QUEUE_SERVICE, useValue: queueMock },
      ],
    }).compile();

    negativeCache = module.get<NegativeCacheService>(NegativeCacheService);
    presentationResolver = module.get<MediaPresentationResolver>(
      MediaPresentationResolver,
    );
    enrichmentProcessor = module.get<MediaEnrichmentProcessorService>(
      MediaEnrichmentProcessorService,
    );
  });

  describe('NegativeCacheService', () => {
    it('returns true when valid negative entry is found', async () => {
      prismaMock.negativeMediaLookup.findFirst.mockResolvedValueOnce({
        id: 'neg-1',
        negativeUntil: new Date(Date.now() + 86400000),
      });

      const isNeg = await negativeCache.isNegative(
        'wikimedia_commons',
        'title_search',
        'Plaza Dorrego',
      );

      expect(isNeg).toBe(true);
      expect(prismaMock.negativeMediaLookup.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            provider: 'wikimedia_commons',
            lookupStrategy: 'title_search',
            lookupKey: 'plaza dorrego',
          }),
        }),
      );
    });

    it('returns false when negative entry is not found', async () => {
      prismaMock.negativeMediaLookup.findFirst.mockResolvedValueOnce(null);

      const isNeg = await negativeCache.isNegative(
        'wikimedia_commons',
        'title_search',
        'Unknown Place',
      );

      expect(isNeg).toBe(false);
    });
  });

  describe('MediaPresentationResolver (Presentation vs Documentary Separation)', () => {
    it('resolves authentic documentary photos with CC attribution when photos exist', () => {
      const activity = {
        photos: [
          {
            url: 'https://upload.wikimedia.org/wikipedia/commons/barolo.jpg',
            author: 'Mariano',
            license: 'CC BY-SA 4.0',
            provider: 'wikimedia_commons',
          },
        ],
        type: 'architecture',
      };

      const presentation = presentationResolver.resolvePresentation(activity);

      expect(presentation.source).toBe('DOCUMENTARY');
      expect(presentation.photos).toHaveLength(1);
      expect(presentation.primaryPhoto.isFallback).toBe(false);
      expect(presentation.primaryPhoto.url).toBe(
        'https://upload.wikimedia.org/wikipedia/commons/barolo.jpg',
      );
      expect(presentation.primaryPhoto.author).toBe('Mariano');
    });

    it('resolves curated category fallback in presentation when photos array is empty without DB mutation', () => {
      const activity = {
        photos: null as any,
        knownActivityTypeName: 'tango',
      };

      const presentation = presentationResolver.resolvePresentation(activity);

      expect(presentation.source).toBe('CURATED_FALLBACK');
      expect(presentation.photos).toHaveLength(0);
      expect(presentation.primaryPhoto.isFallback).toBe(true);
      expect(presentation.primaryPhoto.caption).toContain('Tango');
    });
  });

  describe('MediaEnrichmentProcessorService', () => {
    it('persists documentary photos and emits ActivityMediaUpdated in transaction', async () => {
      wikimediaCommonsMock.findPhotosForActivity.mockResolvedValueOnce([
        {
          url: 'https://upload.wikimedia.org/wikipedia/commons/san_telmo.jpg',
          author: 'Wikimedia User',
          license: 'CC BY 3.0',
          provider: 'wikimedia_commons',
        },
      ]);
      prismaMock.activity.update.mockResolvedValueOnce({});
      outboxServiceMock.createInTx.mockResolvedValueOnce({});

      await enrichmentProcessor.handleMediaEnrichment({
        activityId: 'act-123',
        name: 'San Telmo Market',
        destinationLabel: 'Buenos Aires',
        latitude: -34.6158,
        longitude: -58.3754,
      });

      expect(wikimediaCommonsMock.findPhotosForActivity).toHaveBeenCalledWith({
        name: 'San Telmo Market',
        destinationLabel: 'Buenos Aires',
        latitude: -34.6158,
        longitude: -58.3754,
      });

      expect(prismaMock.$transaction).toHaveBeenCalled();
      expect(prismaMock.activity.update).toHaveBeenCalledWith({
        where: { id: 'act-123' },
        data: expect.objectContaining({
          mediaStatus: 'ENRICHED',
        }),
      });

      expect(outboxServiceMock.createInTx).toHaveBeenCalledWith(
        prismaMock,
        expect.objectContaining({
          eventType: 'ActivityMediaUpdated',
          payload: {
            activityId: 'act-123',
            mediaStatus: 'ENRICHED',
            photoCount: 1,
          },
        }),
      );
    });
  });
});
