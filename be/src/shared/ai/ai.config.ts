import { registerAs } from '@nestjs/config';

export interface AiConfig {
  // General
  enableAi: boolean;
  provider: 'openai' | 'groq' | 'ollama' | 'gemini';
  defaultModel: string;
  temperature: number;
  timeout: number;
  // OpenAI
  openaiApiKey?: string;
  // Groq
  groqApiKey?: string;
  // Gemini
  geminiApiKey?: string;
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
  const provider = (process.env.AI_PROVIDER as any) || 'gemini';

  // Resolve model per provider with fallback to AI_MODEL override
  let defaultModel = process.env.AI_MODEL;
  if (!defaultModel) {
    switch (provider) {
      case 'gemini':
        defaultModel = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
        break;
      case 'groq':
        defaultModel = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
        break;
      case 'ollama':
        defaultModel = process.env.OLLAMA_MODEL || 'llama3.2';
        break;
      case 'openai':
      default:
        defaultModel =
          process.env.OPENAI_MODEL ||
          process.env.OPENAI_DEFAULT_MODEL ||
          'gpt-4o-mini';
        break;
    }
  }

  // Validate that defaultModel is not an embedding model
  if (defaultModel && isEmbeddingModel(defaultModel)) {
    const fallbackModel =
      provider === 'gemini'
        ? 'gemini-3.6-flash'
        : provider === 'groq'
          ? 'openai/gpt-oss-20b'
          : provider === 'ollama'
            ? 'llama3.2'
            : 'gpt-4o-mini';

    console.warn(
      `⚠️  Configuration warning: model "${defaultModel}" is an embedding model. ` +
        `Using "${fallbackModel}" for chat/generation instead. ` +
        `Please set appropriate chat model and use EMBEDDINGS_MODEL for embeddings.`,
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
    geminiApiKey: process.env.GEMINI_API_KEY,
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
