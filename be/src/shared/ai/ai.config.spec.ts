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

  it('rejects an unknown embedding provider instead of falling back', () => {
    process.env.EMBEDDING_PROVIDER = 'mystery-provider';

    expect(loadConfig).toThrow('Unsupported EMBEDDING_PROVIDER');
  });

  it('rejects vector widths that do not match the pgvector schema', () => {
    process.env.EMBEDDING_PROVIDER = 'bedrock';
    process.env.EMBEDDING_DIMENSIONS = '512';

    expect(loadConfig).toThrow('current pgvector schema requires 256');
  });
});
