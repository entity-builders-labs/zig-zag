// @ts-nocheck
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { OpenAI, ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import * as fs from 'fs';
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
import { Where } from 'chromadb';
import { PrismaService } from '../../core/database/prisma.service';

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

  // Helper to detect if a URL points to a local instance
  private isLocalOllamaInstance(url: string): boolean {
    const urlLower = url.toLowerCase();
    const localhostPatterns = [
      'localhost',
      '127.0.0.1',
      'host.docker.internal',
      '0.0.0.0',
      '::1', // IPv6 localhost
    ];

    // Check if URL contains any localhost pattern
    const containsLocalhost = localhostPatterns.some((pattern) =>
      urlLower.includes(pattern),
    );

    // Also check for local IP ranges (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
    const localIpPattern =
      /https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/i;
    const isLocalIp = localIpPattern.test(url);

    return containsLocalhost || isLocalIp;
  }

  // Helper to detect if we're running in Docker
  private isRunningInDocker(): boolean {
    // Check multiple indicators that we're in Docker
    if (process.env.DOCKER_CONTAINER === 'true') {
      return true;
    }

    // Check environment variables that indicate Docker
    if (process.env.NODE_ENV === 'production' && process.platform === 'linux') {
      // In production on Linux, assume Docker unless proven otherwise
      return true;
    }

    // Check hostname patterns
    if (
      process.env.HOSTNAME?.includes('container') ||
      process.env.HOSTNAME?.includes('docker')
    ) {
      return true;
    }

    // Check /proc/1/cgroup for docker (Linux only, with safe error handling)
    if (process.platform === 'linux') {
      try {
        if (fs.existsSync('/proc/1/cgroup')) {
          const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
          if (cgroup.includes('docker')) {
            return true;
          }
        }
      } catch {
        // Ignore errors reading cgroup
      }
    }

    return false;
  }

  // Unified helper to find a working Ollama URL with retries
  private async findWorkingOllamaUrl(
    maxRetries: number = 10,
    endpoint: string = '/api/tags',
  ): Promise<string> {
    const isDocker = this.isRunningInDocker();

    // Prioritize Docker service name if in Docker, localhost otherwise
    const tryUrls = isDocker
      ? ['http://ollama:11434', 'http://localhost:11434']
      : ['http://localhost:11434', 'http://ollama:11434'];

    this.logger.log(
      `Attempting to connect to Ollama (environment: ${isDocker ? 'Docker' : 'local'}, trying: ${tryUrls.join(', ')})...`,
    );

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      for (const url of tryUrls) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout per attempt

          const resp = await fetch(`${url}${endpoint}`, {
            method: 'GET',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
            },
          } as any);

          clearTimeout(timeoutId);

          if (resp.ok) {
            this.logger.log(`✓ Ollama accessible at ${url}`);
            return url;
          } else {
            this.logger.debug(
              `Ollama at ${url} returned status ${resp.status} ${resp.statusText}`,
            );
          }
        } catch (error: any) {
          const errorMsg = error?.message || String(error);
          const isTimeout =
            errorMsg.includes('aborted') ||
            errorMsg.includes('timeout') ||
            error.name === 'AbortError';
          const isConnectionError =
            errorMsg.includes('ECONNREFUSED') ||
            errorMsg.includes('ENOTFOUND') ||
            errorMsg.includes('getaddrinfo') ||
            errorMsg.includes('fetch failed');

          // Only log on last attempt or for connection errors (not timeouts)
          if (attempt === maxRetries || (!isTimeout && isConnectionError)) {
            this.logger.debug(
              `Connection to ${url} failed (attempt ${attempt}/${maxRetries}): ${errorMsg}`,
            );
          }
          // Continue to next URL
          continue;
        }
      }

      // Wait before retrying (except on last attempt)
      if (attempt < maxRetries) {
        // Exponential backoff: 2s, 4s, 6s, 8s, 10s, 12s, 14s, 16s, 18s
        const waitTime = 2000 + (attempt - 1) * 2000;
        this.logger.log(
          `⏳ Ollama not ready yet, waiting ${waitTime}ms before retry (attempt ${attempt}/${maxRetries})...`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    // If we get here, neither URL worked after all retries
    throw new Error(
      `Could not connect to Ollama at any of: ${tryUrls.join(', ')} after ${maxRetries} attempts. ` +
        `Please ensure Ollama is running: docker-compose up -d ollama (or ollama serve if running locally)`,
    );
  }

  // Helper to get the actual Ollama base URL (handles Docker networking)
  private getOllamaBaseUrl(): string {
    const configuredUrl = this.config.ollamaBaseUrl || 'http://localhost:11434';
    const isLocalhost = this.isLocalOllamaInstance(configuredUrl);

    // For remote instances (Ollama Cloud), use configured URL
    if (!isLocalhost) {
      return configuredUrl;
    }

    // For local instances, try Docker service name first, then localhost
    // This works both in Docker (ollama:11434) and outside Docker (localhost:11434)
    // We'll try both URLs in createOllamaEmbeddingsAdapter
    return 'http://ollama:11434'; // Will fallback to localhost if this fails
  }

  // Helper to get Ollama request headers with authentication if configured
  private getOllamaHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Check if this is a localhost instance (local Ollama typically doesn't require auth)
    const baseUrl = this.getOllamaBaseUrl();
    const isLocalhost = this.isLocalOllamaInstance(baseUrl);

    // Only add Bearer token auth header for remote instances with API key
    // Local Ollama instances don't require authentication
    if (
      !isLocalhost &&
      this.config.ollamaApiKey &&
      this.config.ollamaApiKey.trim().length > 0
    ) {
      headers['Authorization'] = `Bearer ${this.config.ollamaApiKey.trim()}`;
    }

    return headers;
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

    // FORCE local instance for embeddings (Ollama Cloud doesn't support /api/embed)
    // Always use local instance, ignoring any remote Ollama Cloud configuration
    const configuredUrl =
      baseUrl || this.config.ollamaBaseUrl || 'http://localhost:11434';
    const isConfiguredRemote = !this.isLocalOllamaInstance(configuredUrl);

    // Try Docker service name first (works in Docker Compose), then fallback to localhost
    // This automatically works in both Docker and non-Docker environments
    let actualBaseUrl: string | null = null;

    // Warn if user configured a remote instance
    if (isConfiguredRemote) {
      this.logger.warn(
        `⚠️  Ollama embeddings: Detected remote Ollama configuration (${configuredUrl}), ` +
          `but embeddings require a local Ollama instance. ` +
          `Will try Docker service name (ollama:11434) first, then localhost. ` +
          `Please ensure Ollama is running. ` +
          `For chat/completion, you can still use Ollama Cloud via OLLAMA_BASE_URL.`,
      );
    }

    // Helper to find working Ollama URL by trying both options with retries
    // Uses the unified connection helper
    const findWorkingUrl = async (maxRetries: number = 10): Promise<string> => {
      if (actualBaseUrl) {
        return actualBaseUrl; // Already found a working URL
      }

      try {
        actualBaseUrl = await this.findWorkingOllamaUrl(
          maxRetries,
          '/api/tags',
        );
        this.logger.log(
          `✓ Ollama embeddings: Found working instance at ${actualBaseUrl} (embeddings always use local Ollama).`,
        );
        return actualBaseUrl;
      } catch (error: any) {
        throw new Error(
          `Ollama embeddings: ${error.message}. ` +
            `Please ensure Ollama is running (either as Docker service or locally). ` +
            `Check with: docker ps | grep ollama or curl http://localhost:11434/api/tags`,
        );
      }
    };

    // Helper to make embedding request (always local, no auth needed)
    const makeEmbeddingRequest = async (
      url: string,
      body: any,
    ): Promise<Response> => {
      // Always use local instance without authentication
      let resp: Response;
      try {
        resp = await makeRequest(url, body, false);
      } catch {
        // If makeRequest throws (network error), try to find working URL
        const workingUrl = await findWorkingUrl();
        resp = await makeRequest(`${workingUrl}/api/embed`, body, false);
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
      const collectionName = this.config.chromaCollectionName || 'activities';

      if (provider === 'ollama') {
        const model = this.config.embeddingsModel || 'nomic-embed-text';

        // Verify Ollama is accessible and model is available before proceeding
        this.logger.log(
          `Initializing embeddings with Ollama (model=${model})...`,
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
          this.logger.log(
            `Initializing Chroma vector store${this.config.chromaUrl ? ` at ${this.config.chromaUrl}` : ' (local)'}...`,
          );
          const initStartTime = Date.now();

          const initPromise = this.config.chromaUrl
            ? Chroma.fromDocuments([], this.embeddings, {
                collectionName,
                url: this.config.chromaUrl,
              } as any)
            : Chroma.fromDocuments([], this.embeddings, {
                collectionName,
              });

          // Increase timeout to 120 seconds for Chroma initialization
          // Chroma can be slow on first initialization or if connecting to remote server
          const CHROMA_TIMEOUT = 120000; // 120 seconds
          const timeoutPromise = new Promise((_, reject) =>
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
            initError?.message?.includes('ETIMEDOUT')
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

          // If initialization fails due to Ollama connection, disable embeddings gracefully
          if (
            initError?.message?.includes('Ollama not available') ||
            initError?.message?.includes('Could not connect to Ollama')
          ) {
            this.logger.warn(
              `⚠️  Ollama not available for embeddings. Embeddings will be disabled. ` +
                `The application will continue to work, but semantic search features will be unavailable. ` +
                `To enable embeddings: ensure Ollama is running (docker-compose up -d ollama) and restart the backend.`,
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
        this.logger.log(
          `Initializing Chroma vector store${this.config.chromaUrl ? ` at ${this.config.chromaUrl}` : ' (local)'}...`,
        );
        const initStartTime = Date.now();

        const initPromise = this.config.chromaUrl
          ? Chroma.fromDocuments([], this.embeddings, {
              collectionName,
              url: this.config.chromaUrl,
            } as any)
          : Chroma.fromDocuments([], this.embeddings, {
              collectionName,
            });

        // Increase timeout to 120 seconds for Chroma initialization
        const CHROMA_TIMEOUT = 120000; // 120 seconds
        const timeoutPromise = new Promise((_, reject) =>
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
            initError?.message?.includes('ETIMEDOUT')
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
        this.logger.log(
          `Initializing Chroma vector store${this.config.chromaUrl ? ` at ${this.config.chromaUrl}` : ' (local)'}...`,
        );
        const initStartTime = Date.now();

        const initPromise = Chroma.fromDocuments([], this.embeddings, {
          collectionName,
        });

        // Increase timeout to 120 seconds for Chroma initialization
        const CHROMA_TIMEOUT = 120000; // 120 seconds
        const timeoutPromise = new Promise((_, reject) =>
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
            initError?.message?.includes('ETIMEDOUT')
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
            `\n  2. Wrong CHROMA_URL: current value = ${this.config.chromaUrl || 'default (local)'}` +
            `\n  3. Network connectivity: curl http://localhost:8001/api/v1/heartbeat`,
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
        return new Document({
          pageContent: `Name: ${activity.name}. Description: ${activity.description}. Metadata: ${activity.metadata}`,
          metadata: activity,
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
          activityType: activity.type,
          activityMetadata: activity.metadata,
          // Campos específicos para filtrado
          tags: metadata.tags || [],
          timeOfDay: metadata.timeOfDayPreference || [],
          seasonality: metadata.seasonalityScore || {},
          physicalIntensity: metadata.physicalIntensity || 3,
          combinationScore: metadata.combinationScore || {},
          complementaryBefore: metadata.complementaryActivities?.before || [],
          complementaryAfter: metadata.complementaryActivities?.after || [],
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
      } else {
        // For ollama/groq we use HTTP endpoints in generateChatResponse/generateCompletionResponse
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
          `Please set AI_MODEL to a chat model like "llama3.2:3b", "llama3.2:1b", or "gpt-oss:20b". ` +
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
    try {
      const provider = this.config.provider;
      if (provider === 'ollama') {
        const model = this.config.defaultModel || 'llama3.2:3b';
        // Validate that we're not using an embedding model for chat
        this.validateChatModel(model);

        // Format combined prompt
        const combined = PromptTemplate.fromTemplate(
          `${systemPrompt}\n${userPrompt}`,
        );
        const promptText = await combined.format(variables as any);
        const headers = this.getOllamaHeaders();
        const baseUrl = this.getOllamaBaseUrl();

        // Add timeout to Ollama fetch (Ollama can be slow, especially for complex prompts)
        // Use dedicated Ollama timeout (defaults to 4x base timeout = 240s)
        const timeoutMs = this.config.ollamaTimeout || this.config.timeout * 4;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const options: Record<string, any> = {
            temperature: this.config.temperature,
          };
          if (this.config.ollamaNumCtx) {
            options.num_ctx = this.config.ollamaNumCtx;
          }

          const resp = await fetch(`${baseUrl}/api/generate`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model,
              prompt: promptText,
              stream: false,
              options,
            }),
            signal: controller.signal,
          } as any);
          clearTimeout(timeoutId);

          if (!resp.ok) {
            const errorText = await resp.text().catch(() => 'Unknown error');
            let errorMessage = `Ollama error ${resp.status} (${baseUrl}): ${errorText}`;

            // Provide helpful suggestions for common errors
            if (errorText.includes('does not support generate')) {
              errorMessage +=
                `\n⚠️  Model "${model}" does not support generation. ` +
                `This appears to be an embedding model. ` +
                `Please set AI_MODEL to a chat model like "llama3.2:3b" or "llama3.2:1b" in your .env file. ` +
                `Embedding models should only be set in EMBEDDINGS_MODEL.`;
            } else if (resp.status === 500 && errorText.includes('memory')) {
              errorMessage +=
                `\n⚠️  Memory error detected. Solutions:` +
                `\n1) Use a smaller model: Set AI_MODEL=llama3.2:3b or AI_MODEL=llama3.2:1b in your .env` +
                `\n2) Increase Docker Desktop memory: Settings > Resources > Memory (recommended: 16GB+)` +
                `\n3) Current model "${model}" may be too large for available memory.`;
            }

            throw new Error(errorMessage);
          }
          const data = await resp.json();
          return data.response as string;
        } catch (error: any) {
          clearTimeout(timeoutId);
          // Handle timeout errors
          if (
            error.name === 'AbortError' ||
            error.message?.includes('aborted')
          ) {
            throw new Error(
              `Ollama request timeout after ${timeoutMs}ms. ` +
                `The model may be processing a complex prompt. ` +
                `Try: 1) Using a smaller model (e.g., llama3.2:1b), 2) Simplifying the prompt, or 3) Increasing OLLAMA_TIMEOUT environment variable (current: ${timeoutMs}ms).`,
            );
          }
          throw error;
        }
      }

      if (provider === 'groq') {
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
        return data.choices?.[0]?.message?.content || '';
      }

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
      return await chain.invoke(variables);
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
    try {
      const provider = this.config.provider;
      if (provider === 'ollama') {
        const model = this.config.defaultModel || 'llama3.2:3b';
        // Validate that we're not using an embedding model for completion
        this.validateChatModel(model);

        // If no variables, use prompt directly to avoid template parsing issues
        // Otherwise, use template with escaped braces
        let text: string;
        if (Object.keys(variables).length === 0) {
          text = promptText;
        } else {
          // Escape double braces in prompt to avoid template variable conflicts
          const escapedPrompt = promptText
            .replace(/\{\{/g, '{{{{')
            .replace(/\}\}/g, '}}}}');
          const tmpl = PromptTemplate.fromTemplate(escapedPrompt);
          text = await tmpl.format(variables as any);
        }
        const headers = this.getOllamaHeaders();
        const baseUrl = this.getOllamaBaseUrl();

        // Add timeout to Ollama fetch (Ollama can be slow, especially for complex prompts)
        // Use dedicated Ollama timeout (defaults to 4x base timeout = 240s)
        const timeoutMs = this.config.ollamaTimeout || this.config.timeout * 4;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const options: Record<string, any> = {
            temperature: this.config.temperature,
          };
          if (this.config.ollamaNumCtx) {
            options.num_ctx = this.config.ollamaNumCtx;
          }

          const resp = await fetch(`${baseUrl}/api/generate`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model,
              prompt: text,
              stream: false,
              options,
            }),
            signal: controller.signal,
          } as any);
          clearTimeout(timeoutId);

          if (!resp.ok) {
            const errorText = await resp.text().catch(() => 'Unknown error');
            let errorMessage = `Ollama error ${resp.status} (${baseUrl}): ${errorText}`;

            // Provide helpful suggestions for common errors
            if (errorText.includes('does not support generate')) {
              errorMessage +=
                `\n⚠️  Model "${model}" does not support generation. ` +
                `This appears to be an embedding model. ` +
                `Please set AI_MODEL to a chat model like "llama3.2:3b" or "llama3.2:1b" in your .env file. ` +
                `Embedding models should only be set in EMBEDDINGS_MODEL.`;
            } else if (resp.status === 500 && errorText.includes('memory')) {
              errorMessage +=
                `\n⚠️  Memory error detected. Solutions:` +
                `\n1) Use a smaller model: Set AI_MODEL=llama3.2:3b or AI_MODEL=llama3.2:1b in your .env` +
                `\n2) Increase Docker Desktop memory: Settings > Resources > Memory (recommended: 16GB+)` +
                `\n3) Current model "${model}" may be too large for available memory (6.3 GiB).`;
            }

            throw new Error(errorMessage);
          }
          const data = await resp.json();
          return data.response as string;
        } catch (error: any) {
          clearTimeout(timeoutId);
          // Handle timeout errors
          if (
            error.name === 'AbortError' ||
            error.message?.includes('aborted')
          ) {
            throw new Error(
              `Ollama request timeout after ${timeoutMs}ms. ` +
                `The model may be processing a complex prompt. ` +
                `Try: 1) Using a smaller model (e.g., llama3.2:1b), 2) Simplifying the prompt, or 3) Increasing OLLAMA_TIMEOUT environment variable (current: ${timeoutMs}ms).`,
            );
          }
          throw error;
        }
      }

      if (provider === 'groq') {
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
        return data.choices?.[0]?.text || '';
      }

      const model = customOptions
        ? this.getCompletionModel(customOptions)
        : this.completionModel;
      const prompt = PromptTemplate.fromTemplate(promptText);
      const chain = this.createChain(prompt, model);
      return await chain.invoke(variables);
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

      // Opción B: Reinicializar completamente
      this.vectorStore = await Chroma.fromDocuments(
        [], // Empezar vacío
        this.embeddings,
        {
          collectionName: 'activities', // Nuevo nombre para evitar conflictos
        },
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
}
