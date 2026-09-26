import { Test, TestingModule } from '@nestjs/testing';
import aiConfig from '@shared/ai/ai.config';
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

  it('uses temperature 0 and max_completion_tokens 900', async () => {
    const provider = await makeProvider();
    await provider.extractExperiences(request, searchResult);
    expect(lastBody().temperature).toBe(0);
    expect(lastBody().max_completion_tokens).toBe(900);
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

  it('returns a parse-failure envelope on malformed JSON', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'not json' } }] }),
    } as any);
    const provider = await makeProvider();
    const result = await provider.extractExperiences(request, searchResult);
    expect(result.candidates).toHaveLength(0);
    expect(result.validationErrors).toContain('Failed to parse JSON response');
    expect(result.provider).toBe('cloudflare');
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
});
