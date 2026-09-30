import { Test, TestingModule } from '@nestjs/testing';
import aiConfig from '@shared/ai/ai.config';
import {
  buildDiscoveryAnchorContext,
  buildDiscoverySystemPrompt,
  buildDiscoveryUserPrompt,
} from '../prompts/experience-discovery-extraction.prompt';
import {
  CloudflareDiscoveryError,
  CloudflareDiscoveryProvider,
} from './cloudflare-discovery.provider';

const ENDPOINT =
  'https://api.cloudflare.com/client/v4/accounts/acct-123/ai/v1/chat/completions';

const baseConfig = {
  accountId: 'acct-123',
  apiToken: 'cf-secret-token',
  model: '@cf/qwen/qwen3.8-27b',
  timeoutMs: 60000,
  maxCompletionTokens: 4096,
};

const VALID_CANDIDATE = {
  candidates: [
    {
      name: 'Paseo',
      themes: ['history'],
      traits: [] as string[],
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
};

const request = {
  scope: { destinationName: 'San Telmo' },
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

async function makeProvider(
  overrides: Partial<typeof baseConfig> = {},
): Promise<CloudflareDiscoveryProvider> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      CloudflareDiscoveryProvider,
      {
        provide: aiConfig.KEY,
        useValue: {
          discoveryExtractor: {
            cloudflare: { ...baseConfig, ...overrides },
          },
        },
      },
    ],
  }).compile();
  return module.get(CloudflareDiscoveryProvider);
}

