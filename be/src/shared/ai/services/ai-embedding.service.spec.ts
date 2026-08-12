import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
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

describe('AiEmbeddingService Bedrock adapter', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('invokes Titan with the configured dimensions and returns its vector', async () => {
    mockSend.mockResolvedValue({
      body: new TextEncoder().encode(JSON.stringify({ embedding: [0.1, 0.2] })),
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
    });

    await service.ensureInitialized();
    const result = await service.getEmbeddings()!.embedQuery('Museos y arte');

    expect(result).toEqual([0.1, 0.2]);
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
  });

  it('falls back to OpenAI when the Bedrock startup check fails and an OpenAI key is configured', async () => {
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

    expect(service.getEmbeddings()).not.toBeNull();
    expect(service.isReady()).toBe(true);
  });

  it('embeds documents in small concurrent batches, preserving input order', async () => {
    mockSend.mockImplementation(async (command: InvokeModelCommand) => {
      const { inputText } = JSON.parse(command.input.body as string);
      return {
        body: new TextEncoder().encode(
          JSON.stringify({ embedding: [inputText.length] }),
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

    expect(result).toEqual(texts.map((t) => [t.length]));
    // 1 connectivity-check call during init + 1 per text.
    expect(mockSend).toHaveBeenCalledTimes(texts.length + 1);
  });
});
