import { buildPreferenceSpec } from './preference-spec-builder.util';
import {
  findAmbiguousHardConstraints,
  findUnenforceableHardConstraints,
} from './hard-constraint-enforceability.util';
import { recordRequestIntentStep } from './generation-trace/request-audit';
import { GenerationTraceRecorder } from './generation-trace-recorder.util';
import { TourGenerationRequest } from '../interfaces/tour-generation.interface';
import {
  AccessibilityNeed,
  DietaryRestriction,
} from '../interfaces/tour-generation.interface';
import { NormalizedPreferenceIntent } from '../interfaces/preference-interpretation.interface';
import { InterpretedAnchor } from '../interfaces/preference-spec.interface';
import {
  PreferenceAssertion,
  UnresolvedPreferenceConcept,
} from '../preferences/preference-assertion.interface';

function baseRequest(
  overrides: Partial<TourGenerationRequest> = {},
): TourGenerationRequest {
  return {
    contractVersion: 1,
    destination: {
      label: 'Córdoba, Argentina',
      latitude: -31.42,
      longitude: -64.18,
      scaleHint: 'settlement' as any,
    },
    days: 3,
    budgetLevel: 'medium' as any,
    groupType: 'couple' as any,
    intent: {
      interests: [],
      intents: [],
      explorationStyle: 'balanced' as any,
    },
    mobility: {
      allowedTransportationModes: ['walking' as any],
      maxWalkingDistancePerDayMeters: 5000,
      maxContinuousWalkingDistanceMeters: 1500,
      travelPace: 'moderate' as any,
      accessibilityNeeds: [],
    },
    dietaryRestrictions: [],
    startDates: [],
    includeExistingExperiences: true,
    skipImageGeneration: true,
    excludeTours: [],
    categories: [],
    ...overrides,
  };
}

function inferred(
  overrides: Partial<PreferenceAssertion> & Pick<PreferenceAssertion, 'target'>,
): PreferenceAssertion {
  return {
    polarity: 'INCLUDE',
    constraint: 'SOFT',
    provenance: 'INFERRED',
    importance: 0.7,
    confidence: 0.9,
    evidence: [{ kind: 'USER_TEXT_SPAN', text: 'fixture span' }],
    ...overrides,
  };
}

function emptyInterpreted(
  overrides: Partial<NormalizedPreferenceIntent> = {},
): NormalizedPreferenceIntent {
  return {
    assertions: [],
    unresolvedConcepts: [],
    anchoredPlaces: [],
    ambiguities: [],
    positiveSemanticQuery: '',
    notes: [],
    ...overrides,
  };
}

