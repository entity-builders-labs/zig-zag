import { TourGenerationProcessorService } from './tour-generation-processor.service';

describe('TourGenerationProcessorService', () => {
  function setup(initialTour: any, latestTour: any = initialTour) {
    const prisma: any = {
      tour: { update: jest.fn().mockResolvedValue({}) },
      outboxEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction = jest.fn(async (callback: any) => callback(prisma));

    const toursService = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(initialTour)
        .mockResolvedValue(latestTour),
    };
    const generation = {
      generateTourExperiences: jest.fn().mockResolvedValue(undefined),
    };
    const queue = { subscribe: jest.fn() };
    const service = new TourGenerationProcessorService(
      prisma as any,
      toursService as any,
      generation as any,
      queue as any,
    );
    return { service, prisma, toursService, generation, queue };
  }

  const payload = {
    eventKey: 'tour-generation:tour-1',
    tourId: 'tour-1',
    userId: 'user-1',
    requestedAt: new Date().toISOString(),
  };

  it('subscribes to TourGenerationRequested', () => {
    const { service, queue } = setup({
      id: 'tour-1',
      metadata: { generationStatus: 'pending' },
      experiences: [],
    });
    service.onModuleInit();
    expect(queue.subscribe).toHaveBeenCalledWith(
      'TourGenerationRequested',
      expect.any(Function),
    );
  });

  it('processes a pending generation request', async () => {
    const { service, generation } = setup({
      id: 'tour-1',
      metadata: { generationStatus: 'pending' },
      experiences: [],
    });
    await service.handleGenerationRequested(payload);
    expect(generation.generateTourExperiences).toHaveBeenCalledWith('tour-1');
  });

  it('treats duplicate delivery after completion as a no-op', async () => {
    const { service, generation } = setup({
      id: 'tour-1',
      metadata: { generationStatus: 'completed' },
      experiences: [{ id: 'tour-experience-1' }],
    });
    await service.handleGenerationRequested(payload);
    expect(generation.generateTourExperiences).not.toHaveBeenCalled();
  });

  it('acknowledges duplicate delivery after a terminal failure without rerunning generation', async () => {
    const { service, generation } = setup({
      id: 'tour-1',
      metadata: { generationStatus: 'failed', generationError: 'infeasible' },
      experiences: [],
    });

    await service.handleGenerationRequested(payload);

    expect(generation.generateTourExperiences).not.toHaveBeenCalled();
  });

  it('recovers an interrupted generating state before replaying the durable request', async () => {
    const { service, prisma, generation } = setup({
      id: 'tour-1',
      metadata: {
        generationStatus: 'generating',
        generationStartedAt: '2026-08-31T10:00:00.000Z',
      },
      experiences: [],
    });

    await service.handleGenerationRequested(payload);

    expect(prisma.tour.update).toHaveBeenCalledWith({
      where: { id: 'tour-1' },
      data: {
        metadata: expect.objectContaining({
          generationStatus: 'pending',
          generationRecoveredAt: expect.any(String),
        }),
      },
    });
    expect(generation.generateTourExperiences).toHaveBeenCalledWith('tour-1');
  });

  it('compensates a transient 429 back to pending, removes the unpublished TourFailed event and rethrows', async () => {
    const initialTour = {
      id: 'tour-1',
      metadata: { generationStatus: 'pending' },
      experiences: [],
    };
    const latestTour = {
      id: 'tour-1',
      metadata: {
        generationStatus: 'failed',
        generationError: 'Google Places 429 rate limited',
        generationFailedAt: '2026-09-02T20:00:00.000Z',
        generationTrace: { steps: [] },
      },
      experiences: [],
    };
    const { service, prisma, generation } = setup(initialTour, latestTour);
    const transient = new Error(
      'Failed to generate experiences: Google Places 429 rate limited',
    );
    generation.generateTourExperiences.mockRejectedValueOnce(transient);

    await expect(service.handleGenerationRequested(payload)).rejects.toBe(
      transient,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.tour.update).toHaveBeenCalledWith({
      where: { id: 'tour-1' },
      data: {
        metadata: expect.objectContaining({
          generationStatus: 'pending',
          generationFailureKind: 'retryable',
          generationRetryReasonCode: 'RATE_LIMITED',
          generationRetryCount: 1,
          generationRetryableAt: expect.any(String),
        }),
      },
    });
    expect(prisma.outboxEvent.deleteMany).toHaveBeenCalledWith({
      where: {
        eventType: 'TourFailed',
        status: 'PENDING',
        payload: { path: ['tourId'], equals: 'tour-1' },
      },
    });
  });

  it('does not compensate a deterministic infeasibility failure', async () => {
    const initialTour = {
      id: 'tour-1',
      metadata: { generationStatus: 'pending' },
      experiences: [],
    };
    const latestTour = {
      id: 'tour-1',
      metadata: {
        generationStatus: 'failed',
        generationError: 'No feasible itinerary',
        generationTrace: { steps: [] },
      },
      experiences: [],
    };
    const { service, prisma, generation } = setup(initialTour, latestTour);
    const terminal = new Error(
      'Failed to generate experiences: No feasible itinerary',
    );
    generation.generateTourExperiences.mockRejectedValueOnce(terminal);

    await expect(service.handleGenerationRequested(payload)).rejects.toBe(
      terminal,
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.outboxEvent.deleteMany).not.toHaveBeenCalled();
  });
});
