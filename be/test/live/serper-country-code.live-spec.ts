import * as fs from 'fs';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from 'src/app.module';
import { DestinationResolutionService } from 'src/modules/tours/services/destination-resolution.service';
import {
  EXPERIENCE_GROUNDED_SEARCH_PROVIDER,
  ExperienceGroundedSearchProvider,
} from 'src/modules/tours/interfaces/experience-grounding.interface';
import { loadRootEnv } from './discovery/discovery-live.helper';

loadRootEnv();
jest.setTimeout(3 * 60 * 1000);

/**
 * ONE live Serper /search request proving the country-code fact reaches the
 * provider: DestinationResolutionService.countryCode -> grounded request
 * destinationCountryCode -> the DI-selected grounded provider -> the HTTP
 * body Serper receives (`gl`) and Serper's own `searchParameters` echo.
 * The generation-side hops are covered by the destination-country-code
 * integration spec; this closes the last hop against the real provider.
 *
 *   set -a; source ../.env; source ../.env.spike.stage3-place-cutover; set +a
 *   RUN_SPIKE_PREFLIGHT=1 npx jest --config ./test/jest-live.json \
 *     --runInBand serper-country-code
 *
 * Budget: 1 Serper credit; 0 SerpApi requests (asserted).
 */
const RUN = process.env.RUN_SPIKE_PREFLIGHT === '1';
const describeIfRun = RUN ? describe : describe.skip;

describeIfRun('Serper gl from the resolved destination country (live)', () => {
  it('sends gl=ar for a Buenos Aires destination resolved to AR, and no hl', async () => {
    expect(process.env.GROUNDED_SEARCH_PROVIDER).toBe('serper');
    expect(process.env.AI_CACHE_MODE).toBe('off');
    const requests: Array<{ host: string; body?: unknown }> = [];
    const originalFetch = global.fetch;
    global.fetch = (async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url;
      const host = new URL(url).hostname;
      requests.push({
        host,
        body:
          host === 'google.serper.dev' && typeof init?.body === 'string'
            ? JSON.parse(init.body)
            : undefined,
      });
      return originalFetch(input, init);
    }) as typeof fetch;

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    try {
      const destination = await moduleRef
        .get(DestinationResolutionService)
        .resolveDestination('Buenos Aires, Argentina', {
          latitude: -34.6037,
          longitude: -58.3816,
        });
      const provider = moduleRef.get<ExperienceGroundedSearchProvider>(
        EXPERIENCE_GROUNDED_SEARCH_PROVIDER,
      );

      const result = await provider.search({
        destinationName: 'Buenos Aires, Argentina',
        destinationCountryCode: destination.countryCode,
        requestedThemes: ['history'],
        query: 'San Telmo historical walking tour',
      });

      const serperCalls = requests.filter(
        (r) => r.host === 'google.serper.dev',
      );
      const echo = (result.rawOutput as any)?.searchParameters;
      const record = {
        generatedAt: new Date().toISOString(),
        destinationCountryCode: destination.countryCode,
        provider: result.provider,
        model: result.model,
        groundingStatus: result.groundingStatus,
        providerLocale: result.providerLocale,
        sentBody: serperCalls[0]?.body,
        serperSearchParametersEcho: echo,
        evidenceCount: result.evidence.length,
        hosts: requests.map((r) => r.host),
      };
      const outDir = path.join(
        __dirname,
        '../../../spikes/stage3-place-cutover-cold-warm-2026-09-25',
      );
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(
        path.join(outDir, 'serper-country-code.json'),
        JSON.stringify(record, null, 2),
      );
      console.info(JSON.stringify(record, null, 2));

      expect(destination.countryCode).toBe('AR');
      expect(result.provider).toBe('serper');
      expect(result.model).toBe('google-search');
      expect(serperCalls).toHaveLength(1);
      expect(serperCalls[0].body).toMatchObject({ gl: 'ar' });
      expect(serperCalls[0].body).not.toHaveProperty('hl');
      expect(echo).toMatchObject({ gl: 'ar' });
      expect(result.providerLocale).toEqual({ gl: 'ar' });
      expect(requests.some((r) => r.host === 'serpapi.com')).toBe(false);
    } finally {
      global.fetch = originalFetch;
      await moduleRef.close();
    }
  });
});
