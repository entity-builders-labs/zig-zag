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
      enrichActivity: jest.fn(),
      enrichBatch: jest.fn(),
    } as any;

    mockSerpApi = {
      providerName: 'serpapi',
      enrichActivity: jest.fn(),
      enrichBatch: jest.fn(),
    } as any;

    provider = new HybridPhotoProvider(mockWikimedia, mockSerpApi);
  });

  it('should route cultural query to Wikimedia first', async () => {
    mockWikimedia.enrichActivity.mockResolvedValueOnce({
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

    const result = await provider.enrichActivity({
      name: 'Palacio Barolo',
      category: 'cultural',
      wikidataId: 'Q1140940',
    });

    expect(mockWikimedia.enrichActivity).toHaveBeenCalled();
    expect(mockSerpApi.enrichActivity).not.toHaveBeenCalled();
    expect(result.provider).toBe('wikimedia');
  });

  it('should cascade to SerpApi when Wikimedia has no photos', async () => {
    mockWikimedia.enrichActivity.mockResolvedValueOnce({
      photos: [],
      status: 'failed',
      provider: 'wikimedia',
    });

    mockSerpApi.enrichActivity.mockResolvedValueOnce({
      photos: [
        {
          url: 'https://lh3.googleusercontent.com/p/123',
          sourceProvider: 'serpapi',
        },
      ],
      status: 'enriched',
      provider: 'serpapi',
    });

    const result = await provider.enrichActivity({
      name: 'Museo Poco Conocido',
      category: 'museum',
      latitude: -34.6,
      longitude: -58.38,
    });

    expect(mockWikimedia.enrichActivity).toHaveBeenCalled();
    expect(mockSerpApi.enrichActivity).toHaveBeenCalled();
    expect(result.provider).toBe('serpapi');
  });

  it('should route query without coords/wikidata directly to SerpApi', async () => {
    mockSerpApi.enrichActivity.mockResolvedValueOnce({
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

    const result = await provider.enrichActivity({
      name: 'Café Tortoni',
      category: 'food',
    });

    expect(mockWikimedia.enrichActivity).not.toHaveBeenCalled();
    expect(mockSerpApi.enrichActivity).toHaveBeenCalled();
    expect(result.provider).toBe('serpapi');
  });
});
