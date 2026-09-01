import { WikimediaPhotoProvider } from './wikimedia-photo.provider';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('WikimediaPhotoProvider', () => {
  let provider: WikimediaPhotoProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new WikimediaPhotoProvider();
  });

  it('should enrich activity from Wikipedia geosearch, page details, and extract', async () => {
    // 1. Mock geosearch response
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        query: {
          geosearch: [
            {
              pageid: 123,
              title: 'Palacio Barolo',
              lat: -34.6096,
              lon: -58.386,
              dist: 12,
            },
          ],
        },
      },
    });

    // 2. Mock page details response
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        query: {
          pages: {
            '123': {
              pageid: 123,
              title: 'Palacio Barolo',
              extract:
                'El Palacio Barolo es un rascacielos histórico ubicado sobre la Avenida de Mayo en Buenos Aires. Fue diseñado por Mario Palanti.',
              thumbnail: {
                source: 'https://upload.wikimedia.org/thumb/barolo.jpg',
                width: 400,
                height: 300,
              },
              original: {
                source: 'https://upload.wikimedia.org/barolo.jpg',
                width: 1200,
                height: 900,
              },
            },
          },
        },
      },
    });

    // 3. Mock commons search response
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        query: {
          pages: {},
        },
      },
    });

    const result = await provider.enrichActivity({
      name: 'Palacio Barolo',
      category: 'cultural',
      latitude: -34.6096,
      longitude: -58.386,
    });

    expect(result.status).toBe('enriched');
    expect(result.photos.length).toBe(1);
    expect(result.photos[0].url).toBe(
      'https://upload.wikimedia.org/barolo.jpg',
    );
    expect(result.photos[0].license).toBe('CC BY-SA 4.0');
    expect(result.highlights?.length).toBeGreaterThan(0);
    expect(result.curatorTip).toContain('Monumento histórico');
  });

  it('should handle Wikipedia API failure gracefully', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('Network timeout'));

    const result = await provider.enrichActivity({
      name: 'Monumento Raro',
      latitude: -34.6,
      longitude: -58.38,
    });

    expect(result.status).toBe('failed');
    expect(result.photos.length).toBe(0);
  });
});
