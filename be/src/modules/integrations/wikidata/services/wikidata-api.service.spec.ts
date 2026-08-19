import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { WikidataApiService } from './wikidata-api.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('WikidataApiService', () => {
  let service: WikidataApiService;

  const setup = async (): Promise<WikidataApiService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WikidataApiService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn((): string | undefined => undefined) },
        },
      ],
    }).compile();
    return module.get(WikidataApiService);
  };

  const mockWbGetEntities = (entities: Record<string, any>) => ({
    data: { entities },
  });
  const mockExtracts = (pages: Record<string, any>) => ({
    data: { query: { pages } },
  });

  beforeEach(() => {
    // resetAllMocks (not clearAllMocks) — some tests here don't consume every
    // queued mockResolvedValueOnce/mockRejectedValueOnce (e.g. when
    // resolveExtracts is never reached), and clearAllMocks leaves those
    // unconsumed values queued to leak into the next test's calls.
    jest.resetAllMocks();
  });

  it('resolves a batch of QIDs with exactly 2 HTTP calls, regardless of how many QIDs are requested (up to 50)', async () => {
    mockedAxios.get
      .mockResolvedValueOnce(
        mockWbGetEntities({
          Q1: {
            id: 'Q1',
            labels: { en: { value: 'San Telmo' } },
            descriptions: { en: { value: 'neighborhood in Buenos Aires' } },
            sitelinks: { enwiki: { title: 'San Telmo, Buenos Aires' } },
          },
          Q2: {
            id: 'Q2',
            labels: { en: { value: 'Plaza Dorrego' } },
          },
          Q3: {
            id: 'Q3',
            labels: { en: { value: 'Caminito' } },
            sitelinks: { enwiki: { title: 'Caminito' } },
          },
        }),
      )
      .mockResolvedValueOnce(
        mockExtracts({
          '1': {
            title: 'San Telmo, Buenos Aires',
            extract: 'San Telmo is a barrio...',
          },
          '2': { title: 'Caminito', extract: 'Caminito is a street museum...' },
        }),
      );

    service = await setup();
    const result = await service.getEntitySummaries(['Q1', 'Q2', 'Q3']);

    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    expect(result.get('Q1')?.extract).toBe('San Telmo is a barrio...');
    expect(result.get('Q3')?.extract).toBe('Caminito is a street museum...');

    // Wikimedia's API policy flatly 403s a generic/bot-looking client (not a
    // throttle) — both calls (wbgetentities and the Wikipedia extracts
    // batch) must self-identify.
    const [, wbGetEntitiesConfig] = mockedAxios.get.mock.calls[0];
    const [, extractsConfig] = mockedAxios.get.mock.calls[1];
    expect(wbGetEntitiesConfig?.headers?.['User-Agent']).toBeTruthy();
    expect(extractsConfig?.headers?.['User-Agent']).toBeTruthy();
  });

  it('returns only label/description for a QID with no enwiki sitelink', async () => {
    mockedAxios.get
      .mockResolvedValueOnce(
        mockWbGetEntities({
          Q2: { id: 'Q2', labels: { en: { value: 'Plaza Dorrego' } } },
        }),
      )
      .mockResolvedValueOnce(mockExtracts({}));

    service = await setup();
    const result = await service.getEntitySummaries(['Q2']);

    const summary = result.get('Q2');
    expect(summary?.label).toBe('Plaza Dorrego');
    expect(summary?.extract).toBeUndefined();
    // No sitelink for Q2 means there's nothing to look up extracts for —
    // the extracts call should never even fire.
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('omits a nonexistent QID from the result instead of throwing', async () => {
    mockedAxios.get.mockResolvedValueOnce(
      mockWbGetEntities({
        Q999999: { id: 'Q999999', missing: '' },
      }),
    );

    service = await setup();
    const result = await service.getEntitySummaries(['Q999999']);

    expect(result.has('Q999999')).toBe(false);
  });

  it('returns an empty Map (not a throw) when the wbgetentities request fails', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('wikidata down'));

    service = await setup();
    const result = await service.getEntitySummaries(['Q1']);

    expect(result.size).toBe(0);
  });

  it('keeps label/description even if the extracts request fails', async () => {
    mockedAxios.get
      .mockResolvedValueOnce(
        mockWbGetEntities({
          Q1: {
            id: 'Q1',
            labels: { en: { value: 'San Telmo' } },
            sitelinks: { enwiki: { title: 'San Telmo' } },
          },
        }),
      )
      .mockRejectedValueOnce(new Error('wikipedia down'));

    service = await setup();
    const result = await service.getEntitySummaries(['Q1']);

    expect(result.get('Q1')?.label).toBe('San Telmo');
    expect(result.get('Q1')?.extract).toBeUndefined();
  });

  it('deduplicates repeated QIDs before calling the API', async () => {
    mockedAxios.get
      .mockResolvedValueOnce(
        mockWbGetEntities({ Q1: { id: 'Q1', labels: { en: { value: 'X' } } } }),
      )
      .mockResolvedValueOnce(mockExtracts({}));

    service = await setup();
    await service.getEntitySummaries(['Q1', 'Q1', 'Q1']);

    const [, params] = mockedAxios.get.mock.calls[0];
    expect((params as any).params.ids).toBe('Q1');
  });

  it('chunks more than 50 QIDs into separate batches of at most 50', async () => {
    mockedAxios.get.mockResolvedValue(mockWbGetEntities({}));

    service = await setup();
    const manyQids = Array.from({ length: 51 }, (_, i) => `Q${i}`);
    await service.getEntitySummaries(manyQids);

    // 51 QIDs -> 2 chunks (50 + 1) -> 2 wbgetentities calls. Neither chunk
    // resolves any sitelinks here, so no extracts calls fire — 2 total.
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    const firstBatchIds = (
      mockedAxios.get.mock.calls[0][1] as any
    ).params.ids.split('|');
    const secondBatchIds = (
      mockedAxios.get.mock.calls[1][1] as any
    ).params.ids.split('|');
    expect(firstBatchIds).toHaveLength(50);
    expect(secondBatchIds).toHaveLength(1);
  });
});
