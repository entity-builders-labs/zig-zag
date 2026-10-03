import { ConfigService } from '@nestjs/config';
import {
  createPlacesApiService,
  createRealPlacesApiService,
} from './integrations.module';
import { GooglePlacesApiService } from './google-places/services/google-places-api.service';
import { GeoapifyPlacesApiService } from './google-places/services/geoapify-places-api.service';
import { CachedPlacesApiService } from './google-places/services/cached-places-api.service';

function config(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('IntegrationsModule Places factories', () => {
  const google = { provider: 'google' } as GooglePlacesApiService;
  const geoapify = { provider: 'geoapify' } as GeoapifyPlacesApiService;

  it('defaults to Google and selects it explicitly', () => {
    expect(createRealPlacesApiService(config({}), google, geoapify)).toBe(
      google,
    );
    expect(
      createRealPlacesApiService(
        config({ PLACES_PROVIDER: 'google' }),
        google,
        geoapify,
      ),
    ).toBe(google);
  });

  it('selects Geoapify only when configured explicitly', () => {
    expect(
      createRealPlacesApiService(
        config({ PLACES_PROVIDER: 'geoapify' }),
        google,
        geoapify,
      ),
    ).toBe(geoapify);
  });

  it('rejects an unknown provider instead of treating it as Google', () => {
    expect(() =>
      createRealPlacesApiService(
        config({ PLACES_PROVIDER: 'unknown' }),
        google,
        geoapify,
      ),
    ).toThrow('Invalid PLACES_PROVIDER="unknown"');
  });

  it('uses the cache wrapper only when USE_MOCK_MAPS is true', () => {
    const real = {
      getStatus: () => ({
        provider: 'google' as const,
        available: true,
        cacheEnabled: false,
      }),
    } as GooglePlacesApiService;
    const cached = {
      getStatus: () => ({
        provider: 'google' as const,
        available: true,
        cacheEnabled: true,
        cacheMode: 'strict' as const,
      }),
    } as CachedPlacesApiService;

    expect(
      createPlacesApiService(config({ USE_MOCK_MAPS: 'true' }), real, cached),
    ).toBe(cached);
    expect(
      createPlacesApiService(config({ USE_MOCK_MAPS: 'false' }), real, cached),
    ).toBe(real);
  });
});
