import { Test, TestingModule } from '@nestjs/testing';
import aiConfig from '@shared/ai/ai.config';
import {
  INITIAL_DIMENSION_VOCABULARY,
  PREFERENCE_DIMENSIONS,
} from '../preferences/preference-facet-vocabulary';
import { GeminiDiscoveryProvider } from './gemini-discovery.provider';

const CANONICAL_THEMES =
  INITIAL_DIMENSION_VOCABULARY[PREFERENCE_DIMENSIONS.THEME];
const CANONICAL_INTENTS =
  INITIAL_DIMENSION_VOCABULARY[PREFERENCE_DIMENSIONS.INTENT];

describe('GeminiDiscoveryProvider — controlled facet contract', () => {
  let provider: GeminiDiscoveryProvider;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeminiDiscoveryProvider,
        {
          provide: aiConfig.KEY,
          useValue: {
            discoveryExtractor: {
              gemini: { apiKey: 'test-key', model: 'gemini-test' },
            },
          },
        },
      ],
    }).compile();
    provider = module.get(GeminiDiscoveryProvider);

    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        steps: [
          {
            type: 'model_output',
            content: [{ type: 'text', text: '{"candidates":[]}' }],
          },
        ],
      }),
    } as any);
  });

  afterEach(() => fetchSpy.mockRestore());

  async function capturePayload() {
    await provider.extractExperiences(
      {
        scope: { destinationName: 'Buenos Aires' },
        requestedThemes: ['history'],
        breadth: 'focused',
        maxCandidates: 8,
      } as any,
      {
        evidence: [
          { key: 'ev-1', title: 'T', source: 'S', snippet: 'snippet' },
        ],
      } as any,
    );
    return JSON.parse(fetchSpy.mock.calls[0][1].body as string);
  }

  it('constrains the themes/intents JSON schema to the central controlled vocabulary', async () => {
    const body = await capturePayload();
    const props = body.response_format.properties.candidates.items.properties;

    expect(props.themes.items.enum).toEqual(CANONICAL_THEMES);
    expect(props.intents.items.enum).toEqual(CANONICAL_INTENTS);
  });

  it('leaves traits open-ended (no enum)', async () => {
    const body = await capturePayload();
    const props = body.response_format.properties.candidates.items.properties;

    expect(props.traits.items).toEqual({ type: 'string' });
    expect(props.traits.items.enum).toBeUndefined();
  });

  it('explains the theme/intent/trait contract in the prompt using the central vocabulary', async () => {
    const body = await capturePayload();
    const prompt: string = body.input;

    expect(prompt).toContain(CANONICAL_THEMES.join(', '));
    expect(prompt).toContain(CANONICAL_INTENTS.join(', '));
    expect(prompt).toMatch(/traits is the open-ended dimension/i);
    expect(prompt).toMatch(
      /never put a canonical theme or intent inside traits/i,
    );
  });
});
