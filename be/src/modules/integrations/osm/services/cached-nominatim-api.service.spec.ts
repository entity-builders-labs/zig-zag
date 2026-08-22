import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CachedNominatimApiService } from './cached-nominatim-api.service';
import { INominatimApiService } from '../interfaces/nominatim.interface';

describe('CachedNominatimApiService', () => {
  let tempDir: string;
  let realService: jest.Mocked<INominatimApiService>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nominatim-cache-test-'));
    realService = {
      search: jest.fn(),
      reverse: jest.fn(),
    };
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const setup = async (mode: 'read' | 'write' | 'strict') => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CachedNominatimApiService,
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
        { provide: 'RealNominatimApiService', useValue: realService },
      ],
    }).compile();
    return module.get(CachedNominatimApiService);
  };

  it('write mode calls the real service on a miss and persists the result', async () => {
    realService.search.mockResolvedValue([
      {
        osmType: 'relation',
        osmId: 1,
        addresstype: 'city',
        displayName: 'Test City',
        importance: 0.9,
      },
    ]);
    const service = await setup('write');

    const result = await service.search('Test City');

    expect(result).toEqual([
      {
        osmType: 'relation',
        osmId: 1,
        addresstype: 'city',
        displayName: 'Test City',
        importance: 0.9,
      },
    ]);
    expect(realService.search).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(path.join(tempDir, 'nominatim-cache'))).toHaveLength(
      1,
    );
  });

  it('read mode returns a cached response without calling the real service again', async () => {
    realService.search.mockResolvedValue([
      {
        osmType: 'relation',
        osmId: 1,
        addresstype: 'city',
        displayName: 'Test City',
        importance: 0.9,
      },
    ]);
    const writer = await setup('write');
    await writer.search('Test City');

    realService.search.mockClear();
    const reader = await setup('read');
    const result = await reader.search('Test City');

    expect(result).toEqual([
      {
        osmType: 'relation',
        osmId: 1,
        addresstype: 'city',
        displayName: 'Test City',
        importance: 0.9,
      },
    ]);
    expect(realService.search).not.toHaveBeenCalled();
  });

  it('read mode falls back to the real service on a cache miss (without persisting)', async () => {
    realService.search.mockResolvedValue([
      {
        osmType: 'relation',
        osmId: 2,
        addresstype: 'city',
        displayName: 'Another City',
        importance: 0.8,
      },
    ]);
    const service = await setup('read');

    const result = await service.search('Another City');

    expect(result).toEqual([
      {
        osmType: 'relation',
        osmId: 2,
        addresstype: 'city',
        displayName: 'Another City',
        importance: 0.8,
      },
    ]);
    expect(realService.search).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(path.join(tempDir, 'nominatim-cache'))).toHaveLength(
      0,
    );
  });

  it('strict mode throws on a cache miss instead of calling the real service', async () => {
    const service = await setup('strict');

    await expect(service.search('Unknown City')).rejects.toThrow(/Strict mode/);
    expect(realService.search).not.toHaveBeenCalled();
  });

  it('write mode caches reverse lookups separately from forward searches', async () => {
    realService.reverse.mockResolvedValue({
      osmType: 'relation',
      osmId: 2929054,
      addresstype: 'city',
      displayName: 'Montevideo, Uruguay',
      importance: 0.7,
    });
    const writer = await setup('write');

    await writer.reverse(-34.9059, -56.1913);
    realService.reverse.mockClear();

    const reader = await setup('read');
    const result = await reader.reverse(-34.9059, -56.1913);

    expect(result).toMatchObject({ osmId: 2929054 });
    expect(realService.reverse).not.toHaveBeenCalled();
  });

  it('strict mode does not call the real reverse service on a cache miss', async () => {
    const service = await setup('strict');

    await expect(service.reverse(-34.9, -56.2)).rejects.toThrow(/Strict mode/);
    expect(realService.reverse).not.toHaveBeenCalled();
  });
});
