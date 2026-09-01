import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ToursService } from './tours.service';
import { PrismaService } from '../../../core/database/prisma.service';
import { OutboxService } from '../../outbox/services/outbox.service';

describe('ToursService', () => {
  let service: ToursService;
  let outboxService: { createInTx: jest.Mock };

  const mockPrismaService = {
    tour: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    tourActivity: {
      deleteMany: jest.fn(),
    },
    activity: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    outboxService = {
      createInTx: jest.fn().mockResolvedValue({ id: 'evt-1' }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ToursService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: OutboxService, useValue: outboxService },
      ],
    }).compile();

    service = module.get<ToursService>(ToursService);
    jest.clearAllMocks();
    outboxService.createInTx.mockResolvedValue({ id: 'evt-1' });

    mockPrismaService.$transaction.mockImplementation((arg) =>
      typeof arg === 'function' ? arg(mockPrismaService) : Promise.all(arg),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('creates canonical wizard Tour and TourGenerationRequested in the same transaction', async () => {
      mockPrismaService.tour.create.mockResolvedValue({
        id: 'tour-1',
        ownerId: 'user-1',
        metadata: {},
        activities: [],
      });

      await service.create({
        ownerId: 'user-1',
        name: 'Test',
        categories: [],
        metadata: {
          generationStatus: 'pending',
          generationRequest: { contractVersion: 1 },
        } as any,
        activities: [],
      } as any);

      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      expect(outboxService.createInTx).toHaveBeenCalledWith(
        mockPrismaService,
        expect.objectContaining({
          eventType: 'TourGenerationRequested',
          payload: expect.objectContaining({
            eventKey: 'tour-generation:tour-1',
            tourId: 'tour-1',
            userId: 'user-1',
          }),
        }),
      );
    });

    it('does not enqueue generation for a non-canonical create', async () => {
      mockPrismaService.tour.create.mockResolvedValue({
        id: 'tour-legacy',
        ownerId: 'user-1',
        activities: [],
      });

      await service.create({
        ownerId: 'user-1',
        name: 'Legacy',
        categories: [],
        metadata: { generationStatus: 'pending' } as any,
        activities: [],
      } as any);

      expect(outboxService.createInTx).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when the tour does not exist', async () => {
      mockPrismaService.tour.findUnique.mockResolvedValue(null);

      await expect(service.findOne('tour-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when the tour belongs to someone else', async () => {
      mockPrismaService.tour.findUnique.mockResolvedValue({
        id: 'tour-1',
        ownerId: 'other-user',
      });

      await expect(service.findOne('tour-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns the tour when the caller owns it', async () => {
      const tour = { id: 'tour-1', ownerId: 'user-1' };
      mockPrismaService.tour.findUnique.mockResolvedValue(tour);

      await expect(service.findOne('tour-1', 'user-1')).resolves.toBe(tour);
    });

    it('skips the ownership check for trusted internal callers', async () => {
      const tour = { id: 'tour-1', ownerId: 'someone-else' };
      mockPrismaService.tour.findUnique.mockResolvedValue(tour);

      await expect(service.findOne('tour-1')).resolves.toBe(tour);
    });

    it("includes each TourActivity's waypoint snapshot", async () => {
      const tour = { id: 'tour-1', ownerId: 'user-1' };
      mockPrismaService.tour.findUnique.mockResolvedValue(tour);

      await service.findOne('tour-1', 'user-1');

      expect(mockPrismaService.tour.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            activities: expect.objectContaining({
              include: expect.objectContaining({
                activity: true,
                waypoints: {
                  include: { waypointActivity: true },
                  orderBy: { order: 'asc' },
                },
              }),
            }),
          }),
        }),
      );
    });
  });

  describe('findAll', () => {
    it('always scopes the query to the given ownerId', async () => {
      mockPrismaService.tour.count.mockResolvedValue(0);
      mockPrismaService.tour.findMany.mockResolvedValue([]);

      await service.findAll('user-1', 1, 10);

      expect(mockPrismaService.tour.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ ownerId: 'user-1' }),
        }),
      );
      expect(mockPrismaService.tour.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ ownerId: 'user-1' }),
        }),
      );
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the tour does not exist', async () => {
      mockPrismaService.tour.findUnique.mockResolvedValue(null);

      await expect(service.update('tour-1', {}, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when the tour belongs to someone else', async () => {
      mockPrismaService.tour.findUnique.mockResolvedValue({
        ownerId: 'other-user',
      });

      await expect(service.update('tour-1', {}, 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrismaService.tour.update).not.toHaveBeenCalled();
    });

    it('updates the tour when the caller owns it', async () => {
      mockPrismaService.tour.findUnique.mockResolvedValue({
        ownerId: 'user-1',
      });
      mockPrismaService.tourActivity.deleteMany.mockResolvedValue({});
      mockPrismaService.tour.update.mockResolvedValue({ id: 'tour-1' });

      await service.update('tour-1', { name: 'New name' }, 'user-1');

      expect(mockPrismaService.tour.update).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when the tour does not exist', async () => {
      mockPrismaService.tour.findUnique.mockResolvedValue(null);

      await expect(service.remove('tour-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when the tour belongs to someone else', async () => {
      mockPrismaService.tour.findUnique.mockResolvedValue({
        ownerId: 'other-user',
      });

      await expect(service.remove('tour-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrismaService.tour.delete).not.toHaveBeenCalled();
    });

    it('deletes the tour when the caller owns it', async () => {
      mockPrismaService.tour.findUnique.mockResolvedValue({
        ownerId: 'user-1',
      });
      mockPrismaService.tourActivity.deleteMany.mockResolvedValue({});
      mockPrismaService.tour.delete.mockResolvedValue({ id: 'tour-1' });

      await service.remove('tour-1', 'user-1');

      expect(mockPrismaService.tour.delete).toHaveBeenCalled();
    });
  });
});
