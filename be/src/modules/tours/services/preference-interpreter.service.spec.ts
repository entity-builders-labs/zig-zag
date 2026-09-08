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
        preferredFacets: [
          {
            dimension: 'theme',
            key: 'Arquitectura',
            confidence: 0.95,
            strength: 'strong',
          },
          {
            dimension: 'trait',
            key: 'tranquilo',
            confidence: 0.8,
            strength: 'medium',
          },
          {
            dimension: 'intent',
            key: 'walking-like',
            confidence: 0.85,
            strength: 'weak',
          },
          {
            dimension: 'winery_scale',
            key: 'boutique',
            confidence: 0.9,
            strength: 'strong',
          },
          // Should be dropped because exploration_style is dormant in Phase 2
          {
            dimension: 'exploration_style',
            key: 'relaxed',
            confidence: 0.9,
            strength: 'strong',
          },
        ],
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

    // Verify canonical mapping for localized Spanish "arquitectura" -> "architecture"
    const archFacet = result.intent.preferredFacets.find(
      (f) => f.dimension === 'theme' && f.key === 'architecture',
    );
    expect(archFacet).toBeDefined();
    expect(archFacet?.importance).toBe(1.0); // strong -> 1.0
    expect(archFacet?.confidence).toBeCloseTo(0.95);
    expect(archFacet?.source).toBe('free_text');

    // Verify walking-like -> walk and weak strength -> 0.5
    const walkFacet = result.intent.preferredFacets.find(
      (f) => f.dimension === 'intent' && f.key === 'walk',
    );
    expect(walkFacet).toBeDefined();
    expect(walkFacet?.importance).toBe(0.5); // weak -> 0.5
    expect(walkFacet?.confidence).toBeCloseTo(0.85);

    // Verify winery_scale boutique
    const wineryFacet = result.intent.preferredFacets.find(
      (f) => f.dimension === 'winery_scale' && f.key === 'boutique',
    );
    expect(wineryFacet).toBeDefined();
    expect(wineryFacet?.importance).toBe(1.0);

    // Verify exploration_style was filtered out
    const explorationFacet = result.intent.preferredFacets.find(
      (f) => f.dimension === 'exploration_style',
    );
    expect(explorationFacet).toBeUndefined();

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

    // Fallback maps "arquitectura" to canonical "architecture"
    const archFacet = result.intent.preferredFacets.find(
      (f) => f.dimension === 'theme' && f.key === 'architecture',
    );
    expect(archFacet).toBeDefined();
    expect(archFacet?.importance).toBe(1.0); // strong -> 1.0
    expect(archFacet?.confidence).toBe(0.9);
    expect(archFacet?.source).toBe('free_text');

    expect(result.trace.validationErrors).toContain('provider unavailable');
  });

  it('skips the provider for empty preferences', async () => {
    const { service, langChain } = makeService();

    const result = await service.interpret('   ');

    expect(langChain.generateChatResponse).not.toHaveBeenCalled();
    expect(result.trace.status).toBe('skipped');
    expect(result.intent.preferredFacets).toEqual([]);
    expect(result.intent.softConstraints).toEqual([]);
    expect(result.intent.ambiguities).toEqual([]);
  });
});
