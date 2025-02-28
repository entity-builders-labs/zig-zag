import { Test, TestingModule } from '@nestjs/testing';
import { ActivitiesService } from './activities.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateActivityDto } from './dto/create-activity.dto';
import { NotFoundException } from '@nestjs/common';

describe('ActivitiesService', () => {
  let service: ActivitiesService;
  let prisma: PrismaService;

  const mockPrismaService = {
    activity: {
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    source: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(mockPrismaService)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivitiesService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<ActivitiesService>(ActivitiesService);
    prisma = module.get<PrismaService>(PrismaService);

    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createMany', () => {
    it('should handle duplicate activities gracefully', async () => {
      // Setup - Create test data
      const sourceId = 'test-source-id';
      const externalId = 'test-external-id';
      
      const activityDto: CreateActivityDto = {
        name: 'Test Activity',
        description: 'Test Description',
        latitude: 40.712776,
        longitude: -74.005974,
        sourceId,
        externalId,
        // Add any other required fields here
      };
      
      // First, simulate that no activities exist in the database
      mockPrismaService.activity.findMany.mockResolvedValueOnce([]);
      
      // Mock successful creation for the first batch
      mockPrismaService.$transaction.mockImplementationOnce(async (callback) => {
        return await callback(mockPrismaService);
      });
      
      // Execute - First creation should succeed
      const firstResult = await service.createMany([activityDto]);
      
      // Simulate that the activity now exists in the database for the second call
      mockPrismaService.activity.findMany.mockResolvedValueOnce([
        {
          id: 'some-id',
          sourceId,
          externalId,
          name: 'Test Activity',
          // Add other fields as needed
        },
      ]);
      
      // Execute - Second creation with the same activity
      const secondResult = await service.createMany([activityDto]);
      
      // Assertions
      
      // Verify the findMany was called twice with sourceId and externalId filter
      expect(mockPrismaService.activity.findMany).toHaveBeenCalledTimes(2);
      expect(mockPrismaService.activity.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { 
              AND: [
                { sourceId: sourceId },
                { externalId: externalId }
              ] 
            }
          ]
        },
        select: {
          sourceId: true,
          externalId: true,
        },
      });
      
      // Verify the transaction was used
      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(2);
      
      // The second call should have filtered out the duplicate activity
      // (actual implementation might vary, but duplicates should be handled)
      expect(secondResult.created).toBeLessThanOrEqual(firstResult.created);
      expect(secondResult.duplicates).toBeGreaterThanOrEqual(1);
    });

    it('should handle duplicate activities during database constraint violation', async () => {
      // Setup - Create test data
      const sourceId = 'test-source-id';
      const externalId = 'test-external-id';
      
      const activityDto: CreateActivityDto = {
        name: 'Test Activity',
        description: 'Test Description',
        latitude: 40.712776,
        longitude: -74.005974,
        sourceId,
        externalId,
        // Add any other required fields here
      };
      
      // Simulate that no activities exist in the database (so our check doesn't catch it)
      mockPrismaService.activity.findMany.mockResolvedValueOnce([]);
      
      // Mock a unique constraint violation during transaction
      mockPrismaService.$transaction.mockImplementationOnce(async () => {
        const error = new Error('Unique constraint violation');
        error.name = 'PrismaClientKnownRequestError';
        error.code = 'P2002';
        error.meta = { target: ['sourceId', 'externalId'] };
        throw error;
      });
      
      // Execute - The service should handle the constraint violation gracefully
      const result = await service.createMany([activityDto]);
      
      // Assertions
      expect(result.created).toBe(0);
      expect(result.duplicates).toBe(1);
      expect(result.errors).toBe(0);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { ActivitiesService } from './activities.service';

describe('ActivitiesService', () => {
  let service: ActivitiesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ActivitiesService],
    }).compile();

    service = module.get<ActivitiesService>(ActivitiesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
