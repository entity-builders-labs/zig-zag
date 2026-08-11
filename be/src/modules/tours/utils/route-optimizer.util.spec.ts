import axios from 'axios';
import { optimizeActivityOrder } from './route-optimizer.util';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('optimizeActivityOrder', () => {
  const origin = { latitude: -34.6218351, longitude: -58.3713942 };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the points unchanged when there is 0 or 1 of them', async () => {
    expect(await optimizeActivityOrder(origin, [], 'key')).toEqual([]);

    const single = [{ latitude: 1, longitude: 2 }];
    expect(await optimizeActivityOrder(origin, single, 'key')).toBe(single);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('returns the points unchanged when no API key is configured', async () => {
    const points = [
      { latitude: 1, longitude: 2 },
      { latitude: 3, longitude: 4 },
    ];
    expect(await optimizeActivityOrder(origin, points, undefined)).toBe(points);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('reorders points according to the Directions API waypoint_order', async () => {
    const points = [
      { latitude: 1, longitude: 1, name: 'A' },
      { latitude: 2, longitude: 2, name: 'B' },
      { latitude: 3, longitude: 3, name: 'C' },
    ];
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        status: 'OK',
        routes: [{ waypoint_order: [2, 0, 1] }],
      },
    });

    const result = await optimizeActivityOrder(origin, points, 'test-key');

    expect(result.map((p) => p.name)).toEqual(['C', 'A', 'B']);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://maps.googleapis.com/maps/api/directions/json',
      expect.objectContaining({
        params: expect.objectContaining({
          origin: '-34.6218351,-58.3713942',
          destination: '-34.6218351,-58.3713942',
          waypoints: 'optimize:true|1,1|2,2|3,3',
          mode: 'walking',
          key: 'test-key',
        }),
      }),
    );
  });

  it('keeps points beyond the 25-waypoint limit appended, unoptimized', async () => {
    const points = Array.from({ length: 27 }, (_, i) => ({
      latitude: i,
      longitude: i,
      name: `p${i}`,
    }));
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        status: 'OK',
        // identity order for the first 25
        routes: [{ waypoint_order: Array.from({ length: 25 }, (_, i) => i) }],
      },
    });

    const result = await optimizeActivityOrder(origin, points, 'test-key');

    expect(result).toHaveLength(27);
    expect(result[25].name).toBe('p25');
    expect(result[26].name).toBe('p26');
  });

  it('falls back to the original order when the API responds with a non-OK status', async () => {
    const points = [
      { latitude: 1, longitude: 1 },
      { latitude: 2, longitude: 2 },
    ];
    mockedAxios.get.mockResolvedValueOnce({
      data: { status: 'ZERO_RESULTS' },
    });

    const result = await optimizeActivityOrder(origin, points, 'test-key');

    expect(result).toEqual(points);
  });

  it('falls back to the original order when the request throws', async () => {
    const points = [
      { latitude: 1, longitude: 1 },
      { latitude: 2, longitude: 2 },
    ];
    mockedAxios.get.mockRejectedValueOnce(new Error('network error'));

    const result = await optimizeActivityOrder(origin, points, 'test-key');

    expect(result).toEqual(points);
  });
});
