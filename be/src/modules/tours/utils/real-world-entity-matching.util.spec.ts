import {
  distanceMeters,
  normalizeRealWorldName,
  REAL_WORLD_RECONCILIATION_RADIUS_METERS,
  realWorldNamesMatch,
} from './real-world-entity-matching.util';

describe('real-world-entity-matching.util', () => {
  describe('normalizeRealWorldName', () => {
    it('normalizes diacritics, case, and special characters', () => {
      expect(normalizeRealWorldName('Café San Telmo!')).toBe('cafe san telmo');
      expect(normalizeRealWorldName('   Plaza   Dorrego   ')).toBe(
        'plaza dorrego',
      );
      expect(normalizeRealWorldName('Museo & Centro Cultural')).toBe(
        'museo centro cultural',
      );
    });

    it('handles empty or blank strings', () => {
      expect(normalizeRealWorldName('')).toBe('');
      expect(normalizeRealWorldName('   ')).toBe('');
    });
  });

  describe('realWorldNamesMatch', () => {
    it('returns true for exact matches after normalization', () => {
      expect(realWorldNamesMatch('Plaza Dorrego', 'plaza dorrego')).toBe(true);
      expect(realWorldNamesMatch('Café Tortoni', 'Cafe Tortoni')).toBe(true);
    });

    it('returns true for substring containment in either direction', () => {
      expect(
        realWorldNamesMatch('Plaza Dorrego', 'Feria de Plaza Dorrego'),
      ).toBe(true);
      expect(
        realWorldNamesMatch('Feria de Plaza Dorrego', 'Plaza Dorrego'),
      ).toBe(true);
      expect(realWorldNamesMatch('Mercado San Telmo', 'San Telmo')).toBe(true);
    });

    it('returns false for non-matching names', () => {
      expect(realWorldNamesMatch('Plaza Dorrego', 'Plaza de Mayo')).toBe(false);
      expect(realWorldNamesMatch('El Obrero', 'Don Julio')).toBe(false);
    });

    it('returns false when either name is empty or blank', () => {
      expect(realWorldNamesMatch('', 'Plaza Dorrego')).toBe(false);
      expect(realWorldNamesMatch('Plaza Dorrego', '')).toBe(false);
      expect(realWorldNamesMatch('   ', '   ')).toBe(false);
    });
  });

  describe('distanceMeters', () => {
    it('calculates distance in meters between two coordinates', () => {
      const p1 = { latitude: -34.619528, longitude: -58.372832 };
      // roughly 30 meters away
      const p2 = { latitude: -34.6197, longitude: -58.3729 };
      const dist = distanceMeters(p1, p2);
      expect(dist).toBeGreaterThan(15);
      expect(dist).toBeLessThan(40);
    });

    it('returns 0 for identical points', () => {
      const p = { latitude: -34.619528, longitude: -58.372832 };
      expect(distanceMeters(p, p)).toBe(0);
    });

    it('confirms the 150m boundary constant value', () => {
      expect(REAL_WORLD_RECONCILIATION_RADIUS_METERS).toBe(150);
    });
  });
});
