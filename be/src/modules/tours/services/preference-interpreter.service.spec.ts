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
        if (!response) return '{}';
        return response;
      }),
    } as any;
    return {
      service: new PreferenceInterpreterService(langChain),
      langChain,
    };
  }

  /** One extractor assertion as the LLM returns it. */
  const assertion = (fields: Record<string, unknown>) => ({
    dimension: 'theme',
    key: 'architecture',
    polarity: 'INCLUDE',
    constraint: 'SOFT',
    provenance: 'DIRECT',
    strength: 'strong',
    confidence: 0.9,
    evidence: ['me encanta la arquitectura'],
    ...fields,
  });
  const interpretWith = async (
    text: string,
    payload: Record<string, unknown>,
  ) => makeService(JSON.stringify(payload)).service.interpret(text);

  it('keeps a valid typed assertion exactly as the extractor asserted it', async () => {
    const result = await interpretWith('me encanta la arquitectura', {
      assertions: [assertion({})],
      positiveSemanticQuery: 'arquitectura',
    });

    expect(result.trace.status).toBe('applied');
    expect(result.intent.assertions).toEqual([
      {
        target: { dimension: 'theme', key: 'architecture' },
        polarity: 'INCLUDE',
        constraint: 'SOFT',
        provenance: 'DIRECT',
        importance: 1.0,
        confidence: 0.9,
        evidence: [
          { kind: 'USER_TEXT_SPAN', text: 'me encanta la arquitectura' },
        ],
      },
    ]);
    expect(result.trace.facetNormalizationDecisions).toEqual([
      expect.objectContaining({ accepted: true, reason: 'VALID_AS_EMITTED' }),
    ]);
  });

  it('never upgrades provenance or flips polarity from the words in the text', async () => {
    // Paraphrases: the extractor owns the semantics; validation only checks
    // that the claimed evidence is in the text. "arquitectura" appearing in
    // an INFERRED or EXCLUDE assertion's evidence changes nothing.
    const inferred = await interpretWith('quiero ver los edificios de Gaudí', {
      assertions: [
        assertion({
          provenance: 'INFERRED',
          evidence: ['los edificios de Gaudí'],
        }),
      ],
    });
    expect(inferred.intent.assertions[0].provenance).toBe('INFERRED');

    const negated = await interpretWith('no me interesa la arquitectura', {
      assertions: [
        assertion({
          polarity: 'EXCLUDE',
          evidence: ['no me interesa la arquitectura'],
        }),
      ],
    });
    expect(negated.intent.assertions).toEqual([
      expect.objectContaining({ polarity: 'EXCLUDE', provenance: 'DIRECT' }),
    ]);

    const paraphrase = await interpretWith(
      'nada de edificios religiosos, por favor',
      {
        assertions: [],
        unresolvedConcepts: [
          {
            label: 'religious buildings',
            polarity: 'EXCLUDE',
            constraint: 'HARD',
            evidence: ['nada de edificios religiosos'],
          },
        ],
      },
    );
    expect(paraphrase.intent.assertions).toEqual([]);
    expect(paraphrase.intent.unresolvedConcepts).toEqual([
      {
        label: 'religious buildings',
        polarity: 'EXCLUDE',
        constraint: 'HARD',
        evidence: [
          { kind: 'USER_TEXT_SPAN', text: 'nada de edificios religiosos' },
        ],
        reason: 'UNRESOLVED_OPEN_CONCEPT',
      },
    ]);
  });

  it('accepts only targets of the typed schema and never translates a word into a key', async () => {
    const result = await interpretWith(
      'me encanta la arquitectura y el arte moderno',
      {
        assertions: [
          assertion({ key: 'Arquitectura' }),
          assertion({ key: 'modern_art', evidence: ['el arte moderno'] }),
          assertion({ dimension: 'trait', key: 'tranquilo' }),
          assertion({ dimension: 'exploration_style', key: 'iconic' }),
          assertion({
            dimension: 'local_character',
            key: 'Contemporary',
            evidence: ['el arte moderno'],
          }),
        ],
      },
    );

    expect(result.intent.assertions.map((item) => item.target)).toEqual([
      { dimension: 'local_character', key: 'contemporary' },
    ]);
    expect(
      result.trace.facetNormalizationDecisions!.map(
        (decision) => decision.reason,
      ),
    ).toEqual([
      'UNKNOWN_KEY',
      'UNKNOWN_KEY',
      'UNKNOWN_DIMENSION',
      'UNKNOWN_DIMENSION',
      'VALID_AS_EMITTED',
    ]);
  });

  it('requires every evidence excerpt to occur token-bounded in the user text', async () => {
    const result = await interpretWith('quiero ir el martes al centro', {
      assertions: [
        assertion({ key: 'art', evidence: ['arte'] }),
        assertion({ key: 'history', evidence: [] }),
        assertion({ key: 'culture', evidence: ['el martes', 'un museo'] }),
      ],
    });

    expect(result.intent.assertions).toEqual([]);
    expect(
      result.trace.facetNormalizationDecisions!.map(
        (decision) => decision.reason,
      ),
    ).toEqual([
      'UNSUPPORTED_BY_INPUT',
      'MISSING_EVIDENCE',
      'UNSUPPORTED_BY_INPUT',
    ]);
  });

  it('rejects assertions with a missing or invalid field instead of defaulting it', async () => {
    const result = await interpretWith('me encanta la arquitectura', {
      assertions: [
        assertion({ strength: undefined }),
        assertion({ provenance: 'WIZARD' }),
        assertion({ polarity: 'MAYBE' }),
        assertion({ constraint: undefined }),
        assertion({ confidence: 1.4 }),
      ],
    });

    expect(result.intent.assertions).toEqual([]);
    expect(
      new Set(
        result.trace.facetNormalizationDecisions!.map(
          (decision) => decision.reason,
        ),
      ),
    ).toEqual(new Set(['INVALID_ASSERTION_FIELD']));
  });

  it('keeps one assertion per target and polarity: DIRECT over INFERRED whatever the weight', async () => {
    const result = await interpretWith('me encanta la arquitectura de Gaudí', {
      assertions: [
        assertion({
          provenance: 'INFERRED',
          confidence: 1,
          evidence: ['arquitectura de Gaudí'],
        }),
        assertion({
          strength: 'weak',
          confidence: 0.5,
          evidence: ['me encanta la arquitectura'],
        }),
      ],
    });

    expect(result.intent.assertions).toEqual([
      expect.objectContaining({
        provenance: 'DIRECT',
        importance: 0.5,
        confidence: 0.5,
      }),
    ]);
  });

  it('produces no assertion when semantic extraction fails: no lexical fallback', async () => {
    const { service } = makeService(
      undefined,
      new Error('provider unavailable'),
    );

    const result = await service.interpret(
      'Evitar iglesias, soy vegano, necesito silla de ruedas y busco arquitectura',
    );

    expect(result.trace.status).toBe('failed');
    expect(result.trace.validationErrors).toContain('provider unavailable');
    expect(result.intent.interpretationStatus).toBe('failed');
    expect(result.intent.unresolvedFreeText).toBe(
      'Evitar iglesias, soy vegano, necesito silla de ruedas y busco arquitectura',
    );
    expect(result.intent.assertions).toEqual([]);
    expect(result.intent.unresolvedConcepts).toEqual([]);
    expect(result.intent.positiveSemanticQuery).toBe('');
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
        priority: 'must',
      },
    ]);
  });

  it('skips the provider for empty preferences', async () => {
    const { service, langChain } = makeService();

    const result = await service.interpret('   ');

    expect(langChain.generateChatResponse).not.toHaveBeenCalled();
    expect(result.trace.status).toBe('skipped');
    expect(result.intent.assertions).toEqual([]);
    expect(result.intent.softConstraints).toEqual([]);
    expect(result.intent.ambiguities).toEqual([]);
    expect(result.intent.anchoredPlaces).toEqual([]);
  });

  it('sends the typed schema, not a word list, and asks the extractor for provenance and polarity', async () => {
    const { service, langChain } = makeService(JSON.stringify({}));

    await service.interpret('quiero historia');

    const systemPrompt: string =
      langChain.generateChatResponse.mock.calls[0][0];
    expect(systemPrompt).toContain('- theme: history, culture, art');
    expect(systemPrompt).toContain('- dietary_suitability: vegan');
    expect(systemPrompt).toContain(
      '- accessibility: wheelchair_access, avoid_stairs, limited_mobility',
    );
    expect(systemPrompt).not.toContain('accessibilityPreferences');
    expect(systemPrompt).toContain('provenance: "DIRECT"');
    expect(systemPrompt).toContain('polarity: "INCLUDE"');
    expect(systemPrompt).toContain('unresolvedConcepts');
    expect(systemPrompt).not.toContain('arquitectura" not');
  });

  it('keeps accessibility as typed assertions: the extractor decides HARD need vs SOFT preference (task 25.3)', async () => {
    const text =
      'necesito acceso para silla de ruedas y preferiría evitar escaleras';
    const { service } = makeService(
      JSON.stringify({
        assertions: [
          {
            dimension: 'accessibility',
            key: 'wheelchair_access',
            polarity: 'INCLUDE',
            constraint: 'HARD',
            provenance: 'DIRECT',
            strength: 'strong',
            confidence: 0.95,
            evidence: ['necesito acceso para silla de ruedas'],
          },
          {
            dimension: 'accessibility',
            key: 'avoid_stairs',
            polarity: 'INCLUDE',
            constraint: 'SOFT',
            provenance: 'DIRECT',
            strength: 'medium',
            confidence: 0.9,
            evidence: ['preferiría evitar escaleras'],
          },
        ],
      }),
    );

    const result = await service.interpret(text);

    expect(
      result.intent.assertions.map((a) => [
        `${a.target.dimension}:${a.target.key}`,
        a.constraint,
        a.provenance,
      ]),
    ).toEqual([
      ['accessibility:wheelchair_access', 'HARD', 'DIRECT'],
      ['accessibility:avoid_stairs', 'SOFT', 'DIRECT'],
    ]);
  });

  it('rejects an accessibility key outside the typed schema instead of translating it', async () => {
    const { service } = makeService(
      JSON.stringify({
        assertions: [
          {
            dimension: 'accessibility',
            key: 'silla_de_ruedas',
            polarity: 'INCLUDE',
            constraint: 'HARD',
            provenance: 'DIRECT',
            strength: 'strong',
            confidence: 0.9,
            evidence: ['silla de ruedas'],
          },
        ],
      }),
    );
    const result = await service.interpret('voy en silla de ruedas');
    expect(result.intent.assertions).toEqual([]);
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
          assertions: [
            {
              dimension: 'theme',
              key: 'architecture',
              polarity: 'INCLUDE',
              constraint: 'SOFT',
              provenance: 'DIRECT',
              strength: 'medium',
              confidence: 0.8,
              evidence: ['arquitectura'],
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
          priority: 'must',
        },
        {
          rawName: 'Bodega Norton',
          usage: 'unknown',
          priority: 'must',
        },
        {
          rawName: 'Some Place',
          usage: 'unknown',
          priority: 'soft',
        },
        {
          rawName: 'Plain Mention',
          usage: 'unknown',
          priority: 'soft',
        },
        {
          rawName: 'No Kind Given',
          usage: 'unknown',
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

    it('defaults anchoredPlaces to an empty array when extraction fails', async () => {
      const { service } = makeService(
        undefined,
        new Error('provider unavailable'),
      );

      const result = await service.interpret('Quiero ir al Teatro Colón');

      expect(result.intent.anchoredPlaces).toEqual([]);
    });
  });
});
