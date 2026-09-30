import { Test, TestingModule } from '@nestjs/testing';
import aiConfig from '@shared/ai/ai.config';
import {
  INITIAL_DIMENSION_VOCABULARY,
  PREFERENCE_DIMENSIONS,
} from '../preferences/preference-facet-vocabulary';
import {
  buildDiscoveryAnchorContext,
  buildDiscoverySystemPrompt,
  buildDiscoveryUserPrompt,
} from '../prompts/experience-discovery-extraction.prompt';
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
      /never put a canonical theme or canonical intent inside traits/i,
    );
  });

  it('keeps traits strictly separate but does NOT forbid a key appearing in both themes and intents', async () => {
    const body = await capturePayload();
    const prompt: string = body.input;

    // no global cross-dimension dedupe rule that would contradict the normalizer
    expect(prompt).not.toMatch(/same concept in more than one/i);
    // themes and intents are independent dimensions, overlap allowed
    expect(prompt).toMatch(
      /themes and intents are separate, independent controlled dimensions/i,
    );
    expect(prompt).toMatch(
      /same canonical key MAY appear in both themes and intents/i,
    );
    expect(prompt).toMatch(/do not deduplicate across themes and intents/i);
  });

  it('sends exactly the shared system + user prompt, with no provider-specific fork (RW4 composition contract)', async () => {
    const body = await capturePayload();
    expect(body.system_instruction).toBe(buildDiscoverySystemPrompt());
    expect(body.input).toBe(
      buildDiscoveryUserPrompt(
        {
          scope: { destinationName: 'Buenos Aires' },
          requestedThemes: ['history'],
          breadth: 'focused',
          maxCandidates: 8,
        } as any,
        [{ key: 'ev-1', title: 'T', source: 'S', snippet: 'snippet' }],
      ),
    );
    expect(body.input).toMatch(
      /never merge components from different variants into one candidate/i,
    );
  });
  it('sends the shared anchor-as-relevance-context contract unchanged (RW4 live-6)', async () => {
    const request = {
      scope: { destinationName: 'Mendoza' },
      requestedThemes: ['wine'],
      requestedIntents: ['route_like'],
      anchorNames: ['Ruta del Vino de Mendoza'],
      breadth: 'focused',
      maxCandidates: 8,
    } as any;
    const evidence = [{ key: 'ev-1', title: 'T', source: 'S', snippet: 's' }];
    await provider.extractExperiences(request, { evidence } as any);
    const prompt: string = JSON.parse(
      fetchSpy.mock.calls[0][1].body as string,
    ).input;
    expect(prompt).toBe(buildDiscoveryUserPrompt(request, evidence));
    expect(prompt).toContain(
      buildDiscoveryAnchorContext(request.anchorNames).join('\n'),
    );
    expect(prompt).toMatch(/Do not require literal anchor-name occurrence/);
  });
});
