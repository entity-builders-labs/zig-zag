import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CachedOverpassApiService } from './cached-overpass-api.service';
import { IOverpassApiService } from '../interfaces/overpass.interface';

describe('CachedOverpassApiService', () => {
  let tempDir: string;
  let realService: jest.Mocked<IOverpassApiService>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-cache-test-'));
    realService = {
      queryBoundaryByName: jest.fn(),
      queryContainingBoundary: jest.fn(),
      queryStreets: jest.fn(),
      queryBoundaryById: jest.fn(),
      queryAdminBoundariesWithinArea: jest.fn(),
      queryStreetsWithinArea: jest.fn(),
      queryPoisWithinArea: jest.fn(),
      queryPois: jest.fn(),
      queryFeaturesNear: jest.fn(),
    };
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const setup = async (mode: 'read' | 'write' | 'strict') => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CachedOverpassApiService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'STORAGE_PATH'
                ? tempDir
                : key === 'MOCK_MAPS_MODE'
                  ? mode
                  : undefined,
            ),
          },
        },
        { provide: 'RealOverpassApiService', useValue: realService },
      ],
    }).compile();
    return module.get(CachedOverpassApiService);
  };

  it('write mode calls the real service on a miss and persists the result', async () => {
    realService.queryStreets.mockResolvedValue([{ type: 'way', id: 1 }] as any);
    const service = await setup('write');

    const result = await service.queryStreets({
      latitude: 0,
      longitude: 0,
      radiusMeters: 1000,
    });

    expect(result).toEqual([{ type: 'way', id: 1 }]);
    expect(realService.queryStreets).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(path.join(tempDir, 'osm-cache'))).toHaveLength(1);
  });

  it('read mode returns a cached response without calling the real service again', async () => {
    realService.queryStreets.mockResolvedValue([{ type: 'way', id: 1 }] as any);
    const writer = await setup('write');
    await writer.queryStreets({
      latitude: 0,
      longitude: 0,
      radiusMeters: 1000,
    });

    realService.queryStreets.mockClear();
    const reader = await setup('read');
    const result = await reader.queryStreets({
      latitude: 0,
      longitude: 0,
      radiusMeters: 1000,
    });

    expect(result).toEqual([{ type: 'way', id: 1 }]);
    expect(realService.queryStreets).not.toHaveBeenCalled();
  });

  it('read mode falls back to the real service on a cache miss (without persisting)', async () => {
    realService.queryStreets.mockResolvedValue([{ type: 'way', id: 2 }] as any);
    const service = await setup('read');

    const result = await service.queryStreets({
      latitude: 1,
      longitude: 1,
      radiusMeters: 1000,
    });

    expect(result).toEqual([{ type: 'way', id: 2 }]);
    expect(realService.queryStreets).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(path.join(tempDir, 'osm-cache'))).toHaveLength(0);
  });

  it('strict mode throws on a cache miss instead of calling the real service', async () => {
    const service = await setup('strict');

    await expect(
      service.queryStreets({ latitude: 0, longitude: 0, radiusMeters: 1000 }),
    ).rejects.toThrow(/Strict mode/);
    expect(realService.queryStreets).not.toHaveBeenCalled();
  });

  it('caches queryBoundaryByName and queryContainingBoundary independently by method+params', async () => {
    realService.queryBoundaryByName.mockResolvedValue([
      { type: 'relation', id: 9 },
    ] as any);
    realService.queryContainingBoundary.mockResolvedValue([
      { type: 'relation', id: 9 },
    ] as any);
    const service = await setup('write');

    await service.queryBoundaryByName({
      name: 'San Telmo',
      latitude: 0,
      longitude: 0,
      radiusMeters: 1000,
    });
    await service.queryContainingBoundary({ latitude: 0, longitude: 0 });

    // Same underlying data, different method+params -> two distinct cache entries.
    expect(fs.readdirSync(path.join(tempDir, 'osm-cache'))).toHaveLength(2);
  });

  it('delegates queryBoundaryById to the real service and caches by params', async () => {
    realService.queryBoundaryById.mockResolvedValue([]);
    const service = await setup('write');

    await service.queryBoundaryById({ osmType: 'relation', osmId: 1224652 });
    await service.queryBoundaryById({ osmType: 'relation', osmId: 1224652 });

    expect(realService.queryBoundaryById).toHaveBeenCalledTimes(1);
  });

  it('delegates queryAdminBoundariesWithinArea to the real service and caches by params', async () => {
    realService.queryAdminBoundariesWithinArea.mockResolvedValue([]);
    const service = await setup('write');

    await service.queryAdminBoundariesWithinArea({
      osmType: 'relation',
      osmId: 1224652,
      childAdminLevel: 9,
    });
    await service.queryAdminBoundariesWithinArea({
      osmType: 'relation',
      osmId: 1224652,
      childAdminLevel: 9,
    });

    expect(realService.queryAdminBoundariesWithinArea).toHaveBeenCalledTimes(1);
  });

  it('delegates queryStreetsWithinArea to the real service and caches by params', async () => {
    realService.queryStreetsWithinArea.mockResolvedValue([]);
    const service = await setup('write');

    await service.queryStreetsWithinArea({
      osmType: 'relation',
      osmId: 2223069,
    });
    await service.queryStreetsWithinArea({
      osmType: 'relation',
      osmId: 2223069,
    });

    expect(realService.queryStreetsWithinArea).toHaveBeenCalledTimes(1);
  });

  it('delegates queryPoisWithinArea to the real service and caches by params', async () => {
    realService.queryPoisWithinArea.mockResolvedValue([]);
    const service = await setup('write');

    await service.queryPoisWithinArea({ osmType: 'relation', osmId: 2223069 });
    await service.queryPoisWithinArea({ osmType: 'relation', osmId: 2223069 });

    expect(realService.queryPoisWithinArea).toHaveBeenCalledTimes(1);
  });

  it('delegates queryFeaturesNear to the real service and caches by method+params', async () => {
    realService.queryFeaturesNear.mockResolvedValue([
      { type: 'node', id: 5 },
    ] as any);
    const service = await setup('write');

    const params = {
      latitude: -34.6,
      longitude: -58.38,
      radiusMeters: 3000,
      selectors: [{ key: 'tourism', value: 'museum' }],
    };
    const first = await service.queryFeaturesNear(params);
    const second = await service.queryFeaturesNear(params);

    expect(first).toEqual([{ type: 'node', id: 5 }]);
    expect(second).toEqual([{ type: 'node', id: 5 }]);
    expect(realService.queryFeaturesNear).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(path.join(tempDir, 'osm-cache'))).toHaveLength(1);
  });

  it('strict mode throws on a queryFeaturesNear cache miss', async () => {
    const service = await setup('strict');

    await expect(
      service.queryFeaturesNear({
        latitude: 0,
        longitude: 0,
        radiusMeters: 1000,
        selectors: [{ key: 'leisure', value: 'park' }],
      }),
    ).rejects.toThrow(/Strict mode/);
    expect(realService.queryFeaturesNear).not.toHaveBeenCalled();
  });
});
