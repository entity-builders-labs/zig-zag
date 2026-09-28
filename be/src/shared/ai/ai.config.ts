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
  // Grounded search evidence provider. 'serper' (Google organic SERP via
  // Serper) is only ever selected explicitly — it is NOT a google_ai_mode
  // equivalent, which only 'serpapi' provides.
  groundedSearchProvider?: 'serpapi' | 'serper' | 'groq' | 'tavily' | 'gemini';
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
  // Evidence-only semantic classification (Stage 6 / plan Task B2).
  classification: ClassificationConfig;
  // Web source content retrieval: fetch more of an already-discovered URL's
  // own readable text than the search snippet carried, so an experience that
  // is a sequence of stops can actually be evidenced stop by stop.
  webSourceContent?: WebSourceContentConfig;
}

/**
 * Web source content retrieval configuration. The inline name union mirrors
 * `WebSourceContentProviderName` in the tours capability contract (same
 * established pattern as `groundedSearchProvider` above); an unknown value is
 * rejected by `selectWebSourceContentProvider` at module wiring.
 *
 * Deliberately NOT auto-selected from key presence: unlike
 * `groundedSearchProvider`, a bare `TAVILY_API_KEY` or `CLOUDFLARE_API_TOKEN`
 * never turns this capability on. Retrieval is an extra billed transport per
 * URL, so it exists only when an operator explicitly asked for it. Unset ->
 * `undefined` -> the capability is not registered and evidence-depth gaps
 * stay observable instead of being silently papered over.
 */
export interface WebSourceContentConfig {
  provider?: 'tavily' | 'cloudflare';
  cloudflare: {
    accountId?: string;
    apiToken?: string;
    /** Per-URL transport timeout. Browser Run renders a real page. */
    timeoutMs: number;
    /**
     * Minimum spacing between Browser Run quick-action requests. Live-verified
     * 2026-09-28: this account's plan allows 1 quick-action request per 10s,
     * and a back-to-back second `/markdown` call returned HTTP 429
     * (`errors: [{ code: 2001, message: "Rate limit exceeded" }]`) while the
     * same call after an 11s gap succeeded.
     */
    minRequestIntervalMs: number;
  };
  tavily: {
    apiKey?: string;
    timeoutMs: number;
  };
}

export interface ClassificationConfig {
  provider: 'groq' | 'gemini' | 'ollama';
  groq: { apiKey?: string; model: string };
  gemini: { apiKey?: string; model: string };
  ollama?: { model: string };
}

