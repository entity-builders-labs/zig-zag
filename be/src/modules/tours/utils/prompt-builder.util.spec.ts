import {
  buildPromptFromParams,
  buildPreferencesObject,
  buildWizardSelectionInput,
} from './prompt-builder.util';

const canonicalRequest = (overrides: any = {}) => ({
  contractVersion: 1 as const,
  destination: {
    label: 'Córdoba, Argentina',
    latitude: -31.42,
    longitude: -64.18,
    scaleHint: 'settlement' as const,
  },
  days: 2,
  budgetLevel: 'low' as const,
  groupType: 'family' as const,
  intent: {
    interests: ['history'],
    experienceFormats: ['point_visits'] as any,
    explorationStyle: 'balanced' as const,
    ...overrides.intent,
  },
  mobility: {
    allowedTransportationModes: ['walking'] as any,
    maxWalkingDistancePerDayMeters: 5000,
    maxContinuousWalkingDistanceMeters: 1500,
    travelPace: 'moderate' as const,
    accessibilityNeeds: [] as string[],
    ...overrides.mobility,
  },
  dietaryRestrictions: [] as string[],
  startDates: [] as string[],
  includeExistingActivities: true,
  skipImageGeneration: true,
  excludeTours: [] as string[],
  categories: [] as string[],
});

describe('buildWizardSelectionInput', () => {
  it('expresses themes, formats and mobility as independent dimensions', () => {
    const input = buildWizardSelectionInput(
      canonicalRequest({
        intent: {
          interests: ['history'],
          experienceFormats: ['neighborhood_walks'],
        },
        mobility: {
          allowedTransportationModes: ['public_transport'],
          maxWalkingDistancePerDayMeters: 2000,
          maxContinuousWalkingDistanceMeters: 500,
        },
      }) as any,
    );

    expect(input).toContain('Interests: history');
    expect(input).toContain('Experience formats: neighborhood_walks');
    expect(input).toContain('Allowed transportation modes: public_transport');
    expect(input).toContain('2000 meters per day; 500 meters maximum');
  });

  it('places additional preferences in selector input exactly once', () => {
    const note = 'Focus on street photography';
    const input = buildWizardSelectionInput(
      canonicalRequest({
        intent: { additionalPreferences: note },
      }) as any,
    );

    expect(input.split(note)).toHaveLength(2);
  });
});

describe('buildPromptFromParams', () => {
  it('returns a generic fallback when no params are given', () => {
    expect(buildPromptFromParams({})).toBe('Create a general tour itinerary');
  });

  it('includes name, description, categories, interests, and location', () => {
    const result = buildPromptFromParams({
      name: 'Tango Night',
      description: 'A tour through tango history',
      categories: ['culture', 'nightlife'],
      interests: ['history', 'music'],
      latitude: -34.6,
      longitude: -58.4,
    });

    expect(result).toContain('Tour Name: Tango Night');
    expect(result).toContain('Description: A tour through tango history');
    expect(result).toContain('Categories: culture, nightlife');
    expect(result).toContain('Interests: history, music');
    expect(result).toContain('Location: -34.6, -58.4');
  });

  it('includes the number of days and start dates', () => {
    const result = buildPromptFromParams({
      days: 3,
      startDates: ['2026-09-01', '2026-09-02'],
    });

    expect(result).toContain('Number of days: 3');
    expect(result).toContain('Start dates: 2026-09-01, 2026-09-02');
  });

  it('includes budget, transportation, pace, dietary restrictions, and group type', () => {
    const result = buildPromptFromParams({
      budgetLevel: 'medium',
      transportationMode: ['walking', 'public_transport'],
      travelPace: 'relaxed',
      dietaryRestrictions: ['vegetarian', 'gluten-free'],
      groupType: 'family',
    });

    expect(result).toContain('Budget level: medium');
    expect(result).toContain('Transportation: walking, public_transport');
    expect(result).toContain('Travel pace: relaxed');
    expect(result).toContain('Dietary restrictions: vegetarian, gluten-free');
    expect(result).toContain('Group type: family');
  });

  it('omits empty arrays and falsy values instead of printing empty labels', () => {
    const result = buildPromptFromParams({
      name: 'Tour',
      transportationMode: [],
      dietaryRestrictions: [],
    });

    expect(result).not.toContain('Transportation:');
    expect(result).not.toContain('Dietary restrictions:');
  });
});

describe('buildPreferencesObject', () => {
  it('returns an empty object when no options are given', () => {
    expect(buildPreferencesObject()).toEqual({});
    expect(buildPreferencesObject(undefined)).toEqual({});
  });

  it('captures only the fields that are actually set', () => {
    const result = buildPreferencesObject({
      travelPace: 'moderate' as any,
      dietaryRestrictions: ['vegan'],
      budgetLevel: 'high' as any,
      days: 5,
      startDates: ['2026-09-01'],
    });

    expect(result).toEqual({
      travelPace: 'moderate',
      dietaryRestrictions: ['vegan'],
      budgetLevel: 'high',
      days: 5,
      startDates: ['2026-09-01'],
    });
  });
});
