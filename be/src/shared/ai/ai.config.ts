import { registerAs } from '@nestjs/config';

export interface AiConfig {
  // General
  enableAi: boolean;
  provider: 'openai' | 'groq' | 'ollama';
  defaultModel: string;
  temperature: number;
  timeout: number;
  // OpenAI
  openaiApiKey?: string;
  // Groq
  groqApiKey?: string;
  // Ollama
  ollamaBaseUrl?: string;
  ollamaApiKey?: string;
  ollamaNumCtx?: number;
  ollamaTimeout?: number; // Separate timeout for Ollama (defaults to 4x base timeout)
  // Embeddings
  embeddingsModel?: string;
  embeddingProvider: 'openai' | 'ollama' | 'bedrock';
  awsRegion: string;
  embeddingDimensions: 256 | 512 | 1024;
}

// Helper to detect if a model is an embedding model
function isEmbeddingModel(model: string): boolean {
  const embeddingModelPatterns = [
    'embed',
    'nomic-embed',
    'bge-',
    'e5-',
    'multilingual-e5',
  ];
  return embeddingModelPatterns.some((pattern) =>
    model.toLowerCase().includes(pattern),
  );
}

export default registerAs('ai', (): AiConfig => {
  const provider = (process.env.AI_PROVIDER as any) || 'openai';

  // Get the AI_MODEL from env or use defaults
  let defaultModel =
    process.env.AI_MODEL ||
    (provider === 'openai'
      ? process.env.OPENAI_DEFAULT_MODEL || 'gpt-3.5-turbo'
      : 'llama3.2');

  // Validate that AI_MODEL is not an embedding model
  // If it is, use a default chat model and log a warning
  if (process.env.AI_MODEL && isEmbeddingModel(process.env.AI_MODEL)) {
    const fallbackModel =
      provider === 'openai'
        ? process.env.OPENAI_DEFAULT_MODEL || 'gpt-3.5-turbo'
        : 'llama3.2';

    console.warn(
      `⚠️  Configuration warning: AI_MODEL is set to "${process.env.AI_MODEL}" which is an embedding model. ` +
        `Using "${fallbackModel}" for chat/generation instead. ` +
        `Please set AI_MODEL to a chat model (e.g., "llama3.2", "gpt-3.5-turbo") and use EMBEDDINGS_MODEL for embedding models.`,
    );
    defaultModel = fallbackModel;
  }

  const baseTimeout = process.env.OPENAI_TIMEOUT
    ? parseInt(process.env.OPENAI_TIMEOUT, 10)
    : 60000;

  return {
    enableAi: process.env.ENABLE_AI !== 'false',
    provider,
    defaultModel,
    temperature: process.env.OPENAI_TEMPERATURE
      ? parseFloat(process.env.OPENAI_TEMPERATURE)
      : 0.7,
    timeout: baseTimeout,
    openaiApiKey: process.env.OPENAI_API_KEY,
    groqApiKey: process.env.GROQ_API_KEY,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
    ollamaApiKey: process.env.OLLAMA_API_KEY,
    ollamaNumCtx: process.env.OLLAMA_NUM_CTX
      ? parseInt(process.env.OLLAMA_NUM_CTX, 10)
      : undefined,
    // Ollama needs more time for complex prompts (default 4x base timeout = 240s)
    // Can be overridden with OLLAMA_TIMEOUT env var
    ollamaTimeout: process.env.OLLAMA_TIMEOUT
      ? parseInt(process.env.OLLAMA_TIMEOUT, 10)
      : baseTimeout * 4,
    embeddingsModel:
      process.env.EMBEDDINGS_MODEL ||
      (process.env.EMBEDDING_PROVIDER === 'bedrock'
        ? 'amazon.titan-embed-text-v2:0'
        : 'nomic-embed-text'),
    embeddingProvider:
      (process.env.EMBEDDING_PROVIDER as 'openai' | 'ollama' | 'bedrock') ||
      (process.env.NODE_ENV === 'production' ? 'openai' : 'ollama'),
    awsRegion: process.env.AWS_REGION || 'us-east-1',
    embeddingDimensions: ([256, 512, 1024].includes(
      Number(process.env.EMBEDDING_DIMENSIONS),
    )
      ? Number(process.env.EMBEDDING_DIMENSIONS)
      : 256) as 256 | 512 | 1024,
  };
});
