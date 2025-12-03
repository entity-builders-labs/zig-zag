import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { OpenAI, ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { ChatOllama } from '@langchain/ollama';
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  PromptTemplate,
  SystemMessagePromptTemplate,
} from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableSequence } from '@langchain/core/runnables';
import { BaseLanguageModel } from '@langchain/core/language_models/base';
import { Document } from '@langchain/core/documents';
import aiConfig from './ai.config';
import { Activity } from '@prisma/client';
import { Chroma } from '@langchain/community/vectorstores/chroma';
import { Where, ChromaClient } from 'chromadb';
import { PrismaService } from '../../core/database/prisma.service';
import { AiCacheService } from './services/ai-cache.service';

// At the top of the file, add interface
interface ActivityMetadata {
  timeOfDayPreference?: string[];
  physicalIntensity?: number;
  enhancedDescription?: string;
  targetAudience?: string;
  bestTimeToVisit?: string;
  tags?: string[];
  complementaryActivities?: {
    before?: string[];
    after?: string[];
  };
  seasonalityScore?: any;
  combinationScore?: any;
}

@Injectable()
export class LangChainService {
  private readonly logger = new Logger(LangChainService.name);
  private chatModel: any;
  private completionModel: any;

  private embeddings: any;
  private vectorStore: Chroma | null = null; // optional if embeddings disabled
  private embeddingFailureCount = 0;
  private readonly MAX_EMBEDDING_FAILURES = 3; // Disable after 3 consecutive failures
  private embeddingsDisabled = false;

  constructor(
    @Inject(aiConfig.KEY)
    private readonly config: ConfigType<typeof aiConfig>,
    private readonly prisma: PrismaService,
    private readonly aiCache: AiCacheService,
  ) {
    // Initialize models
    this.initializeModels();
    // Initialize vector store asynchronously (don't block constructor)
    // Errors will be logged but won't prevent service startup
    this.initializeVectorStore().catch((error) => {
      this.logger.error(
        'Failed to initialize vector store during startup',
        error,
      );
    });
  }