export type DiscoveryExtractorProvider =
  | 'gemini'
  | 'groq'
  | 'ollama'
  | 'cloudflare';

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
  cloudflare: {
    accountId?: string;
    apiToken?: string;
    model: string;
    timeoutMs: number;
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

  // Select the model only from the variable owned by the active provider.
  // A global model override would let a stale model follow AI_PROVIDER across
  // environments and make provider/model provenance ambiguous.
  let defaultModel: string;
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
      defaultModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      break;
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
  if (
    !['gemini', 'groq', 'ollama', 'cloudflare'].includes(
      discoveryExtractorProvider,
    )
  ) {
    throw new Error(
      `Unsupported DISCOVERY_EXTRACTOR_PROVIDER "${discoveryExtractorProvider}". Expected gemini, groq, ollama or cloudflare.`,
    );
  }

  // Explicit GROUNDED_SEARCH_PROVIDER is authoritative. The implicit default
  // is unchanged (serpapi if its key exists, else groq): a SERPER_API_KEY on
  // its own deliberately does not switch the active provider.
  const groundedSearchProvider = (
    process.env.GROUNDED_SEARCH_PROVIDER ||
    (process.env.SERPAPI_API_KEY ? 'serpapi' : 'groq')
  ).toLowerCase();
  if (
    !['serpapi', 'serper', 'groq', 'tavily', 'gemini'].includes(
      groundedSearchProvider,
    )
  ) {
    throw new Error(
      `Unsupported GROUNDED_SEARCH_PROVIDER "${groundedSearchProvider}". Expected serpapi, serper, groq, tavily, or gemini.`,
    );
  }

  const classificationProvider = process.env.CLASSIFICATION_PROVIDER || 'groq';
  if (!['groq', 'gemini', 'ollama'].includes(classificationProvider)) {
    throw new Error(
      `Unsupported CLASSIFICATION_PROVIDER "${classificationProvider}". Expected groq, gemini or ollama.`,
    );
  }

  // Web source content retrieval. Explicit selection only: unlike
  // GROUNDED_SEARCH_PROVIDER, no key presence ever turns this on (a bare
  // TAVILY_API_KEY/CLOUDFLARE_API_TOKEN must not silently start billing an
  // extra transport call per URL). Unset -> undefined -> the capability is not
  // registered, and an evidence-depth gap stays visible instead of being
  // papered over.
  const webSourceContentProvider = (
    process.env.WEB_SOURCE_CONTENT_PROVIDER || ''
  ).toLowerCase();
  if (
    webSourceContentProvider &&
    !['tavily', 'cloudflare'].includes(webSourceContentProvider)
  ) {
    throw new Error(
      `Unsupported WEB_SOURCE_CONTENT_PROVIDER "${webSourceContentProvider}". Expected tavily or cloudflare.`,
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
      | 'serper'
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
      cloudflare: {
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
        apiToken: process.env.CLOUDFLARE_API_TOKEN,
        model: process.env.CLOUDFLARE_DISCOVERY_MODEL || '@cf/qwen/qwen3.8-27b',
        timeoutMs: process.env.CLOUDFLARE_DISCOVERY_TIMEOUT_MS
          ? parseInt(process.env.CLOUDFLARE_DISCOVERY_TIMEOUT_MS, 10)
          : baseTimeout,
      },
    },
    geminiGroundedSearchModel:
      process.env.GEMINI_GROUNDED_SEARCH_MODEL || 'gemini-3.5-flash',
    classification: {
      provider: classificationProvider as ClassificationConfig['provider'],
      groq: {
        apiKey: process.env.GROQ_API_KEY,
        model: process.env.GROQ_CLASSIFICATION_MODEL || 'qwen/qwen3.8-27b',
      },
      gemini: {
        apiKey: process.env.GEMINI_API_KEY,
        model:
          process.env.GEMINI_CLASSIFICATION_MODEL ||
          process.env.GEMINI_MODEL ||
          'gemini-3.5-flash-lite',
      },
      ollama: {
        model:
          process.env.OLLAMA_CLASSIFICATION_MODEL ||
          process.env.OLLAMA_MODEL ||
          'qwen2.5:7b-instruct',
      },
    },
    webSourceContent: {
      // Explicit selection only — never inferred from a key being present.
      provider: webSourceContentProvider as WebSourceContentConfig['provider'],
      cloudflare: {
        // Browser Run shares the account credentials Workers AI already uses;
        // they are separate Cloudflare products on the same account/token.
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
        apiToken: process.env.CLOUDFLARE_API_TOKEN,
        timeoutMs: process.env.WEB_SOURCE_CONTENT_TIMEOUT_MS
          ? parseInt(process.env.WEB_SOURCE_CONTENT_TIMEOUT_MS, 10)
          : 30000,
        minRequestIntervalMs: process.env.CLOUDFLARE_BROWSER_RUN_MIN_INTERVAL_MS
          ? parseInt(process.env.CLOUDFLARE_BROWSER_RUN_MIN_INTERVAL_MS, 10)
          : 10000,
      },
      tavily: {
        apiKey: process.env.TAVILY_API_KEY,
        timeoutMs: process.env.WEB_SOURCE_CONTENT_TIMEOUT_MS
          ? parseInt(process.env.WEB_SOURCE_CONTENT_TIMEOUT_MS, 10)
          : 15000,
      },
    },
  };
});
