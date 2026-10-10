import { Test, TestingModule } from '@nestjs/testing';
import aiConfig from '@shared/ai/ai.config';
import {
  buildDiscoveryAnchorContext,
  buildDiscoverySystemPrompt,
  buildDiscoveryUserPrompt,
} from '../prompts/experience-discovery-extraction.prompt';
import { OllamaDiscoveryProvider } from './ollama-discovery.provider';

const chatMock = jest.fn();
const abortMock = jest.fn();
const OllamaCtor = jest.fn();

jest.mock('ollama', () => ({
  Ollama: jest.fn().mockImplementation((cfg: unknown) => {
    OllamaCtor(cfg);
    return { chat: chatMock, abort: abortMock };
  }),
}));

const ollamaConfig = {
  baseUrl: 'http://ollama.internal:11434',
  apiKey: 'ollama_api_key_if_needed',
  model: 'qwen2.5:7b-instruct',
  timeoutMs: 60000,
  numCtx: 4096,
};

async function makeProvider(
  overrides: Partial<typeof ollamaConfig> = {},
): Promise<OllamaDiscoveryProvider> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      OllamaDiscoveryProvider,
      {
        provide: aiConfig.KEY,
        useValue: {
          discoveryExtractor: { ollama: { ...ollamaConfig, ...overrides } },
        },
      },
    ],
  }).compile();
  return module.get(OllamaDiscoveryProvider);
}

const request = {
  scope: { destinationName: 'Buenos Aires' },
  requestedThemes: ['history'],
  requestedIntents: ['walk'],
  breadth: 'focused',
  maxCandidates: 8,
} as any;

const searchResult = {
  evidence: [
    {
      key: 'ev-1',
      source: 'src',
      title: 'San Telmo',
      snippet: 'Historic barrio',
    },
  ],
} as any;

