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
        },
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

    it('rejects an unknown GROUNDED_SEARCH_PROVIDER instead of silently falling back to any provider', () => {
      process.env.GROUNDED_SEARCH_PROVIDER = 'mystery-provider';

      expect(loadConfig).toThrow('Unsupported GROUNDED_SEARCH_PROVIDER');
    });
  });
});
