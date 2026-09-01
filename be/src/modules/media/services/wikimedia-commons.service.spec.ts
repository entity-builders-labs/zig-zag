import axios from 'axios';
import { WikimediaCommonsService } from './wikimedia-commons.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('WikimediaCommonsService lookup outcomes', () => {
  let negativeCache: any;
  let service: WikimediaCommonsService;

  beforeEach(() => {
    jest.clearAllMocks();
    negativeCache = {
      isNegative: jest.fn().mockResolvedValue(false),
      recordNegative: jest.fn().mockResolvedValue(undefined),
    };
    service = new WikimediaCommonsService(negativeCache);
  });

  it('returns FOUND and preserves documentary attribution metadata', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        query: {
          pages: {
            '1': {
              title: 'File:Place.jpg',
              imageinfo: [
                {
                  thumburl: 'https://commons.example/place.jpg',
                  thumbwidth: 1200,
                  thumbheight: 800,
                  descriptionurl: 'https://commons.example/wiki/File:Place.jpg',
                  extmetadata: {
                    Artist: { value: 'Jane Photographer' },
                    LicenseShortName: { value: 'CC BY-SA 4.0' },
                    LicenseUrl: {
                      value: 'https://creativecommons.org/licenses/by-sa/4.0/',
                    },
                    ObjectName: { value: 'Historic Place' },
                  },
                },
              ],
            },
          },
        },
      },
    } as any);

    const result = await service.findPhotosForActivity({
      name: 'Historic Place',
      destinationLabel: 'Test City',
      latitude: -34.5,
      longitude: -58.4,
    });

    expect(result.outcome).toBe('FOUND');
    if (result.outcome === 'FOUND') {
      expect(result.photos[0]).toEqual(
        expect.objectContaining({
          author: 'Jane Photographer',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
          sourceUrl: 'https://commons.example/wiki/File:Place.jpg',
        }),
      );
    }
    expect(negativeCache.recordNegative).not.toHaveBeenCalled();
  });

  it('negative-caches valid empty responses per lookup strategy', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: { query: { pages: {} } } } as any)
      .mockResolvedValueOnce({ data: { query: { pages: {} } } } as any);

    const result = await service.findPhotosForActivity({
      name: 'Unknown Place',
      destinationLabel: 'Test City',
      latitude: -34.5,
      longitude: -58.4,
    });

    expect(result.outcome).toBe('AUTHORITATIVE_EMPTY');
    expect(negativeCache.recordNegative).toHaveBeenCalledTimes(2);
    expect(negativeCache.recordNegative).toHaveBeenCalledWith(
      'wikimedia_commons',
      'title_search',
      'Unknown Place Test City',
    );
    expect(negativeCache.recordNegative).toHaveBeenCalledWith(
      'wikimedia_commons',
      'geosearch',
      '-34.5000,-58.4000',
    );
  });

  it.each([
    [{ code: 'ECONNABORTED', message: 'timeout' }, 'RETRYABLE_FAILURE'],
    [
      { response: { status: 429 }, message: 'rate limited' },
      'RETRYABLE_FAILURE',
    ],
    [
      { response: { status: 503 }, message: 'unavailable' },
      'RETRYABLE_FAILURE',
    ],
  ])(
    'does not negative-cache transient provider failure %#',
    async (error, outcome) => {
      mockedAxios.get
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ data: { query: { pages: {} } } } as any);

      const result = await service.findPhotosForActivity({
        name: 'Retry Place',
        destinationLabel: 'Test City',
        latitude: -34.5,
        longitude: -58.4,
      });

      expect(result.outcome).toBe(outcome);
      expect(negativeCache.recordNegative).not.toHaveBeenCalledWith(
        'wikimedia_commons',
        'title_search',
        expect.any(String),
      );
    },
  );

  it('classifies non-retryable 4xx as permanent without poisoning negative cache', async () => {
    mockedAxios.get
      .mockRejectedValueOnce({
        response: { status: 400 },
        message: 'bad request',
      })
      .mockResolvedValueOnce({ data: { query: { pages: {} } } } as any);

    const result = await service.findPhotosForActivity({
      name: 'Bad Request Place',
      destinationLabel: 'Test City',
      latitude: -34.5,
      longitude: -58.4,
    });

    expect(result.outcome).toBe('PERMANENT_FAILURE');
    expect(negativeCache.recordNegative).not.toHaveBeenCalledWith(
      'wikimedia_commons',
      'title_search',
      expect.any(String),
    );
  });
});