  // Helper to detect if we're running in production (Fly.io)
  private isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  // Helper to create Chroma client configuration
  private async getChromaConfig(): Promise<any> {
    const collectionName = this.config.chromaCollectionName || 'activities';

    // Check if Chroma Cloud credentials are provided
    const isChromaCloud =
      this.config.chromaApiKey &&
      this.config.chromaTenant &&
      this.config.chromaDatabase;

    if (isChromaCloud) {
      // Use Chroma Cloud with authentication
      this.logger.log(
        `Configuring Chroma Cloud (tenant: ${this.config.chromaTenant}, database: ${this.config.chromaDatabase})...`,
      );

      // Debug log for troubleshooting connection issues
      this.logger.debug(
        `Chroma Config: URL=${this.config.chromaUrl}, Tenant=${this.config.chromaTenant}, DB=${this.config.chromaDatabase}, APIKey present=${!!this.config.chromaApiKey}`,
      );

      // Create Chroma Cloud client with authentication headers
      // We use ChromaClient directly instead of CloudClient to allow for custom URLs (e.g. local with auth)
      // CloudClient forces specific host/port logic that ignores the full URL
      let chromaUrl = this.config.chromaUrl || 'https://api.trychroma.com';
      // Ensure protocol is present
      if (
        !chromaUrl.startsWith('http://') &&
        !chromaUrl.startsWith('https://')
      ) {
        chromaUrl = `https://${chromaUrl}`;
      }

      this.logger.log(`Connecting to Chroma Cloud at ${chromaUrl}`);
      // Cast to any to bypass type restriction if the library types are outdated or strict
      // We need to ensure the header is sent as 'X-Chroma-Token', not 'X_CHROMA_TOKEN'
      const tokenHeaderType: any = 'X-Chroma-Token';

      const chromaClient = new ChromaClient({
        path: chromaUrl,
        auth: {
          provider: 'token',
          credentials: this.config.chromaApiKey!,
          tokenHeaderType,
        },
        tenant: this.config.chromaTenant!,
        database: this.config.chromaDatabase!,
      });

      // Test client connection before passing to LangChain
      try {
        await chromaClient.heartbeat();
        this.logger.debug(
          '✓ Chroma Cloud client connection verified (heartbeat)',
        );
      } catch (hbError: any) {
        this.logger.error(
          `⚠️  Chroma Cloud client connection failed during config: ${hbError.message}`,
          hbError.stack,
        );
      }

      return {
        collectionName,
        index: chromaClient, // LangChain expects 'index' not 'client' for pre-configured client
        url: chromaUrl,
        // Pass explicit collection creation options to work around LangChain's limitations
        // LangChain's Chroma wrapper sometimes struggles with authenticated cloud instances
        // We'll rely on the client's global auth configuration
        collectionMetadata: {
          'hnsw:space': 'cosine',
        },
        // Also pass clientParams in case LangChain needs to create a new client internally
        // This ensures tenant/database are preserved
        clientParams: {
          auth: {
            provider: 'token',
            credentials: this.config.chromaApiKey!,
            tokenHeaderType: 'X-Chroma-Token' as any,
          },
          tenant: this.config.chromaTenant!,
          database: this.config.chromaDatabase!,
        },
      };
    } else if (this.config.chromaUrl) {
      // Use remote Chroma instance (self-hosted or Fly.io)
      let url = this.config.chromaUrl;
      // Ensure protocol is present
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `http://${url}`; // Default to http for self-hosted
      }

      this.logger.log(`Configuring Chroma at ${url}...`);
      return {
        collectionName,
        url: url,
      };
    } else {
      // Use local Chroma instance
      // In Docker, use service name 'chroma'. Locally, use 'localhost'.
      const isDocker = process.env.DOCKER_CONTAINER === 'true';
      // Port 8000 is standard for Chroma, but Docker Compose maps it to 8001 on host
      const defaultUrl = isDocker
        ? 'http://chroma:8000'
        : 'http://localhost:8001';

      this.logger.log(
        `Configuring local Chroma instance (defaulting to ${defaultUrl})...`,
      );
      return {
        collectionName,
        url: defaultUrl,
      };
    }
  }

  // Helper to get Ollama request headers with authentication if configured
  private getOllamaHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add Bearer token auth header if API key is configured
    // (Ollama Cloud requires API key, local instances typically don't)
    if (
      this.config.ollamaApiKey &&
      this.config.ollamaApiKey.trim().length > 0
    ) {
      headers['Authorization'] = `Bearer ${this.config.ollamaApiKey.trim()}`;
    }

    return headers;
  }

  // Helper to get Ollama base URL
  private getOllamaBaseUrl(): string {
    return this.config.ollamaBaseUrl || 'http://localhost:11434';
  }

  // Helper to find a working Ollama URL by trying multiple endpoints
  private async findWorkingOllamaUrl(
    maxRetries: number = 10,
    endpoint: string = '/api/tags',
  ): Promise<string> {
    const urlsToTry = [
      this.config.ollamaBaseUrl,
      'http://ollama:11434', // Docker service name
      'http://localhost:11434', // Local development
    ].filter((url): url is string => url !== undefined);

    // Remove duplicates
    const uniqueUrls = [...new Set(urlsToTry)];

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      for (const url of uniqueUrls) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          const resp = await fetch(`${url}${endpoint}`, {
            method: 'GET',
            signal: controller.signal,
            headers: this.getOllamaHeaders(),
          } as any);
          clearTimeout(timeoutId);

          if (resp.ok) {
            this.logger.debug(`Found working Ollama URL: ${url}`);
            return url;
          }
        } catch {
          // Continue to next URL
          continue;
        }
      }
      // Wait a bit before retrying
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error(
      `Could not find working Ollama instance after ${maxRetries} attempts. ` +
        `Tried URLs: ${uniqueUrls.join(', ')}. ` +
        `Please ensure Ollama is running and accessible.`,
    );
  }

  // Minimal HTTP adapter for Ollama embeddings API
  private createOllamaEmbeddingsAdapter(baseUrl: string, model: string) {
    const makeRequest = async (
      url: string,
      body: any,
      withAuth: boolean,
    ): Promise<Response> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (
        withAuth &&
        this.config.ollamaApiKey &&
        this.config.ollamaApiKey.trim().length > 0
      ) {
        headers['Authorization'] = `Bearer ${this.config.ollamaApiKey.trim()}`;
      }
      try {
        // Add timeout to fetch to avoid hanging
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        } as any);

        clearTimeout(timeoutId);
        return response;
      } catch (fetchError: any) {
        // Handle network errors (fetch failed)
        // Don't log error here - let findWorkingUrl handle retries and logging
        // This prevents noise when trying multiple URLs
        throw new Error(
          `Failed to connect to Ollama at ${url}: ${fetchError.message || fetchError}`,
        );
      }
    };

    // In production, use configured URL directly if provided
    // Otherwise, try local instance for embeddings (Ollama Cloud doesn't support /api/embed)
    const configuredUrl =
      baseUrl || this.config.ollamaBaseUrl || 'http://localhost:11434';
    const isConfiguredRemote = configuredUrl.startsWith('https://');
    const isProd = this.isProduction();

    // In production, use configured URL directly (even if remote)
    // In development, warn if user configured a remote instance for embeddings
    if (isConfiguredRemote && !isProd) {
      this.logger.warn(
        `⚠️  Ollama embeddings: Detected remote Ollama configuration (${configuredUrl}), ` +
          `but embeddings require a local Ollama instance. ` +
          `Will try Docker service name (ollama:11434) first, then localhost. ` +
          `Please ensure Ollama is running. ` +
          `For chat/completion, you can still use Ollama Cloud via OLLAMA_BASE_URL.`,
      );
    }

    // Helper to make embedding request
    const makeEmbeddingRequest = async (
      url: string,
      body: any,
    ): Promise<Response> => {
      // In production, use auth if configured; in development, local instances don't need auth
      const needsAuth =
        isProd && this.config.ollamaApiKey && isConfiguredRemote;
      let resp: Response;
      try {
        resp = await makeRequest(url, body, needsAuth);
      } catch {
        // If makeRequest throws (network error), try to find working URL
        const workingUrl = await this.getOllamaBaseUrl();
        resp = await makeRequest(`${workingUrl}/api/embed`, body, needsAuth);
      }

      // If we get an error, provide helpful local instance troubleshooting
      if (!resp.ok) {
        const clonedResp = resp.clone();
        const errorText = await clonedResp.text().catch(() => 'Unknown error');

        if (resp.status === 401) {
          this.logger.error(
            `Ollama embeddings: 401 error from local instance (${url}). ` +
              `This is unexpected for local Ollama. Error: ${errorText}. ` +
              `Please verify: 1) Ollama is running, 2) Ollama is accessible at ${url}, ` +
              `3) No authentication is required (local Ollama doesn't use auth).`,
          );
        } else if (resp.status === 0 || resp.status >= 500) {
          this.logger.error(
            `Ollama embeddings: Connection error to local instance (${url}). ` +
              `Error: ${errorText}. ` +
              `Please verify: 1) Ollama is installed and running, ` +
              `2) Run "ollama serve" to start the server (or ensure Docker service is running), ` +
              `3) Check that Ollama is accessible at ${url}.`,
          );
        }
      }

      return resp;
    };

    // Helper function to find working URL (local to this adapter)
    const findWorkingUrl = async (): Promise<string> => {
      return await this.findWorkingOllamaUrl(10, '/api/tags');
    };

    return {
      embedDocuments: async (texts: string[]) => {
        const vectors: number[][] = [];
        let workingUrl: string;

        try {
          workingUrl = await findWorkingUrl();
        } catch (error: any) {
          // If we can't connect to Ollama, disable embeddings gracefully
          this.logger.error(
            `Failed to connect to Ollama for embeddings: ${error.message}. ` +
              `Embeddings will be disabled. To enable: ensure Ollama is running (docker-compose up -d ollama)`,
          );
          this.embeddingsDisabled = true;
          throw new Error(
            `Ollama not available for embeddings. Please ensure Ollama is running: docker-compose up -d ollama`,
          );
        }

        for (const text of texts) {
          const resp = await makeEmbeddingRequest(`${workingUrl}/api/embed`, {
            model,
            input: text,
          });

          if (!resp.ok) {
            const errorText = await resp.text().catch(() => 'Unknown error');
            let errorMessage = `Ollama embeddings error ${resp.status} (local instance at ${workingUrl}): ${errorText}.`;

            if (resp.status === 401) {
              errorMessage +=
                `\n⚠️  Unexpected 401 from local Ollama instance. ` +
                `Local Ollama should not require authentication. ` +
                `Please verify: 1) Ollama is running, ` +
                `2) No authentication is configured, ` +
                `3) The instance at ${workingUrl} is accessible. ` +
                `If running in Docker, ensure the Ollama service is running in docker-compose.`;
            } else if (resp.status === 0 || resp.status >= 500) {
              errorMessage +=
                `\n⚠️  Connection error to local Ollama instance. ` +
                `Please verify: 1) Ollama is installed and running (run "ollama serve" or ensure Docker service is running), ` +
                `2) Ollama is accessible at ${workingUrl}, ` +
                `3) The embedding model "nomic-embed-text" is installed (run "ollama pull nomic-embed-text" or "docker-compose exec ollama ollama pull nomic-embed-text").`;
            }

            throw new Error(errorMessage);
          }
          const data = await resp.json();
          vectors.push(data.embedding || data.data?.[0]?.embedding);
        }
        return vectors;
      },
      embedQuery: async (text: string) => {
        let workingUrl: string;

        try {
          workingUrl = await findWorkingUrl();
        } catch (error: any) {
          // If we can't connect to Ollama, disable embeddings gracefully
          this.logger.error(
            `Failed to connect to Ollama for embeddings: ${error.message}. ` +
              `Embeddings will be disabled. To enable: ensure Ollama is running (docker-compose up -d ollama)`,
          );
          this.embeddingsDisabled = true;
          throw new Error(
            `Ollama not available for embeddings. Please ensure Ollama is running: docker-compose up -d ollama`,
          );
        }

        const resp = await makeEmbeddingRequest(`${workingUrl}/api/embed`, {
          model,
          prompt: text,
        });

        if (!resp.ok) {
          const errorText = await resp.text().catch(() => 'Unknown error');
          let errorMessage = `Ollama embeddings error ${resp.status} (local instance at ${workingUrl}): ${errorText}.`;

          if (resp.status === 401) {
            errorMessage +=
              `\n⚠️  Unexpected 401 from local Ollama instance. ` +
              `Local Ollama should not require authentication. ` +
              `Please verify: 1) Ollama is running, ` +
              `2) No authentication is configured, ` +
              `3) The instance at ${workingUrl} is accessible. ` +
              `If running in Docker, ensure the Ollama service is running in docker-compose.`;
          } else if (resp.status === 0 || resp.status >= 500) {
            errorMessage +=
              `\n⚠️  Connection error to local Ollama instance. ` +
              `Please verify: 1) Ollama is installed and running (run "ollama serve" or ensure Docker service is running), ` +
              `2) Ollama is accessible at ${workingUrl}, ` +
              `3) The embedding model "nomic-embed-text" is installed (run "ollama pull nomic-embed-text" or "docker-compose exec ollama ollama pull nomic-embed-text").`;
          }

          throw new Error(errorMessage);
        }
        const data = await resp.json();
        return data.embedding || data.data?.[0]?.embedding;
      },
    } as any;
  }

  async initializeVectorStore() {
    try {
      const provider = this.config.provider;

      if (provider === 'ollama') {
        // Detect if using Ollama Cloud (remote URL with https)
        // Ollama Cloud doesn't support /api/embed endpoint, only chat/completions
        const isOllamaCloud =
          this.config.ollamaBaseUrl?.startsWith('https://') ||
          this.config.ollamaBaseUrl?.includes('ollama.com') ||
          this.config.ollamaBaseUrl?.includes('api.ollama.com');

        // When using Chroma Cloud, prefer OpenAI embeddings if available
        // This is more reliable than Ollama embeddings for cloud deployments
        const isChromaCloud =
          this.config.chromaApiKey &&
          this.config.chromaTenant &&
          this.config.chromaDatabase;

        // Ollama Cloud doesn't support embeddings - use OpenAI if available
        if (isOllamaCloud && this.config.openaiApiKey) {
          this.logger.log(
            `⚠️  Ollama Cloud detected. Ollama Cloud doesn't support embeddings endpoint (/api/embed). ` +
              `Using OpenAI embeddings as fallback (Ollama Cloud will be used for chat/completions only)...`,
          );

          this.embeddings = new OpenAIEmbeddings({
            openAIApiKey: this.config.openaiApiKey,
          });

          // Initialize Chroma with timeout
          const chromaConfig = await this.getChromaConfig();
          const chromaLocation = this.config.chromaApiKey
            ? `Chroma Cloud (${this.config.chromaTenant}/${this.config.chromaDatabase})`
            : this.config.chromaUrl
              ? `at ${this.config.chromaUrl}`
              : '(local)';

          this.logger.log(
            `Initializing Chroma vector store ${chromaLocation} with OpenAI embeddings...`,
          );
          const initStartTime = Date.now();

          const initPromise = Chroma.fromDocuments(
            [],
            this.embeddings,
            chromaConfig as any,
          );

          const CHROMA_TIMEOUT = 120000; // 120 seconds
          const timeoutPromise: Promise<never> = new Promise((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `Chroma initialization timeout (${CHROMA_TIMEOUT / 1000}s)`,
                  ),
                ),
              CHROMA_TIMEOUT,
            ),
          );

          try {
            this.vectorStore = await Promise.race([
              initPromise,
              timeoutPromise,
            ]);

            const initTime = Date.now() - initStartTime;
            this.logger.log(
              `✓ Chroma initialized with OpenAI embeddings in ${initTime}ms.`,
            );
            return;
          } catch (initError: any) {
            if (
              initError?.message?.includes('Chroma initialization timeout') ||
              initError?.message?.includes('Chroma') ||
              initError?.message?.includes('ECONNREFUSED') ||
              initError?.message?.includes('ENOTFOUND') ||
              initError?.message?.includes('ETIMEDOUT') ||
              initError?.message?.includes('Unauthorized') ||
              initError?.message?.includes('401') ||
              initError?.message?.includes('default_tenant')
            ) {
              this.logger.warn(
                `⚠️  Chroma vector store initialization failed: ${initError.message}. ` +
                  `The application will continue to work, but semantic search features will be unavailable. ` +
                  `To enable semantic search: ensure Chroma is running and accessible and restart the backend.`,
              );
              this.embeddings = null;
              this.vectorStore = null;
              this.embeddingsDisabled = true;
              return;
            }
            throw initError;
          }
        }

        // Ollama Cloud but no OpenAI key - disable embeddings gracefully
        if (isOllamaCloud && !this.config.openaiApiKey) {
          this.logger.warn(
            `⚠️  Ollama Cloud detected, but OpenAI API key is not configured. ` +
              `Ollama Cloud doesn't support embeddings endpoint (/api/embed). ` +
              `Embeddings will be disabled. ` +
              `To enable embeddings: configure OPENAI_API_KEY in your .env file, ` +
              `or use a local Ollama instance (docker-compose up -d ollama) for embeddings.`,
          );
          this.embeddings = null;
          this.vectorStore = null;
          this.embeddingsDisabled = true;
          return;
        }

        // When using Chroma Cloud with local Ollama, prefer OpenAI embeddings if available
        if (isChromaCloud && this.config.openaiApiKey) {
          this.logger.log(
            `Using Chroma Cloud with OpenAI embeddings (Ollama will be used for chat/completions only)...`,
          );

          this.embeddings = new OpenAIEmbeddings({
            openAIApiKey: this.config.openaiApiKey,
          });

          // Initialize Chroma with timeout
          const chromaConfig = await this.getChromaConfig();
          this.logger.log(
            `Initializing Chroma Cloud vector store (${this.config.chromaTenant}/${this.config.chromaDatabase})...`,
          );
          const initStartTime = Date.now();

          const initPromise = Chroma.fromDocuments(
            [],
            this.embeddings,
            chromaConfig as any,
          );

          const CHROMA_TIMEOUT = 120000; // 120 seconds
          const timeoutPromise: Promise<never> = new Promise((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `Chroma initialization timeout (${CHROMA_TIMEOUT / 1000}s)`,
                  ),
                ),
              CHROMA_TIMEOUT,
            ),
          );

          try {
            this.vectorStore = await Promise.race([
              initPromise,
              timeoutPromise,
            ]);

            const initTime = Date.now() - initStartTime;
            this.logger.log(
              `✓ Chroma Cloud initialized with OpenAI embeddings in ${initTime}ms.`,
            );
            return;
          } catch (initError: any) {
            if (
              initError?.message?.includes('Chroma initialization timeout') ||
              initError?.message?.includes('Chroma') ||
              initError?.message?.includes('ECONNREFUSED') ||
              initError?.message?.includes('ENOTFOUND') ||
              initError?.message?.includes('ETIMEDOUT') ||
              initError?.message?.includes('Unauthorized') ||
              initError?.message?.includes('401') ||
              initError?.message?.includes('default_tenant')
            ) {
              this.logger.warn(
                `⚠️  Chroma Cloud vector store initialization failed: ${initError.message}. ` +
                  `The application will continue to work, but semantic search features will be unavailable. ` +
                  `To enable semantic search: ensure Chroma Cloud credentials are correct and restart the backend.`,
              );
              this.embeddings = null;
              this.vectorStore = null;
              this.embeddingsDisabled = true;
              return;
            }
            throw initError;
          }
        }

        // Fallback to Ollama embeddings (for local deployments only)
        // Skip if using Ollama Cloud (already handled above)
        if (isOllamaCloud) {
          // Should not reach here, but just in case
          this.logger.warn(
            `⚠️  Skipping Ollama embeddings initialization for Ollama Cloud. ` +
              `Ollama Cloud doesn't support embeddings.`,
          );
          this.embeddings = null;
          this.vectorStore = null;
          this.embeddingsDisabled = true;
          return;
        }

        const model = this.config.embeddingsModel || 'nomic-embed-text';

        // Verify Ollama is accessible and model is available before proceeding
        this.logger.log(
          `Initializing embeddings with local Ollama instance (model=${model})...`,
        );

        // Use unified connection helper to find working Ollama URL
        let testUrl: string | null = null;
        let modelCheckResp: Response | null = null;

        try {
          // Find working Ollama URL with retries
          testUrl = await this.findWorkingOllamaUrl(10, '/api/tags');

          // Verify model exists
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);
          modelCheckResp = await fetch(`${testUrl}/api/tags`, {
            method: 'GET',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
            },
          } as any);
          clearTimeout(timeoutId);

          if (!modelCheckResp.ok) {
            throw new Error(
              `Ollama at ${testUrl} returned status ${modelCheckResp.status}`,
            );
          }

          const modelsData = await modelCheckResp.json();
          const modelExists = modelsData.models?.some(
            (m: any) => m.name === model || m.name.startsWith(`${model}:`),
          );

          if (!modelExists) {
            this.logger.warn(
              `⚠️  Embedding model "${model}" not found in Ollama. ` +
                `Please download it with: docker-compose exec ollama ollama pull ${model}`,
            );
            // Continue anyway - Ollama will download it on first use, but it will be slow
          } else {
            this.logger.log(
              `✓ Embedding model "${model}" is available in Ollama`,
            );
          }
        } catch (checkError: any) {
          this.logger.warn(
            `Could not verify Ollama model availability: ${checkError.message}. ` +
              `Will attempt initialization anyway, but embeddings may fail if model is not available.`,
          );
        }

        try {
          // Use the URL we already found in the verification above
          // This avoids redundant connection attempts
          const workingUrl = testUrl || 'http://ollama:11434';
          this.logger.log(
            `Using Ollama at ${workingUrl} for embeddings adapter`,
          );

          this.embeddings = this.createOllamaEmbeddingsAdapter(
            workingUrl,
            model,
          );

          // Initialize Chroma with timeout
          const chromaConfig = await this.getChromaConfig();
          const chromaLocation = this.config.chromaApiKey
            ? `Chroma Cloud (${this.config.chromaTenant}/${this.config.chromaDatabase})`
            : this.config.chromaUrl
              ? `at ${this.config.chromaUrl}`
              : '(local)';

          this.logger.log(
            `Initializing Chroma vector store ${chromaLocation}...`,
          );
          const initStartTime = Date.now();

          const initPromise = Chroma.fromDocuments(
            [],
            this.embeddings,
            chromaConfig as any,
          );

          // Increase timeout to 120 seconds for Chroma initialization
          // Chroma can be slow on first initialization or if connecting to remote server
          const CHROMA_TIMEOUT = 120000; // 120 seconds
          const timeoutPromise: Promise<never> = new Promise((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `Chroma initialization timeout (${CHROMA_TIMEOUT / 1000}s)`,
                  ),
                ),
              CHROMA_TIMEOUT,
            ),
          );

          this.vectorStore = await Promise.race([initPromise, timeoutPromise]);

          const initTime = Date.now() - initStartTime;
          this.logger.log(
            `✓ Chroma initialized with Ollama embeddings (model=${model}) in ${initTime}ms.`,
          );
          return;
        } catch (initError: any) {
          // Handle Chroma timeout or connection errors gracefully
          if (
            initError?.message?.includes('Chroma initialization timeout') ||
            initError?.message?.includes('Chroma') ||
            initError?.message?.includes('ECONNREFUSED') ||
            initError?.message?.includes('ENOTFOUND') ||
            initError?.message?.includes('ETIMEDOUT') ||
            initError?.message?.includes('Unauthorized') ||
            initError?.message?.includes('401') ||
            initError?.message?.includes('default_tenant')
          ) {
            this.logger.warn(
              `⚠️  Chroma vector store initialization failed: ${initError.message}. ` +
                `The application will continue to work, but semantic search features will be unavailable. ` +
                `To enable semantic search: ensure Chroma is running and accessible${this.config.chromaUrl ? ` at ${this.config.chromaUrl}` : ' (or configure CHROMA_URL)'} and restart the backend.`,
            );
            this.embeddings = null;
            this.vectorStore = null;
            this.embeddingsDisabled = true;
            return; // Exit gracefully instead of throwing
          }

          // If initialization fails due to Ollama connection, try OpenAI as fallback if available
          if (
            (initError?.message?.includes('Ollama not available') ||
              initError?.message?.includes('Could not connect to Ollama')) &&
            this.config.openaiApiKey
          ) {
            this.logger.warn(
              `⚠️  Ollama not available for embeddings. Falling back to OpenAI embeddings...`,
            );
            try {
              this.embeddings = new OpenAIEmbeddings({
                openAIApiKey: this.config.openaiApiKey,
              });
              const chromaConfig = await this.getChromaConfig();
              this.vectorStore = await Chroma.fromDocuments(
                [],
                this.embeddings,
                chromaConfig as any,
              );
              this.logger.log(
                `✓ Chroma initialized with OpenAI embeddings (fallback from Ollama).`,
              );
              return;
            } catch (fallbackError: any) {
              this.logger.warn(
                `⚠️  OpenAI fallback also failed: ${fallbackError.message}. Embeddings will be disabled. ` +
                  `The application will continue to work, but semantic search features will be unavailable.`,
              );
              this.embeddings = null;
              this.vectorStore = null;
              this.embeddingsDisabled = true;
              return;
            }
          }

          // If no fallback available, disable embeddings gracefully
          if (
            initError?.message?.includes('Ollama not available') ||
            initError?.message?.includes('Could not connect to Ollama')
          ) {
            this.logger.warn(
              `⚠️  Ollama not available for embeddings. Embeddings will be disabled. ` +
                `The application will continue to work, but semantic search features will be unavailable. ` +
                `To enable embeddings: ensure Ollama is running (docker-compose up -d ollama) or configure OPENAI_API_KEY for fallback.`,
            );
            this.embeddings = null;
            this.vectorStore = null;
            this.embeddingsDisabled = true;
            return; // Exit gracefully instead of throwing
          }
          // Re-throw other errors
          throw initError;
        }
      }

      if (provider === 'openai' && this.config.openaiApiKey) {
        this.embeddings = new OpenAIEmbeddings({
          openAIApiKey: this.config.openaiApiKey,
        });

        // Initialize Chroma with timeout
        const chromaConfig = await this.getChromaConfig();
        const chromaLocation = this.config.chromaApiKey
          ? `Chroma Cloud (${this.config.chromaTenant}/${this.config.chromaDatabase})`
          : this.config.chromaUrl
            ? `at ${this.config.chromaUrl}`
            : '(local)';

        this.logger.log(
          `Initializing Chroma vector store ${chromaLocation}...`,
        );
        const initStartTime = Date.now();

        const initPromise = Chroma.fromDocuments(
          [],
          this.embeddings,
          chromaConfig as any,
        );

        // Increase timeout to 120 seconds for Chroma initialization
        const CHROMA_TIMEOUT = 120000; // 120 seconds
        const timeoutPromise: Promise<never> = new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Chroma initialization timeout (${CHROMA_TIMEOUT / 1000}s)`,
                ),
              ),
            CHROMA_TIMEOUT,
          ),
        );

        try {
          this.vectorStore = await Promise.race([initPromise, timeoutPromise]);

          const initTime = Date.now() - initStartTime;
          this.logger.log(
            `✓ Chroma initialized with OpenAI embeddings in ${initTime}ms.`,
          );
          return;
        } catch (initError: any) {
          // Handle Chroma timeout or connection errors gracefully
          if (
            initError?.message?.includes('Chroma initialization timeout') ||
            initError?.message?.includes('Chroma') ||
            initError?.message?.includes('ECONNREFUSED') ||
            initError?.message?.includes('ENOTFOUND') ||
            initError?.message?.includes('ETIMEDOUT') ||
            initError?.message?.includes('Unauthorized') ||
            initError?.message?.includes('401') ||
            initError?.message?.includes('default_tenant')
          ) {
            this.logger.warn(
              `⚠️  Chroma vector store initialization failed: ${initError.message}. ` +
                `The application will continue to work, but semantic search features will be unavailable. ` +
                `To enable semantic search: ensure Chroma is running and accessible${this.config.chromaUrl ? ` at ${this.config.chromaUrl}` : ' (or configure CHROMA_URL)'} and restart the backend.`,
            );
            this.embeddings = null;
            this.vectorStore = null;
            this.embeddingsDisabled = true;
            return; // Exit gracefully instead of throwing
          }
          throw initError;
        }
      }

      // Groq u otros: intentar Ollama embeddings si baseUrl está configurado
      if (provider === 'groq' && this.config.ollamaBaseUrl) {
        const model = this.config.embeddingsModel || 'nomic-embed-text';
        this.embeddings = this.createOllamaEmbeddingsAdapter(
          this.config.ollamaBaseUrl!,
          model,
        );

        // Initialize Chroma with timeout
        const chromaConfig = await this.getChromaConfig();
        const chromaLocation = this.config.chromaApiKey
          ? `Chroma Cloud (${this.config.chromaTenant}/${this.config.chromaDatabase})`
          : this.config.chromaUrl
            ? `at ${this.config.chromaUrl}`
            : '(local)';

        this.logger.log(
          `Initializing Chroma vector store ${chromaLocation}...`,
        );
        const initStartTime = Date.now();

        const initPromise = Chroma.fromDocuments(
          [],
          this.embeddings,
          chromaConfig as any,
        );

        // Increase timeout to 120 seconds for Chroma initialization
        const CHROMA_TIMEOUT = 120000; // 120 seconds
        const timeoutPromise: Promise<never> = new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Chroma initialization timeout (${CHROMA_TIMEOUT / 1000}s)`,
                ),
              ),
            CHROMA_TIMEOUT,
          ),
        );

        try {
          this.vectorStore = await Promise.race([initPromise, timeoutPromise]);

          const initTime = Date.now() - initStartTime;
          this.logger.log(
            `✓ Chroma initialized with Ollama embeddings (provider=groq, model=${model}) in ${initTime}ms.`,
          );
          return;
        } catch (initError: any) {
          // Handle Chroma timeout or connection errors gracefully
          if (
            initError?.message?.includes('Chroma initialization timeout') ||
            initError?.message?.includes('Chroma') ||
            initError?.message?.includes('ECONNREFUSED') ||
            initError?.message?.includes('ENOTFOUND') ||
            initError?.message?.includes('ETIMEDOUT') ||
            initError?.message?.includes('Unauthorized') ||
            initError?.message?.includes('401') ||
            initError?.message?.includes('default_tenant')
          ) {
            this.logger.warn(
              `⚠️  Chroma vector store initialization failed: ${initError.message}. ` +
                `The application will continue to work, but semantic search features will be unavailable. ` +
                `To enable semantic search: ensure Chroma is running and accessible${this.config.chromaUrl ? ` at ${this.config.chromaUrl}` : ' (or configure CHROMA_URL)'} and restart the backend.`,
            );
            this.embeddings = null;
            this.vectorStore = null;
            this.embeddingsDisabled = true;
            return; // Exit gracefully instead of throwing
          }
          throw initError;
        }
      }

      this.embeddings = null;
      this.vectorStore = null;
      this.logger.warn(
        'Embeddings disabled (no compatible provider configured).',
      );
    } catch (e: any) {
      const errorMessage = e?.message || String(e);
      this.logger.error(
        `Failed to initialize vector store: ${errorMessage}`,
        e?.stack,
      );

      // Provide helpful error messages based on error type
      if (errorMessage.includes('Could not connect to Ollama')) {
        this.logger.error(
          `⚠️  Ollama connection issue. Possible causes:` +
            `\n  1. Ollama service not running: docker ps | grep ollama` +
            `\n  2. Ollama not accessible: curl http://localhost:11434/api/tags` +
            `\n  3. Docker network issue: ensure backend and ollama are on the same network` +
            `\n  4. Ollama still starting up: wait a few seconds and try again` +
            `\n  → To start Ollama: docker-compose up -d ollama` +
            `\n  → To check Ollama status: docker-compose ps ollama` +
            `\n  → To view Ollama logs: docker-compose logs ollama`,
        );
      } else if (errorMessage.includes('timeout')) {
        this.logger.error(
          `⚠️  Chroma initialization timed out. Possible causes:` +
            `\n  1. ChromaDB service is not running or not accessible` +
            `\n  2. Network connectivity issues` +
            `\n  3. ChromaDB is overloaded` +
            `\n  4. If using Ollama, the embedding model may be downloading (this can take several minutes)` +
            `\n  → Check: docker ps | grep chroma` +
            `\n  → Check: curl http://localhost:8001/api/v1/heartbeat` +
            `\n  → If using Ollama: docker-compose exec ollama ollama pull ${this.config.embeddingsModel || 'nomic-embed-text'}`,
        );
      } else if (
        errorMessage.includes('model') ||
        errorMessage.includes('Ollama')
      ) {
        this.logger.error(
          `⚠️  Ollama/embedding model issue. Possible causes:` +
            `\n  1. Embedding model not downloaded: docker-compose exec ollama ollama pull ${this.config.embeddingsModel || 'nomic-embed-text'}` +
            `\n  2. Ollama service not running: docker ps | grep ollama` +
            `\n  3. Ollama not accessible: curl http://localhost:11434/api/tags` +
            `\n  4. Ollama still starting up: wait a few seconds and try again`,
        );
      } else if (
        errorMessage.includes('Chroma') ||
        errorMessage.includes('chroma')
      ) {
        this.logger.error(
          `⚠️  ChromaDB connection issue. Possible causes:` +
            `\n  1. ChromaDB service not running: docker ps | grep chroma` +
            `\n  2. Wrong CHROMA_URL: current value = ${this.config.chromaUrl || 'default (local/internal)'}` +
            `\n  3. Network connectivity: curl http://localhost:8001/api/v1/heartbeat` +
            `\n  4. If on Fly.io, ensure 'zig-zag-chroma' is deployed and CHROMA_URL is set if using a custom name.`,
        );
      }

      this.embeddings = null;
      this.vectorStore = null;
    }
  }

  async saveActivityEmbedding(activities: Activity[]) {
    // Check if embeddings are disabled due to repeated failures
    if (this.embeddingsDisabled) {
      return; // Silently skip if disabled
    }

    if (!this.embeddings || !this.vectorStore) {
      this.logger.warn(
        'Embeddings or vector store not initialized, skipping embedding save',
      );
      return;
    }

    try {
      const docs = activities.map((activity) => {
        // Sanitize metadata for ChromaDB (only string, number, boolean allowed)
        const sanitizedMetadata: Record<string, string | number | boolean> = {};

        for (const [key, value] of Object.entries(activity)) {
          if (value === null || value === undefined) continue;

          if (value instanceof Date) {
            sanitizedMetadata[key] = value.toISOString();
          } else if (typeof value === 'object') {
            sanitizedMetadata[key] = JSON.stringify(value);
          } else {
            sanitizedMetadata[key] = value as string | number | boolean;
          }
        }

        return new Document({
          pageContent: `Name: ${activity.name}. Description: ${activity.description}. Metadata: ${JSON.stringify(
            activity.metadata,
          )}`,
          metadata: sanitizedMetadata,
        });
      });

      const embedding = await this.embeddings.embedDocuments(
        docs.map((doc) => doc.pageContent),
      );
      await this.vectorStore.addVectors(embedding, docs, {
        ids: activities.map((activity) => activity.id.toString()),
      });

      // Reset failure count on success
      this.embeddingFailureCount = 0;

      this.logger.debug(
        `Successfully saved embeddings for ${activities.length} activities`,
      );
    } catch (error) {
      this.embeddingFailureCount++;

      this.logger.error(
        `Failed to save embeddings for activities: ${error.message} (failure count: ${this.embeddingFailureCount}/${this.MAX_EMBEDDING_FAILURES})`,
        error.stack,
      );

      // Disable embeddings after too many consecutive failures
      if (this.embeddingFailureCount >= this.MAX_EMBEDDING_FAILURES) {
        this.embeddingsDisabled = true;
        this.logger.error(
          `Embeddings disabled after ${this.MAX_EMBEDDING_FAILURES} consecutive failures. ` +
            `To re-enable, fix the Ollama configuration and restart the service. ` +
            `If using a local Ollama instance, ensure OLLAMA_API_KEY is unset or correct.`,
        );
      }
      // Don't throw - allow the crawling process to continue even if embeddings fail
    }
  }

  async addActivityToVectorStore(activity: Activity) {
    // Check if embeddings are disabled due to repeated failures
    if (this.embeddingsDisabled) {
      return; // Silently skip if disabled
    }

    let metadata: ActivityMetadata = {};
    // Parse the metadata if it's stored as a string
    try {
      metadata =
        typeof activity.metadata === 'string'
          ? JSON.parse(activity.metadata)
          : activity.metadata || {};
    } catch (error) {
      console.warn(
        `Error parsing metadata for activity ${activity.id}:`,
        error,
      );
      metadata = {};
    }

    // Create a rich text representation
    const activityText = `Activity Details:
${activity.name} is a ${metadata.physicalIntensity || 3} intensity activity.
About this activity: ${activity.description || 'No description available'}
${metadata.enhancedDescription || ''}
This activity is ideal for ${metadata.targetAudience || 'all audiences'} and is best experienced ${metadata.bestTimeToVisit || 'any time'}.
It can be done during ${metadata.timeOfDayPreference ? metadata.timeOfDayPreference.join(', ') : 'any time of day'}.
Activity type: ${activity.type}.
Keywords: ${metadata.tags ? metadata.tags.join(', ') : ''}.

Related Activities:
Before this activity, consider: ${metadata.complementaryActivities?.before ? metadata.complementaryActivities.before.join(', ') : 'flexible'}.
After this activity, you can try: ${metadata.complementaryActivities?.after ? metadata.complementaryActivities.after.join(', ') : 'flexible'}.
`;

    if (!this.vectorStore) return;
    await this.vectorStore.addDocuments([
      {
        pageContent: activityText,
        id: activity.id, // Usar el ID como string (UUID o ObjectId durante migración)
        metadata: {
          activityId: activity.id, // CRÍTICO: Siempre string
          activityName: activity.name,
          activityType: activity.type || '',
          activityMetadata:
            typeof activity.metadata === 'string'
              ? activity.metadata
              : JSON.stringify(activity.metadata || {}),
          // Campos específicos para filtrado
          tags: (metadata.tags || []).join(','), // Flatten arrays to strings for better compatibility
          timeOfDay: (metadata.timeOfDayPreference || []).join(','),
          seasonality: JSON.stringify(metadata.seasonalityScore || {}),
          physicalIntensity: metadata.physicalIntensity || 3,
          combinationScore: JSON.stringify(metadata.combinationScore || {}),
          complementaryBefore: (
            metadata.complementaryActivities?.before || []
          ).join(','),
          complementaryAfter: (
            metadata.complementaryActivities?.after || []
          ).join(','),
        },
      },
    ]);
  }

  async findSimilarActivities(prompt: string, k: number = 10, filter?: Where) {
    if (!this.vectorStore) return [] as any[];
    const results = await this.vectorStore.similaritySearch(prompt, k, {
      ...filter,
    });
    return results;
  }

  private initializeModels(): void {
    try {
      const provider = this.config.provider;
      if (!this.config.enableAi) {
        this.logger.warn('AI disabled via ENABLE_AI=false');
        return;
      }

      // Validate chat model is not an embedding model (for Ollama/Groq)
      if (provider === 'ollama' || provider === 'groq') {
        const model = this.config.defaultModel;
        try {
          this.validateChatModel(model);
        } catch (validationError: any) {
          this.logger.error(
            `⚠️  Configuration error: ${validationError.message}`,
          );
          throw validationError;
        }
        this.logger.log(
          `AI provider: ${provider}, chat model: ${model}, embeddings model: ${this.config.embeddingsModel || 'nomic-embed-text'}`,
        );
      }

      if (provider === 'openai') {
        const commonOptions = {
          openAIApiKey: this.config.openaiApiKey,
          temperature: this.config.temperature,
          timeout: this.config.timeout,
        };
        this.chatModel = new ChatOpenAI({
          ...commonOptions,
          modelName: this.config.defaultModel,
        });
        this.completionModel = new OpenAI({
          ...commonOptions,
          modelName: 'gpt-3.5-turbo-instruct',
        });
      } else if (provider === 'ollama') {
        // Use ChatOllama from @langchain/ollama
        const model = this.config.defaultModel || 'llama3.2';
        const baseUrl = this.getOllamaBaseUrl();
        const headers = this.getOllamaHeaders();

        const ollamaConfig: any = {
          baseUrl,
          model,
          temperature: this.config.temperature,
          timeout: this.config.ollamaTimeout || this.config.timeout * 4,
        };

        // Add authentication headers if configured
        if (headers['Authorization']) {
          ollamaConfig.headers = headers;
        }

        // Add num_ctx if configured (Ollama-specific option)
        if (this.config.ollamaNumCtx) {
          ollamaConfig.numCtx = this.config.ollamaNumCtx;
        }

        this.chatModel = new ChatOllama(ollamaConfig);
        // For completions, we can use ChatOllama as well (it supports both chat and completion)
        this.completionModel = new ChatOllama(ollamaConfig);
      } else {
        // For groq we use HTTP endpoints in generateChatResponse/generateCompletionResponse
        this.chatModel = null;
        this.completionModel = null;
      }

      this.logger.log('AI models initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize AI models', error);
      throw error;
    }
  }

  /**
   * Get the ChatOpenAI model instance
   */
  getChatModel(
    customOptions?: Partial<ConstructorParameters<typeof ChatOpenAI>[0]>,
  ): ChatOpenAI {
    if (customOptions) {
      return new ChatOpenAI({
        openAIApiKey: this.config.openaiApiKey,
        temperature: this.config.temperature,
        timeout: this.config.timeout,
        modelName: this.config.defaultModel,
        ...customOptions,
      });
    }
    return this.chatModel;
  }

  /**
   * Get the OpenAI completion model instance
   */
  getCompletionModel(
    customOptions?: Partial<ConstructorParameters<typeof OpenAI>[0]>,
  ): OpenAI {
    if (customOptions) {
      return new OpenAI({
        openAIApiKey: this.config.openaiApiKey,
        temperature: this.config.temperature,
        timeout: this.config.timeout,
        modelName: 'text-davinci-003',
        ...customOptions,
      });
    }
    return this.completionModel;
  }

  /**
   * Get the AI generation timeout in milliseconds
   * For Ollama, returns the configured ollamaTimeout (defaults to 4x base timeout = 240s)
   * For other providers, returns the config timeout
   */
  getGenerationTimeout(): number {
    if (this.config.provider === 'ollama') {
      // Use dedicated Ollama timeout (defaults to 4x base timeout for complex prompts)
      return this.config.ollamaTimeout || this.config.timeout * 4;
    }
    return this.config.timeout; // 60s default for other providers
  }

  /**
   * Create a simple prompt template
   */
  createPromptTemplate(
    template: string,
    inputVariables?: string[],
  ): PromptTemplate {
    // The new API automatically extracts input variables from the template
    // If specific inputVariables are provided, we can use them with a different approach
    if (inputVariables && inputVariables.length > 0) {
      return new PromptTemplate({ template, inputVariables });
    }
    // Otherwise let the fromTemplate method extract variables automatically
    return PromptTemplate.fromTemplate(template);
  }

  /**
   * Create a simple chain with a language model
   */
  createChain(
    promptTemplate: PromptTemplate,
    model: BaseLanguageModel = this.chatModel,
  ): RunnableSequence {
    return RunnableSequence.from([
      promptTemplate,
      model,
      new StringOutputParser(),
    ]);
  }

  // Helper to validate that a model is not an embedding model
  private validateChatModel(model: string): void {
    const embeddingModelPatterns = [
      'embed',
      'nomic-embed',
      'bge-',
      'e5-',
      'multilingual-e5',
    ];
    const isEmbeddingModel = embeddingModelPatterns.some((pattern) =>
      model.toLowerCase().includes(pattern),
    );
    if (isEmbeddingModel) {
      throw new Error(
        `Invalid model "${model}" for chat/generation. This is an embedding model and cannot be used for chat. ` +
          `Please set AI_MODEL to a chat model like "llama3.2", "llama3.2:1b", or "gpt-oss:20b". ` +
          `Embedding models (like "nomic-embed-text") should only be set in EMBEDDINGS_MODEL.`,
      );
    }
  }

  async generateChatResponse(
    systemPrompt: string,
    userPrompt: string,
    variables: Record<string, string> = {},
    customOptions?: Partial<ConstructorParameters<typeof ChatOpenAI>[0]>,
  ): Promise<string> {
    // Check cache first
    const cached = this.aiCache.get(
      systemPrompt + '|' + userPrompt,
      'chat',
      variables,
    );
    if (cached) return cached;

    try {
      let response = '';
      const provider = this.config.provider;

      if (provider === 'ollama') {
        // Use ChatOllama from @langchain/ollama
        const model = this.chatModel;
        if (!model) {
          throw new Error(
            'Ollama chat model not initialized. Please check your Ollama configuration.',
          );
        }

        // Format prompts using ChatPromptTemplate
        const chatPrompt = ChatPromptTemplate.fromMessages([
          SystemMessagePromptTemplate.fromTemplate(systemPrompt),
          HumanMessagePromptTemplate.fromTemplate(userPrompt),
        ]);

        const chain = RunnableSequence.from([
          chatPrompt,
          model,
          new StringOutputParser(),
        ]);

        try {
          response = await chain.invoke(variables);
        } catch (error: any) {
          // Handle errors with helpful messages
          const errorMsg = error?.message || String(error);
          const modelName = this.config.defaultModel || 'llama3.2';

          // Provide helpful suggestions for common errors
          if (
            errorMsg.includes('does not support generate') ||
            errorMsg.includes('embedding model')
          ) {
            throw new Error(
              `Model "${modelName}" does not support generation. ` +
                `This appears to be an embedding model. ` +
                `Please set AI_MODEL to a chat model like "llama3.2" or "llama3.2:1b" in your .env file. ` +
                `Embedding models should only be set in EMBEDDINGS_MODEL.`,
            );
          } else if (errorMsg.includes('memory')) {
            throw new Error(
              `Memory error detected. Solutions:` +
                `\n1) Use a smaller model: Set AI_MODEL=llama3.2 or AI_MODEL=llama3.2:1b in your .env` +
                `\n2) Increase Docker Desktop memory: Settings > Resources > Memory (recommended: 16GB+)` +
                `\n3) Current model "${modelName}" may be too large for available memory.`,
            );
          } else if (
            errorMsg.includes('fetch failed') ||
            errorMsg.includes('ECONNREFUSED') ||
            errorMsg.includes('ENOTFOUND') ||
            errorMsg.includes('network') ||
            errorMsg.includes('connection')
          ) {
            const baseUrl = this.getOllamaBaseUrl();
            const isRemote = baseUrl.startsWith('https://');
            let diagnosticMessage = `Network error connecting to Ollama at ${baseUrl}. `;

            if (isRemote) {
              diagnosticMessage +=
                `\n⚠️  This appears to be a remote Ollama instance (Ollama Cloud). ` +
                `Possible causes:` +
                `\n1) Network connectivity issue from Fly.io to Ollama Cloud` +
                `\n2) DNS resolution failure - verify the URL is correct: ${baseUrl}` +
                `\n3) SSL/TLS certificate issue` +
                `\n4) Firewall or network policy blocking the connection` +
                `\n5) Ollama Cloud service may be temporarily unavailable` +
                `\n\nTroubleshooting:` +
                `\n- Verify OLLAMA_BASE_URL is set correctly: ${baseUrl}` +
                `\n- Check if OLLAMA_API_KEY is set (required for Ollama Cloud)` +
                `\n- Test connectivity: curl -v ${baseUrl}/api/tags` +
                `\n- Check Fly.io logs for network errors` +
                `\n- Verify Ollama Cloud status at https://status.ollama.com`;
            } else {
              diagnosticMessage +=
                `\n⚠️  This appears to be a local Ollama instance. ` +
                `Possible causes:` +
                `\n1) Ollama service is not running` +
                `\n2) Ollama is not accessible at ${baseUrl}` +
                `\n3) Network configuration issue in Docker/Fly.io` +
                `\n\nTroubleshooting:` +
                `\n- Verify Ollama is running: docker ps | grep ollama` +
                `\n- Test connectivity: curl ${baseUrl}/api/tags` +
                `\n- In production, consider using Ollama Cloud instead of local instance` +
                `\n- Set OLLAMA_BASE_URL to https://api.ollama.com for Ollama Cloud`;
            }

            this.logger.error(diagnosticMessage);
            throw new Error(diagnosticMessage);
          }

          this.logger.error(`Error generating chat response: ${errorMsg}`);
          throw error;
        }
      } else if (provider === 'groq') {
        const userTmpl = PromptTemplate.fromTemplate(userPrompt);
        const userText = await userTmpl.format(variables as any);
        const model = this.config.defaultModel || 'llama-3.1-8b-instant';

        const resp = await fetch(
          'https://api.groq.com/openai/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.config.groqApiKey}`,
            },
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userText },
              ],
              temperature: this.config.temperature,
            }),
          } as any,
        );

        if (!resp.ok) {
          const errorText = await resp.text().catch(() => 'Unknown error');
          let errorMessage = `Groq error ${resp.status}: ${errorText}`;

          // Try to parse JSON error if available
          try {
            const errorJson = JSON.parse(errorText);
            if (errorJson.error?.message) {
              errorMessage = `Groq error ${resp.status}: ${errorJson.error.message}`;
            }
          } catch {
            // If not JSON, use the text as-is
          }

          // Provide helpful suggestions for common errors
          if (resp.status === 400) {
            // Check if it's a deprecation error
            if (
              errorText.includes('decommissioned') ||
              errorText.includes('deprecated') ||
              errorText.includes('no longer supported')
            ) {
              errorMessage +=
                `\n⚠️  Model deprecated. The model "${model}" has been decommissioned.` +
                `\nRecommended replacements:` +
                `\n  - For 70B models: Use "llama-3.3-70b-versatile" instead` +
                `\n  - For 8B models: Use "llama-3.1-8b-instant"` +
                `\n  - Other options: "llama-3.3-70b-versatile", "openai/gpt-oss-120b", "openai/gpt-oss-20b"` +
                `\nSee https://console.groq.com/docs/deprecations for more details.`;
            } else {
              errorMessage +=
                `\n⚠️  Bad request. Common causes:` +
                `\n1) Invalid model name: "${model}". Valid Groq models include: llama-3.1-8b-instant, llama-3.3-70b-versatile, openai/gpt-oss-120b, openai/gpt-oss-20b` +
                `\n2) Missing or invalid API key: Check GROQ_API_KEY environment variable` +
                `\n3) Invalid request format: Check that systemPrompt and userText are valid strings` +
                `\nSee https://console.groq.com/docs/models for the full list of available models.`;
            }
          } else if (resp.status === 401) {
            errorMessage += `\n⚠️  Authentication failed. Please check your GROQ_API_KEY environment variable.`;
          } else if (resp.status === 429) {
            errorMessage += `\n⚠️  Rate limit exceeded. Please wait before making more requests.`;
          }

          throw new Error(errorMessage);
        }

        const data = await resp.json();
        response = data.choices?.[0]?.message?.content || '';
      } else {
        // Default: OpenAI via LangChain
        const model = customOptions
          ? this.getChatModel(customOptions)
          : this.chatModel;
        const chatPrompt = ChatPromptTemplate.fromMessages([
          SystemMessagePromptTemplate.fromTemplate(systemPrompt),
          HumanMessagePromptTemplate.fromTemplate(userPrompt),
        ]);
        const chain = RunnableSequence.from([
          chatPrompt,
          model,
          new StringOutputParser(),
        ]);
        response = await chain.invoke(variables);
      }

      // Save to cache
      this.aiCache.save(
        systemPrompt + '|' + userPrompt,
        'chat',
        variables,
        response,
      );
      return response;
    } catch (error) {
      this.logger.error(`Error generating chat response: ${error.message}`);
      throw error;
    }
  }

  /**
   * Run a simple prompt with the completion model
   */
  async generateCompletionResponse(
    promptText: string,
    variables: Record<string, string> = {},
    customOptions?: Partial<ConstructorParameters<typeof OpenAI>[0]>,
  ): Promise<string> {
    // Check cache first
    const cached = this.aiCache.get(promptText, 'completion', variables);
    if (cached) return cached;

    try {
      let response = '';
      const provider = this.config.provider;

      if (provider === 'ollama') {
        // Use ChatOllama from @langchain/ollama for completions
        const model = this.completionModel;
        if (!model) {
          throw new Error(
            'Ollama completion model not initialized. Please check your Ollama configuration.',
          );
        }

        // Format prompt template
        const prompt = PromptTemplate.fromTemplate(promptText);
        const chain = this.createChain(prompt, model);

        try {
          response = await chain.invoke(variables);
        } catch (error: any) {
          // Handle errors with helpful messages
          const errorMsg = error?.message || String(error);
          const modelName = this.config.defaultModel || 'llama3.2';

          // Provide helpful suggestions for common errors
          if (
            errorMsg.includes('does not support generate') ||
            errorMsg.includes('embedding model')
          ) {
            throw new Error(
              `Model "${modelName}" does not support generation. ` +
                `This appears to be an embedding model. ` +
                `Please set AI_MODEL to a chat model like "llama3.2" or "llama3.2:1b" in your .env file. ` +
                `Embedding models should only be set in EMBEDDINGS_MODEL.`,
            );
          } else if (errorMsg.includes('memory')) {
            throw new Error(
              `Memory error detected. Solutions:` +
                `\n1) Use a smaller model: Set AI_MODEL=llama3.2 or AI_MODEL=llama3.2:1b in your .env` +
                `\n2) Increase Docker Desktop memory: Settings > Resources > Memory (recommended: 16GB+)` +
                `\n3) Current model "${modelName}" may be too large for available memory.`,
            );
          } else if (
            errorMsg.includes('fetch failed') ||
            errorMsg.includes('ECONNREFUSED') ||
            errorMsg.includes('ENOTFOUND') ||
            errorMsg.includes('network') ||
            errorMsg.includes('connection')
          ) {
            const baseUrl = this.getOllamaBaseUrl();
            const isRemote = baseUrl.startsWith('https://');
            let diagnosticMessage = `Network error connecting to Ollama at ${baseUrl}. `;

            if (isRemote) {
              diagnosticMessage +=
                `\n⚠️  This appears to be a remote Ollama instance (Ollama Cloud). ` +
                `Possible causes:` +
                `\n1) Network connectivity issue from Fly.io to Ollama Cloud` +
                `\n2) DNS resolution failure - verify the URL is correct: ${baseUrl}` +
                `\n3) SSL/TLS certificate issue` +
                `\n4) Firewall or network policy blocking the connection` +
                `\n5) Ollama Cloud service may be temporarily unavailable` +
                `\n\nTroubleshooting:` +
                `\n- Verify OLLAMA_BASE_URL is set correctly: ${baseUrl}` +
                `\n- Check if OLLAMA_API_KEY is set (required for Ollama Cloud)` +
                `\n- Test connectivity: curl -v ${baseUrl}/api/tags` +
                `\n- Check Fly.io logs for network errors` +
                `\n- Verify Ollama Cloud status at https://status.ollama.com`;
            } else {
              diagnosticMessage +=
                `\n⚠️  This appears to be a local Ollama instance. ` +
                `Possible causes:` +
                `\n1) Ollama service is not running` +
                `\n2) Ollama is not accessible at ${baseUrl}` +
                `\n3) Network configuration issue in Docker/Fly.io` +
                `\n\nTroubleshooting:` +
                `\n- Verify Ollama is running: docker ps | grep ollama` +
                `\n- Test connectivity: curl ${baseUrl}/api/tags` +
                `\n- In production, consider using Ollama Cloud instead of local instance` +
                `\n- Set OLLAMA_BASE_URL to https://api.ollama.com for Ollama Cloud`;
            }

            this.logger.error(diagnosticMessage);
            throw new Error(diagnosticMessage);
          }

          this.logger.error(
            `Error generating completion response: ${errorMsg}`,
            error.stack,
          );
          throw error;
        }
      } else if (provider === 'groq') {
        const tmpl = PromptTemplate.fromTemplate(promptText);
        const text = await tmpl.format(variables as any);
        const model = this.config.defaultModel || 'llama-3.1-8b-instant';

        const resp = await fetch('https://api.groq.com/openai/v1/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.groqApiKey}`,
          },
          body: JSON.stringify({
            model,
            prompt: text,
            temperature: this.config.temperature,
          }),
        } as any);

        if (!resp.ok) {
          const errorText = await resp.text().catch(() => 'Unknown error');
          let errorMessage = `Groq error ${resp.status}: ${errorText}`;

          // Try to parse JSON error if available
          try {
            const errorJson = JSON.parse(errorText);
            if (errorJson.error?.message) {
              errorMessage = `Groq error ${resp.status}: ${errorJson.error.message}`;
            }
          } catch {
            // If not JSON, use the text as-is
          }

          // Provide helpful suggestions for common errors
          if (resp.status === 400) {
            // Check if it's a deprecation error
            if (
              errorText.includes('decommissioned') ||
              errorText.includes('deprecated') ||
              errorText.includes('no longer supported')
            ) {
              errorMessage +=
                `\n⚠️  Model deprecated. The model "${model}" has been decommissioned.` +
                `\nRecommended replacements:` +
                `\n  - For 70B models: Use "llama-3.3-70b-versatile" instead` +
                `\n  - For 8B models: Use "llama-3.1-8b-instant"` +
                `\n  - Other options: "llama-3.3-70b-versatile", "openai/gpt-oss-120b", "openai/gpt-oss-20b"` +
                `\nSee https://console.groq.com/docs/deprecations for more details.`;
            } else {
              errorMessage +=
                `\n⚠️  Bad request. Common causes:` +
                `\n1) Invalid model name: "${model}". Valid Groq models include: llama-3.1-8b-instant, llama-3.3-70b-versatile, openai/gpt-oss-120b, openai/gpt-oss-20b` +
                `\n2) Missing or invalid API key: Check GROQ_API_KEY environment variable` +
                `\n3) Invalid request format: Check that prompt is a valid string` +
                `\n4) Note: Groq's /completions endpoint may not support all models. Consider using chat/completions instead.` +
                `\nSee https://console.groq.com/docs/models for the full list of available models.`;
            }
          } else if (resp.status === 401) {
            errorMessage += `\n⚠️  Authentication failed. Please check your GROQ_API_KEY environment variable.`;
          } else if (resp.status === 429) {
            errorMessage += `\n⚠️  Rate limit exceeded. Please wait before making more requests.`;
          }

          throw new Error(errorMessage);
        }

        const data = await resp.json();
        response = data.choices?.[0]?.text || '';
      } else {
        const model = customOptions
          ? this.getCompletionModel(customOptions)
          : this.completionModel;
        const prompt = PromptTemplate.fromTemplate(promptText);
        const chain = this.createChain(prompt, model);
        response = await chain.invoke(variables);
      }

      // Save to cache
      this.aiCache.save(promptText, 'completion', variables, response);
      return response;
    } catch (error) {
      this.logger.error(
        `Error generating completion response: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Analyze relationships between activities using AI
   * @param prompt The formatted prompt containing activity details
   * @returns A JSON string containing relationship analysis
   */
  async analyzeActivity(activity: Activity, distanceKm: number): Promise<any> {
    const prompt = new PromptTemplate({
      template: `As an AI expert in activity planning and tourism, analyze this activity 
Activity
Name: {name}
Type: {type}
Duration: {duration} minutes
Description: {description}
Metadata: {metadata}

Physical distance: {distanceKm} km


Evaluate and provide a JSON response with:
1. Scores (0-100):
   - compatibilityScore: Overall compatibility
   - timeCompatibilityScore: How well their durations and timing work together
   - distanceScore: Score based on physical distance
   - varietyScore: How well they complement each other in terms of variety
2.    Provide a structured analysis following the specified format  metadata: {{
      enhancedDescription: string;
      tags: string[];
      targetAudience: string;
      bestTimeToVisit: string;
      accessibilityInfo: string;
      recommendedEquipment: string;
      culturalRelevance: string;
      sustainabilityRating: number;
      localTips: string;
      weatherConsiderations: string;
      potentialNextActivitiesTypes: string[];
    }}

Response format:
{{
  "compatibilityScore": number,
  "timeCompatibilityScore": number,
  "distanceScore": number,
  "varietyScore": number,
  "relationType": string,
  "reasoning": string,
  "timeGapRecommended": number,
  "enhancedDescription": string,
  "tags": string[],
  "targetAudience": string,
  "bestTimeToVisit": string,
  "accessibilityInfo": string,
  "recommendedEquipment": string,
  "culturalRelevance": string,
  "sustainabilityRating": number,
  "localTips": string,
  "weatherConsiderations": string,
  "potentialNextActivitiesTypes": string[],
}}
`,
      inputVariables: [
        'name',
        'type',
        'duration',
        'description',
        'metadata',
        'distanceKm',
      ],
    });

    try {
      const resultText = await this.generateCompletionResponse(
        prompt.template as string,
        {
          name: activity.name,
          type: activity.type,
          duration: String(activity.duration),
          description: activity.description || '',
          metadata: JSON.stringify(activity.metadata || ''),
          distanceKm: distanceKm.toFixed(1),
        } as any,
      );

      return JSON.parse(resultText);
    } catch (error) {
      console.error('Error analyzing activity relationship:', error);
      throw new Error('Failed to analyze activity relationship');
    }
  }

  async resetVectorStore() {
    try {
      console.log('Resetting vector store...');

      // Reinicializar completamente usando la configuración de Chroma
      const chromaConfig = await this.getChromaConfig();
      this.vectorStore = await Chroma.fromDocuments(
        [], // Empezar vacío
        this.embeddings,
        chromaConfig as any,
      );

      console.log('Vector store reset successfully');
    } catch (error) {
      console.error('Error resetting vector store:', error);
      throw error;
    }
  }

  async rebuildVectorStore() {
    try {
      // 1. Reset vector store
      await this.resetVectorStore();

      // 2. Get all activities from database
      const activities = await this.prisma.activity.findMany({
        where: {
          metadata: { not: null }, // Solo actividades con metadata
        },
      });

      console.log(
        `Rebuilding vector store with ${activities.length} activities...`,
      );

      // 3. Add all activities to vector store with consistent IDs
      for (const activity of activities) {
        try {
          await this.addActivityToVectorStore(activity);
          console.log(`Added activity ${activity.id}: ${activity.name}`);
        } catch (error) {
          console.error(`Error adding activity ${activity.id}:`, error);
        }
      }

      console.log('Vector store rebuilt successfully');
      return { success: true, count: activities.length };
    } catch (error) {
      console.error('Error rebuilding vector store:', error);
      throw error;
    }
  }

  async testChromaConnection(): Promise<any> {
    const result: any = {
      status: 'unknown',
      timestamp: new Date().toISOString(),
      config: {},
      error: null,
    };

    try {
      const config = await this.getChromaConfig();
      // Mask sensitive data
      result.config = {
        ...config,
        index: config.index ? 'ChromaClient instance' : undefined,
        client: config.client ? 'ChromaClient instance' : undefined, // Keep for backward compat
        auth: config.index || config.client ? 'configured' : undefined,
      };

      // 1. Check basic connectivity
      // Prefer using the index/client if available, otherwise use URL
      const chromaClient = config.index || config.client;
      if (chromaClient) {
        result.checkType = 'client-list-collections';
        try {
          const collections = await chromaClient.listCollections();
          result.status = 'connected';
          result.collectionsCount = collections.length;
          result.collections = collections.map((c: any) => c.name);
        } catch (e: any) {
          result.status = 'error';
          result.error = `Client failed to list collections: ${e.message}`;
        }
      } else if (config.url) {
        result.checkType = 'http-heartbeat';
        const heartbeatUrl = `${config.url}/api/v2/heartbeat`;
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          const resp = await fetch(heartbeatUrl, {
            signal: controller.signal,
          } as any);
          clearTimeout(timeoutId);

          if (resp.ok) {
            result.status = 'connected';
            result.heartbeat = await resp.json();
          } else {
            result.status = 'error';
            result.error = `HTTP ${resp.status} from ${heartbeatUrl}`;
          }
        } catch (e: any) {
          result.status = 'error';
          result.error = `Connection failed to ${heartbeatUrl}: ${e.message}`;
        }
      }

      // 2. Check VectorStore initialization and operation status
      result.vectorStoreInitialized = !!this.vectorStore;
      if (this.vectorStore) {
        try {
          // Test a simple read operation to verify tenant/collection access
          // This triggers ensureCollection internally if not already done
          await this.vectorStore.similaritySearch('test', 1);
          result.vectorStoreStatus = 'operational';
        } catch (vsError: any) {
          result.vectorStoreStatus = 'error';
          result.vectorStoreError = vsError.message;
          // If unauthorized, it suggests the fix didn't propagate to the vectorStore instance
          if (
            vsError.message.includes('Unauthorized') ||
            vsError.message.includes('default_tenant')
          ) {
            result.vectorStoreHint =
              'LangChain VectorStore might not be using the correct tenant configuration.';
          }
        }
      }

      return result;
    } catch (error: any) {
      return {
        status: 'fatal_error',
        error: error.message,
        stack: error.stack,
      };
    }
  }
}
