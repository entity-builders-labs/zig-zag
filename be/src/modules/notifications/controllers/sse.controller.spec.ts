import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { of } from 'rxjs';
import { PrismaService } from '../../../core/database/prisma.service';
import { SSEController } from './sse.controller';
import { SSEHubService } from '../services/sse-hub.service';

describe('SSEController', () => {
  let controller: SSEController;
  let sseHub: jest.Mocked<Pick<SSEHubService, 'getStream' | 'removeClient'>>;
  let prisma: any;

  beforeEach(() => {
    sseHub = {
      getStream: jest.fn().mockReturnValue(of({ type: 'connected', data: {} })),
      removeClient: jest.fn(),
    };
    prisma = {
      tour: { findUnique: jest.fn() },
      experience: { findUnique: jest.fn() },
    };
    controller = new SSEController(
      sseHub as unknown as SSEHubService,
      prisma as PrismaService,
    );
  });

  it('opens a namespaced tour stream only for its owner', async () => {
    prisma.tour.findUnique.mockResolvedValue({ ownerId: 'user-1' });

    const stream = await controller.streamTourEvents('tour-1', {
      id: 'user-1',
    } as any);
    stream.subscribe();

    expect(sseHub.getStream).toHaveBeenCalledWith('tour:tour-1');
    expect(sseHub.removeClient).toHaveBeenCalledWith('tour:tour-1');
  });

  it('rejects a tour stream requested by a different user', async () => {
    prisma.tour.findUnique.mockResolvedValue({ ownerId: 'owner-1' });

    await expect(
      controller.streamTourEvents('tour-1', { id: 'user-2' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(sseHub.getStream).not.toHaveBeenCalled();
  });

  it('returns not found for missing tours and experiences', async () => {
    prisma.tour.findUnique.mockResolvedValue(null);
    prisma.experience.findUnique.mockResolvedValue(null);

    await expect(
      controller.streamTourEvents('missing', { id: 'user-1' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.streamExperienceEvents('missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('opens the namespaced experience stream for an existing experience', async () => {
    prisma.experience.findUnique.mockResolvedValue({ id: 'experience-1' });

    const stream = await controller.streamExperienceEvents('experience-1');
    stream.subscribe();

    expect(sseHub.getStream).toHaveBeenCalledWith('experience:experience-1');
    expect(sseHub.removeClient).toHaveBeenCalledWith('experience:experience-1');
  });
});
