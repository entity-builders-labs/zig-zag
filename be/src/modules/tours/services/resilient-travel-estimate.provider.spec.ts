import { ResilientTravelEstimateProvider } from './resilient-travel-estimate.provider';
import { TransportationMode } from '../interfaces/tour-generation.interface';
import { buildPointFootprint } from '../utils/spatial-footprint.util';

describe('ResilientTravelEstimateProvider', () => {
  const from = buildPointFootprint(-34.6, -58.4);
  const to = buildPointFootprint(-34.61, -58.41);
  const realEstimate = {
    mode: TransportationMode.WALKING,
    durationMinutes: 12,
    distanceMeters: 900,
    walkingMinutes: 12,
    walkingDistanceMeters: 900,
    approximate: false,
    provider: 'geoapify',
  };
  const approximateEstimate = {
    mode: TransportationMode.WALKING,
    durationMinutes: 18,
    distanceMeters: 1300,
    walkingMinutes: 18,
    walkingDistanceMeters: 1300,
    approximate: true,
    provider: 'approximate',
  };

  const service = (options?: {
    routingProvider?: string;
    available?: boolean;
    geoapifyError?: Error;
  }) => {
    const config = {
      get: jest.fn((key: string) =>
        key === 'ROUTING_PROVIDER' ? options?.routingProvider : undefined,
      ),
    };
    const geoapify = {
      isAvailable: jest.fn(() => options?.available ?? true),
      estimate: options?.geoapifyError
        ? jest.fn().mockRejectedValue(options.geoapifyError)
        : jest.fn().mockResolvedValue(realEstimate),
    };
    const approximate = {
      estimate: jest.fn().mockResolvedValue(approximateEstimate),
    };
    return {
      provider: new ResilientTravelEstimateProvider(
        config as any,
        geoapify as any,
        approximate as any,
      ),
      geoapify,
      approximate,
    };
  };

  it('uses configured Geoapify routing when available', async () => {
    const { provider, geoapify, approximate } = service();
    const result = await provider.estimate(from, to, [
      TransportationMode.WALKING,
    ]);
    expect(result).toEqual(realEstimate);
    expect(geoapify.estimate).toHaveBeenCalledTimes(1);
    expect(approximate.estimate).not.toHaveBeenCalled();
  });

  it('falls back explicitly when Geoapify is unavailable', async () => {
    const { provider, approximate } = service({ available: false });
    const result = await provider.estimate(from, to, [
      TransportationMode.WALKING,
    ]);
    expect(approximate.estimate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      approximate: true,
      provider: 'approximate',
      fallbackReason: 'geoapify_unconfigured',
    });
  });

  it('falls back explicitly when the real routing provider fails', async () => {
    const { provider } = service({
      geoapifyError: new Error('routing timeout'),
    });
    const result = await provider.estimate(from, to, [
      TransportationMode.WALKING,
    ]);
    expect(result.approximate).toBe(true);
    expect(result.fallbackReason).toContain('geoapify_failed:routing timeout');
  });

  it('can deliberately run approximate-only and records that decision', async () => {
    const { provider, geoapify } = service({
      routingProvider: 'approximate',
    });
    const result = await provider.estimate(from, to, [
      TransportationMode.WALKING,
    ]);
    expect(geoapify.estimate).not.toHaveBeenCalled();
    expect(result.fallbackReason).toBe(
      'routing_provider_configured_approximate',
    );
  });
});