describe('preference-spec-builder.util', () => {
  it('keeps the DIRECT structured selection over an INFERRED assertion of the same target, whatever their weights', () => {
    const request = baseRequest({
      intent: {
        interests: ['history'],
        intents: [],
        explorationStyle: 'balanced' as any,
      },
    });
    const interpreted = emptyInterpreted({
      assertions: [
        inferred({
          target: { dimension: 'theme', key: 'history' },
          importance: 1,
          confidence: 1,
        }),
      ],
    });

    const spec = buildPreferenceSpec(request, interpreted);

    const historyFacets = spec.facets.filter(
      (f) => f.dimension === 'theme' && f.key === 'history',
    );
    expect(historyFacets).toEqual([
      {
        dimension: 'theme',
        key: 'history',
        provenance: 'DIRECT',
        importance: 1,
        confidence: 1,
        evidence: [
          {
            kind: 'STRUCTURED_SELECTION',
            field: 'intent.interests',
            value: 'history',
          },
        ],
        required: false,
      },
    ]);
  });

  it('keeps an INFERRED assertion INFERRED with importance and confidence separate', () => {
    const spec = buildPreferenceSpec(
      baseRequest(),
      emptyInterpreted({
        assertions: [inferred({ target: { dimension: 'theme', key: 'wine' } })],
      }),
    );
    expect(spec.facets).toEqual([
      expect.objectContaining({
        dimension: 'theme',
        key: 'wine',
        provenance: 'INFERRED',
        importance: 0.7,
        confidence: 0.9,
      }),
    ]);
    // No combined scalar: utility weighs INFERRED by importance x confidence.
    expect(spec.facets[0]).not.toHaveProperty('weight');
  });

  it('never translates a structured value outside the typed schema', () => {
    const spec = buildPreferenceSpec(
      baseRequest({
        intent: {
          interests: ['historia', 'history'],
          intents: ['caminata'],
          explorationStyle: 'balanced' as any,
        },
      }),
      emptyInterpreted(),
    );
    expect(spec.assertions.map((a) => a.target)).toEqual([
      { dimension: 'theme', key: 'history' },
    ]);
  });

  it('keeps explorationStyle out of facets entirely -- it is never a RequestedFacet', () => {
    const request = baseRequest({
      intent: {
        interests: ['history'],
        intents: [],
        explorationStyle: 'iconic' as any,
      },
    });
    const interpreted = emptyInterpreted();

    const spec = buildPreferenceSpec(request, interpreted);

    expect(spec.explorationStyle).toBe('iconic');
    expect(
      spec.facets.some((f) => (f.dimension as string) === 'exploration_style'),
    ).toBe(false);
    // Only the requested theme facet -- explorationStyle adds nothing.
    expect(spec.facets).toHaveLength(1);
  });

  it('turns a typed dietary restriction into a DIRECT HARD assertion without the extractor, never a facet', () => {
    const spec = buildPreferenceSpec(
      baseRequest({ dietaryRestrictions: [DietaryRestriction.VEGAN] }),
      emptyInterpreted(),
    );

    expect(spec.assertions).toEqual([
      {
        target: { dimension: 'dietary_suitability', key: 'vegan' },
        polarity: 'INCLUDE',
        constraint: 'HARD',
        provenance: 'DIRECT',
        importance: 1,
        confidence: 1,
        evidence: [
          {
            kind: 'STRUCTURED_SELECTION',
            field: 'dietaryRestrictions',
            value: 'vegan',
          },
        ],
      },
    ]);
    // A HARD constraint never becomes a soft preference facet.
    expect(spec.facets).toEqual([]);
  });

  it('never turns typed budget or group context into preference phrases or assertions (task 25.5)', () => {
    const spec = buildPreferenceSpec(
      baseRequest({ budgetLevel: 'low' as any, groupType: 'family' as any }),
      emptyInterpreted(),
    );

    expect(spec.assertions).toEqual([]);
    expect(spec.facets).toEqual([]);
    expect(spec).not.toHaveProperty('softConstraints');
    expect(JSON.stringify(spec)).not.toMatch(/low budget|family friendly/);
  });

  it('never reads extractor diagnostics as preferences', () => {
    const spec = buildPreferenceSpec(
      baseRequest(),
      emptyInterpreted({
        ambiguities: ['quiere historia militar?'],
        notes: ['viaja con chicos'],
      }),
    );
    expect(spec.assertions).toEqual([]);
    expect(spec.facets).toEqual([]);
    expect(spec.unresolvedConcepts).toEqual([]);
  });

  it('passes anchoredPlaces through to spec.anchors unchanged', () => {
    const request = baseRequest();
    const anchors: InterpretedAnchor[] = [
      {
        rawName: 'Teatro Colón',
        usage: 'specific_destination',
        priority: 'must',
      },
      { rawName: 'San Telmo', usage: 'geographic_scope', priority: 'soft' },
    ];
    const interpreted = emptyInterpreted({ anchoredPlaces: anchors });

    const spec = buildPreferenceSpec(request, interpreted);

    expect(spec.anchors).toEqual(anchors);
  });

  it('wires EXCLUDE assertions, unresolved concepts, semanticQuery and trip fields from the request/interpreted intent', () => {
    const request = baseRequest({
      days: 5,
      startDates: ['2026-10-01'],
      mobility: {
        allowedTransportationModes: ['walking' as any],
        maxWalkingDistancePerDayMeters: 5000,
        maxContinuousWalkingDistanceMeters: 1500,
        travelPace: 'fast' as any,
        accessibilityNeeds: [],
      },
    });
    const nightlifeExclusion = inferred({
      target: { dimension: 'theme', key: 'nightlife' },
      polarity: 'EXCLUDE',
    });
    const religiousSites: UnresolvedPreferenceConcept = {
      label: 'religious sites',
      polarity: 'EXCLUDE',
      constraint: 'HARD',
      evidence: [{ kind: 'USER_TEXT_SPAN', text: 'iglesias' }],
      reason: 'UNRESOLVED_OPEN_CONCEPT',
    };
    const interpreted = emptyInterpreted({
      assertions: [nightlifeExclusion],
      unresolvedConcepts: [religiousSites],
      positiveSemanticQuery: 'edificios históricos accesibles',
    });

    const spec = buildPreferenceSpec(request, interpreted);

    // Exclusions stay assertions; they never become include facets.
    expect(spec.assertions).toEqual([nightlifeExclusion]);
    expect(spec.facets).toEqual([]);
    expect(spec.unresolvedConcepts).toEqual([religiousSites]);
    expect(spec.facetSchemaVersion).toBe('facet-schema-v2');
    expect(spec.semanticQuery).toBe('edificios históricos accesibles');
    expect(spec.trip).toEqual({
      days: 5,
      startDates: ['2026-10-01'],
      pace: 'fast',
    });
  });

  describe('polarity (task 25.6)', () => {
    it('never turns an EXCLUDE assertion into a positive facet, whatever its provenance or weight', () => {
      const spec = buildPreferenceSpec(
        baseRequest(),
        emptyInterpreted({
          assertions: [
            inferred({
              target: { dimension: 'theme', key: 'architecture' },
              polarity: 'EXCLUDE',
              provenance: 'DIRECT',
              importance: 1,
              confidence: 1,
            }),
          ],
        }),
      );
      expect(spec.facets).toEqual([]);
      expect(spec.assertions).toEqual([
        expect.objectContaining({
          target: { dimension: 'theme', key: 'architecture' },
          polarity: 'EXCLUDE',
          constraint: 'SOFT',
        }),
      ]);
    });

    it('records a structured INCLUDE and an extracted EXCLUDE of the same target as a conflict in which neither participates', () => {
      const exclusion = inferred({
        target: { dimension: 'theme', key: 'history' },
        polarity: 'EXCLUDE',
      });
      const spec = buildPreferenceSpec(
        baseRequest({
          intent: {
            interests: ['history', 'art'],
            intents: [],
            explorationStyle: 'balanced' as any,
          },
        }),
        emptyInterpreted({ assertions: [exclusion] }),
      );

      expect(spec.facets.map((f) => `${f.dimension}:${f.key}`)).toEqual([
        'theme:art',
      ]);
      expect(spec.assertions.map((a) => a.target.key)).toEqual(['art']);
      expect(spec.polarityConflicts).toEqual([
        {
          target: { dimension: 'theme', key: 'history' },
          include: expect.objectContaining({
            polarity: 'INCLUDE',
            provenance: 'DIRECT',
          }),
          exclude: exclusion,
          blocking: false,
          reason: 'PREFERENCE_POLARITY_CONFLICT',
        },
      ]);
    });

    it('turns an INCLUDE plus HARD EXCLUDE of one target into a blocking conflict, never a guessed winner', () => {
      const spec = buildPreferenceSpec(
        baseRequest({
          intent: {
            interests: ['nightlife'],
            intents: [],
            explorationStyle: 'balanced' as any,
          },
        }),
        emptyInterpreted({
          assertions: [
            inferred({
              target: { dimension: 'theme', key: 'nightlife' },
              polarity: 'EXCLUDE',
              constraint: 'HARD',
            }),
          ],
        }),
      );
      expect(spec.polarityConflicts).toHaveLength(1);
      expect(spec.facets).toEqual([]);
      // Contradictory intent is not unenforceable intent.
      expect(findUnenforceableHardConstraints(spec)).toEqual([]);
      expect(findAmbiguousHardConstraints(spec)).toEqual([
        expect.objectContaining({
          target: { dimension: 'theme', key: 'nightlife' },
          blocking: true,
        }),
      ]);
    });

    it('records the conflict in the request.intent trace step', () => {
      const spec = buildPreferenceSpec(
        baseRequest({
          intent: {
            interests: ['history'],
            intents: [],
            explorationStyle: 'balanced' as any,
          },
        }),
        emptyInterpreted({
          assertions: [
            inferred({
              target: { dimension: 'theme', key: 'history' },
              polarity: 'EXCLUDE',
            }),
          ],
        }),
      );
      const step = recordRequestIntentStep(new GenerationTraceRecorder(), {
        request: baseRequest(),
        preferenceSpec: spec,
      });
      const rule = step.rules.find(
        (candidate) => candidate.id === 'INTENT-POLARITY-001',
      );
      expect(rule?.status).toBe('WARN');
      expect((rule?.facts as Record<string, unknown>)?.conflicts).toEqual([
        expect.objectContaining({
          target: { dimension: 'theme', key: 'history' },
          reason: 'PREFERENCE_POLARITY_CONFLICT',
          includeProvenance: 'DIRECT',
          excludeProvenance: 'INFERRED',
        }),
      ]);
    });
  });

  it('turns a typed accessibility need into a DIRECT HARD INCLUDE assertion, never a facet (task 25.3)', () => {
    const spec = buildPreferenceSpec(
      baseRequest({
        mobility: {
          allowedTransportationModes: ['walking' as any],
          maxWalkingDistancePerDayMeters: 5000,
          maxContinuousWalkingDistanceMeters: 1500,
          travelPace: 'moderate' as any,
          accessibilityNeeds: [AccessibilityNeed.WHEELCHAIR_ACCESS],
        },
      }),
      emptyInterpreted(),
    );
    expect(spec.assertions).toEqual([
      {
        target: { dimension: 'accessibility', key: 'wheelchair_access' },
        polarity: 'INCLUDE',
        constraint: 'HARD',
        provenance: 'DIRECT',
        importance: 1,
        confidence: 1,
        evidence: [
          {
            kind: 'STRUCTURED_SELECTION',
            field: 'mobility.accessibilityNeeds',
            value: 'wheelchair_access',
          },
        ],
      },
    ]);
    expect(spec.facets).toEqual([]);
    expect(findUnenforceableHardConstraints(spec)).toEqual([
      expect.objectContaining({
        target: { dimension: 'accessibility', key: 'wheelchair_access' },
        missingKnowledge: 'CLASSIFICATION_COMPLETENESS',
      }),
    ]);
  });

  it('keeps an extracted SOFT accessibility preference as a facet for the utility boundary', () => {
    const spec = buildPreferenceSpec(
      baseRequest(),
      emptyInterpreted({
        assertions: [
          inferred({
            target: { dimension: 'accessibility', key: 'avoid_stairs' },
            provenance: 'DIRECT',
            importance: 0.7,
            confidence: 0.9,
          }),
        ],
      }),
    );
    expect(spec.facets).toEqual([
      expect.objectContaining({
        dimension: 'accessibility',
        key: 'avoid_stairs',
        provenance: 'DIRECT',
      }),
    ]);
    expect(findUnenforceableHardConstraints(spec)).toEqual([]);
  });

  it('never lets a SOFT DIRECT selection weaken an extracted HARD constraint on the same target (F7)', () => {
    const hardExtracted = inferred({
      target: { dimension: 'theme', key: 'history' },
      constraint: 'HARD',
      provenance: 'INFERRED',
      importance: 0.5,
      confidence: 0.4,
    });
    const spec = buildPreferenceSpec(
      baseRequest({
        intent: {
          interests: ['history'],
          intents: [],
          explorationStyle: 'balanced' as any,
        },
      }),
      emptyInterpreted({ assertions: [hardExtracted] }),
    );
    expect(spec.assertions).toEqual([hardExtracted]);
    expect(spec.facets).toEqual([]);
    expect(spec.supersededAssertions).toEqual([
      {
        assertion: expect.objectContaining({
          constraint: 'SOFT',
          provenance: 'DIRECT',
        }),
        reason: 'HARD_OUTRANKS_SOFT',
      },
    ]);
    expect(findUnenforceableHardConstraints(spec)).toEqual([
      expect.objectContaining({
        target: { dimension: 'theme', key: 'history' },
      }),
    ]);
  });
});
