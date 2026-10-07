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

  it('collects the Spanish primary label and en/es aliases into `aliases` (cross-source confirmation via OSM wikidata tag)', async () => {
    mockedAxios.get
      .mockResolvedValueOnce(
        mockWbGetEntities({
          Q1808336: {
            id: 'Q1808336',
            labels: {
              en: { value: 'Museum of Latin American Art of Buenos Aires' },
              es: { value: 'Museo de Arte Latinoamericano de Buenos Aires' },
            },
            aliases: {
              en: [{ value: 'MALBA' }],
              es: [{ value: 'MALBA' }],
            },
          },
        }),
      )
      .mockResolvedValueOnce(mockExtracts({}));

    service = await setup();
    const result = await service.getEntitySummaries(['Q1808336']);

    const summary = result.get('Q1808336');
    expect(summary?.label).toBe('Museum of Latin American Art of Buenos Aires');
    expect(summary?.aliases).toEqual(
      expect.arrayContaining([
        'Museo de Arte Latinoamericano de Buenos Aires',
        'MALBA',
      ]),
    );
    // "MALBA" appears in both language buckets — deduplicated, not doubled.
    expect(summary?.aliases?.filter((name) => name === 'MALBA')).toHaveLength(
      1,
    );
  });

  it('requests aliases and the es label alongside en, in one wbgetentities call', async () => {
    mockedAxios.get
      .mockResolvedValueOnce(mockWbGetEntities({}))
      .mockResolvedValueOnce(mockExtracts({}));

    service = await setup();
    await service.getEntitySummaries(['Q1']);

    const [, requestConfig] = mockedAxios.get.mock.calls[0];
    expect(requestConfig?.params?.props).toContain('aliases');
    expect(requestConfig?.params?.languages).toBe('en|es');
  });

  it('is undefined when Wikidata has no Spanish label or any alias for the entity', async () => {
    mockedAxios.get
      .mockResolvedValueOnce(
        mockWbGetEntities({
          Q2: { id: 'Q2', labels: { en: { value: 'Plaza Dorrego' } } },
        }),
      )
      .mockResolvedValueOnce(mockExtracts({}));

    service = await setup();
    const result = await service.getEntitySummaries(['Q2']);

    expect(result.get('Q2')?.aliases).toBeUndefined();
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

  it('reports a failed lookup when the wbgetentities request fails', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('wikidata down'));

    service = await setup();
    const result = await service.lookupEntitySummaries(['Q1']);

    expect(result.status).toBe('failed');
    expect(result.summaries.size).toBe(0);
    expect(result.failedQids).toEqual(new Set(['Q1']));
  });

  it('keeps label/description and reports partial degradation when the extracts request fails', async () => {
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
    const result = await service.lookupEntitySummaries(['Q1']);

    expect(result.status).toBe('partial');
    expect(result.summaries.get('Q1')?.label).toBe('San Telmo');
    expect(result.summaries.get('Q1')?.extract).toBeUndefined();
    expect(result.extractFailedQids).toEqual(new Set(['Q1']));
  });

  it('reports only the failed chunk when a multi-batch lookup partially fails', async () => {
    mockedAxios.get
      .mockResolvedValueOnce(mockWbGetEntities({}))
      .mockRejectedValueOnce(new Error('second batch down'));

    service = await setup();
    const manyQids = Array.from({ length: 51 }, (_, i) => `Q${i}`);
    const result = await service.lookupEntitySummaries(manyQids);

    expect(result.status).toBe('partial');
    expect(result.failedQids).toEqual(new Set(['Q50']));
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

  describe('sitelinkCount (component-quality notability signal)', () => {
    it('counts every sitelink Wikidata returns, not just enwiki', async () => {
      mockedAxios.get
        .mockResolvedValueOnce(
          mockWbGetEntities({
            Q1: {
              id: 'Q1',
              labels: { en: { value: 'Plaza Dorrego' } },
              sitelinks: {
                enwiki: { title: 'Plaza Dorrego' },
                eswiki: { title: 'Plaza Dorrego' },
                frwiki: { title: 'Plaza Dorrego' },
                commonswiki: { title: 'Category:Plaza Dorrego' },
              },
            },
          }),
        )
        .mockResolvedValueOnce(mockExtracts({}));

      service = await setup();
      const result = await service.getEntitySummaries(['Q1']);

      expect(result.get('Q1')?.sitelinkCount).toBe(4);
    });

    it('the enwiki extract flow still works once the request is no longer filtered to enwiki-only sitelinks', async () => {
      mockedAxios.get
        .mockResolvedValueOnce(
          mockWbGetEntities({
            Q1: {
              id: 'Q1',
              labels: { en: { value: 'Plaza Dorrego' } },
              sitelinks: {
                enwiki: { title: 'Plaza Dorrego' },
                eswiki: { title: 'Plaza Dorrego' },
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          mockExtracts({
            '1': { title: 'Plaza Dorrego', extract: 'Plaza Dorrego is...' },
          }),
        );

      service = await setup();
      const result = await service.getEntitySummaries(['Q1']);

      expect(result.get('Q1')?.extract).toBe('Plaza Dorrego is...');
      expect(result.get('Q1')?.sitelinkCount).toBe(2);
    });

    it('reports sitelinkCount 0, not undefined, for a resolved entity with no sitelinks', async () => {
      mockedAxios.get
        .mockResolvedValueOnce(
          mockWbGetEntities({
            Q2: { id: 'Q2', labels: { en: { value: 'Plaza Dorrego' } } },
          }),
        )
        .mockResolvedValueOnce(mockExtracts({}));

      service = await setup();
      const result = await service.getEntitySummaries(['Q2']);

      expect(result.get('Q2')?.sitelinkCount).toBe(0);
      expect(result.get('Q2')?.sitelinkCount).not.toBeUndefined();
    });

    it('no longer sends a sitefilter param, so the API returns the full sitelinks map', async () => {
      mockedAxios.get
        .mockResolvedValueOnce(mockWbGetEntities({}))
        .mockResolvedValueOnce(mockExtracts({}));

      service = await setup();
      await service.getEntitySummaries(['Q1']);

      const [, requestConfig] = mockedAxios.get.mock.calls[0];
      expect((requestConfig as any)?.params?.sitefilter).toBeUndefined();
      expect((requestConfig as any)?.params?.props).toContain('sitelinks');
    });

    it('is absent from the returned summaries when the entity has sitelinks but no label/description/alias/enwiki title at all (identity admission is unchanged by sitelinkCount — regression)', async () => {
      // Real sitelinks exist (dewiki/frwiki) but none of them is `enwiki`,
      // and there is no label/description/alias either -- no usable
      // textual identity for IdentityEvidenceCollector to reason about.
      // sitelinkCount is quality/notability evidence on an ALREADY-valid
      // summary, never what makes a summary valid in the first place --
      // admitting this would let IdentityEvidenceCollector treat "a
      // summary merely exists" as a Wikidata identity attempt
      // (hintMatched=false, candidateMatched=true), wrongly REJECTing a
      // real candidate instead of falling through to the nearby-Wikidata
      // path.
      mockedAxios.get.mockResolvedValueOnce(
        mockWbGetEntities({
          Q1: {
            id: 'Q1',
            sitelinks: {
              dewiki: { title: 'Etwas' },
              frwiki: { title: 'Quelque chose' },
            },
          },
        }),
      );

      service = await setup();
      const result = await service.getEntitySummaries(['Q1']);

      expect(result.has('Q1')).toBe(false);
      // No enwiki sitelink among the (real, non-empty) sitelinks means
      // there's nothing to look up extracts for either.
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it('still reports the full real sitelinkCount for a normal, textually-identifiable entity with multiple sitelinks', async () => {
      mockedAxios.get
        .mockResolvedValueOnce(
          mockWbGetEntities({
            Q1: {
              id: 'Q1',
              labels: { en: { value: 'Plaza Dorrego' } },
              sitelinks: {
                enwiki: { title: 'Plaza Dorrego' },
                eswiki: { title: 'Plaza Dorrego' },
                dewiki: { title: 'Plaza Dorrego' },
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          mockExtracts({
            '1': { title: 'Plaza Dorrego', extract: 'Plaza Dorrego is...' },
          }),
        );

      service = await setup();
      const result = await service.getEntitySummaries(['Q1']);

      expect(result.get('Q1')?.sitelinkCount).toBe(3);
      expect(result.get('Q1')?.extract).toBe('Plaza Dorrego is...');
    });
  });

  describe('findNearbyPlaces (Task A2, cross-source confirmation)', () => {
    it('queries the SPARQL endpoint with a wikibase:around service using lon,lat point and km radius, and maps bindings to WikidataNearbyPlace[]', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          results: {
            bindings: [
              {
                item: { value: 'http://www.wikidata.org/entity/Q1808336' },
                itemLabel: {
                  value: 'Museum of Latin American Art of Buenos Aires',
                },
                location: { value: 'Point(-58.403593 -34.577111)' },
              },
            ],
          },
        },
      });

      service = await setup();
      const results = await service.findNearbyPlaces(
        -34.5768817,
        -58.4033919,
        200,
      );

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://query.wikidata.org/sparql',
        expect.objectContaining({
          params: expect.objectContaining({
            format: 'json',
            query: expect.stringContaining('Point(-58.4033919 -34.5768817)'),
          }),
        }),
      );
      const [, config] = mockedAxios.get.mock.calls[0];
      expect((config as any).params.query).toContain('wikibase:radius "0.2"');
      expect(results).toEqual([
        {
          qid: 'Q1808336',
          label: 'Museum of Latin American Art of Buenos Aires',
          latitude: -34.577111,
          longitude: -58.403593,
        },
      ]);
    });

    it('returns an empty array (never throws) when the SPARQL endpoint fails', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('network error'));

      service = await setup();
      const results = await service.findNearbyPlaces(-34.6, -58.4, 200);

      expect(results).toEqual([]);
    });

    it('returns an empty array when there are no nearby bindings', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { results: { bindings: [] } },
      });

      service = await setup();
      const results = await service.findNearbyPlaces(-34.6, -58.4, 200);

      expect(results).toEqual([]);
    });
  });

  describe('lookupPhysicalLocation', () => {
    beforeEach(() => mockedAxios.get.mockReset());

    it('reports an item with a coordinate (P625) as located and one without as not located', async () => {
      service = await setup();
      mockedAxios.get.mockResolvedValueOnce(
        mockWbGetEntities({
          Q1: {
            id: 'Q1',
            claims: { P625: [{ mainsnak: { snaktype: 'value' } }] },
          },
          Q2: {
            id: 'Q2',
            claims: { P31: [{ mainsnak: { snaktype: 'value' } }] },
          },
        }),
      );

      const result = await service.lookupPhysicalLocation(['Q1', 'Q2']);

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          params: expect.objectContaining({ props: 'claims', ids: 'Q1|Q2' }),
        }),
      );
      expect(result.get('Q1')).toEqual({ qid: 'Q1', located: true });
      expect(result.get('Q2')).toEqual({ qid: 'Q2', located: false });
    });

    it('leaves a missing item and a P625 without a value UNKNOWN or not located', async () => {
      service = await setup();
      mockedAxios.get.mockResolvedValueOnce(
        mockWbGetEntities({
          Q3: { id: 'Q3', missing: '' },
          Q4: {
            id: 'Q4',
            claims: { P625: [{ mainsnak: { snaktype: 'novalue' } }] },
          },
        }),
      );

      const result = await service.lookupPhysicalLocation(['Q3', 'Q4']);

      expect(result.has('Q3')).toBe(false);
      expect(result.get('Q4')).toEqual({ qid: 'Q4', located: false });
    });

    it('never throws: a failed lookup leaves every item UNKNOWN', async () => {
      service = await setup();
      mockedAxios.get.mockRejectedValueOnce(new Error('timeout'));

      const result = await service.lookupPhysicalLocation(['Q5']);

      expect(result.size).toBe(0);
    });

    it('ignores ids that are not QIDs without calling Wikidata', async () => {
      service = await setup();

      const result = await service.lookupPhysicalLocation(['', 'osm:node:1']);

      expect(result.size).toBe(0);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });
  });
});
