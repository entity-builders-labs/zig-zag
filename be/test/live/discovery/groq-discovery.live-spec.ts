import { Test } from '@nestjs/testing';
import { ConfigModule } from 'src/core/config/config.module';
import { LangChainService } from 'src/shared/ai/langchain.service';
import { AiCacheService } from 'src/shared/ai/services/ai-cache.service';
import aiConfig from 'src/shared/ai/ai.config';
import { GroqDiscoveryProvider } from 'src/modules/tours/services/groq-discovery.provider';
import {
  assertLiveExtractionContract,
  assertNoGenericPseudoEntities,
  liveGate,
  loadRootEnv,
  printCharacterization,
} from './discovery-live.helper';
import {
  controlledScenario,
  genericEntityScenario,
  longTailScenario,
} from './discovery-live.fixtures';

loadRootEnv();
jest.setTimeout(120000);

const RUN = liveGate('groq');

// A no-op cache so a "live" call is guaranteed to be a real outbound call
// (not transport/model mocking — the real LangChainService + real Groq HTTP
// path still run).
const noCache = {
  getCachedResponse: async (): Promise<string | null> => null,
  cacheResponse: async (): Promise<void> => undefined,
  isEnabled: (): boolean => false,
};

(RUN ? describe : describe.skip)('LIVE groq discovery extractor', () => {
  let provider: GroqDiscoveryProvider;
  let expectedModel: string;
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    if (!process.env.GROQ_API_KEY) {
      throw new Error(
        'LIVE Groq discovery requested but GROQ_API_KEY is missing',
      );
    }
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule],
      providers: [
        GroqDiscoveryProvider,
        LangChainService,
        { provide: AiCacheService, useValue: noCache },
      ],
    }).compile();
    provider = moduleRef.get(GroqDiscoveryProvider);
    expectedModel = moduleRef.get(aiConfig.KEY).discoveryExtractor.groq.model;
    // eslint-disable-next-line no-console
    console.info(`\nLIVE groq · model=${expectedModel}`);
  });

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });
  afterEach(() => fetchSpy.mockRestore());

  for (const scenario of [controlledScenario, longTailScenario]) {
    it(`extracts real candidates for the ${scenario.name} scenario`, async () => {
      const result = await provider.extractExperiences(
        scenario.request,
        scenario.evidence,
        { bypassCache: true },
      );
      printCharacterization(scenario.name, result as any);

      // Prove the real transport was Groq, at the Groq discovery model.
      const groqCall = fetchSpy.mock.calls.find(([url]) =>
        String(url).includes('api.groq.com'),
      );
      expect(groqCall).toBeDefined();
      expect(JSON.parse((groqCall![1] as any).body).model).toBe(expectedModel);

      assertLiveExtractionContract({
        result: result as any,
        evidenceKeys: scenario.evidence.evidence.map((e) => e.key),
        expectedProvider: 'groq',
      });
    });
  }

  it('does not materialise a generic category as a concrete PLACE (generic-entity probe)', async () => {
    const result = await provider.extractExperiences(
      genericEntityScenario.request,
      genericEntityScenario.evidence,
      { bypassCache: true },
    );
    printCharacterization(genericEntityScenario.name, result as any);

    const groqCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes('api.groq.com'),
    );
    expect(groqCall).toBeDefined();
    expect(JSON.parse((groqCall![1] as any).body).model).toBe(expectedModel);

    assertLiveExtractionContract({
      result: result as any,
      evidenceKeys: genericEntityScenario.evidence.evidence.map((e) => e.key),
      expectedProvider: 'groq',
      allowEmptyCandidates: true,
    });
    assertNoGenericPseudoEntities(
      result as any,
      genericEntityScenario.bannedPlaceNames ?? [],
    );
  });
});