describe('CloudflareDiscoveryProvider', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"candidates":[]}' } }],
      }),
    } as any);
  });

  afterEach(() => fetchSpy.mockRestore());

  function lastCall(): [string, any] {
    return fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
  }

  function lastBody(): any {
    return JSON.parse(lastCall()[1].body as string);
  }

  it('calls the Cloudflare Workers AI chat completions endpoint with the account id', async () => {
    const provider = await makeProvider();
    await provider.extractExperiences(request, searchResult);
    expect(lastCall()[0]).toBe(ENDPOINT);
  });

  it('sends a Bearer Authorization header with the API token', async () => {
    const provider = await makeProvider();
    await provider.extractExperiences(request, searchResult);
    expect(lastCall()[1].headers.Authorization).toBe('Bearer cf-secret-token');
    expect(lastCall()[1].headers['Content-Type']).toBe('application/json');
  });

  it('sends the configured model', async () => {
    const provider = await makeProvider();
    await provider.extractExperiences(request, searchResult);
    expect(lastBody().model).toBe('@cf/qwen/qwen3.8-27b');
  });

  it('sends system and user messages built from the shared prompt', async () => {
    const provider = await makeProvider();
    await provider.extractExperiences(request, searchResult);
    const body = lastBody();
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
    expect(body.messages[0].content).toContain('ExperienceCandidate extractor');
    expect(body.messages[1].content).toContain('Grounded evidence:');
    expect(body.messages[1].content).toContain('ev-1');
  });

  it('sends exactly the shared system + user prompt, with no provider-specific fork (RW4 composition contract)', async () => {
    const provider = await makeProvider();
    await provider.extractExperiences(request, searchResult);
    const body = lastBody();
    expect(body.messages[0].content).toBe(buildDiscoverySystemPrompt());
    expect(body.messages[1].content).toBe(
      buildDiscoveryUserPrompt(request, searchResult.evidence),
    );
    expect(body.messages[1].content).toMatch(
      /never merge components from different variants into one candidate/i,
    );
  });

  it('sends the typed anchor context through the shared user prompt (C4)', async () => {
    const provider = await makeProvider();
    await provider.extractExperiences(
      { ...request, anchorNames: ['Caminito'] },
      searchResult,
    );
    expect(lastBody().messages[1].content).toContain('Named anchors: Caminito');
  });

  it('sends the shared anchor-as-relevance-context contract unchanged (RW4 live-6)', async () => {
    const provider = await makeProvider();
    const anchored = { ...request, anchorNames: ['Ruta del Vino de Mendoza'] };
    await provider.extractExperiences(anchored, searchResult);
    const user = lastBody().messages[1].content;
    expect(user).toBe(
      buildDiscoveryUserPrompt(anchored, searchResult.evidence),
    );
    expect(user).toContain(
      buildDiscoveryAnchorContext(anchored.anchorNames).join('\n'),
    );
    expect(user).toMatch(/Do not require literal anchor-name occurrence/);
  });

  it('uses temperature 0, default max_completion_tokens (4096), and disables thinking', async () => {
    const provider = await makeProvider();
    await provider.extractExperiences(request, searchResult);
    expect(lastBody().temperature).toBe(0);
    expect(lastBody().max_completion_tokens).toBe(4096);
    expect(lastBody().chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it('propagates an explicit maxCompletionTokens override to Cloudflare', async () => {
    const provider = await makeProvider({ maxCompletionTokens: 2048 });
    await provider.extractExperiences(request, searchResult);
    expect(lastBody().max_completion_tokens).toBe(2048);
  });

  it('parses a multi-candidate payload exceeding the previous truncated RW4 size (payload-size regression)', async () => {
    const multiCandidatePayload = {
      candidates: [
        {
          name: 'Maipú Wine Route Tour',
          description:
            'A traditional wine route experience in eastern Mendoza, visiting century-old wineries known for classic Malbec, Cabernet Sauvignon, and Bonarda. The route covers the historic wine region of Maipú, featuring guided tastings at renowned estates like Bodega Trapiche, Bodega Norton, and Bodega Santa Julia, accompanied by regional gastronomy.',
          themes: ['wine', 'history', 'gastronomy'],
          traits: [
            'traditional wineries',
            'classic Malbec',
            'century-old estates',
            'guided cellar visits',
            'olive oil tastings',
          ],
          intents: ['route_like', 'visit'],
          suggestedDurationMinutes: 360,
          componentHints: [
            {
              key: 'maipu',
              name: 'Maipú',
              role: 'area',
              expectedKind: 'AREA',
              evidenceKeys: ['ev-1'],
              supportSpan: 'Historic barrio',
            },
            {
              key: 'trapiche',
              name: 'Bodega Trapiche',
              role: 'venue',
              expectedKind: 'PLACE',
              evidenceKeys: ['ev-1'],
              supportSpan: 'Historic barrio',
            },
            {
              key: 'norton',
              name: 'Bodega Norton',
              role: 'venue',
              expectedKind: 'PLACE',
              evidenceKeys: ['ev-1'],
              supportSpan: 'Historic barrio',
            },
            {
              key: 'santa-julia',
              name: 'Bodega Santa Julia',
              role: 'venue',
              expectedKind: 'PLACE',
              evidenceKeys: ['ev-1'],
              supportSpan: 'Historic barrio',
            },
          ],
          evidenceKeys: ['ev-1'],
          shortReason:
            'Evidence explicitly describes the Maipú Wine Route as a distinct circuit visiting historic estates.',
          orderedByEvidence: false,
        },
        {
          name: 'Luján de Cuyo Wine Route Tour',
          description:
            'A premium wine route experience in the First Zone of Argentine Malbec. This circuit visits world-class boutique wineries and signature cuisine restaurants situated at the foothills of the Andes in Luján de Cuyo, celebrated for high-altitude terroirs, iconic single-vineyard bottlings, and refined cellar dining.',
          themes: ['wine', 'gastronomy', 'scenic'],
          traits: [
            'boutique wineries',
            'premium Malbec',
            'signature cuisine',
            'high-altitude terroirs',
            'architectural cellars',
          ],
          intents: ['route_like', 'visit'],
          suggestedDurationMinutes: 360,
          componentHints: [
            {
              key: 'lujan',
              name: 'Luján de Cuyo',
              role: 'area',
              expectedKind: 'AREA',
              evidenceKeys: ['ev-1'],
              supportSpan: 'Historic barrio',
            },
            {
              key: 'catena',
              name: 'Catena Zapata',
              role: 'venue',
              expectedKind: 'PLACE',
              evidenceKeys: ['ev-1'],
              supportSpan: 'Historic barrio',
            },
            {
              key: 'vina-cobos',
              name: 'Viña Cobos',
              role: 'venue',
              expectedKind: 'PLACE',
              evidenceKeys: ['ev-1'],
              supportSpan: 'Historic barrio',
            },
            {
              key: 'achaval-ferrer',
              name: 'Achaval-Ferrer',
              role: 'venue',
              expectedKind: 'PLACE',
              evidenceKeys: ['ev-1'],
              supportSpan: 'Historic barrio',
            },
          ],
          evidenceKeys: ['ev-1'],
          shortReason:
            'Evidence explicitly describes the Luján de Cuyo Wine Route as an independent high-altitude wine circuit.',
          orderedByEvidence: false,
        },
      ],
    };

    const serialized = JSON.stringify(multiCandidatePayload, null, 2);
    // Payload-size regression: verify extraction succeeds on serialized JSON larger
    // than the live-observed RW4 truncated output (~3150 characters).
    expect(serialized.length).toBeGreaterThan(3200);

    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: { content: serialized },
            finish_reason: 'stop',
          },
        ],
      }),
    } as any);

    const provider = await makeProvider();
    const result = await provider.extractExperiences(request, searchResult);
    expect(result.validationErrors).toHaveLength(0);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].name).toBe('Maipú Wine Route Tour');
    expect(result.candidates[1].name).toBe('Luján de Cuyo Wine Route Tour');
  });

  it('extracts a valid candidate through the shared deterministic boundary', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(VALID_CANDIDATE) } }],
      }),
    } as any);
    const provider = await makeProvider();
    const result = await provider.extractExperiences(request, searchResult);
    expect(result.validationErrors).toHaveLength(0);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].name).toBe('Paseo');
    expect(result.candidates[0].themes).toEqual(['history']);
  });

  it('returns empty candidates for an empty candidates array', async () => {
    const provider = await makeProvider();
    const result = await provider.extractExperiences(request, searchResult);
    expect(result.candidates).toHaveLength(0);
    expect(result.validationErrors).toHaveLength(0);
  });

  it('returns a parse-failure envelope on malformed JSON when finish_reason is stop', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: { content: 'not json' },
            finish_reason: 'stop',
          },
        ],
      }),
    } as any);
    const provider = await makeProvider();
    const result = await provider.extractExperiences(request, searchResult);
    expect(result.candidates).toHaveLength(0);
    expect(result.validationErrors).toContain('Failed to parse JSON response');
    expect(result.validationErrors).not.toContain(
      'Cloudflare discovery response truncated at completion token limit',
    );
    expect(result.provider).toBe('cloudflare');
  });

  it('diagnoses truncation explicitly when finish_reason is length and JSON is incomplete', async () => {
    const truncatedJson = '{"candidates":[{"name":"Cut off candidate",';
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: { content: truncatedJson },
            finish_reason: 'length',
          },
        ],
      }),
    } as any);

    const provider = await makeProvider();
    const result = await provider.extractExperiences(request, searchResult);
    expect(result.candidates).toHaveLength(0);
    expect(result.rawOutput).toBe(truncatedJson);
    expect(result.validationErrors).toContain(
      'Cloudflare discovery response truncated at completion token limit',
    );
    expect(result.provider).toBe('cloudflare');
    expect(result.model).toBe('@cf/qwen/qwen3.8-27b');
  });

  it('diagnoses truncation when finish_reason is length even if content is syntactically valid JSON', async () => {
    const validJson = JSON.stringify(VALID_CANDIDATE);
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: { content: validJson },
            finish_reason: 'length',
          },
        ],
      }),
    } as any);

    const provider = await makeProvider();
    const result = await provider.extractExperiences(request, searchResult);
    expect(result.candidates).toHaveLength(0);
    expect(result.validationErrors).toContain(
      'Cloudflare discovery response truncated at completion token limit',
    );
    expect(result.rawOutput).toBe(validJson);
    expect(result.provider).toBe('cloudflare');
    expect(result.model).toBe('@cf/qwen/qwen3.8-27b');
  });

  it('throws a provider failure on a non-2xx Cloudflare response', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'upstream exploded',
    } as any);
    const provider = await makeProvider();
    await expect(
      provider.extractExperiences(request, searchResult),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('preserves HTTP 429 as a provider failure, never as empty candidates', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    } as any);
    const provider = await makeProvider();
    const err = await provider
      .extractExperiences(request, searchResult)
      .catch((e) => e);
    expect(err).toBeInstanceOf(CloudflareDiscoveryError);
    expect(err.status).toBe(429);
    expect(err.message).toContain('429');
  });

  it('returns an explicit error when the account id is missing and makes no call', async () => {
    const provider = await makeProvider({ accountId: undefined });
    const result = await provider.extractExperiences(request, searchResult);
    expect(result.validationErrors).toEqual(['Missing Cloudflare account id']);
    expect(result.provider).toBe('cloudflare');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns an explicit error when the API token is missing and makes no call', async () => {
    const provider = await makeProvider({ apiToken: undefined });
    const result = await provider.extractExperiences(request, searchResult);
    expect(result.validationErrors).toEqual(['Missing Cloudflare API token']);
    expect(result.provider).toBe('cloudflare');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports provider and model provenance', async () => {
    const provider = await makeProvider();
    const result = await provider.extractExperiences(request, searchResult);
    expect(result.provider).toBe('cloudflare');
    expect(result.model).toBe('@cf/qwen/qwen3.8-27b');
  });

  it('never surfaces the API token in a provider error', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Authorization: Bearer cf-secret-token was rejected',
    } as any);
    const provider = await makeProvider();
    const err = await provider
      .extractExperiences(request, searchResult)
      .catch((e) => e);
    expect(err.message).not.toContain('cf-secret-token');
    expect(err.message).toContain('[REDACTED]');
  });

  it('strips qwen <think> reasoning wrappers before parsing', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: `<think>the user wants history</think>${JSON.stringify(VALID_CANDIDATE)}`,
            },
          },
        ],
      }),
    } as any);
    const provider = await makeProvider();
    const result = await provider.extractExperiences(request, searchResult);
    expect(result.validationErrors).toHaveLength(0);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].name).toBe('Paseo');
  });

  it('strips ```json markdown fences before parsing', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: '```json\n' + JSON.stringify(VALID_CANDIDATE) + '\n```',
            },
          },
        ],
      }),
    } as any);
    const provider = await makeProvider();
    const result = await provider.extractExperiences(request, searchResult);
    expect(result.validationErrors).toHaveLength(0);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].name).toBe('Paseo');
  });
});
