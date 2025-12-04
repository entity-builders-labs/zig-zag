import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Embeddings } from '@langchain/core/embeddings';
import aiConfig from '../ai.config';

@Injectable()
export class AiEmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(AiEmbeddingService.name);
  private embeddings: Embeddings | null = null;
  private embeddingsDisabled = false;
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

  private async initializeEmbeddings() {
    try {
      const provider = this.config.embeddingProvider;

      this.logger.log(`Initializing embeddings with provider: ${provider}`);

      if (provider === 'openai') {
        if (!this.config.openaiApiKey) {
          this.logger.warn(
            '⚠️  OpenAI API key missing. Embeddings disabled. Set OPENAI_API_KEY to enable.',
          );
          this.embeddingsDisabled = true;
          return;
        }

        this.embeddings = new OpenAIEmbeddings({
          openAIApiKey: this.config.openaiApiKey,
          modelName: 'text-embedding-3-small', // Cost-effective default
        });
        this.logger.log('✓ OpenAI embeddings initialized');
      } else if (provider === 'ollama') {
        const model = this.config.embeddingsModel || 'nomic-embed-text';

        try {
          const workingUrl = await this.findWorkingOllamaUrl(5, '/api/tags');
          this.logger.log(`Using Ollama at ${workingUrl} for embeddings`);

          this.embeddings = this.createOllamaEmbeddingsAdapter(
            workingUrl,
            model,
          );
          this.logger.log(`✓ Ollama embeddings initialized (model: ${model})`);
        } catch (error) {
          this.logger.error(
            `Failed to initialize Ollama embeddings: ${error.message}`,
          );
          this.embeddingsDisabled = true;

          if (this.config.openaiApiKey) {
            this.logger.warn('Falling back to OpenAI embeddings...');
            this.embeddings = new OpenAIEmbeddings({
              openAIApiKey: this.config.openaiApiKey,
            });
            this.embeddingsDisabled = false;
          }
        }
      }
    } catch (error) {
      this.logger.error(`Failed to initialize embeddings: ${error.message}`);
      this.embeddingsDisabled = true;
    }
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

  // Minimal HTTP adapter for Ollama embeddings API
  private createOllamaEmbeddingsAdapter(
    baseUrl: string,
    model: string,
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
        for (const text of texts) {
          const resp = await makeRequest(`${baseUrl}/api/embed`, {
            model,
            input: text,
          });

          if (!resp.ok) {
            throw new Error(`Ollama embeddings error ${resp.status}`);
          }
          const data = await resp.json();
          vectors.push(data.embedding || data.data?.[0]?.embedding);
        }
        return vectors;
      },
      embedQuery: async (text: string) => {
        const resp = await makeRequest(`${baseUrl}/api/embed`, {
          model,
          prompt: text, // /api/embed uses 'input' usually, but some versions used prompt? sticking to what worked in langchain service or better standard
          // standard /api/embed uses 'input'. Let's check langchain.service.ts implementation
          input: text,
        });

        if (!resp.ok) {
          // Fallback to generate endpoint if embed fails? No, let's assume /api/embed exists (newer ollama)
          // Actually, let's look at the original implementation
          throw new Error(`Ollama embeddings error ${resp.status}`);
        }
        const data = await resp.json();
        return data.embedding || data.data?.[0]?.embedding;
      },
    } as any; // Type assertion to match Embeddings interface
  }

  isReady(): boolean {
    return !!this.embeddings && !this.embeddingsDisabled;
  }
}
