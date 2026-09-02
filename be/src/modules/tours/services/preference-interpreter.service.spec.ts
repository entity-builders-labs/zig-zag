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

  it('normalizes the complete typed LLM response and records an applied trace', async () => {
    const { service, langChain } = makeService(
      JSON.stringify({
        preferredThemes: [' Arquitectura '],
        preferredTraits: ['tranquilo'],
        preferredIntents: ['walking-like'],
        excludedThemes: [],
        excludedTraits: [],
        hardExclusions: ['religion'],
        softConstraints: ['prefer shade'],
        ambiguities: ['short walks could mean distance or duration'],
        dietaryPreferences: ['vegan'],
        accessibilityPreferences: ['wheelchair accessible'],
        budgetPreferences: ['low budget'],
        groupPreferences: ['family friendly'],
        positiveSemanticQuery: 'edificios históricos accesibles',
        notes: ['prioridad alta'],
      }),
    );

    const result = await service.interpret('Quiero arquitectura tranquila');

    expect(langChain.generateChatResponse).toHaveBeenCalledTimes(1);
    expect(result.intent.preferredThemes).toEqual(['arquitectura']);
    expect(result.intent.preferredIntents).toEqual(['walking-like']);
    expect(result.intent.dietaryPreferences).toEqual(['vegan']);
    expect(result.intent.accessibilityPreferences).toEqual([
      'wheelchair accessible',
    ]);
    expect(result.trace.status).toBe('applied');
    expect(result.trace.provider).toBe('gemini');
    expect(result.trace.model).toBe('gemini-test');
    expect(result.trace.userPrompt).toBe('Quiero arquitectura tranquila');
  });

  it('uses a deterministic fallback for religion, diet and accessibility when the provider fails', async () => {
    const { service } = makeService(
      undefined,
      new Error('provider unavailable'),
    );

    const result = await service.interpret(
      'Evitar iglesias, soy vegano, necesito silla de ruedas y busco arquitectura',
    );

    expect(result.trace.status).toBe('fallback');
    expect(result.intent.excludedThemes).toContain('religion');
    expect(result.intent.hardExclusions).toContain('religion');
    expect(result.intent.hardExclusions).toContain('non-vegan food');
    expect(result.intent.dietaryPreferences).toContain('vegan');
    expect(result.intent.accessibilityPreferences).toContain('accessibility');
    expect(result.intent.preferredThemes).toContain('arquitectura');
    expect(result.trace.validationErrors).toContain('provider unavailable');
  });

  it('skips the provider for empty preferences', async () => {
    const { service, langChain } = makeService();

    const result = await service.interpret('   ');

    expect(langChain.generateChatResponse).not.toHaveBeenCalled();
    expect(result.trace.status).toBe('skipped');
    expect(result.intent.preferredThemes).toEqual([]);
    expect(result.intent.softConstraints).toEqual([]);
    expect(result.intent.ambiguities).toEqual([]);
  });
});
