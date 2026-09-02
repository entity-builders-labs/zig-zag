import { TourGenerationProcessorService } from './tour-generation-processor.service';

describe('TourGenerationProcessorService', () => {
  function setup(tour: any) {
    const prisma = {
      tour: { update: jest.fn().mockResolvedValue({}) },
    };
    const toursService = {
      findOne: jest.fn().mockResolvedValue(tour),
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
});