describe('OllamaDiscoveryProvider', () => {
  beforeEach(() => {
    chatMock.mockReset();
    abortMock.mockReset();
    OllamaCtor.mockReset();
  });

  it('calls the Ollama client with structured JSON mode, temperature 0, and the configured model/host', async () => {
    chatMock.mockResolvedValue({ message: { content: '{"candidates":[]}' } });
    const provider = await makeProvider();

    const result = await provider.extractExperiences(request, searchResult);

    expect(OllamaCtor).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'http://ollama.internal:11434' }),
    );
    // placeholder api key -> no Authorization header
    expect(OllamaCtor.mock.calls[0][0].headers).toBeUndefined();

    const chatArg = chatMock.mock.calls[0][0];
    expect(chatArg).toMatchObject({
      model: 'qwen2.5:7b-instruct',
      stream: false,
      options: { temperature: 0, num_ctx: 4096 },
    });
    // structured JSON schema, not the bare 'json' string
    expect(chatArg.format).toEqual(
      expect.objectContaining({ type: 'object', required: ['candidates'] }),
    );
    const hintProps =
      chatArg.format.properties.candidates.items.properties.componentHints.items
        .properties;
    expect(hintProps.expectedKind.enum).toEqual(['PLACE', 'AREA', 'ROUTE']);
    expect(chatArg.messages[0].role).toBe('system');
    expect(chatArg.messages[1].role).toBe('user');
    expect(result.provider).toBe('ollama');
    expect(result.model).toBe('qwen2.5:7b-instruct');
  });

  it('sends exactly the shared system + user prompt, with no provider-specific fork (RW4 composition contract)', async () => {
    chatMock.mockResolvedValue({ message: { content: '{"candidates":[]}' } });
    const provider = await makeProvider();
    await provider.extractExperiences(request, searchResult);
    const [system, user] = chatMock.mock.calls[0][0].messages;
    expect(system.content).toBe(buildDiscoverySystemPrompt());
    expect(user.content).toBe(
      buildDiscoveryUserPrompt(request, searchResult.evidence),
    );
    expect(user.content).toMatch(
      /never merge components from different variants into one candidate/i,
    );
  });

  it('sends the shared anchor-as-relevance-context contract unchanged (RW4 live-6)', async () => {
    chatMock.mockResolvedValue({ message: { content: '{"candidates":[]}' } });
    const provider = await makeProvider();
    const anchored = { ...request, anchorNames: ['Ruta del Vino de Mendoza'] };
    await provider.extractExperiences(anchored, searchResult);
    const user = chatMock.mock.calls[0][0].messages[1].content;
    expect(user).toBe(
      buildDiscoveryUserPrompt(anchored, searchResult.evidence),
    );
    expect(user).toContain(
      buildDiscoveryAnchorContext(anchored.anchorNames).join('\n'),
    );
    expect(user).toMatch(/Do not require literal anchor-name occurrence/);
  });

  it('sends an Authorization header when a real api key is configured', async () => {
    chatMock.mockResolvedValue({ message: { content: '{"candidates":[]}' } });
    const provider = await makeProvider({ apiKey: 'real-secret' });
    await provider.extractExperiences(request, searchResult);
    expect(OllamaCtor.mock.calls[0][0].headers).toEqual({
      Authorization: 'Bearer real-secret',
    });
  });

  it('strips qwen <think> blocks before parsing', async () => {
    chatMock.mockResolvedValue({
      message: {
        content:
          '<think>the user wants history</think>{"candidates":[{"name":"Paseo","themes":["history"],"traits":[],"intents":["walk"],"componentHints":[{"key":"a","name":"Plaza de Mayo","role":"venue","expectedKind":"PLACE","evidenceKeys":["ev-1"],"supportSpan":"Historic barrio"}],"evidenceKeys":["ev-1"],"shortReason":"x"}]}',
      },
    });
    const provider = await makeProvider();
    const result = await provider.extractExperiences(request, searchResult);
    expect(result.validationErrors).toHaveLength(0);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].themes).toEqual(['history']);
  });

  it('routes a leaked canonical theme out of traits via the real shared normalizer', async () => {
    chatMock.mockResolvedValue({
      message: {
        content: JSON.stringify({
          candidates: [
            {
              name: 'Mixed facets',
              themes: [],
              traits: ['history', 'Craft Beer'],
              intents: ['walk'],
              componentHints: [
                {
                  key: 'a',
                  name: 'Plaza de Mayo',
                  role: 'venue',
                  expectedKind: 'PLACE',
                  evidenceKeys: ['ev-1'],
                  supportSpan: 'Historic barrio',
                },
              ],
              evidenceKeys: ['ev-1'],
              shortReason: 'x',
            },
          ],
        }),
      },
    });
    const provider = await makeProvider();
    const result = await provider.extractExperiences(request, searchResult);
    expect(result.candidates[0].themes).toEqual(['history']);
    expect(result.candidates[0].traits).toEqual(['Craft Beer']);
  });

  it('returns a parse-failure envelope on non-JSON output', async () => {
    chatMock.mockResolvedValue({ message: { content: 'not json at all' } });
    const provider = await makeProvider();
    const result = await provider.extractExperiences(request, searchResult);
    expect(result.candidates).toHaveLength(0);
    expect(result.validationErrors).toContain('Failed to parse JSON response');
    expect(result.provider).toBe('ollama');
  });

  it('wraps a transport failure with the base URL and model', async () => {
    chatMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const provider = await makeProvider();
    await expect(
      provider.extractExperiences(request, searchResult),
    ).rejects.toThrow(
      /Ollama discovery request failed against http:\/\/ollama\.internal:11434 \(model qwen2\.5:7b-instruct\): ECONNREFUSED/,
    );
  });
});

describe('OllamaDiscoveryProvider.completeStructured (transport only)', () => {
  it('sends the given prompts with the given schema as the structured format', async () => {
    chatMock.mockReset();
    chatMock.mockResolvedValue({ message: { content: '{"reports":[]}' } });
    const provider = await makeProvider();

    const content = await provider.completeStructured({
      system: 'SYS',
      user: 'USER',
      jsonSchema: {
        type: 'object',
        properties: { reports: { type: 'array' } },
      },
    });

    const chatArg = chatMock.mock.calls[0][0];
    expect(chatArg.format).toEqual({
      type: 'object',
      properties: { reports: { type: 'array' } },
    });
    expect(chatArg.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USER' },
    ]);
    expect(content).toBe('{"reports":[]}');
  });
});
