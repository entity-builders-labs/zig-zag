import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { OpenAI, ChatOpenAI } from '@langchain/openai';
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
import aiConfig from './ai.config';
import { Activity } from '@prisma/client';
import { AiCacheService } from './services/ai-cache.service';

export type GroqResponseFormat =
  | { type: 'json_object' }
  | {
      type: 'json_schema';
      json_schema: {
        name: string;
        strict: true;
        schema: Record<string, unknown>;
      };
    };

export type ChatResponseOptions = Partial<
  ConstructorParameters<typeof ChatOpenAI>[0]
> & {
  responseFormat?: GroqResponseFormat;
  groq?: {
    maxCompletionTokens?: number;
    reasoningEffort?: 'low' | 'medium' | 'high';
    includeReasoning?: boolean;
  };
};

@Injectable()
export class LangChainService {
  private readonly logger = new Logger(LangChainService.name);
  private chatModel: any;
  private completionModel: any;
  private readonly groqMaxRateLimitRetries = 1;

  constructor(
    @Inject(aiConfig.KEY)
    private readonly config: ConfigType<typeof aiConfig>,
    private readonly aiCache: AiCacheService,
  ) {
    this.initializeModels();
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

  // Helper to get Ollama base URL
  private getOllamaBaseUrl(): string {
    return this.config.ollamaBaseUrl || 'http://localhost:11434';
  }

  private groqRetryDelayMs(resp: Response, errorBody: string): number {
    const retryAfter = resp.headers?.get?.('retry-after');
    const retryAfterSeconds = retryAfter ? Number(retryAfter) : NaN;
    if (Number.isFinite(retryAfterSeconds)) {
      return Math.min(10_000, Math.max(250, retryAfterSeconds * 1000));
    }

    const messageDelay = errorBody.match(
      /(?:try again|retry)\s+in\s+([\d.]+)\s*(ms|s)/i,
    );
    if (messageDelay) {
      const value = Number(messageDelay[1]);
      const milliseconds =
        messageDelay[2].toLowerCase() === 'ms' ? value : value * 1000;
      return Math.min(10_000, Math.max(250, Math.ceil(milliseconds) + 100));
    }
    return 1000;
  }

  private async fetchGroq(init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const resp = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        init,
      );
      if (resp.ok) return resp;

      const errorBody = await resp.text();
      if (resp.status === 429 && attempt < this.groqMaxRateLimitRetries) {
        const delayMs = this.groqRetryDelayMs(resp, errorBody);
        this.logger.warn(
          `Groq rate limited the request; retrying once in ${delayMs}ms.`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      this.logger.error(`Groq error ${resp.status}: ${errorBody}`);
      throw new Error(`Groq error ${resp.status}: ${errorBody}`);
    }
  }

  private initializeModels(): void {
    try {
      const provider = this.config.provider;
      if (!this.config.enableAi) {
        this.logger.warn('AI disabled via ENABLE_AI=false');
        return;
      }

      // Validate chat model is not an embedding model (for Ollama/Groq/Gemini)
      if (provider === 'ollama' || provider === 'groq' || provider === 'gemini') {
        const model = this.config.defaultModel;
        try {
          this.validateChatModel(model);
        } catch (validationError: any) {
          this.logger.error(
            `⚠️  Configuration error: ${validationError.message}`,
          );
          throw validationError;
        }
        this.logger.log(`AI provider: ${provider}, chat model: ${model}`);
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
        this.completionModel = new ChatOllama(ollamaConfig);
      } else {
        // For gemini and groq we use direct API calls in generateChatResponse/generateCompletionResponse
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
    if (inputVariables && inputVariables.length > 0) {
      return new PromptTemplate({ template, inputVariables });
    }
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
    options: ChatResponseOptions = {},
  ): Promise<string> {
    const {
      responseFormat: requestedResponseFormat,
      groq: groqOptions,
      ...modelOptions
    } = options;
    const responseShapeOptions = {
      responseFormat: requestedResponseFormat,
      groq: groqOptions,
    };
    const cachePrompt =
      requestedResponseFormat || groqOptions
        ? `${systemPrompt}|${userPrompt}|${JSON.stringify(responseShapeOptions)}`
        : `${systemPrompt}|${userPrompt}`;
    // Check cache first
    const cached = await this.aiCache.getCachedResponse(cachePrompt, {
      type: 'chat',
      variables,
    });
    if (cached) return cached;

    try {
      let response = '';
      const provider = this.config.provider;

      if (provider === 'ollama') {
        const model = this.chatModel;
        if (!model) {
          throw new Error(
            'Ollama chat model not initialized. Please check your Ollama configuration.',
          );
        }

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
          // Handle errors (truncated for brevity, same as original)
          throw error;
        }
      } else if (provider === 'gemini') {
        const userTmpl = PromptTemplate.fromTemplate(userPrompt);
        const userText = await userTmpl.format(variables as any);
        const model = this.config.defaultModel || 'gemini-3.6-flash';

        const payload: any = {
          contents: [
            {
              role: 'user',
              parts: [{ text: userText }],
            },
          ],
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          generationConfig: {
            temperature: this.config.temperature,
            responseMimeType: 'application/json',
          },
        };

        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.config.geminiApiKey}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          } as any,
        );

        if (!resp.ok) {
          const errorBody = await resp.text();
          this.logger.error(`Gemini error ${resp.status}: ${errorBody}`);
          throw new Error(`Gemini error ${resp.status}: ${errorBody}`);
        }

        const data = await resp.json();
        const candidateText =
          data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        response = candidateText.trim();
      } else if (provider === 'groq') {
        const userTmpl = PromptTemplate.fromTemplate(userPrompt);
        const userText = await userTmpl.format(variables as any);
        const model = this.config.defaultModel || 'llama-3.1-8b-instant';
        const responseFormat = requestedResponseFormat ?? {
          type: 'json_object' as const,
        };
        if (
          responseFormat.type === 'json_schema' &&
          !/^openai\/gpt-oss-(20b|120b)$/.test(model)
        ) {
          throw new Error(
            `Groq model "${model}" does not support strict JSON Schema output. ` +
              'Use openai/gpt-oss-20b or openai/gpt-oss-120b.',
          );
        }

        const resp = await this.fetchGroq({
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
            temperature:
              responseFormat.type === 'json_schema'
                ? 0
                : this.config.temperature,
            ...(groqOptions?.maxCompletionTokens
              ? {
                  max_completion_tokens: groqOptions.maxCompletionTokens,
                }
              : {}),
            ...(groqOptions?.reasoningEffort
              ? { reasoning_effort: groqOptions.reasoningEffort }
              : {}),
            ...(groqOptions?.includeReasoning !== undefined
              ? { include_reasoning: groqOptions.includeReasoning }
              : {}),
            // Every caller of generateChatResponse (tour generation,
            // composite generation, activity metadata) parses the result
            // as JSON — without this, Groq's chat models are free to
            // return "pretty" JSON with unescaped characters (em-dashes,
            // stray quotes) that reliably breaks JSON.parse on long
            // responses. Forcing JSON mode at the API level, not just via
            // prompt instructions, is what actually fixes it. Unlike
            // generateCompletionResponse below, every current caller here
            // expects JSON, so this is safe unconditionally.
            response_format: responseFormat,
          }),
        } as any);
        const data = await resp.json();
        const rawContent = data.choices?.[0]?.message?.content || '';
        response = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      } else {
        // Default: OpenAI via LangChain
        const model = Object.keys(modelOptions).length
          ? this.getChatModel(modelOptions)
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
      await this.aiCache.cacheResponse(cachePrompt, response, {
        type: 'chat',
        variables,
      });
      return response;
    } catch (error) {
      this.logger.error(`Error generating chat response: ${error.message}`);
      throw error;
    }
  }

  async generateCompletionResponse(
    promptText: string,
    variables: Record<string, string> = {},
    customOptions?: Partial<ConstructorParameters<typeof OpenAI>[0]>,
  ): Promise<string> {
    // Check cache first
    const cached = await this.aiCache.getCachedResponse(promptText, {
      type: 'completion',
      variables,
    });
    if (cached) return cached;

    try {
      let response = '';
      const provider = this.config.provider;

      if (provider === 'ollama') {
        const model = this.completionModel;
        const prompt = PromptTemplate.fromTemplate(promptText);
        const chain = this.createChain(prompt, model);
        response = await chain.invoke(variables);
      } else if (provider === 'gemini') {
        const tmpl = PromptTemplate.fromTemplate(promptText);
        const text = await tmpl.format(variables as any);
        const model = this.config.defaultModel || 'gemini-3.6-flash';

        const payload: any = {
          contents: [
            {
              role: 'user',
              parts: [{ text }],
            },
          ],
          generationConfig: {
            temperature: this.config.temperature,
          },
        };

        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.config.geminiApiKey}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          } as any,
        );

        if (!resp.ok) {
          const errorBody = await resp.text();
          this.logger.error(`Gemini completion error ${resp.status}: ${errorBody}`);
          throw new Error(`Gemini completion error ${resp.status}: ${errorBody}`);
        }

        const data = await resp.json();
        const candidateText =
          data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        response = candidateText.trim();
      } else if (provider === 'groq') {
        const tmpl = PromptTemplate.fromTemplate(promptText);
        const text = await tmpl.format(variables as any);
        const model = this.config.defaultModel || 'llama-3.3-70b-versatile';

        const resp = await this.fetchGroq({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.groqApiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: text }],
            temperature: this.config.temperature,
          }),
        } as any);
        const data = await resp.json();
        const rawCompletion = data.choices?.[0]?.message?.content || '';
        response = rawCompletion.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      } else {
        const model = customOptions
          ? this.getCompletionModel(customOptions)
          : this.completionModel;
        const prompt = PromptTemplate.fromTemplate(promptText);
        const chain = this.createChain(prompt, model);
        response = await chain.invoke(variables);
      }

      await this.aiCache.cacheResponse(promptText, response, {
        type: 'completion',
        variables,
      });
      return response;
    } catch (error) {
      this.logger.error(
        `Error generating completion response: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

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
}
