import { buildPreferenceSpec } from './preference-spec-builder.util';
import { TourGenerationRequest } from '../interfaces/tour-generation.interface';
import { NormalizedPreferenceIntent } from '../interfaces/preference-interpretation.interface';
import { InterpretedAnchor } from '../interfaces/preference-spec.interface';

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

function emptyInterpreted(
  overrides: Partial<NormalizedPreferenceIntent> = {},
): NormalizedPreferenceIntent {
  return {
    preferredFacets: [],
    anchoredPlaces: [],
    excludedThemes: [],
    excludedTraits: [],
    hardExclusions: [],
    softConstraints: [],
    ambiguities: [],
    dietaryPreferences: [],
    accessibilityPreferences: [],
    budgetPreferences: [],
    groupPreferences: [],
    positiveSemanticQuery: '',
    notes: [],
    ...overrides,
  };
}

describe('preference-spec-builder.util', () => {
  it('merges wizard history and interpreted history into one deduplicated facet, keeping the highest effective weight', () => {
    const request = baseRequest({
      intent: {
        interests: ['history'],
        intents: [],
        explorationStyle: 'balanced' as any,
      },
    });
    const interpreted = emptyInterpreted({
      preferredFacets: [
        {
          dimension: 'theme',
          key: 'history',
          importance: 0.7,
          confidence: 0.9,
          source: 'free_text',
        },
      ],
    });

    const spec = buildPreferenceSpec(request, interpreted);

    const historyFacets = spec.facets.filter(
      (f) => f.dimension === 'theme' && f.key === 'history',
    );
    expect(historyFacets).toHaveLength(1);
    // Wizard facet (importance 1.0 x confidence 1.0 = 1.0) beats the
    // free-text facet (0.7 x 0.9 = 0.63) under the highest-effective-weight
    // dedup rule.
    expect(historyFacets[0]).toEqual({
      dimension: 'theme',
      key: 'history',
      weight: 1.0,
      source: 'wizard',
      required: false,
    });
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
    expect(spec.facets.some((f) => f.dimension === 'exploration_style')).toBe(
      false,
    );
    // Only the requested theme facet -- explorationStyle adds nothing.
    expect(spec.facets).toHaveLength(1);
  });

  it('keeps dietary restrictions in softConstraints.dietary only', () => {
    const request = baseRequest({ dietaryRestrictions: ['vegan'] });
    const interpreted = emptyInterpreted({
      dietaryPreferences: ['gluten-free'],
    });

    const spec = buildPreferenceSpec(request, interpreted);

    expect(spec.softConstraints.dietary).toEqual(
      expect.arrayContaining(['vegan', 'gluten-free']),
    );
    expect(spec.softConstraints.budget).not.toContain('vegan');
    expect(spec.softConstraints.accessibility).not.toContain('vegan');
    expect(spec.softConstraints.group).not.toContain('vegan');
  });

  it('routes a low budget level to softConstraints.budget only', () => {
    const request = baseRequest({ budgetLevel: 'low' as any });
    const interpreted = emptyInterpreted();

    const spec = buildPreferenceSpec(request, interpreted);

    expect(spec.softConstraints.budget).toContain('low budget');
    expect(spec.softConstraints.dietary).not.toContain('low budget');
    expect(spec.softConstraints.accessibility).not.toContain('low budget');
    expect(spec.softConstraints.group).not.toContain('low budget');
  });

  it('routes a family group type to softConstraints.group only', () => {
    const request = baseRequest({ groupType: 'family' as any });
    const interpreted = emptyInterpreted();

    const spec = buildPreferenceSpec(request, interpreted);

    expect(spec.softConstraints.group).toContain('family friendly');
    expect(spec.softConstraints.dietary).not.toContain('family friendly');
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

  it('wires exclusions, semanticQuery and trip fields from the request/interpreted intent', () => {
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
    const interpreted = emptyInterpreted({
      excludedThemes: ['religion'],
      excludedTraits: ['crowded'],
      hardExclusions: ['non-vegan food'],
      positiveSemanticQuery: 'edificios históricos accesibles',
    });

    const spec = buildPreferenceSpec(request, interpreted);

    expect(spec.exclusions).toEqual({
      themes: ['religion'],
      traits: ['crowded'],
      hard: ['non-vegan food'],
    });
    expect(spec.semanticQuery).toBe('edificios históricos accesibles');
    expect(spec.trip).toEqual({
      days: 5,
      startDates: ['2026-10-01'],
      pace: 'fast',
    });
  });
});
