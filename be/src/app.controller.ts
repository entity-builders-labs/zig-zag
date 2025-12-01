import { Controller, Get } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { AppService } from './app.service';
import aiConfig from './shared/ai/ai.config';
import { LangChainService } from './shared/ai/langchain.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    @Inject(aiConfig.KEY)
    private readonly aiConfiguration: ConfigType<typeof aiConfig>,
    private readonly langChainService: LangChainService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'backend',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('test/chroma')
  async testChroma() {
    return this.langChainService.testChromaConnection();
  }

  @Get('test/ollama')
  async testOllama() {
    const tryUrls = ['http://ollama:11434', 'http://localhost:11434'];
    const results: any[] = [];
    const embeddingsModel =
      this.aiConfiguration.embeddingsModel || 'nomic-embed-text';

    for (const url of tryUrls) {
      const result: any = {
        url,
        status: 'unknown',
        error: null,
        details: null,
        embeddings: {
          tested: false,
          status: 'not_tested',
          error: null,
          embeddingLength: null,
        },
      };

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

        const response = await fetch(`${url}/api/tags`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
        } as any);

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          result.status = 'connected';
          result.details = {
            models:
              data.models?.map((m: any) => ({
                name: m.name,
                size: m.size,
                modified_at: m.modified_at,
              })) || [],
            modelCount: data.models?.length || 0,
          };

          // Test embeddings if connection works
          try {
            result.embeddings.tested = true;
            const embedController = new AbortController();
            const embedTimeoutId = setTimeout(
              () => embedController.abort(),
              10000,
            ); // 10 second timeout for embeddings

            const testText = 'This is a test embedding';
            const embedResponse = await fetch(`${url}/api/embed`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: embeddingsModel,
                input: testText,
              }),
              signal: embedController.signal,
            } as any);

            clearTimeout(embedTimeoutId);

            if (embedResponse.ok) {
              const embedData = await embedResponse.json();
              const embedding =
                embedData.embedding || embedData.data?.[0]?.embedding;
              result.embeddings.status = 'success';
              result.embeddings.embeddingLength = embedding?.length || 0;
            } else {
              result.embeddings.status = 'error';
              const errorText = await embedResponse
                .text()
                .catch(() => 'Unknown error');
              result.embeddings.error = `HTTP ${embedResponse.status}: ${errorText}`;
            }
          } catch (embedError: any) {
            result.embeddings.status = 'error';
            if (embedError.name === 'AbortError') {
              result.embeddings.error = 'Embedding timeout (10s)';
            } else {
              result.embeddings.error =
                embedError.message || String(embedError);
            }
          }
        } else {
          result.status = 'error';
          result.error = `HTTP ${response.status}: ${await response.text().catch(() => 'Unknown error')}`;
        }
      } catch (error: any) {
        result.status = 'error';
        if (error.name === 'AbortError') {
          result.error = 'Connection timeout (5s)';
        } else {
          result.error = error.message || String(error);
        }
      }

      results.push(result);
    }

    const workingUrl = results.find((r) => r.status === 'connected');
    const workingEmbeddings = results.find(
      (r) => r.embeddings.status === 'success',
    );

    const summary = {
      connected: !!workingUrl,
      workingUrl: workingUrl?.url || null,
      embeddingsWorking: !!workingEmbeddings,
      embeddingsModel,
      results,
    };

    return {
      success: !!workingUrl,
      embeddingsSuccess: !!workingEmbeddings,
      message: workingUrl
        ? `Ollama is accessible at ${workingUrl.url}${
            workingEmbeddings
              ? ` and embeddings are working with model "${embeddingsModel}"`
              : ` but embeddings failed (model: "${embeddingsModel}")`
          }`
        : 'Ollama is not accessible at any of the tested URLs',
      ...summary,
    };
  }
}
