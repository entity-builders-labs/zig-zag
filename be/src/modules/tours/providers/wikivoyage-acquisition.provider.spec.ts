import { Test, TestingModule } from '@nestjs/testing';
import { WikivoyageAcquisitionProvider } from './wikivoyage-acquisition.provider';
import { WikivoyageApiService } from '../services/wikivoyage-api.service';
import { WikivoyageArticleResult } from '../interfaces/wikivoyage-api.interface';

describe('WikivoyageAcquisitionProvider', () => {
  let provider: WikivoyageAcquisitionProvider;
  let apiService: jest.Mocked<WikivoyageApiService>;

  beforeEach(async () => {
    const mockApiService = {
      fetchArticle: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WikivoyageAcquisitionProvider,
        {
          provide: WikivoyageApiService,
          useValue: mockApiService,
        },
      ],
    }).compile();

    provider = module.get<WikivoyageAcquisitionProvider>(
      WikivoyageAcquisitionProvider,
    );
    apiService = module.get(WikivoyageApiService);
  });

  it('maps found article entries into normalized SourceObservations', async () => {
    const mockResult: WikivoyageArticleResult = {
      status: 'found',
      title: 'San Telmo',
      pageid: 10791,
      entries: [
        {
          name: 'Mercado San Telmo',
          description: 'Mercado tradicional techado.',
          lat: -34.619528,
          long: -58.372832,
          wikidata: 'Q6010497',
          sectionType: 'SEE',
          templateName: 'see',
        },
        {
          name: 'Clases de Tango',
          description: 'Aprender a bailar tango en la plaza.',
          sectionType: 'DO',
          templateName: 'hacer',
        },
      ],
    };

    apiService.fetchArticle.mockResolvedValueOnce(mockResult);

    const result = await provider.acquire('San Telmo');

    expect(result.status).toBe('success');
    expect(result.value).toHaveLength(2);

    const [mercado, tango] = result.value;

    expect(mercado).toEqual({
      provider: 'wikivoyage',
      externalId: 'Q6010497',
      // Adapter-boundary normalization: a real, well-formed Wikidata QID
      // resolved here as the typed canonical identity fact -- never
      // re-derived downstream from `provider`/`externalId`.
      canonicalIdentity: { wikidataQid: 'Q6010497' },
      title: 'Mercado San Telmo',
      description: 'Mercado tradicional techado.',
      geo: {
        latitude: -34.619528,
        longitude: -58.372832,
      },
      evidenceType: 'place',
      originationCapabilities: ['SINGLE_PLACE'],
      evidenceKey: 'wikivoyage:San_Telmo:see:see:Mercado_San_Telmo:1',
      // B3 live wiring (cutover M2): the observation's real existence in a
      // fetched Wikivoyage article IS the editorial-listing signal,
      // normalized here at the adapter boundary.
      qualityEvidence: { editorialListing: { listed: true } },
      metadata: {
        sectionType: 'SEE',
        templateName: 'see',
      },
    });

    expect(tango).toEqual({
      provider: 'wikivoyage',
      externalId: undefined,
      canonicalIdentity: undefined,
      title: 'Clases de Tango',
      description: 'Aprender a bailar tango en la plaza.',
      geo: undefined,
      evidenceType: 'tourism_activity',
      originationCapabilities: [],
      evidenceKey: 'wikivoyage:San_Telmo:do:hacer:Clases_de_Tango:1',
      qualityEvidence: { editorialListing: { listed: true } },
      metadata: {
        sectionType: 'DO',
        templateName: 'hacer',
      },
    });
  });

  it('preserves sectionType and templateName in metadata (Task B1)', async () => {
    const mockResult: WikivoyageArticleResult = {
      status: 'found',
      title: 'Palermo',
      entries: [
        {
          name: 'Jardín Japonés',
          sectionType: 'SEE',
          templateName: 'ver',
        },
      ],
    };

    apiService.fetchArticle.mockResolvedValueOnce(mockResult);

    const result = await provider.acquire('Palermo');

    expect(result.value[0].metadata).toEqual({
      sectionType: 'SEE',
      templateName: 'ver',
    });
  });

  it('generates distinct collision-resistant evidenceKeys for duplicate names in the same article', async () => {
    const mockResult: WikivoyageArticleResult = {
      status: 'found',
      title: 'San Telmo',
      entries: [
        {
          name: 'Café Dorrego',
          sectionType: 'EAT',
          templateName: 'eat',
        },
        {
          name: 'Café Dorrego',
          sectionType: 'EAT',
          templateName: 'eat',
        },
      ],
    };

    apiService.fetchArticle.mockResolvedValueOnce(mockResult);

    const result = await provider.acquire('San Telmo');
    expect(result.status).toBe('success');
    expect(result.value).toHaveLength(2);
    expect(result.value[0].evidenceKey).toBe(
      'wikivoyage:San_Telmo:eat:eat:Cafe_Dorrego:1',
    );
    expect(result.value[1].evidenceKey).toBe(
      'wikivoyage:San_Telmo:eat:eat:Cafe_Dorrego:2',
    );
  });

  it('generates distinct listing-specific evidenceKeys for different listings sharing the same Wikidata QID', async () => {
    const mockResult: WikivoyageArticleResult = {
      status: 'found',
      title: 'San Telmo',
      entries: [
        {
          name: 'Mercado San Telmo',
          sectionType: 'SEE',
          templateName: 'see',
          wikidata: 'Q6010497',
        },
        {
          name: 'Tour gastronómico Mercado San Telmo',
          sectionType: 'DO',
          templateName: 'do',
          wikidata: 'Q6010497',
        },
      ],
    };

    apiService.fetchArticle.mockResolvedValueOnce(mockResult);

    const result = await provider.acquire('San Telmo');
    expect(result.status).toBe('success');
    expect(result.value).toHaveLength(2);

    const [seeListing, doListing] = result.value;

    // Both observations retain Wikidata QID in externalId, and both carry
    // the same typed canonicalIdentity fact -- the ONE signal corroboration
    // reads to recognize a shared real-world identity.
    expect(seeListing.externalId).toBe('Q6010497');
    expect(doListing.externalId).toBe('Q6010497');
    expect(seeListing.canonicalIdentity).toEqual({ wikidataQid: 'Q6010497' });
    expect(doListing.canonicalIdentity).toEqual({ wikidataQid: 'Q6010497' });

    // Evidence keys are listing-specific, distinct, and include section/template/name/occurrence
    expect(seeListing.evidenceKey).toBe(
      'wikivoyage:San_Telmo:see:see:Mercado_San_Telmo:1',
    );
    expect(doListing.evidenceKey).toBe(
      'wikivoyage:San_Telmo:do:do:Tour_gastronomico_Mercado_San_Telmo:1',
    );
    expect(seeListing.evidenceKey).not.toBe(doListing.evidenceKey);
    expect(seeListing.evidenceKey).not.toContain('wikidata');
    expect(doListing.evidenceKey).not.toContain('wikidata');
  });

  it('filters entries when sections option is provided', async () => {
    const mockResult: WikivoyageArticleResult = {
      status: 'found',
      title: 'San Telmo',
      entries: [
        {
          name: 'Mercado San Telmo',
          sectionType: 'SEE',
          templateName: 'see',
        },
        {
          name: 'Clases de Tango',
          sectionType: 'DO',
          templateName: 'do',
        },
        {
          name: 'Parrilla El Desnivel',
          sectionType: 'EAT',
          templateName: 'eat',
        },
      ],
    };

    apiService.fetchArticle.mockResolvedValueOnce(mockResult);

    const result = await provider.acquire('San Telmo', { sections: ['DO'] });

    expect(result.status).toBe('success');
    expect(result.value).toHaveLength(1);
    expect(result.value[0].title).toBe('Clases de Tango');
    expect(result.value[0].evidenceType).toBe('tourism_activity');
  });

  it('returns success with empty array when article is not found', async () => {
    apiService.fetchArticle.mockResolvedValueOnce({
      status: 'not_found',
      entries: [],
    });

    const result = await provider.acquire('NonExistentNeighborhood');

    expect(result.status).toBe('success');
    expect(result.value).toEqual([]);
    expect(result.failureReason).toBeUndefined();
  });

  it('returns failed with failureReason when API service fails', async () => {
    apiService.fetchArticle.mockResolvedValueOnce({
      status: 'failed',
      entries: [],
      failureReason: 'Network timeout',
    });

    const result = await provider.acquire('San Telmo');

    expect(result.status).toBe('failed');
    expect(result.value).toEqual([]);
    expect(result.failureReason).toBe('Network timeout');
  });
});
