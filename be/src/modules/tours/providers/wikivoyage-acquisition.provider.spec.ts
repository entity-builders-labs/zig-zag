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
      title: 'Mercado San Telmo',
      description: 'Mercado tradicional techado.',
      geo: {
        latitude: -34.619528,
        longitude: -58.372832,
      },
      evidenceType: 'place',
      evidenceKey: 'wikivoyage:San_Telmo:Mercado_San_Telmo',
    });

    expect(tango).toEqual({
      provider: 'wikivoyage',
      externalId: undefined,
      title: 'Clases de Tango',
      description: 'Aprender a bailar tango en la plaza.',
      geo: undefined,
      evidenceType: 'tourism_activity',
      evidenceKey: 'wikivoyage:San_Telmo:Clases_de_Tango',
    });
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
