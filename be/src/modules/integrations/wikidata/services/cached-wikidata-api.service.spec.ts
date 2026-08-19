import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CachedWikidataApiService } from './cached-wikidata-api.service';
import {
  IWikidataApiService,
  WikidataEntitySummary,
} from '../interfaces/wikidata.interface';

describe('CachedWikidataApiService', () => {
  let tempDir: string;
  let realService: jest.Mocked<IWikidataApiService>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wikidata-cache-test-'));
    realService = { getEntitySummaries: jest.fn() };
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const setup = async (mode: 'read' | 'write' | 'strict') => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CachedWikidataApiService,
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
        { provide: 'RealWikidataApiService', useValue: realService },
      ],
    }).compile();
    return module.get(CachedWikidataApiService);
  };

  const summary = (qid: string): WikidataEntitySummary => ({
    qid,
    label: `Label for ${qid}`,
  });

  it('write mode calls the real service for a miss and persists each summary under its own QID file', async () => {
    realService.getEntitySummaries.mockResolvedValue(
      new Map([
        ['Q1', summary('Q1')],
        ['Q2', summary('Q2')],
      ]),
    );
    const service = await setup('write');

    const result = await service.getEntitySummaries(['Q1', 'Q2']);

    expect(result.get('Q1')).toEqual(summary('Q1'));
    expect(result.get('Q2')).toEqual(summary('Q2'));
    expect(realService.getEntitySummaries).toHaveBeenCalledWith(['Q1', 'Q2']);
    const cachedFiles = fs.readdirSync(path.join(tempDir, 'wikidata-cache'));
    expect(cachedFiles.sort()).toEqual(['Q1.json', 'Q2.json']);
  });

  it('read mode returns cached QIDs without calling the real service again', async () => {
    realService.getEntitySummaries.mockResolvedValue(
      new Map([['Q1', summary('Q1')]]),
    );
    const writer = await setup('write');
    await writer.getEntitySummaries(['Q1']);

    realService.getEntitySummaries.mockClear();
    const reader = await setup('read');
    const result = await reader.getEntitySummaries(['Q1']);

    expect(result.get('Q1')).toEqual(summary('Q1'));
    expect(realService.getEntitySummaries).not.toHaveBeenCalled();
  });

  it('only fetches the QIDs that are actually missing from the cache, merging with what was already cached', async () => {
    // Q1 already cached from a previous run.
    realService.getEntitySummaries.mockResolvedValue(
      new Map([['Q1', summary('Q1')]]),
    );
    const writer = await setup('write');
    await writer.getEntitySummaries(['Q1']);

    // Now request Q1 (cached) + Q2 (not cached) together.
    realService.getEntitySummaries.mockClear();
    realService.getEntitySummaries.mockResolvedValue(
      new Map([['Q2', summary('Q2')]]),
    );
    const service = await setup('write');
    const result = await service.getEntitySummaries(['Q1', 'Q2']);

    // The real service is only asked for the missing one — this is the
    // whole point of caching per-QID instead of per-batch: changing the
    // candidate pool doesn't blow away the cache benefit for QIDs already
    // resolved.
    expect(realService.getEntitySummaries).toHaveBeenCalledWith(['Q2']);
    expect(result.get('Q1')).toEqual(summary('Q1'));
    expect(result.get('Q2')).toEqual(summary('Q2'));
  });

  it('strict mode throws on a cache miss instead of calling the real service', async () => {
    const service = await setup('strict');

    await expect(service.getEntitySummaries(['Q1'])).rejects.toThrow(
      /Strict mode/,
    );
    expect(realService.getEntitySummaries).not.toHaveBeenCalled();
  });

  it('read mode falls back to the real service on a miss without persisting', async () => {
    realService.getEntitySummaries.mockResolvedValue(
      new Map([['Q1', summary('Q1')]]),
    );
    const service = await setup('read');

    const result = await service.getEntitySummaries(['Q1']);

    expect(result.get('Q1')).toEqual(summary('Q1'));
    // The cache dir itself is created eagerly regardless of mode, but the
    // per-QID file must not be written in read mode.
    expect(fs.existsSync(path.join(tempDir, 'wikidata-cache'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'wikidata-cache', 'Q1.json'))).toBe(
      false,
    );
  });

  it('deduplicates repeated QIDs in the request', async () => {
    realService.getEntitySummaries.mockResolvedValue(
      new Map([['Q1', summary('Q1')]]),
    );
    const service = await setup('write');

    await service.getEntitySummaries(['Q1', 'Q1', 'Q1']);

    expect(realService.getEntitySummaries).toHaveBeenCalledWith(['Q1']);
  });
});
