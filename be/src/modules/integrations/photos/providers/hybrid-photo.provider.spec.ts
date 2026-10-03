import { HybridPhotoProvider } from './hybrid-photo.provider';
import { WikimediaPhotoProvider } from './wikimedia-photo.provider';
import { SerpApiPhotoProvider } from './serpapi-photo.provider';

describe('HybridPhotoProvider', () => {
  let provider: HybridPhotoProvider;
  let mockWikimedia: jest.Mocked<WikimediaPhotoProvider>;
  let mockSerpApi: jest.Mocked<SerpApiPhotoProvider>;

  beforeEach(() => {
    mockWikimedia = {
      providerName: 'wikimedia',
      enrichExperience: jest.fn(),
      enrichBatch: jest.fn(),
    } as any;

    mockSerpApi = {
      providerName: 'serpapi',
      enrichExperience: jest.fn(),
      enrichBatch: jest.fn(),
    } as any;

    provider = new HybridPhotoProvider(mockWikimedia, mockSerpApi);
  });

  it('should route cultural query to Wikimedia first', async () => {
    mockWikimedia.enrichExperience.mockResolvedValueOnce({
      photos: [
        {
          url: 'https://commons.wikimedia.org/pic.jpg',
          sourceProvider: 'wikimedia',
        },
      ],
      highlights: ['Historia barroca'],
      status: 'enriched',
      provider: 'wikimedia',
    });

    const result = await provider.enrichExperience({
      name: 'Palacio Barolo',
      category: 'cultural',
      wikidataId: 'Q1140940',
    });

    expect(mockWikimedia.enrichExperience).toHaveBeenCalled();
    expect(mockSerpApi.enrichExperience).not.toHaveBeenCalled();
    expect(result.provider).toBe('wikimedia');
  });

  it('should cascade to SerpApi when Wikimedia has no photos', async () => {
    mockWikimedia.enrichExperience.mockResolvedValueOnce({
      photos: [],
      status: 'failed',
      provider: 'wikimedia',
    });

    mockSerpApi.enrichExperience.mockResolvedValueOnce({
      photos: [
        {
          url: 'https://lh3.googleusercontent.com/p/123',
          sourceProvider: 'serpapi',
        },
      ],
      status: 'enriched',
      provider: 'serpapi',
    });

    const result = await provider.enrichExperience({
      name: 'Museo Poco Conocido',
      category: 'museum',
      latitude: -34.6,
      longitude: -58.38,
    });

    expect(mockWikimedia.enrichExperience).toHaveBeenCalled();
    expect(mockSerpApi.enrichExperience).toHaveBeenCalled();
    expect(result.provider).toBe('serpapi');
  });

  it('should route query without coords/wikidata directly to SerpApi', async () => {
    mockSerpApi.enrichExperience.mockResolvedValueOnce({
      photos: [
        {
          url: 'https://lh3.googleusercontent.com/p/cafe',
          sourceProvider: 'serpapi',
        },
      ],
      highlights: ['Café histórico'],
      status: 'enriched',
      provider: 'serpapi',
    });

    const result = await provider.enrichExperience({
      name: 'Café Tortoni',
      category: 'food',
    });

    expect(mockWikimedia.enrichExperience).not.toHaveBeenCalled();
    expect(mockSerpApi.enrichExperience).toHaveBeenCalled();
    expect(result.provider).toBe('serpapi');
  });
});
