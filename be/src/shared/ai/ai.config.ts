import { registerAs } from '@nestjs/config';
import { EmbeddingProvider } from './interfaces/embedding-index.interface';

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
  // Grounded search evidence provider ('serpapi' | 'groq' | 'tavily' | 'gemini')
  groundedSearchProvider?: 'serpapi' | 'groq' | 'tavily' | 'gemini';
  // SerpApi (grounded search evidence provider)
  serpApiKey?: string;
  // Tavily (grounded search evidence provider)
  tavilyApiKey?: string;
  // Ollama
  ollamaBaseUrl?: string;
  ollamaApiKey?: string;
  ollamaNumCtx?: number;
  ollamaTimeout?: number; // Separate timeout for Ollama (defaults to 4x base timeout)
  // Embeddings
  embeddingsModel?: string;
  embeddingProvider: EmbeddingProvider;
  awsRegion: string;
  embeddingDimensions: 256;
  // Discovery extraction (ExperienceCandidate extraction from grounded evidence)
  discoveryExtractor: DiscoveryExtractorConfig;
  // Gemini's own google_search grounding, when groundedSearchProvider is 'gemini'
  geminiGroundedSearchModel: string;
  // Evidence-only semantic classification (Stage 6 / plan Task B2). v1 is
  // Groq-only per the canonical spec -- no provider selector like
  // discoveryExtractor's, since a cross-provider fallback is explicitly out
  // of scope until the existing AI abstraction is asked to support it.
  classification: ClassificationConfig;
}

export interface ClassificationConfig {
  groq: { apiKey?: string; model: string };
}

export type DiscoveryExtractorProvider = 'gemini' | 'groq' | 'ollama';

export interface DiscoveryExtractorConfig {
  provider: DiscoveryExtractorProvider;
  gemini: { apiKey?: string; model: string };
  groq: { apiKey?: string; model: string };
  ollama: {
    baseUrl: string;
    apiKey?: string;
    model: string;
    timeoutMs: number;
    numCtx?: number;
  };
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

  const configuredEmbeddingProvider =
    process.env.EMBEDDING_PROVIDER ||
    (process.env.NODE_ENV === 'production' ? 'bedrock' : 'ollama');
  if (!['openai', 'ollama', 'bedrock'].includes(configuredEmbeddingProvider)) {
    throw new Error(
      `Unsupported EMBEDDING_PROVIDER "${configuredEmbeddingProvider}". Expected openai, ollama, or bedrock.`,
    );
  }
  const embeddingProvider = configuredEmbeddingProvider as EmbeddingProvider;
  const configuredEmbeddingDimensions = Number(
    process.env.EMBEDDING_DIMENSIONS || 256,
  );
  if (configuredEmbeddingDimensions !== 256) {
    throw new Error(
      `Unsupported EMBEDDING_DIMENSIONS "${configuredEmbeddingDimensions}". ` +
        'The current pgvector schema requires 256 dimensions; changing it requires a coordinated schema migration and full index rebuild.',
    );
  }
  const defaultEmbeddingModel =
    embeddingProvider === 'bedrock'
      ? 'amazon.titan-embed-text-v2:0'
      : embeddingProvider === 'openai'
        ? 'text-embedding-3-small'
        : 'nomic-embed-text';

  const discoveryExtractorProvider =
    process.env.DISCOVERY_EXTRACTOR_PROVIDER || 'gemini';
  if (!['gemini', 'groq', 'ollama'].includes(discoveryExtractorProvider)) {
    throw new Error(
      `Unsupported DISCOVERY_EXTRACTOR_PROVIDER "${discoveryExtractorProvider}". Expected gemini, groq or ollama.`,
    );
  }

  const groundedSearchProvider = (
    process.env.GROUNDED_SEARCH_PROVIDER ||
    (process.env.SERPAPI_API_KEY ? 'serpapi' : 'groq')
  ).toLowerCase();
  if (
    !['serpapi', 'groq', 'tavily', 'gemini'].includes(groundedSearchProvider)
  ) {
    throw new Error(
      `Unsupported GROUNDED_SEARCH_PROVIDER "${groundedSearchProvider}". Expected serpapi, groq, tavily, or gemini.`,
    );
  }

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
    serpApiKey: process.env.SERPAPI_API_KEY,
    tavilyApiKey: process.env.TAVILY_API_KEY,
    groundedSearchProvider: groundedSearchProvider as
      | 'serpapi'
      | 'groq'
      | 'tavily'
      | 'gemini',
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
    embeddingsModel: process.env.EMBEDDINGS_MODEL || defaultEmbeddingModel,
    embeddingProvider,
    awsRegion: process.env.AWS_REGION || 'us-east-1',
    embeddingDimensions: 256,
    discoveryExtractor: {
      provider: discoveryExtractorProvider as DiscoveryExtractorProvider,
      gemini: {
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_DISCOVERY_MODEL || 'gemini-3.5-flash-lite',
      },
      groq: {
        apiKey: process.env.GROQ_API_KEY,
        model: process.env.GROQ_DISCOVERY_MODEL || 'qwen/qwen3.8-27b',
      },
      ollama: {
        // Reuse the existing Ollama connection settings — a remote host is
        // allowed (a future self-hosted deployment), localhost is the default.
        baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
        apiKey: process.env.OLLAMA_API_KEY,
        model:
          process.env.OLLAMA_DISCOVERY_MODEL ||
          process.env.OLLAMA_MODEL ||
          'qwen2.5:7b-instruct',
        timeoutMs: process.env.OLLAMA_DISCOVERY_TIMEOUT_MS
          ? parseInt(process.env.OLLAMA_DISCOVERY_TIMEOUT_MS, 10)
          : process.env.OLLAMA_TIMEOUT
            ? parseInt(process.env.OLLAMA_TIMEOUT, 10)
            : baseTimeout * 4,
        numCtx: process.env.OLLAMA_NUM_CTX
          ? parseInt(process.env.OLLAMA_NUM_CTX, 10)
          : undefined,
      },
    },
    geminiGroundedSearchModel:
      process.env.GEMINI_GROUNDED_SEARCH_MODEL || 'gemini-3.5-flash',
    classification: {
      groq: {
        apiKey: process.env.GROQ_API_KEY,
        model: process.env.GROQ_CLASSIFICATION_MODEL || 'qwen/qwen3.8-27b',
      },
    },
  };
});
