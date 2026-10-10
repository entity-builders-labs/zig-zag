import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Embeddings } from '@langchain/core/embeddings';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import aiConfig from '../ai.config';
import {
  EmbeddingIndexIdentity,
  EmbeddingServiceStatus,
  EXPERIENCE_EMBEDDING_DOCUMENT_VERSION,
} from '../interfaces/embedding-index.interface';

@Injectable()
export class AiEmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(AiEmbeddingService.name);
  private embeddings: Embeddings | null = null;
  private embeddingsDisabled = false;
  private unavailableReason = 'Embedding provider has not initialized';
  private initPromise: Promise<void> | null = null;

  constructor(
    @Inject(aiConfig.KEY)
    private readonly config: ConfigType<typeof aiConfig>,
  ) {}

  async onModuleInit() {
    await this.ensureInitialized();
  }

  async ensureInitialized() {
    if (!this.initPromise) {
      this.initPromise = this.initializeEmbeddings();
    }
    await this.initPromise;
  }

  getEmbeddings(): Embeddings | null {
    if (this.embeddingsDisabled) return null;
    return this.embeddings;
  }

  getIndexIdentity(): EmbeddingIndexIdentity {
    return {
      provider: this.config.embeddingProvider,
      model: this.config.embeddingsModel!,
      dimensions: this.config.embeddingDimensions,
      documentVersion: EXPERIENCE_EMBEDDING_DOCUMENT_VERSION,
    };
  }

  getStatus(): EmbeddingServiceStatus {
    const identity = this.getIndexIdentity();
    return this.isReady()
      ? { status: 'ready', identity }
      : {
          status: 'unavailable',
          identity,
          reason: this.unavailableReason,
        };
  }

  private disable(reason: string): void {
    this.embeddings = null;
    this.embeddingsDisabled = true;
    this.unavailableReason = reason;
  }

  private async initializeEmbeddings() {
    try {
      if (!this.config.enableAi) {
        this.logger.log('AI is disabled. Embeddings initialization skipped.');
        this.disable('AI is disabled');
        return;
      }

      const provider = this.config.embeddingProvider;

      this.logger.log(`Initializing embeddings with provider: ${provider}`);

      if (provider === 'bedrock') {
        const bedrockEmbeddings = this.withRuntimeFailureTracking(
          this.createBedrockEmbeddingsAdapter(
            this.config.awsRegion,
            this.config.embeddingsModel || 'amazon.titan-embed-text-v2:0',
            this.config.embeddingDimensions,
          ),
          'Bedrock',
        );

        try {
          // Fail fast with a clear cause (bad credentials, wrong region,
          // model not enabled for this account, etc.) instead of only
          // finding out on the first real embed call during a crawl.
          await bedrockEmbeddings.embedQuery('connectivity check');
          this.embeddings = bedrockEmbeddings;
          this.logger.log(
            `✓ Bedrock embeddings initialized (model: ${this.config.embeddingsModel}, dimensions: ${this.config.embeddingDimensions})`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to initialize Bedrock embeddings: ${error.message}`,
          );
          this.disable(`Bedrock initialization failed: ${error.message}`);
        }
      } else if (provider === 'openai') {
        if (!this.config.openaiApiKey) {
          this.logger.warn(
            '⚠️  OpenAI API key missing. Embeddings disabled. Set OPENAI_API_KEY to enable.',
          );
          this.disable('OpenAI API key is missing');
          return;
        }

        this.embeddings = this.withRuntimeFailureTracking(
          this.withVectorValidation(
            new OpenAIEmbeddings({
              openAIApiKey: this.config.openaiApiKey,
              modelName: this.config.embeddingsModel,
              dimensions: this.config.embeddingDimensions,
            }),
          ),
          'OpenAI',
        );
        this.logger.log(
          `✓ OpenAI embeddings initialized (model: ${this.config.embeddingsModel}, dimensions: ${this.config.embeddingDimensions})`,
        );
      } else if (provider === 'ollama') {
        const model = this.config.embeddingsModel || 'nomic-embed-text';

        try {
          const workingUrl = await this.findWorkingOllamaUrl(5, '/api/tags');
          this.logger.log(`Using Ollama at ${workingUrl} for embeddings`);

          const ollamaEmbeddings = this.withRuntimeFailureTracking(
            this.createOllamaEmbeddingsAdapter(
              workingUrl,
              model,
              this.config.embeddingDimensions,
            ),
            'Ollama',
          );
          await ollamaEmbeddings.embedQuery('connectivity check');
          this.embeddings = ollamaEmbeddings;
          this.logger.log(`✓ Ollama embeddings initialized (model: ${model})`);
        } catch (error) {
          this.logger.error(
            `Failed to initialize Ollama embeddings: ${error.message}`,
          );
          this.disable(`Ollama initialization failed: ${error.message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to initialize embeddings: ${error.message}`);
      this.disable(`Embedding initialization failed: ${error.message}`);
    }
  }

  private validateVector(vector: unknown, source: string): number[] {
    if (!Array.isArray(vector)) {
      throw new Error(`${source} did not return an embedding vector`);
    }
    if (vector.length !== this.config.embeddingDimensions) {
      throw new Error(
        `${source} returned ${vector.length} dimensions; expected ${this.config.embeddingDimensions}`,
      );
    }
    if (!vector.every((value) => Number.isFinite(value))) {
      throw new Error(`${source} returned a vector with non-finite values`);
    }
    return vector as number[];
  }

  private withVectorValidation(embeddings: Embeddings): Embeddings {
    return {
      embedQuery: async (text: string) =>
        this.validateVector(
          await embeddings.embedQuery(text),
          'Embedding provider',
        ),
      embedDocuments: async (texts: string[]) => {
        const vectors = await embeddings.embedDocuments(texts);
        if (vectors.length !== texts.length) {
          throw new Error(
            `Embedding provider returned ${vectors.length} vectors for ${texts.length} documents`,
          );
        }
        return vectors.map((vector) =>
          this.validateVector(vector, 'Embedding provider'),
        );
      },
    } as Embeddings;
  }

  private withRuntimeFailureTracking(
    embeddings: Embeddings,
    providerLabel: string,
  ): Embeddings {
    const trackFailure = async <T>(operation: () => Promise<T>): Promise<T> => {
      try {
        return await operation();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.disable(`${providerLabel} request failed: ${message}`);
        throw error;
      }
    };

    return {
      embedQuery: (text: string) =>
        trackFailure(() => embeddings.embedQuery(text)),
      embedDocuments: (texts: string[]) =>
        trackFailure(() => embeddings.embedDocuments(texts)),
    } as Embeddings;
  }

  private createBedrockEmbeddingsAdapter(
    region: string,
    model: string,
    dimensions: 256 | 512 | 1024,
  ): Embeddings {
    const client = new BedrockRuntimeClient({ region });

    const embed = async (inputText: string): Promise<number[]> => {
      const response = await client.send(
        new InvokeModelCommand({
          modelId: model,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            inputText,
            dimensions,
            normalize: true,
          }),
        }),
      );
      const payload = JSON.parse(new TextDecoder().decode(response.body));
      return this.validateVector(payload.embedding, 'Bedrock');
    };

    // Titan's InvokeModel API accepts one input per request. A small batch of
    // concurrent requests keeps large crawls from being fully sequential
    // without bursting through the account's RPM quota.
    const BATCH_SIZE = 5;

    return {
      embedDocuments: async (texts: string[]) => {
        const vectors: number[][] = [];
        for (let i = 0; i < texts.length; i += BATCH_SIZE) {
          const batch = texts.slice(i, i + BATCH_SIZE);
          const batchVectors = await Promise.all(
            batch.map((text) => embed(text)),
          );
          vectors.push(...batchVectors);
        }
        return vectors;
      },
      embedQuery: embed,
    } as Embeddings;
  }

  // Helper to get Ollama request headers with authentication if configured
  private getOllamaHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (
      this.config.ollamaApiKey &&
      this.config.ollamaApiKey.trim().length > 0
    ) {
      headers['Authorization'] = `Bearer ${this.config.ollamaApiKey.trim()}`;
    }

    return headers;
  }

  // Helper to find a working Ollama URL by trying multiple endpoints
  private async findWorkingOllamaUrl(
    maxRetries: number = 5,
    endpoint: string = '/api/tags',
  ): Promise<string> {
    const urlsToTry = [
      this.config.ollamaBaseUrl,
      'http://ollama:11434', // Docker service name
      'http://localhost:11434', // Local development
    ].filter((url): url is string => {
      if (!url) return false;
      // Filter out the public website which returns 200 OK for /api/tags but isn't an API
      if (url.includes('ollama.com')) return false;
      return true;
    });

    // Remove duplicates
    const uniqueUrls = [...new Set(urlsToTry)];

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      for (const url of uniqueUrls) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);

          // Ensure protocol
          const fullUrl = url.startsWith('http') ? url : `http://${url}`;

          const resp = await fetch(`${fullUrl}${endpoint}`, {
            method: 'GET',
            signal: controller.signal,
            headers: this.getOllamaHeaders(),
          } as any);
          clearTimeout(timeoutId);

          if (resp.ok) {
            // Validate it's a JSON response and looks like Ollama
            const contentType = resp.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
              return fullUrl;
            }
          }
        } catch {
          continue;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error(
      `Could not find working Ollama instance. Tried: ${uniqueUrls.join(', ')}`,
    );
  }

  // Ollama's `nomic-embed-text` tag resolves to nomic-embed-text-v1.5
  // (confirmed against the Ollama library/HF model card), which is trained
  // with Matryoshka Representation Learning specifically so its output can
  // be shrunk to match our fixed-width pgvector column. Nomic's documented
  // procedure is layer-norm -> truncate -> L2-normalize, in that order —
  // skipping the layer-norm step produces *a* vector but not the one the
  // model was actually trained to produce at reduced width.
  private truncateAndRenormalize(
    vector: number[],
    targetDim: number,
  ): number[] {
    if (vector.length < targetDim) {
      throw new Error(
        `Ollama returned ${vector.length} dimensions; expected at least ${targetDim}`,
      );
    }
    if (vector.length === targetDim) {
      return this.validateVector(vector, 'Ollama');
    }

    const n = vector.length;
    const mean = vector.reduce((sum, v) => sum + v, 0) / n;
    const variance = vector.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
    const layerNormed = vector.map(
      (v) => (v - mean) / Math.sqrt(variance + 1e-5),
    );

    const truncated = layerNormed.slice(0, targetDim);
    const norm = Math.sqrt(truncated.reduce((sum, v) => sum + v * v, 0));
    const result = norm > 0 ? truncated.map((v) => v / norm) : truncated;
    return this.validateVector(result, 'Ollama');
  }

  // Minimal HTTP adapter for Ollama embeddings API
  private createOllamaEmbeddingsAdapter(
    baseUrl: string,
    model: string,
    targetDim: number,
  ): Embeddings {
    const makeRequest = async (url: string, body: any): Promise<Response> => {
      const headers = this.getOllamaHeaders();
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        } as any);

        clearTimeout(timeoutId);
        return response;
      } catch (fetchError: any) {
        throw new Error(
          `Failed to connect to Ollama at ${url}: ${fetchError.message || fetchError}`,
        );
      }
    };

    return {
      embedDocuments: async (texts: string[]) => {
        const vectors: number[][] = [];
        const batchSize = 32;
        for (let offset = 0; offset < texts.length; offset += batchSize) {
          const batch = texts.slice(offset, offset + batchSize);
          const resp = await makeRequest(`${baseUrl}/api/embed`, {
            model,
            input: batch,
          });

          if (!resp.ok) {
            throw new Error(`Ollama embeddings error ${resp.status}`);
          }
          const data = await resp.json();
          if (!Array.isArray(data.embeddings)) {
            throw new Error('Ollama did not return an embeddings array');
          }
          if (data.embeddings.length !== batch.length) {
            throw new Error(
              `Ollama returned ${data.embeddings.length} vectors for ${batch.length} documents`,
            );
          }
          vectors.push(
            ...data.embeddings.map((vector: number[]) =>
              this.truncateAndRenormalize(vector, targetDim),
            ),
          );
        }
        return vectors;
      },
      embedQuery: async (text: string) => {
        const resp = await makeRequest(`${baseUrl}/api/embed`, {
          model,
          input: text,
        });

        if (!resp.ok) {
          throw new Error(`Ollama embeddings error ${resp.status}`);
        }
        const data = await resp.json();
        const vector = data.embeddings?.[0];
        return this.truncateAndRenormalize(vector, targetDim);
      },
    } as any; // Type assertion to match Embeddings interface
  }

  isReady(): boolean {
    return !!this.embeddings && !this.embeddingsDisabled;
  }
}
