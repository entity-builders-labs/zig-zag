import { TourImageService } from './tour-image.service';

describe('TourImageService', () => {
  const tour = {
    id: 'tour-1',
    name: 'Buenos Aires',
    description: 'A cultural tour',
    metadata: { generationStatus: 'generating' },
    experiences: [
      { experience: { canonicalName: 'Museo Nacional' } },
      { experience: { canonicalName: 'San Telmo' } },
    ],
  };

  it('persists a generated cover outcome together with the URL', async () => {
    const prisma: any = {
      tour: {
        findUnique: jest.fn().mockResolvedValue(tour),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    const images: any = {
      generateImage: jest
        .fn()
        .mockResolvedValue('https://example.test/cover.jpg'),
    };
    const service = new TourImageService(prisma, images);

    await expect(service.generateTourCoverImage(tour.id)).resolves.toBe(
      'https://example.test/cover.jpg',
    );

    expect(prisma.tour.update).toHaveBeenCalledWith({
      where: { id: tour.id },
      data: expect.objectContaining({
        coverImage: 'https://example.test/cover.jpg',
        metadata: expect.objectContaining({
          generationStatus: 'generating',
          coverImageGeneration: expect.objectContaining({
            status: 'generated',
          }),
        }),
      }),
    });
  });

  it('persists a non-fatal failed outcome before propagating provider failure', async () => {
    const prisma: any = {
      tour: {
        findUnique: jest.fn().mockResolvedValue(tour),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    const providerError = new Error('image provider 429');
    const images: any = {
      generateImage: jest.fn().mockRejectedValue(providerError),
    };
    const service = new TourImageService(prisma, images);

    await expect(service.generateTourCoverImage(tour.id)).rejects.toBe(
      providerError,
    );

    expect(prisma.tour.update).toHaveBeenCalledWith({
      where: { id: tour.id },
      data: {
        metadata: expect.objectContaining({
          generationStatus: 'generating',
          coverImageGeneration: expect.objectContaining({
            status: 'failed',
            reasonCode: 'COVER_IMAGE_PROVIDER_FAILED',
            error: 'image provider 429',
          }),
        }),
      },
    });
  });

  it('records a provider no-image response without inventing a cover URL', async () => {
    const prisma: any = {
      tour: {
        findUnique: jest.fn().mockResolvedValue(tour),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    const images: any = { generateImage: jest.fn().mockResolvedValue(null) };
    const service = new TourImageService(prisma, images);

    await expect(service.generateTourCoverImage(tour.id)).resolves.toBeNull();

    expect(prisma.tour.update).toHaveBeenCalledWith({
      where: { id: tour.id },
      data: {
        metadata: expect.objectContaining({
          coverImageGeneration: expect.objectContaining({
            status: 'not_generated',
            reasonCode: 'PROVIDER_RETURNED_NO_IMAGE',
          }),
        }),
      },
    });
  });

  describe('resolveDestinationCoverImage', () => {
    it('returns existing coverImage immediately if already present', async () => {
      const tourWithCover = {
        ...tour,
        coverImage: 'https://example.test/existing.jpg',
      };
      const prisma: any = {
        tour: {
          findUnique: jest.fn().mockResolvedValue(tourWithCover),
          update: jest.fn(),
        },
      };
      const images: any = { generateImage: jest.fn() };
      const service = new TourImageService(prisma, images);

      const result = await service.resolveDestinationCoverImage(tour.id, {
        label: 'Salta',
        latitude: -24.7859,
        longitude: -65.4116,
      });

      expect(result).toBe('https://example.test/existing.jpg');
      expect(prisma.tour.update).not.toHaveBeenCalled();
    });

    it('resolves photo, saves coverImage, and creates TourProgressUpdated outbox event with coverImage', async () => {
      const prisma: any = {
        tour: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ ...tour, coverImage: null }),
          update: jest.fn().mockResolvedValue(undefined),
        },
        $transaction: jest.fn(async (cb) => cb(prisma)),
      };
      const images: any = { generateImage: jest.fn() };
      const outboxService: any = {
        createInTx: jest.fn().mockResolvedValue({ id: 'outbox-1' }),
      };
      const wikimediaProvider: any = {
        enrichExperience: jest.fn().mockResolvedValue({
          photos: [{ url: 'https://upload.wikimedia.org/catedral-salta.jpg' }],
        }),
      };
      const service = new TourImageService(
        prisma,
        images,
        outboxService,
        wikimediaProvider,
      );

      jest.spyOn(service as any, 'fetchDestinationPhoto').mockResolvedValue({
        url: 'https://upload.wikimedia.org/catedral-salta.jpg',
        provider: 'wikimedia',
      });

      const result = await service.resolveDestinationCoverImage(tour.id, {
        label: 'Salta, Argentina',
        latitude: -24.7859,
        longitude: -65.4116,
      });

      expect(result).toBe('https://upload.wikimedia.org/catedral-salta.jpg');
      expect(prisma.tour.update).toHaveBeenCalledWith({
        where: { id: tour.id },
        data: expect.objectContaining({
          coverImage: 'https://upload.wikimedia.org/catedral-salta.jpg',
          metadata: expect.objectContaining({
            coverImageResolution: expect.objectContaining({
              status: 'resolved',
              provider: 'wikimedia',
              url: 'https://upload.wikimedia.org/catedral-salta.jpg',
            }),
          }),
        }),
      });

      expect(outboxService.createInTx).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          eventType: 'TourProgressUpdated',
          payload: expect.objectContaining({
            tourId: tour.id,
            status: 'generating',
            coverImage: 'https://upload.wikimedia.org/catedral-salta.jpg',
          }),
        }),
      );
    });

    it('preserves metadata changes and does not revert completed lifecycle on late cover resolution', async () => {
      // Initially, tour is generating
      const initialTour = {
        id: 'tour-race-1',
        name: 'Salta Tour',
        ownerId: 'user-1',
        coverImage: null as string | null,
        metadata: { generationStatus: 'generating' },
      };

      // While photo resolution was pending HTTP calls, generation finished and updated metadata
      const completedTourInDb = {
        id: 'tour-race-1',
        name: 'Salta Tour',
        ownerId: 'user-1',
        coverImage: null as string | null,
        metadata: {
          generationStatus: 'completed',
          generationTrace: { steps: ['retrieval', 'ranking', 'planning'] },
          executionSummary: { totalExperiences: 5, durationMs: 1420 },
        },
      };

      let findUniqueCallCount = 0;
      const prisma: any = {
        tour: {
          findUnique: jest.fn().mockImplementation(async () => {
            findUniqueCallCount++;
            // First call before fetchDestinationPhoto
            if (findUniqueCallCount === 1) return initialTour;
            // Atomic re-read inside $transaction after fetchDestinationPhoto finishes
            return completedTourInDb;
          }),
          update: jest.fn().mockResolvedValue(undefined),
        },
        $transaction: jest.fn(async (cb) => cb(prisma)),
      };

      const outboxService: any = {
        createInTx: jest.fn().mockResolvedValue({ id: 'outbox-race-1' }),
      };

      const service = new TourImageService(
        prisma,
        {} as any,
        outboxService,
        {} as any,
      );

      jest.spyOn(service as any, 'fetchDestinationPhoto').mockResolvedValue({
        url: 'https://upload.wikimedia.org/salta-view.jpg',
        provider: 'wikipedia_search',
      });

      const result = await service.resolveDestinationCoverImage('tour-race-1', {
        label: 'Salta, Argentina',
      });

      expect(result).toBe('https://upload.wikimedia.org/salta-view.jpg');

      // Verify update merged into latest DB metadata without clobbering generationTrace or executionSummary
      expect(prisma.tour.update).toHaveBeenCalledWith({
        where: { id: 'tour-race-1' },
        data: {
          coverImage: 'https://upload.wikimedia.org/salta-view.jpg',
          metadata: expect.objectContaining({
            generationStatus: 'completed',
            generationTrace: { steps: ['retrieval', 'ranking', 'planning'] },
            executionSummary: { totalExperiences: 5, durationMs: 1420 },
            coverImageResolution: expect.objectContaining({
              status: 'resolved',
              provider: 'wikipedia_search',
              url: 'https://upload.wikimedia.org/salta-view.jpg',
            }),
          }),
        },
      });

      // Verify event did NOT roll back lifecycle status to 'generating'
      expect(outboxService.createInTx).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          eventType: 'TourProgressUpdated',
          payload: expect.objectContaining({
            tourId: 'tour-race-1',
            status: 'completed',
            coverImage: 'https://upload.wikimedia.org/salta-view.jpg',
          }),
        }),
      );
    });

    it('does not overwrite coverImage if a concurrent worker set it before transaction commits', async () => {
      const initialTour = {
        id: 'tour-concurrent-1',
        name: 'Mendoza Tour',
        ownerId: 'user-1',
        coverImage: null as string | null,
        metadata: { generationStatus: 'generating' },
      };

      const concurrentTourInDb = {
        ...initialTour,
        coverImage: 'https://example.test/concurrent-winner.jpg',
      };

      let findUniqueCallCount = 0;
      const prisma: any = {
        tour: {
          findUnique: jest.fn().mockImplementation(async () => {
            findUniqueCallCount++;
            if (findUniqueCallCount === 1) return initialTour;
            return concurrentTourInDb;
          }),
          update: jest.fn().mockResolvedValue(undefined),
        },
        $transaction: jest.fn(async (cb) => cb(prisma)),
      };

      const outboxService: any = { createInTx: jest.fn() };
      const service = new TourImageService(
        prisma,
        {} as any,
        outboxService,
        {} as any,
      );

      jest.spyOn(service as any, 'fetchDestinationPhoto').mockResolvedValue({
        url: 'https://upload.wikimedia.org/late-arrival.jpg',
        provider: 'wikipedia_summary',
      });

      await service.resolveDestinationCoverImage('tour-concurrent-1', {
        label: 'Mendoza',
      });

      // Transaction re-read detected coverImage already set, aborted update
      expect(prisma.tour.update).not.toHaveBeenCalled();
      expect(outboxService.createInTx).not.toHaveBeenCalled();
    });

    it('rejects sports stadiums, football fields, and non-iconic facilities', () => {
      const service = new TourImageService({} as any, {} as any);
      const isIconic = (service as any).isIconicDestinationPage.bind(service);

      // Should reject football stadiums and clubs
      expect(
        isIconic(
          'Estadio Marcelo Bielsa',
          'https://upload.wikimedia.org/Estadio_Bielsa.jpg',
        ),
      ).toBe(false);
      expect(
        isIconic(
          "Club Atlético Newell's Old Boys",
          'https://upload.wikimedia.org/cancha_newells.jpg',
        ),
      ).toBe(false);
      expect(
        isIconic(
          'Estadio Monumental Antonio Vespucio Liberti',
          'https://upload.wikimedia.org/river_stadium.jpg',
        ),
      ).toBe(false);
      expect(
        isIconic(
          'Cementerio de la Recoleta',
          'https://upload.wikimedia.org/cementerio.jpg',
        ),
      ).toBe(false);
      expect(
        isIconic('Bandera de Rosario', 'https://upload.wikimedia.org/flag.svg'),
      ).toBe(false);

      // Should accept iconic city articles and landmarks
      expect(
        isIconic(
          'Rosario (Argentina)',
          'https://upload.wikimedia.org/Monumento_a_la_Bandera.jpg',
        ),
      ).toBe(true);
      expect(
        isIconic(
          'San Carlos de Bariloche',
          'https://upload.wikimedia.org/Catedral_Nahuel_Huapi.jpg',
        ),
      ).toBe(true);
      expect(
        isIconic(
          'Catedral de Salta',
          'https://upload.wikimedia.org/catedral_salta.jpg',
        ),
      ).toBe(true);
    });
  });
});
