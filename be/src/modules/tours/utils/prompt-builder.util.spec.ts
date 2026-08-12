import {
  buildPromptFromParams,
  buildPreferencesObject,
} from './prompt-builder.util';

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
    });

    expect(result).toEqual({
      travelPace: 'moderate',
      dietaryRestrictions: ['vegan'],
      budgetLevel: 'high',
    });
  });
});
