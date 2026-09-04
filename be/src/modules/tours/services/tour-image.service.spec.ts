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
});
