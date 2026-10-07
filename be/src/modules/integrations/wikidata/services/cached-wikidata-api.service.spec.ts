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
    realService = {
      getEntitySummaries: jest.fn(),
      lookupEntitySummaries: jest.fn(),
      findNearbyPlaces: jest.fn(),
      lookupPhysicalLocation: jest.fn(),
    };
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
    sitelinkCount: 0,
  });

  const successfulLookup = (summaries: Map<string, WikidataEntitySummary>) => ({
    summaries,
    status: 'success' as const,
    failedQids: new Set<string>(),
    extractFailedQids: new Set<string>(),
  });

  it('write mode calls the real service for a miss and persists each summary under its own QID file', async () => {
    realService.lookupEntitySummaries.mockResolvedValue(
      successfulLookup(
        new Map([
          ['Q1', summary('Q1')],
          ['Q2', summary('Q2')],
        ]),
      ),
    );
    const service = await setup('write');

    const result = await service.getEntitySummaries(['Q1', 'Q2']);

    expect(result.get('Q1')).toEqual(summary('Q1'));
    expect(result.get('Q2')).toEqual(summary('Q2'));
    expect(realService.lookupEntitySummaries).toHaveBeenCalledWith([
      'Q1',
      'Q2',
    ]);
    const cachedFiles = fs.readdirSync(path.join(tempDir, 'wikidata-cache'));
    expect(cachedFiles.sort()).toEqual(['Q1.json', 'Q2.json']);
  });

  it('read mode returns cached QIDs without calling the real service again', async () => {
    realService.lookupEntitySummaries.mockResolvedValue(
      successfulLookup(new Map([['Q1', summary('Q1')]])),
    );
    const writer = await setup('write');
    await writer.getEntitySummaries(['Q1']);

    realService.lookupEntitySummaries.mockClear();
    const reader = await setup('read');
    const result = await reader.getEntitySummaries(['Q1']);

    expect(result.get('Q1')).toEqual(summary('Q1'));
    expect(realService.lookupEntitySummaries).not.toHaveBeenCalled();
  });

  it('only fetches the QIDs that are actually missing from the cache, merging with what was already cached', async () => {
    // Q1 already cached from a previous run.
    realService.lookupEntitySummaries.mockResolvedValue(
      successfulLookup(new Map([['Q1', summary('Q1')]])),
    );
    const writer = await setup('write');
    await writer.getEntitySummaries(['Q1']);

    // Now request Q1 (cached) + Q2 (not cached) together.
    realService.lookupEntitySummaries.mockClear();
    realService.lookupEntitySummaries.mockResolvedValue(
      successfulLookup(new Map([['Q2', summary('Q2')]])),
    );
    const service = await setup('write');
    const result = await service.getEntitySummaries(['Q1', 'Q2']);

    // The real service is only asked for the missing one — this is the
    // whole point of caching per-QID instead of per-batch: changing the
    // candidate pool doesn't blow away the cache benefit for QIDs already
    // resolved.
    expect(realService.lookupEntitySummaries).toHaveBeenCalledWith(['Q2']);
    expect(result.get('Q1')).toEqual(summary('Q1'));
    expect(result.get('Q2')).toEqual(summary('Q2'));
  });

  it('strict mode throws on a cache miss instead of calling the real service', async () => {
    const service = await setup('strict');

    await expect(service.getEntitySummaries(['Q1'])).rejects.toThrow(
      /Strict mode/,
    );
    expect(realService.lookupEntitySummaries).not.toHaveBeenCalled();
  });

  it('read mode falls back to the real service on a miss without persisting', async () => {
    realService.lookupEntitySummaries.mockResolvedValue(
      successfulLookup(new Map([['Q1', summary('Q1')]])),
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
    realService.lookupEntitySummaries.mockResolvedValue(
      successfulLookup(new Map([['Q1', summary('Q1')]])),
    );
    const service = await setup('write');

    await service.getEntitySummaries(['Q1', 'Q1', 'Q1']);

    expect(realService.lookupEntitySummaries).toHaveBeenCalledWith(['Q1']);
  });

  it('does not cache a label-only summary when Wikipedia extracts failed', async () => {
    realService.lookupEntitySummaries.mockResolvedValue({
      summaries: new Map([['Q1', summary('Q1')]]),
      status: 'partial',
      failedQids: new Set(),
      extractFailedQids: new Set(['Q1']),
    });
    const service = await setup('write');

    const result = await service.lookupEntitySummaries(['Q1']);

    expect(result.status).toBe('partial');
    expect(result.extractFailedQids).toEqual(new Set(['Q1']));
    expect(fs.existsSync(path.join(tempDir, 'wikidata-cache', 'Q1.json'))).toBe(
      false,
    );
  });

  describe('sitelinkCount cache-staleness contract', () => {
    it('caches and round-trips a real, non-zero sitelinkCount on a fresh fetch', async () => {
      realService.lookupEntitySummaries.mockResolvedValue(
        successfulLookup(
          new Map([['Q1', { qid: 'Q1', label: 'X', sitelinkCount: 12 }]]),
        ),
      );
      const writer = await setup('write');
      await writer.getEntitySummaries(['Q1']);

      const persisted = JSON.parse(
        fs.readFileSync(
          path.join(tempDir, 'wikidata-cache', 'Q1.json'),
          'utf-8',
        ),
      );
      expect(persisted.sitelinkCount).toBe(12);

      realService.lookupEntitySummaries.mockClear();
      const reader = await setup('read');
      const result = await reader.getEntitySummaries(['Q1']);

      expect(result.get('Q1')?.sitelinkCount).toBe(12);
      expect(realService.lookupEntitySummaries).not.toHaveBeenCalled();
    });

    it('treats a cached sitelinkCount of 0 as a valid, real cache hit — never re-fetched as if missing', async () => {
      realService.lookupEntitySummaries.mockResolvedValue(
        successfulLookup(
          new Map([['Q1', { qid: 'Q1', label: 'X', sitelinkCount: 0 }]]),
        ),
      );
      const writer = await setup('write');
      await writer.getEntitySummaries(['Q1']);

      realService.lookupEntitySummaries.mockClear();
      const reader = await setup('read');
      const result = await reader.getEntitySummaries(['Q1']);

      expect(result.get('Q1')?.sitelinkCount).toBe(0);
      expect(realService.lookupEntitySummaries).not.toHaveBeenCalled();
    });

    it('treats a legacy cached entry with no sitelinkCount as stale and refetches it from the real service in normal (read) mode', async () => {
      // Simulate a cache file written before sitelinkCount existed.
      fs.mkdirSync(path.join(tempDir, 'wikidata-cache'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'wikidata-cache', 'Q1.json'),
        JSON.stringify({ qid: 'Q1', label: 'Legacy label' }),
      );
      realService.lookupEntitySummaries.mockResolvedValue(
        successfulLookup(
          new Map([
            ['Q1', { qid: 'Q1', label: 'Legacy label', sitelinkCount: 7 }],
          ]),
        ),
      );

      const reader = await setup('read');
      const result = await reader.getEntitySummaries(['Q1']);

      expect(realService.lookupEntitySummaries).toHaveBeenCalledWith(['Q1']);
      expect(result.get('Q1')?.sitelinkCount).toBe(7);
    });

    it('never invents/backfills a synthetic sitelinkCount onto stale cache data — the refreshed value always comes from the real service', async () => {
      fs.mkdirSync(path.join(tempDir, 'wikidata-cache'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'wikidata-cache', 'Q1.json'),
        JSON.stringify({ qid: 'Q1', label: 'Legacy label' }),
      );
      realService.lookupEntitySummaries.mockResolvedValue(
        successfulLookup(new Map()), // real service found nothing for Q1 this time
      );

      const reader = await setup('read');
      const result = await reader.getEntitySummaries(['Q1']);

      expect(realService.lookupEntitySummaries).toHaveBeenCalledWith(['Q1']);
      expect(result.has('Q1')).toBe(false);
    });

    it('a stale legacy entry in strict mode surfaces as the normal strict-mode cache-miss error, not a silent hit', async () => {
      fs.mkdirSync(path.join(tempDir, 'wikidata-cache'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'wikidata-cache', 'Q1.json'),
        JSON.stringify({ qid: 'Q1', label: 'Legacy label' }),
      );
      const service = await setup('strict');

      await expect(service.getEntitySummaries(['Q1'])).rejects.toThrow(
        /Strict mode/,
      );
      expect(realService.lookupEntitySummaries).not.toHaveBeenCalled();
    });
  });

  describe('findNearbyPlaces (Task A2 — deliberately uncached passthrough)', () => {
    it('always delegates directly to the real service, even in write mode', async () => {
      realService.findNearbyPlaces.mockResolvedValue([
        {
          qid: 'Q1808336',
          label: 'Museum of Latin American Art of Buenos Aires',
          latitude: -34.577111,
          longitude: -58.403593,
        },
      ]);
      const service = await setup('write');

      const results = await service.findNearbyPlaces(
        -34.5768817,
        -58.4033919,
        200,
      );

      expect(realService.findNearbyPlaces).toHaveBeenCalledWith(
        -34.5768817,
        -58.4033919,
        200,
      );
      expect(results).toEqual([
        {
          qid: 'Q1808336',
          label: 'Museum of Latin American Art of Buenos Aires',
          latitude: -34.577111,
          longitude: -58.403593,
        },
      ]);
    });
  });
});
