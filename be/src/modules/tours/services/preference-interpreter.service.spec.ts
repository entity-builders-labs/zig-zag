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

  it('accepts JSON already normalized by the provider boundary', async () => {
    const { service } = makeService(
      '{"anchoredPlaces":[{"rawName":"San Telmo","kind":"area","priority":"must"}]}',
    );

    const result = await service.interpret(
      'sí o sí quiero una caminata histórica por San Telmo',
    );

    expect(result.trace.status).toBe('applied');
    expect(result.intent.anchoredPlaces).toEqual([
      {
        rawName: 'San Telmo',
        usage: 'unknown',
        kind: 'unknown',
        priority: 'must',
      },
    ]);
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
    expect(result.intent.anchoredPlaces).toEqual([]);
  });

  it('drops invalid keys for controlled dimensions in LLM response', async () => {
    const { service } = makeService(
      JSON.stringify({
        preferredFacets: [
          {
            dimension: 'theme',
            key: 'unsupported_theme_123',
            confidence: 0.9,
            strength: 'strong',
          },
          {
            dimension: 'theme',
            key: 'history',
            confidence: 0.9,
            strength: 'strong',
          },
        ],
      }),
    );

    const result = await service.interpret('Quiero algo raro e historia');
    expect(result.intent.preferredFacets).toHaveLength(1);
    expect(result.intent.preferredFacets[0].key).toBe('history');
  });

  it('repairs uniquely mappable malformed dimensions and traces rejected facets', async () => {
    const { service } = makeService(
      JSON.stringify({
        preferredFacets: [
          {
            dimension: 'nature_type',
            key: 'history',
            confidence: 0.8,
            strength: 'strong',
          },
          {
            dimension: 'tourism_intensity',
            key: 'walk',
            confidence: 0.7,
            strength: 'medium',
          },
          {
            dimension: 'local_character',
            key: 'San Telmo',
            confidence: 0.9,
            strength: 'strong',
          },
          {
            dimension: 'invalid_dimension',
            key: 'food',
            confidence: 0.5,
            strength: 'weak',
          },
        ],
        anchoredPlaces: [
          { rawName: 'San Telmo', kind: 'area', priority: 'must' },
        ],
      }),
    );

    const result = await service.interpret(
      'sí o sí quiero una caminata histórica por San Telmo',
    );
    expect(result.intent.preferredFacets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimension: 'theme', key: 'history' }),
        expect.objectContaining({ dimension: 'intent', key: 'walk' }),
      ]),
    );
    expect(result.intent.preferredFacets).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dimension: 'local_character',
          key: 'san_telmo',
        }),
      ]),
    );
    expect(result.intent.anchoredPlaces).toEqual([
      {
        rawName: 'San Telmo',
        usage: 'unknown',
        kind: 'unknown',
        priority: 'must',
      },
    ]);
    expect(result.trace.facetNormalizationDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rawDimension: 'nature_type',
          rawKey: 'history',
          normalizedDimension: 'theme',
          normalizedKey: 'history',
          accepted: true,
          reason: 'REPAIRED_UNIQUE_VOCABULARY_MATCH',
        }),
        expect.objectContaining({
          rawDimension: 'tourism_intensity',
          rawKey: 'walk',
          normalizedDimension: 'intent',
          normalizedKey: 'walk',
          accepted: true,
          reason: 'REPAIRED_UNIQUE_VOCABULARY_MATCH',
        }),
        expect.objectContaining({
          rawDimension: 'local_character',
          rawKey: 'san telmo',
          accepted: false,
          reason: 'UNKNOWN_KEY',
        }),
        expect.objectContaining({
          rawDimension: 'invalid_dimension',
          rawKey: 'food',
          accepted: false,
          reason: 'AMBIGUOUS_CROSS_DIMENSION_KEY',
        }),
      ]),
    );
  });

  it('drops facets with missing or blank dimension in LLM response', async () => {
    const { service } = makeService(
      JSON.stringify({
        preferredFacets: [
          {
            key: 'history',
            confidence: 0.9,
            strength: 'strong',
          },
          {
            dimension: '',
            key: 'history',
            confidence: 0.9,
            strength: 'strong',
          },
          {
            dimension: 'theme',
            key: 'history',
            confidence: 0.9,
            strength: 'strong',
          },
        ],
      }),
    );

    const result = await service.interpret('Quiero historia');
    expect(result.intent.preferredFacets).toHaveLength(1);
    expect(result.intent.preferredFacets[0]).toEqual(
      expect.objectContaining({
        dimension: 'theme',
        key: 'history',
        confidence: 0.9,
        importance: 1.0,
      }),
    );
  });

  describe('anchoredPlaces (D3)', () => {
    it('preserves linguistic usage but never accepts the LLM geographic kind', async () => {
      const { service } = makeService(
        JSON.stringify({
          anchoredPlaces: [
            {
              rawName: 'San Telmo',
              usage: 'geographic_scope',
              kind: 'venue',
              priority: 'must',
            },
          ],
        }),
      );

      await expect(
        service.interpret(
          'sí o sí quiero una caminata histórica por San Telmo',
        ),
      ).resolves.toEqual(
        expect.objectContaining({
          intent: expect.objectContaining({
            anchoredPlaces: [
              {
                rawName: 'San Telmo',
                usage: 'geographic_scope',
                kind: 'unknown',
                priority: 'must',
              },
            ],
          }),
        }),
      );
    });

    describe('prompt contract', () => {
      it('sends the conservative D3 anchor-priority rules to the LLM', async () => {
        const { service, langChain } = makeService(
          JSON.stringify({ anchoredPlaces: [] }),
        );

        await service.interpret('Quiero visitar el Teatro Colón');

        expect(langChain.generateChatResponse).toHaveBeenCalledTimes(1);

        // generateChatResponse(systemPrompt, userPrompt, variables, options) --
        // the system prompt is the first positional argument.
        const systemPrompt = langChain.generateChatResponse.mock.calls[0][0];

        // must: explicit, unambiguous named-place intent only.
        expect(systemPrompt).toContain(
          '"must" ONLY for explicit, unambiguous named-place intent',
        );
        expect(systemPrompt).toContain('quiero visitar X');
        expect(systemPrompt).toContain('incluí X');
        expect(systemPrompt).toContain('sí o sí quiero ir a X');
        expect(systemPrompt).toContain('no me quiero perder X');

        // soft: weaker/ambiguous wording, including a mere thematic mention,
        // must never escalate to "must".
        expect(systemPrompt).toContain('weaker or ambiguous');
        expect(systemPrompt).toContain('is priority "soft"');
        expect(systemPrompt).toContain('me interesa la arquitectura de X');

        // no hallucination: never invent named places that were not mentioned.
        expect(systemPrompt.toLowerCase()).toContain(
          'do not invent named places',
        );
      });
    });

    it('preserves an explicit must anchor emitted for unambiguous named-place intent ("sí o sí X")', async () => {
      const { service } = makeService(
        JSON.stringify({
          anchoredPlaces: [
            { rawName: 'Teatro Colón', kind: 'venue', priority: 'must' },
          ],
        }),
      );

      const result = await service.interpret(
        'Sí o sí quiero ir al Teatro Colón',
      );

      expect(result.intent.anchoredPlaces).toEqual([
        {
          rawName: 'Teatro Colón',
          usage: 'unknown',
          kind: 'unknown',
          priority: 'must',
        },
      ]);
    });

    it('keeps a weakly-worded mention as a soft anchor ("me gustaría conocer X")', async () => {
      const { service } = makeService(
        JSON.stringify({
          anchoredPlaces: [
            { rawName: 'Teatro Colón', kind: 'venue', priority: 'soft' },
          ],
        }),
      );

      const result = await service.interpret(
        'Me gustaría conocer el Teatro Colón',
      );

      expect(result.intent.anchoredPlaces).toEqual([
        {
          rawName: 'Teatro Colón',
          usage: 'unknown',
          kind: 'unknown',
          priority: 'soft',
        },
      ]);
    });

    it('keeps a mere thematic mention of a place as a soft anchor, never must', async () => {
      const { service } = makeService(
        JSON.stringify({
          anchoredPlaces: [
            { rawName: 'Teatro Colón', kind: 'venue', priority: 'soft' },
          ],
          preferredFacets: [
            {
              dimension: 'theme',
              key: 'architecture',
              confidence: 0.8,
              strength: 'medium',
            },
          ],
        }),
      );

      const result = await service.interpret(
        'Me interesa la arquitectura del Teatro Colón',
      );

      expect(result.intent.anchoredPlaces).toEqual([
        {
          rawName: 'Teatro Colón',
          usage: 'unknown',
          kind: 'unknown',
          priority: 'soft',
        },
      ]);
    });

    it('degrades malformed anchor payloads safely', async () => {
      const { service } = makeService(
        JSON.stringify({
          anchoredPlaces: [
            { rawName: 'Teatro Colón', kind: 'venue', priority: 'must' },
            { rawName: '   ', kind: 'venue', priority: 'must' },
            { kind: 'venue', priority: 'must' },
            'not-an-object',
            42,
            null,
            { rawName: 'Bodega Norton', kind: 'winery', priority: 'must' },
            { rawName: 'Some Place', kind: 'venue', priority: 'urgent' },
            { rawName: 'Plain Mention', kind: 'venue' },
            { rawName: 'No Kind Given', priority: 'soft' },
          ],
        }),
      );

      const result = await service.interpret('cualquier texto');

      expect(result.intent.anchoredPlaces).toEqual([
        {
          rawName: 'Teatro Colón',
          usage: 'unknown',
          kind: 'unknown',
          priority: 'must',
        },
        {
          rawName: 'Bodega Norton',
          usage: 'unknown',
          kind: 'unknown',
          priority: 'must',
        },
        {
          rawName: 'Some Place',
          usage: 'unknown',
          kind: 'unknown',
          priority: 'soft',
        },
        {
          rawName: 'Plain Mention',
          usage: 'unknown',
          kind: 'unknown',
          priority: 'soft',
        },
        {
          rawName: 'No Kind Given',
          usage: 'unknown',
          kind: 'unknown',
          priority: 'soft',
        },
      ]);
    });

    it('caps the anchor count conservatively', async () => {
      const anchors = Array.from({ length: 10 }, (_, i) => ({
        rawName: `Place ${i}`,
        kind: 'venue',
        priority: 'soft',
      }));
      const { service } = makeService(
        JSON.stringify({ anchoredPlaces: anchors }),
      );

      const result = await service.interpret('texto con muchos lugares');

      expect(result.intent.anchoredPlaces.length).toBeLessThanOrEqual(5);
    });

    it('defaults anchoredPlaces to an empty array in the deterministic fallback', async () => {
      const { service } = makeService(
        undefined,
        new Error('provider unavailable'),
      );

      const result = await service.interpret('Quiero ir al Teatro Colón');

      expect(result.intent.anchoredPlaces).toEqual([]);
    });
  });
});
