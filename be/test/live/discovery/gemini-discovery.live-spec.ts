import { Test } from '@nestjs/testing';
import { ConfigModule } from 'src/core/config/config.module';
import aiConfig from 'src/shared/ai/ai.config';
import { GeminiDiscoveryProvider } from 'src/modules/tours/services/gemini-discovery.provider';
import {
  assertLiveExtractionContract,
  liveGate,
  loadRootEnv,
  printCharacterization,
} from './discovery-live.helper';
import {
  controlledScenario,
  longTailScenario,
} from './discovery-live.fixtures';

loadRootEnv();
jest.setTimeout(120000);

const RUN = liveGate('gemini');

(RUN ? describe : describe.skip)('LIVE gemini discovery extractor', () => {
  let provider: GeminiDiscoveryProvider;
  let model: string;

  beforeAll(async () => {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error(
        'LIVE Gemini discovery requested but GEMINI_API_KEY is missing',
      );
    }
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule],
      providers: [GeminiDiscoveryProvider],
    }).compile();
    provider = moduleRef.get(GeminiDiscoveryProvider);
    model = moduleRef.get(aiConfig.KEY).discoveryExtractor.gemini.model;
    // eslint-disable-next-line no-console
    console.info(`\nLIVE gemini · model=${model}`);
  });

  for (const scenario of [controlledScenario, longTailScenario]) {
    it(`extracts real candidates for the ${scenario.name} scenario`, async () => {
      const result = await provider.extractExperiences(
        scenario.request,
        scenario.evidence,
      );
      printCharacterization(scenario.name, result as any);
      assertLiveExtractionContract({
        result: result as any,
        evidenceKeys: scenario.evidence.evidence.map((e) => e.key),
        expectedProvider: 'gemini',
      });
    });
  }
});
