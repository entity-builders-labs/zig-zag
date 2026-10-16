import { buildPreferenceSpec } from './preference-spec-builder.util';
import { TourGenerationRequest } from '../interfaces/tour-generation.interface';
import { DietaryRestriction } from '../interfaces/tour-generation.interface';
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
    softConstraints: [],
    ambiguities: [],
    accessibilityPreferences: [],
    budgetPreferences: [],
    groupPreferences: [],
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
        weight: 1,
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

  it('keeps an INFERRED assertion INFERRED and its weight as importance x confidence', () => {
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
    expect(spec.facets[0].weight).toBeCloseTo(0.63);
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
    expect(spec.softConstraints).toEqual({
      accessibility: [],
      budget: [],
      group: [],
    });
  });

  it('routes a low budget level to softConstraints.budget only', () => {
    const request = baseRequest({ budgetLevel: 'low' as any });
    const interpreted = emptyInterpreted();

    const spec = buildPreferenceSpec(request, interpreted);

    expect(spec.softConstraints.budget).toContain('low budget');
    expect(spec.softConstraints.accessibility).not.toContain('low budget');
    expect(spec.softConstraints.group).not.toContain('low budget');
  });

  it('routes a family group type to softConstraints.group only', () => {
    const request = baseRequest({ groupType: 'family' as any });
    const interpreted = emptyInterpreted();

    const spec = buildPreferenceSpec(request, interpreted);

    expect(spec.softConstraints.group).toContain('family friendly');
    expect(spec.softConstraints.budget).not.toContain('family friendly');
    expect(spec.softConstraints.accessibility).not.toContain('family friendly');
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
    expect(spec.facetSchemaVersion).toBe('facet-schema-v1');
    expect(spec.semanticQuery).toBe('edificios históricos accesibles');
    expect(spec.trip).toEqual({
      days: 5,
      startDates: ['2026-10-01'],
      pace: 'fast',
    });
  });
});
