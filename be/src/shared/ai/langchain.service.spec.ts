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
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 404 });

      await expect(
        service.generateCompletionResponse('Classify: {name}', {
          name: 'x',
        }),
      ).rejects.toThrow('Groq error 404');
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
});
