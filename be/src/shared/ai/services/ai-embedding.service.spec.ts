import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { OpenAIEmbeddings } from '@langchain/openai';
import { AiEmbeddingService } from './ai-embedding.service';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-bedrock-runtime', () => {
  const actual = jest.requireActual('@aws-sdk/client-bedrock-runtime');
  return {
    ...actual,
    BedrockRuntimeClient: jest.fn().mockImplementation(() => ({
      send: mockSend,
    })),
  };
});

jest.mock('@langchain/openai', () => ({
  OpenAIEmbeddings: jest.fn(),
}));

describe('AiEmbeddingService Bedrock adapter', () => {
  const vector256 = (value: number) => Array(256).fill(value);

  beforeEach(() => {
    mockSend.mockReset();
    jest.mocked(OpenAIEmbeddings).mockClear();
  });

  it('invokes Titan with the configured dimensions and returns its vector', async () => {
    mockSend.mockResolvedValue({
      body: new TextEncoder().encode(
        JSON.stringify({ embedding: vector256(0.1) }),
      ),
    });

    const service = new AiEmbeddingService({
      enableAi: true,
      provider: 'groq',
      defaultModel: 'llama-3.1-8b-instant',
      temperature: 0.7,
      timeout: 60_000,
      embeddingProvider: 'bedrock',
      embeddingsModel: 'amazon.titan-embed-text-v2:0',
      awsRegion: 'us-east-1',
      embeddingDimensions: 256,
      discoveryExtractor: {
        provider: 'gemini',
        gemini: { model: 'gemini-3.5-flash-lite' },
        groq: { model: 'openai/gpt-oss-120b' },
        ollama: {
          baseUrl: 'http://localhost:11434',
          model: 'qwen2.5:7b-instruct',
          timeoutMs: 240000,
        },
      },
      geminiGroundedSearchModel: 'gemini-3.5-flash',
      classification: { groq: { model: 'qwen/qwen3.8-27b' } },
    });

    await service.ensureInitialized();
    const result = await service.getEmbeddings()!.embedQuery('Museos y arte');

    expect(result).toEqual(vector256(0.1));
    // 1 connectivity-check call during init + this explicit call.
    expect(mockSend).toHaveBeenCalledTimes(2);
    const command = mockSend.mock.calls[1][0] as InvokeModelCommand;
    expect(command.input.modelId).toBe('amazon.titan-embed-text-v2:0');
    expect(JSON.parse(command.input.body as string)).toEqual({
      inputText: 'Museos y arte',
      dimensions: 256,
      normalize: true,
    });
  });

  it('does not initialize embeddings when AI is disabled', async () => {
    const service = new AiEmbeddingService({
      enableAi: false,
      provider: 'groq',
      defaultModel: 'llama-3.1-8b-instant',
      temperature: 0.7,
      timeout: 60_000,
      embeddingProvider: 'bedrock',
      embeddingsModel: 'amazon.titan-embed-text-v2:0',
      awsRegion: 'us-east-1',
      embeddingDimensions: 256,
      discoveryExtractor: {
        provider: 'gemini',
        gemini: { model: 'gemini-3.5-flash-lite' },
        groq: { model: 'openai/gpt-oss-120b' },
        ollama: {
          baseUrl: 'http://localhost:11434',
          model: 'qwen2.5:7b-instruct',
          timeoutMs: 240000,
        },
      },
      geminiGroundedSearchModel: 'gemini-3.5-flash',
      classification: { groq: { model: 'qwen/qwen3.8-27b' } },
    });

    await service.ensureInitialized();

    expect(service.getEmbeddings()).toBeNull();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('disables embeddings when the startup connectivity check fails and no OpenAI fallback is configured', async () => {
    mockSend.mockRejectedValue(new Error('AccessDeniedException'));

    const service = new AiEmbeddingService({
      enableAi: true,
      provider: 'groq',
      defaultModel: 'llama-3.1-8b-instant',
      temperature: 0.7,
      timeout: 60_000,
      embeddingProvider: 'bedrock',
      embeddingsModel: 'amazon.titan-embed-text-v2:0',
      awsRegion: 'us-east-1',
      embeddingDimensions: 256,
    } as any);

    await service.ensureInitialized();

    expect(service.getEmbeddings()).toBeNull();
    expect(service.isReady()).toBe(false);
    expect(OpenAIEmbeddings).not.toHaveBeenCalled();
  });

  it('marks Bedrock unavailable after a runtime embedding failure', async () => {
    mockSend
      .mockResolvedValueOnce({
        body: new TextEncoder().encode(
          JSON.stringify({ embedding: vector256(0.1) }),
        ),
      })
      .mockRejectedValueOnce(new Error('ThrottlingException'));

    const service = new AiEmbeddingService({
      enableAi: true,
      provider: 'groq',
      defaultModel: 'llama-3.1-8b-instant',
      temperature: 0.7,
      timeout: 60_000,
      embeddingProvider: 'bedrock',
      embeddingsModel: 'amazon.titan-embed-text-v2:0',
      awsRegion: 'us-east-1',
      embeddingDimensions: 256,
      discoveryExtractor: {
        provider: 'gemini',
        gemini: { model: 'gemini-3.5-flash-lite' },
        groq: { model: 'openai/gpt-oss-120b' },
        ollama: {
          baseUrl: 'http://localhost:11434',
          model: 'qwen2.5:7b-instruct',
          timeoutMs: 240000,
        },
      },
      geminiGroundedSearchModel: 'gemini-3.5-flash',
      classification: { groq: { model: 'qwen/qwen3.8-27b' } },
    });

    await service.ensureInitialized();
    await expect(
      service.getEmbeddings()!.embedQuery('history'),
    ).rejects.toThrow('ThrottlingException');

    expect(service.getStatus()).toMatchObject({
      status: 'unavailable',
      reason: 'Bedrock request failed: ThrottlingException',
    });
  });

  it('does not mix the index with OpenAI when Bedrock fails, even if an OpenAI key is configured', async () => {
    mockSend.mockRejectedValue(new Error('AccessDeniedException'));

    const service = new AiEmbeddingService({
      enableAi: true,
      provider: 'groq',
      defaultModel: 'llama-3.1-8b-instant',
      temperature: 0.7,
      timeout: 60_000,
      embeddingProvider: 'bedrock',
      embeddingsModel: 'amazon.titan-embed-text-v2:0',
      awsRegion: 'us-east-1',
      embeddingDimensions: 256,
      openaiApiKey: 'sk-test',
    } as any);

    await service.ensureInitialized();

    expect(service.getEmbeddings()).toBeNull();
    expect(service.isReady()).toBe(false);
    expect(OpenAIEmbeddings).not.toHaveBeenCalled();
  });

  it('embeds documents in small concurrent batches, preserving input order', async () => {
    mockSend.mockImplementation(async (command: InvokeModelCommand) => {
      const { inputText } = JSON.parse(command.input.body as string);
      return {
        body: new TextEncoder().encode(
          JSON.stringify({ embedding: vector256(inputText.length) }),
        ),
      };
    });

    const service = new AiEmbeddingService({
      enableAi: true,
      provider: 'groq',
      defaultModel: 'llama-3.1-8b-instant',
      temperature: 0.7,
      timeout: 60_000,
      embeddingProvider: 'bedrock',
      embeddingsModel: 'amazon.titan-embed-text-v2:0',
      awsRegion: 'us-east-1',
      embeddingDimensions: 256,
    } as any);

    await service.ensureInitialized();
    const texts = ['a', 'bb', 'ccc', 'dddd', 'eeeee', 'ffffff'];
    const result = await service.getEmbeddings()!.embedDocuments(texts);

    expect(result).toEqual(texts.map((t) => vector256(t.length)));
    // 1 connectivity-check call during init + 1 per text.
    expect(mockSend).toHaveBeenCalledTimes(texts.length + 1);
  });
});

describe('AiEmbeddingService Ollama adapter', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  // Mirrors the layer-norm -> truncate -> L2-normalize procedure Nomic
  // documents for MRL truncation, so the test asserts against the same
  // math the service is expected to perform, not just output shape.
  function expectedTruncation(vector: number[], targetDim: number): number[] {
    const n = vector.length;
    const mean = vector.reduce((sum, v) => sum + v, 0) / n;
    const variance = vector.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
    const layerNormed = vector.map(
      (v) => (v - mean) / Math.sqrt(variance + 1e-5),
    );
    const truncated = layerNormed.slice(0, targetDim);
    const norm = Math.sqrt(truncated.reduce((sum, v) => sum + v * v, 0));
    return truncated.map((v) => v / norm);
  }

  function mockOllamaFetch(fullVector: number[]) {
    return jest.fn(async (_url: string, init?: { method?: string }) => {
      if (init?.method === 'GET') {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({}),
        } as any;
      }
      return {
        ok: true,
        // Ollama's real /api/embed shape: { embeddings: [[...]] }, plural,
        // one vector per input - not a singular `embedding` key.
        json: async () => ({ embeddings: [fullVector] }),
      } as any;
    });
  }

  it('truncates and renormalizes a 768-dim Ollama vector down to the configured dimension', async () => {
    const fullVector = Array.from(
      { length: 768 },
      (_, i) => Math.sin(i) * 0.1 + 0.01,
    );
    global.fetch = mockOllamaFetch(fullVector) as any;

    const service = new AiEmbeddingService({
      enableAi: true,
      provider: 'groq',
      defaultModel: 'llama-3.1-8b-instant',
      temperature: 0.7,
      timeout: 60_000,
      embeddingProvider: 'ollama',
      embeddingsModel: 'nomic-embed-text',
      ollamaBaseUrl: 'http://ollama-test:11434',
      awsRegion: 'us-east-1',
      embeddingDimensions: 256,
    } as any);

    await service.ensureInitialized();
    const result = await service.getEmbeddings()!.embedQuery('museo de arte');

    expect(result).toHaveLength(256);
    const magnitude = Math.sqrt(result.reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 5);

    const expected = expectedTruncation(fullVector, 256);
    result.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 5));
  });

  it('applies the same truncation to embedDocuments', async () => {
    const fullVector = Array.from(
      { length: 768 },
      (_, i) => Math.cos(i) * 0.05,
    );
    global.fetch = mockOllamaFetch(fullVector) as any;

    const service = new AiEmbeddingService({
      enableAi: true,
      provider: 'groq',
      defaultModel: 'llama-3.1-8b-instant',
      temperature: 0.7,
      timeout: 60_000,
      embeddingProvider: 'ollama',
      embeddingsModel: 'nomic-embed-text',
      ollamaBaseUrl: 'http://ollama-test:11434',
      awsRegion: 'us-east-1',
      embeddingDimensions: 256,
    } as any);

    await service.ensureInitialized();
    const [vector] = await service
      .getEmbeddings()!
      .embedDocuments(['parque nacional']);

    expect(vector).toHaveLength(256);
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 5);
  });

  it('uses Ollama array input in bounded batches and preserves document count', async () => {
    const postInputs: Array<string | string[]> = [];
    global.fetch = jest.fn(
      async (_url: string, init?: { method?: string; body?: string }) => {
        if (init?.method === 'GET') {
          return {
            ok: true,
            headers: { get: () => 'application/json' },
          } as any;
        }
        const input = JSON.parse(init?.body ?? '{}').input as string | string[];
        postInputs.push(input);
        const values = Array.isArray(input) ? input : [input];
        return {
          ok: true,
          json: async () => ({
            embeddings: values.map((value, textIndex) =>
              Array.from(
                { length: 768 },
                (_, index) => Math.sin(index * (textIndex + 1)) + value.length,
              ),
            ),
          }),
        } as any;
      },
    ) as any;

    const service = new AiEmbeddingService({
      enableAi: true,
      provider: 'groq',
      defaultModel: 'llama-3.1-8b-instant',
      temperature: 0.7,
      timeout: 60_000,
      embeddingProvider: 'ollama',
      embeddingsModel: 'nomic-embed-text',
      ollamaBaseUrl: 'http://ollama-test:11434',
      awsRegion: 'us-east-1',
      embeddingDimensions: 256,
    } as any);

    await service.ensureInitialized();
    const documents = Array.from({ length: 40 }, (_, index) => `doc-${index}`);
    const vectors = await service.getEmbeddings()!.embedDocuments(documents);

    expect(vectors).toHaveLength(40);
    vectors.forEach((vector) => expect(vector).toHaveLength(256));
    expect(postInputs).toEqual([
      'connectivity check',
      documents.slice(0, 32),
      documents.slice(32),
    ]);
  });

  it('rejects a short vector instead of persisting an incompatible width', async () => {
    const shortVector = [0.6, 0.8];
    global.fetch = mockOllamaFetch(shortVector) as any;

    const service = new AiEmbeddingService({
      enableAi: true,
      provider: 'groq',
      defaultModel: 'llama-3.1-8b-instant',
      temperature: 0.7,
      timeout: 60_000,
      embeddingProvider: 'ollama',
      embeddingsModel: 'nomic-embed-text',
      ollamaBaseUrl: 'http://ollama-test:11434',
      awsRegion: 'us-east-1',
      embeddingDimensions: 256,
    } as any);

    await service.ensureInitialized();

    expect(service.getEmbeddings()).toBeNull();
    expect(service.getStatus()).toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining('expected at least 256'),
    });
  });

  it('does not fall back to OpenAI when the configured Ollama service is unavailable', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockRejectedValue(new Error('connection refused'));
    const service = new AiEmbeddingService({
      enableAi: true,
      provider: 'groq',
      defaultModel: 'llama-3.1-8b-instant',
      temperature: 0.7,
      timeout: 60_000,
      embeddingProvider: 'ollama',
      embeddingsModel: 'nomic-embed-text',
      ollamaBaseUrl: 'http://ollama-test:11434',
      openaiApiKey: 'sk-must-not-be-used',
      awsRegion: 'us-east-1',
      embeddingDimensions: 256,
    } as any);

    const initialization = service.ensureInitialized();
    await jest.runAllTimersAsync();
    await initialization;

    expect(service.getEmbeddings()).toBeNull();
    expect(service.isReady()).toBe(false);
    expect(OpenAIEmbeddings).not.toHaveBeenCalled();
  });

  it('marks Ollama unavailable when an embedding request fails after startup', async () => {
    const fullVector = Array.from({ length: 768 }, (_, i) => Math.sin(i) * 0.1);
    let postCount = 0;
    global.fetch = jest.fn(async (_url: string, init?: { method?: string }) => {
      if (init?.method === 'GET') {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
        } as any;
      }
      postCount += 1;
      if (postCount === 1) {
        return {
          ok: true,
          json: async () => ({ embeddings: [fullVector] }),
        } as any;
      }
      return { ok: false, status: 500 } as any;
    }) as any;

    const service = new AiEmbeddingService({
      enableAi: true,
      provider: 'groq',
      defaultModel: 'llama-3.1-8b-instant',
      temperature: 0.7,
      timeout: 60_000,
      embeddingProvider: 'ollama',
      embeddingsModel: 'nomic-embed-text',
      ollamaBaseUrl: 'http://ollama-test:11434',
      openaiApiKey: 'sk-must-not-be-used',
      awsRegion: 'us-east-1',
      embeddingDimensions: 256,
    } as any);

    await service.ensureInitialized();
    await expect(
      service.getEmbeddings()!.embedQuery('history'),
    ).rejects.toThrow('Ollama embeddings error 500');

    expect(service.getStatus()).toMatchObject({
      status: 'unavailable',
      reason: 'Ollama request failed: Ollama embeddings error 500',
    });
    expect(OpenAIEmbeddings).not.toHaveBeenCalled();
  });
});
