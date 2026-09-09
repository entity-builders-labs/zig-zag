import { Test } from '@nestjs/testing';
import { ConfigModule } from 'src/core/config/config.module';
import aiConfig from 'src/shared/ai/ai.config';
import { OllamaDiscoveryProvider } from 'src/modules/tours/services/ollama-discovery.provider';
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

const RUN = liveGate('ollama');

(RUN ? describe : describe.skip)('LIVE ollama discovery extractor', () => {
  let provider: OllamaDiscoveryProvider;
  let baseUrl: string;
  let model: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule],
      providers: [OllamaDiscoveryProvider],
    }).compile();
    provider = moduleRef.get(OllamaDiscoveryProvider);
    const cfg = moduleRef.get(aiConfig.KEY).discoveryExtractor.ollama;
    baseUrl = cfg.baseUrl;
    model = cfg.model;

    // Preflight: a clear failure if the server is not reachable.
    try {
      const resp = await fetch(`${baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      } as any);
      if (!resp.ok) throw new Error(`status ${resp.status}`);
    } catch (e) {
      throw new Error(
        `Ollama live discovery requested but Ollama is unreachable at ${baseUrl}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    // eslint-disable-next-line no-console
    console.info(`\nLIVE ollama · baseUrl=${baseUrl} · model=${model}`);
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
        expectedProvider: 'ollama',
      });
    });
  }

  it('does not materialise a generic category as a concrete PLACE (generic-entity probe)', async () => {
    const result = await provider.extractExperiences(
      genericEntityScenario.request,
      genericEntityScenario.evidence,
    );
    printCharacterization(genericEntityScenario.name, result as any);
    // Domain-contract invariants still hold...
    assertLiveExtractionContract({
      result: result as any,
      evidenceKeys: genericEntityScenario.evidence.evidence.map((e) => e.key),
      expectedProvider: 'ollama',
    });
    // ...and no fabricated pseudo-entity.
    assertNoGenericPseudoEntities(
      result as any,
      genericEntityScenario.bannedPlaceNames ?? [],
    );
  });
});
