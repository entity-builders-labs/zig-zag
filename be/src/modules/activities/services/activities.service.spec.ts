import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateActivityDto } from '../dto/create-activity.dto';
import { ActivitiesService } from './activities.service';
import { ActivityMetadataService } from './activity-metadata.service';
import { VectorStoreService } from '../../../shared/ai/services/vector-store.service';

describe('ActivitiesService', () => {
  let service: ActivitiesService;

  const mockPrismaService = {
    activity: {
      findMany: jest.fn(),
      create: jest.fn().mockImplementation(async ({ data }: { data: any }) => ({
        id: 'generated-id',
        ...data,
      })),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirstOrThrow: jest.fn(),
      createMany: jest.fn(),
      createManyAndReturn: jest.fn(),
      updateMany: jest.fn(),
      updateManyAndReturn: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
      fields: {} as any,
    },
    source: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      createManyAndReturn: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      updateManyAndReturn: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
      count: jest.fn(),
      fields: {} as any,
    },
    $transaction: jest.fn(async (callback: (prisma: any) => Promise<any>) => {
      return await callback(mockPrismaService);
    }),
  } as unknown as PrismaService;

  const mockVectorStoreService = {
    findSimilarActivities: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivitiesService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: ActivityMetadataService,
          useValue: {
            generateMetadata: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: VectorStoreService,
          useValue: mockVectorStoreService,
        },
      ],
    }).compile();

    service = module.get<ActivitiesService>(ActivitiesService);

    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createMany', () => {
    const activityDto: CreateActivityDto = {
      name: 'Test Activity',
      description: 'Test Description',
      latitude: 40.712776,
      longitude: -74.005974,
      sourceId: 'test-source-id',
      externalId: 'test-external-id',
    };

    it('should create an activity successfully', async () => {
      const result = await service.createMany([activityDto]);

      expect(mockPrismaService.activity.create).toHaveBeenCalledTimes(1);
      expect(result.created).toBe(1);
      expect(result.duplicates).toBe(0);
      expect(result.errors).toBe(0);
    });

    it('should count a unique constraint violation (P2002) as a duplicate, not an error', async () => {
      (mockPrismaService.activity.create as jest.Mock).mockRejectedValueOnce({
        code: 'P2002',
        meta: { target: ['sourceId', 'externalId'] },
      });

      const result = await service.createMany([activityDto]);

      expect(result.created).toBe(0);
      expect(result.duplicates).toBe(1);
      expect(result.errors).toBe(0);
    });
  });

  describe('findSimilar', () => {
    it('excludes the source activity and preserves vector-search order', async () => {
      const target = {
        id: 'a1',
        name: 'Museum',
        description: 'Art museum',
        metadata: {},
      };
      (mockPrismaService.activity.findUnique as jest.Mock).mockResolvedValue(
        target,
      );
      mockVectorStoreService.findSimilarActivities.mockResolvedValue([
        { pageContent: '...', metadata: { activityId: 'a2' } },
        { pageContent: '...', metadata: { activityId: 'a1' } }, // self - excluded
        { pageContent: '...', metadata: { activityId: 'a3' } },
      ]);
      (mockPrismaService.activity.findMany as jest.Mock).mockResolvedValue([
        { id: 'a3', name: 'Park' },
        { id: 'a2', name: 'Gallery' },
      ]);

      const result = await service.findSimilar('a1', 2);

      expect(mockVectorStoreService.findSimilarActivities).toHaveBeenCalledWith(
        expect.stringContaining('Museum'),
        3,
      );
      expect(result.map((a) => a.id)).toEqual(['a2', 'a3']);
    });

    it('returns an empty array when no similarity results are found', async () => {
      (mockPrismaService.activity.findUnique as jest.Mock).mockResolvedValue({
        id: 'a1',
        name: 'Museum',
        description: null,
        metadata: {},
      });
      mockVectorStoreService.findSimilarActivities.mockResolvedValue([]);

      const result = await service.findSimilar('a1', 5);

      expect(result).toEqual([]);
      expect(mockPrismaService.activity.findMany).not.toHaveBeenCalled();
    });
  });
});
