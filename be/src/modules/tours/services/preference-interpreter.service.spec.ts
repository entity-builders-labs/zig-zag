import { PreferenceInterpreterService } from './preference-interpreter.service';

describe('PreferenceInterpreterService', () => {
  function makeService(response?: string, error?: Error) {
    const langChain = {
      getProviderMetadata: jest.fn(() => ({
        provider: 'gemini',
        model: 'gemini-test',
      })),
      generateChatResponse: jest.fn(async () => {
        if (error) throw error;
        return response ?? '{}';
      }),
    } as any;
    return {
      service: new PreferenceInterpreterService(langChain),
      langChain,
    };
  }

  it('normalizes a valid LLM response and records an applied trace', async () => {
    const { service, langChain } = makeService(
      JSON.stringify({
        preferredThemes: [' Arquitectura ', 'arquitectura'],
        preferredTraits: ['tranquilo'],
        excludedThemes: [],
        excludedTraits: [],
        hardExclusions: [],
        positiveSemanticQuery: 'edificios históricos',
        notes: ['prioridad alta'],
      }),
    );

    const result = await service.interpret('Quiero arquitectura tranquila');

    expect(langChain.generateChatResponse).toHaveBeenCalledTimes(1);
    expect(result.intent.preferredThemes).toEqual([
      'arquitectura',
      'arquitectura',
    ]);
    expect(result.trace.status).toBe('applied');
    expect(result.trace.provider).toBe('gemini');
    expect(result.trace.model).toBe('gemini-test');
    expect(result.trace.userPrompt).toBe('Quiero arquitectura tranquila');
  });

  it('uses a deterministic fallback when the provider fails', async () => {
    const { service } = makeService(
      undefined,
      new Error('provider unavailable'),
    );

    const result = await service.interpret(
      'Evitar iglesias y buscar arquitectura',
    );

    expect(result.trace.status).toBe('fallback');
    expect(result.intent.excludedThemes).toContain('religion');
    expect(result.intent.preferredThemes).toContain('arquitectura');
    expect(result.trace.validationErrors).toContain('provider unavailable');
  });

  it('skips the provider for empty preferences', async () => {
    const { service, langChain } = makeService();

    const result = await service.interpret('   ');

    expect(langChain.generateChatResponse).not.toHaveBeenCalled();
    expect(result.trace.status).toBe('skipped');
    expect(result.intent.preferredThemes).toEqual([]);
  });
});
