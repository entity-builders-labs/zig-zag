import { Test, TestingModule } from '@nestjs/testing';
import { LangChainService } from './langchain.service';
import aiConfig from './ai.config';
import { AiCacheService } from './services/ai-cache.service';

describe('LangChainService', () => {
  let service: LangChainService;

  const mockConfig = {
    enableAi: true,
    provider: 'groq' as const,
    defaultModel: 'llama-3.1-8b-instant',
    temperature: 0.7,
    timeout: 60000,
    groqApiKey: 'test-groq-key',
    embeddingProvider: 'openai' as const,
  };

  const mockAiCacheService = {
    getCachedResponse: jest.fn().mockResolvedValue(null),
    cacheResponse: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LangChainService,
        { provide: aiConfig.KEY, useValue: mockConfig },
        { provide: AiCacheService, useValue: mockAiCacheService },
      ],
    }).compile();

    service = module.get<LangChainService>(LangChainService);
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  describe('generateCompletionResponse (Groq)', () => {
    it('calls the chat-completions endpoint, not the legacy /v1/completions one', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'cultural' } }],
        }),
      });

      const result = await service.generateCompletionResponse(
        'Classify this place: {name}',
        { name: 'Museo Nacional' },
      );

      expect(result).toBe('cultural');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.groq.com/openai/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"messages"'),
        }),
      );

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.messages).toEqual([
        { role: 'user', content: 'Classify this place: Museo Nacional' },
      ]);
    });

    it('throws a descriptive error when the request fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'model not found',
      });

      await expect(
        service.generateCompletionResponse('Classify: {name}', {
          name: 'x',
        }),
      ).rejects.toThrow('Groq error 404: model not found');
    });

    it('returns the cached response without calling fetch when present', async () => {
      mockAiCacheService.getCachedResponse.mockResolvedValueOnce(
        'cached-value',
      );

      const result = await service.generateCompletionResponse(
        'Classify: {name}',
        {
          name: 'x',
        },
      );

      expect(result).toBe('cached-value');
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('generateChatResponse (Groq)', () => {
    it('requests JSON mode at the API level, not just via prompt instructions', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"title":"Tour"}' } }],
        }),
      });

      await service.generateChatResponse(
        'You are a tour planner.',
        'Plan a tour of {city}',
        { city: 'Rosario' },
      );

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(options.body);
      // Every caller of generateChatResponse parses the result as JSON —
      // without response_format, Groq's chat models are free to return
      // "pretty" JSON with unescaped characters that breaks JSON.parse on
      // long responses (the actual bug this covers).
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(body.messages).toEqual([
        { role: 'system', content: 'You are a tour planner.' },
        { role: 'user', content: 'Plan a tour of Rosario' },
      ]);
    });

    it('uses strict JSON Schema output deterministically when requested', async () => {
      (service as any).config.defaultModel = 'openai/gpt-oss-120b';
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"title":"Tour"}' } }],
        }),
      });
      const schema = {
        type: 'object',
        additionalProperties: false,
        properties: { title: { type: 'string' } },
        required: ['title'],
      };

      await service.generateChatResponse(
        'system',
        'user prompt',
        {},
        {
          responseFormat: {
            type: 'json_schema',
            json_schema: {
              name: 'tour_generation',
              strict: true,
              schema,
            },
          },
        },
      );

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.temperature).toBe(0);
      expect(body.response_format).toEqual({
        type: 'json_schema',
        json_schema: {
          name: 'tour_generation',
          strict: true,
          schema,
        },
      });
    });

    it('passes explicit completion and reasoning limits for complex structured output', async () => {
      (service as any).config.defaultModel = 'openai/gpt-oss-120b';
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"title":"Tour"}' } }],
        }),
      });

      await service.generateChatResponse(
        'system',
        'user prompt',
        {},
        {
          groq: {
            maxCompletionTokens: 8192,
            reasoningEffort: 'low',
            includeReasoning: false,
          },
          responseFormat: {
            type: 'json_schema',
            json_schema: {
              name: 'tour_generation',
              strict: true,
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: { title: { type: 'string' } },
                required: ['title'],
              },
            },
          },
        },
      );

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.max_completion_tokens).toBe(8192);
      expect(body.reasoning_effort).toBe('low');
      expect(body.include_reasoning).toBe(false);
    });

    it('rejects strict JSON Schema output for an unsupported Groq model', async () => {
      (service as any).config.defaultModel = 'llama-3.3-70b-versatile';

      await expect(
        service.generateChatResponse(
          'system',
          'user prompt',
          {},
          {
            responseFormat: {
              type: 'json_schema',
              json_schema: {
                name: 'tour_generation',
                strict: true,
                schema: { type: 'object' },
              },
            },
          },
        ),
      ).rejects.toThrow('does not support strict JSON Schema output');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns the message content from the chat-completions response', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"title":"Tour"}' } }],
        }),
      });

      const result = await service.generateChatResponse(
        'system',
        'user prompt',
      );

      expect(result).toBe('{"title":"Tour"}');
    });

    it('throws a descriptive error when the request fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'internal error',
      });

      await expect(
        service.generateChatResponse('system', 'user prompt'),
      ).rejects.toThrow('Groq error 500: internal error');
    });

    it('retries one transient Groq TPM limit using the provider delay', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: { get: (): string | null => null },
          text: async () =>
            JSON.stringify({
              error: {
                message: 'Rate limit reached. Please try again in 0.001s.',
              },
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '{"title":"Tour"}' } }],
          }),
        });

      const result = await service.generateChatResponse(
        'system',
        'user prompt',
      );

      expect(result).toBe('{"title":"Tour"}');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('does not retry a Groq rate limit more than the max retry count', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 429,
        headers: { get: () => '0' },
        text: async () => 'still rate limited',
      });

      await expect(
        service.generateChatResponse('system', 'user prompt'),
      ).rejects.toThrow('Groq error 429: still rate limited');
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });
  });

  describe('generateChatResponse — per-call provider / model / cache overrides', () => {
    const geminiBaseConfig = {
      enableAi: true,
      provider: 'gemini' as const,
      defaultModel: 'gemini-some-default',
      temperature: 0.7,
      timeout: 60000,
      groqApiKey: 'test-groq-key',
      geminiApiKey: 'test-gemini-key',
      embeddingProvider: 'openai' as const,
    };

    const cacheStub = {
      getCachedResponse: jest.fn(),
      cacheResponse: jest.fn().mockResolvedValue(undefined),
    };

    let overrideService: LangChainService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          LangChainService,
          { provide: aiConfig.KEY, useValue: geminiBaseConfig },
          { provide: AiCacheService, useValue: cacheStub },
        ],
      }).compile();
      overrideService = module.get(LangChainService);
      jest.clearAllMocks();
      cacheStub.getCachedResponse.mockResolvedValue(null);
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"ok":true}' } }],
        }),
      });
    });

    it('routes to Groq when providerOverride is "groq" even though AI_PROVIDER is gemini', async () => {
      await overrideService.generateChatResponse(
        'sys',
        'user',
        {},
        {
          providerOverride: 'groq',
          modelOverride: 'qwen/qwen3.8-27b',
          responseFormat: { type: 'json_object' },
        },
      );

      const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
      expect(JSON.parse(options.body).model).toBe('qwen/qwen3.8-27b');
    });

    it('bypassCache:true skips the cache read even when a cached value exists', async () => {
      cacheStub.getCachedResponse.mockResolvedValue('CACHED');

      const result = await overrideService.generateChatResponse(
        'sys',
        'user',
        {},
        {
          providerOverride: 'groq',
          modelOverride: 'qwen/qwen3.8-27b',
          bypassCache: true,
          responseFormat: { type: 'json_object' },
        },
      );

      expect(result).toBe('{"ok":true}');
      expect(cacheStub.getCachedResponse).not.toHaveBeenCalled();
      expect(cacheStub.cacheResponse).not.toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalled();
    });

    it('without bypassCache, a cached value short-circuits the real call', async () => {
      cacheStub.getCachedResponse.mockResolvedValue('CACHED');

      const result = await overrideService.generateChatResponse(
        'sys',
        'user',
        {},
        {
          providerOverride: 'groq',
          modelOverride: 'qwen/qwen3.8-27b',
          responseFormat: { type: 'json_object' },
        },
      );

      expect(result).toBe('CACHED');
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
