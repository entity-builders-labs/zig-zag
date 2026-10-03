import aiConfig from './ai.config';

describe('aiConfig embedding index contract', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function loadConfig() {
    return (aiConfig as unknown as () => Record<string, unknown>)();
  }

  it('defaults production embeddings to Bedrock Titan v2 with 256 dimensions', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.EMBEDDINGS_MODEL;
    delete process.env.EMBEDDING_DIMENSIONS;

    expect(loadConfig()).toEqual(
      expect.objectContaining({
        embeddingProvider: 'bedrock',
        embeddingsModel: 'amazon.titan-embed-text-v2:0',
        embeddingDimensions: 256,
      }),
    );
  });

  it('defaults local embeddings to Ollama without consulting OpenAI settings', () => {
    process.env.NODE_ENV = 'development';
    process.env.OPENAI_API_KEY = 'unrelated-key';
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.EMBEDDINGS_MODEL;
    delete process.env.EMBEDDING_DIMENSIONS;

    expect(loadConfig()).toEqual(
      expect.objectContaining({
        embeddingProvider: 'ollama',
        embeddingsModel: 'nomic-embed-text',
        embeddingDimensions: 256,
      }),
    );
  });

  it('uses the active chat provider model and ignores the legacy global AI_MODEL', () => {
    process.env.AI_MODEL = 'stale-model-from-another-provider';
    process.env.AI_PROVIDER = 'gemini';
    process.env.GEMINI_MODEL = 'gemini-chat-test';
    process.env.GROQ_MODEL = 'groq-chat-test';

    expect(loadConfig()).toEqual(
      expect.objectContaining({
        provider: 'gemini',
        defaultModel: 'gemini-chat-test',
      }),
    );

    process.env.AI_PROVIDER = 'groq';
    expect(loadConfig()).toEqual(
      expect.objectContaining({
        provider: 'groq',
        defaultModel: 'groq-chat-test',
      }),
    );
  });

  it('rejects an unknown embedding provider instead of falling back', () => {
    process.env.EMBEDDING_PROVIDER = 'mystery-provider';

    expect(loadConfig).toThrow('Unsupported EMBEDDING_PROVIDER');
  });

  it('selects classification independently with provider-owned models', () => {
    process.env.CLASSIFICATION_PROVIDER = 'gemini';
    process.env.GEMINI_CLASSIFICATION_MODEL = 'gemini-classify-test';
    process.env.GROQ_CLASSIFICATION_MODEL = 'groq-classify-test';

    expect(loadConfig()).toEqual(
      expect.objectContaining({
        classification: {
          provider: 'gemini',
          groq: expect.objectContaining({ model: 'groq-classify-test' }),
          gemini: expect.objectContaining({ model: 'gemini-classify-test' }),
          ollama: expect.objectContaining({ model: 'qwen2.5:7b-instruct' }),
        },
      }),
    );
  });

  it('selects the Ollama classification model independently', () => {
    process.env.CLASSIFICATION_PROVIDER = 'ollama';
    process.env.OLLAMA_CLASSIFICATION_MODEL = 'llama3.2:3b';

    expect(loadConfig()).toEqual(
      expect.objectContaining({
        classification: expect.objectContaining({
          provider: 'ollama',
          ollama: { model: 'llama3.2:3b' },
        }),
      }),
    );
  });

  it('rejects vector widths that do not match the pgvector schema', () => {
    process.env.EMBEDDING_PROVIDER = 'bedrock';
    process.env.EMBEDDING_DIMENSIONS = '512';

    expect(loadConfig).toThrow('current pgvector schema requires 256');
  });

  it('defaults discovery extraction to Gemini with the expected default model', () => {
    delete process.env.DISCOVERY_EXTRACTOR_PROVIDER;
    delete process.env.GEMINI_DISCOVERY_MODEL;
    delete process.env.GROQ_DISCOVERY_MODEL;
    delete process.env.OLLAMA_DISCOVERY_MODEL;
    delete process.env.OLLAMA_MODEL;
    delete process.env.OLLAMA_BASE_URL;

    expect(loadConfig()).toEqual(
      expect.objectContaining({
        discoveryExtractor: expect.objectContaining({
          provider: 'gemini',
          gemini: {
            apiKey: process.env.GEMINI_API_KEY,
            model: 'gemini-3.5-flash-lite',
          },
          groq: {
            apiKey: process.env.GROQ_API_KEY,
            model: 'qwen/qwen3.8-27b',
          },
          ollama: expect.objectContaining({
            baseUrl: 'http://localhost:11434',
            model: 'qwen2.5:7b-instruct',
          }),
        }),
      }),
    );
  });

  it('resolves the ollama discovery extractor from OLLAMA_* settings, not AI_PROVIDER', () => {
    process.env.DISCOVERY_EXTRACTOR_PROVIDER = 'ollama';
    process.env.AI_PROVIDER = 'openai';
    process.env.OLLAMA_BASE_URL = 'https://ollama.internal:11434';
    process.env.OLLAMA_DISCOVERY_MODEL = 'qwen2.5:14b-instruct';

    expect(loadConfig()).toEqual(
      expect.objectContaining({
        discoveryExtractor: expect.objectContaining({
          provider: 'ollama',
          ollama: expect.objectContaining({
            baseUrl: 'https://ollama.internal:11434',
            model: 'qwen2.5:14b-instruct',
          }),
        }),
      }),
    );
  });

  it('honors DISCOVERY_EXTRACTOR_PROVIDER=groq and model overrides', () => {
    process.env.DISCOVERY_EXTRACTOR_PROVIDER = 'groq';
    process.env.GROQ_DISCOVERY_MODEL = 'custom-groq-model';

    expect(loadConfig()).toEqual(
      expect.objectContaining({
        discoveryExtractor: expect.objectContaining({
          provider: 'groq',
          groq: expect.objectContaining({ model: 'custom-groq-model' }),
        }),
      }),
    );
  });

  it('honors DISCOVERY_EXTRACTOR_PROVIDER=cloudflare with its own credentials and model', () => {
    process.env.DISCOVERY_EXTRACTOR_PROVIDER = 'cloudflare';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-1';
    process.env.CLOUDFLARE_API_TOKEN = 'tok-1';
    process.env.CLOUDFLARE_DISCOVERY_MODEL = '@cf/qwen/qwen3.8-27b';
    process.env.CLOUDFLARE_DISCOVERY_TIMEOUT_MS = '12345';

    expect(loadConfig()).toEqual(
      expect.objectContaining({
        discoveryExtractor: expect.objectContaining({
          provider: 'cloudflare',
          cloudflare: expect.objectContaining({
            accountId: 'acct-1',
            apiToken: 'tok-1',
            model: '@cf/qwen/qwen3.8-27b',
            timeoutMs: 12345,
          }),
        }),
      }),
    );
  });

  it('defaults the Cloudflare discovery model to @cf/qwen/qwen3.8-27b', () => {
    process.env.DISCOVERY_EXTRACTOR_PROVIDER = 'cloudflare';
    delete process.env.CLOUDFLARE_DISCOVERY_MODEL;
    delete process.env.CLOUDFLARE_DISCOVERY_TIMEOUT_MS;

    expect(loadConfig()).toEqual(
      expect.objectContaining({
        discoveryExtractor: expect.objectContaining({
          provider: 'cloudflare',
          cloudflare: expect.objectContaining({
            model: '@cf/qwen/qwen3.8-27b',
          }),
        }),
      }),
    );
  });

  it('defaults the Cloudflare discovery maxCompletionTokens to 4096 when unset', () => {
    process.env.DISCOVERY_EXTRACTOR_PROVIDER = 'cloudflare';
    delete process.env.CLOUDFLARE_DISCOVERY_MAX_COMPLETION_TOKENS;

    expect(loadConfig()).toEqual(
      expect.objectContaining({
        discoveryExtractor: expect.objectContaining({
          provider: 'cloudflare',
          cloudflare: expect.objectContaining({
            maxCompletionTokens: 4096,
          }),
        }),
      }),
    );
  });

  it('honors an explicit CLOUDFLARE_DISCOVERY_MAX_COMPLETION_TOKENS override', () => {
    process.env.DISCOVERY_EXTRACTOR_PROVIDER = 'cloudflare';
    process.env.CLOUDFLARE_DISCOVERY_MAX_COMPLETION_TOKENS = '2048';

    expect(loadConfig()).toEqual(
      expect.objectContaining({
        discoveryExtractor: expect.objectContaining({
          provider: 'cloudflare',
          cloudflare: expect.objectContaining({
            maxCompletionTokens: 2048,
          }),
        }),
      }),
    );
  });

  it('rejects non-positive or invalid CLOUDFLARE_DISCOVERY_MAX_COMPLETION_TOKENS values', () => {
    process.env.DISCOVERY_EXTRACTOR_PROVIDER = 'cloudflare';

    process.env.CLOUDFLARE_DISCOVERY_MAX_COMPLETION_TOKENS = '0';
    expect(loadConfig).toThrow(
      'Invalid CLOUDFLARE_DISCOVERY_MAX_COMPLETION_TOKENS',
    );

    process.env.CLOUDFLARE_DISCOVERY_MAX_COMPLETION_TOKENS = '-50';
    expect(loadConfig).toThrow(
      'Invalid CLOUDFLARE_DISCOVERY_MAX_COMPLETION_TOKENS',
    );

    process.env.CLOUDFLARE_DISCOVERY_MAX_COMPLETION_TOKENS = 'not-a-number';
    expect(loadConfig).toThrow(
      'Invalid CLOUDFLARE_DISCOVERY_MAX_COMPLETION_TOKENS',
    );

    process.env.CLOUDFLARE_DISCOVERY_MAX_COMPLETION_TOKENS = '1024.5';
    expect(loadConfig).toThrow(
      'Invalid CLOUDFLARE_DISCOVERY_MAX_COMPLETION_TOKENS',
    );
  });

  it('rejects an unknown discovery extractor provider instead of falling back', () => {
    process.env.DISCOVERY_EXTRACTOR_PROVIDER = 'mystery-provider';

    expect(loadConfig).toThrow('Unsupported DISCOVERY_EXTRACTOR_PROVIDER');
  });

  describe('groundedSearchProvider — no silent Tavily fallback (PRE-B6 spike gate)', () => {
    it('honors an explicit GROUNDED_SEARCH_PROVIDER=serpapi override', () => {
      process.env.GROUNDED_SEARCH_PROVIDER = 'serpapi';

      expect(loadConfig()).toEqual(
        expect.objectContaining({ groundedSearchProvider: 'serpapi' }),
      );
    });

    it('defaults to serpapi (never tavily) when unset but a SERPAPI_API_KEY is present', () => {
      delete process.env.GROUNDED_SEARCH_PROVIDER;
      process.env.SERPAPI_API_KEY = 'test-serpapi-key';

      expect(loadConfig()).toEqual(
        expect.objectContaining({ groundedSearchProvider: 'serpapi' }),
      );
    });

    it('defaults to groq (never tavily) when both GROUNDED_SEARCH_PROVIDER and SERPAPI_API_KEY are unset', () => {
      delete process.env.GROUNDED_SEARCH_PROVIDER;
      delete process.env.SERPAPI_API_KEY;

      expect(loadConfig()).toEqual(
        expect.objectContaining({ groundedSearchProvider: 'groq' }),
      );
    });

    it('only ever selects tavily via an explicit GROUNDED_SEARCH_PROVIDER=tavily -- there is no implicit/fallback path to it', () => {
      process.env.GROUNDED_SEARCH_PROVIDER = 'tavily';

      expect(loadConfig()).toEqual(
        expect.objectContaining({ groundedSearchProvider: 'tavily' }),
      );
    });

    it('honors an explicit GROUNDED_SEARCH_PROVIDER=serper', () => {
      process.env.GROUNDED_SEARCH_PROVIDER = 'serper';
      process.env.SERPAPI_API_KEY = 'test-serpapi-key';

      expect(loadConfig()).toEqual(
        expect.objectContaining({ groundedSearchProvider: 'serper' }),
      );
    });

    it('never selects serper implicitly: a SERPER_API_KEY alone does not change the default', () => {
      delete process.env.GROUNDED_SEARCH_PROVIDER;
      delete process.env.SERPAPI_API_KEY;
      process.env.SERPER_API_KEY = 'test-serper-key';

      expect(loadConfig()).toEqual(
        expect.objectContaining({ groundedSearchProvider: 'groq' }),
      );

      process.env.SERPAPI_API_KEY = 'test-serpapi-key';
      expect(loadConfig()).toEqual(
        expect.objectContaining({ groundedSearchProvider: 'serpapi' }),
      );
    });

    it('rejects an unknown GROUNDED_SEARCH_PROVIDER instead of silently falling back to any provider', () => {
      process.env.GROUNDED_SEARCH_PROVIDER = 'mystery-provider';

      expect(loadConfig).toThrow('Unsupported GROUNDED_SEARCH_PROVIDER');
    });
  });
});
