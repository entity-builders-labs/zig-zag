import {
  formatActivityForPrompt,
  formatOsmFeatureForPrompt,
} from './activity-prompt-formatter.util';

describe('formatActivityForPrompt', () => {
  const base = {
    id: 'act-1',
    name: 'Caminito',
    type: 'cultural',
    description: 'A colorful street in La Boca',
    latitude: -34.6393,
    longitude: -58.3628,
    duration: 60,
  };

  it('formats the base fields when no rating/price/hours are known', () => {
    expect(formatActivityForPrompt(base)).toBe(
      'id: act-1 - Caminito (cultural) - A colorful street in La Boca - Location: -34.6393, -58.3628 - Duration: 60 minutes',
    );
  });

  it('includes rating with review count when present', () => {
    const result = formatActivityForPrompt({
      ...base,
      rating: 4.5,
      ratingCount: 230,
    });
    expect(result).toContain('Rating: 4.5/5 (230 reviews)');
  });

  it('includes rating without a review count when ratingCount is missing', () => {
    const result = formatActivityForPrompt({ ...base, rating: 4.5 });
    expect(result).toContain('Rating: 4.5/5');
    expect(result).not.toContain('reviews');
  });

  it('includes price level when present', () => {
    const result = formatActivityForPrompt({ ...base, priceLevel: 2 });
    expect(result).toContain('Price level: 2/5');
  });

  it('includes opening hours when present', () => {
    const result = formatActivityForPrompt({
      ...base,
      openingHours: {
        weekdayText: ['Monday: 9:00 AM – 6:00 PM', 'Tuesday: Closed'],
      },
    });
    expect(result).toContain(
      'Opening hours: Monday: 9:00 AM – 6:00 PM; Tuesday: Closed',
    );
  });

  it('omits opening hours when the weekday text list is empty', () => {
    const result = formatActivityForPrompt({
      ...base,
      openingHours: { weekdayText: [] },
    });
    expect(result).not.toContain('Opening hours');
  });

  it('falls back to defaults for missing type/description/duration', () => {
    const result = formatActivityForPrompt({
      id: 'act-2',
      name: 'Mystery Spot',
      latitude: 0,
      longitude: 0,
    });
    expect(result).toBe(
      'id: act-2 - Mystery Spot (Activity) - No description - Location: 0, 0 - Duration: Unknown minutes',
    );
  });
});

describe('formatOsmFeatureForPrompt', () => {
  it('formats id/name/type without narrative context when none is available', () => {
    const result = formatOsmFeatureForPrompt({
      id: 'osm:way:1',
      name: 'Defensa',
      osmType: 'way',
    });
    expect(result).toBe('id: osm:way:1 - Defensa (way)');
  });

  it('appends narrative context when present, truncated to 200 chars', () => {
    const longContext = 'a'.repeat(300);
    const result = formatOsmFeatureForPrompt({
      id: 'osm:relation:1',
      name: 'San Telmo',
      osmType: 'relation',
      narrativeContext: longContext,
    });
    expect(result).toContain('id: osm:relation:1 - San Telmo (relation) - ');
    expect(result.length).toBeLessThan(300);
  });
});
