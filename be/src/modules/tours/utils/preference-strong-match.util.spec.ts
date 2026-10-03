import {
  isStrongFacetMatch,
  DEFAULT_QUALITY_FLOOR,
} from './preference-strong-match.util';
import { RequestedFacet } from '../interfaces/preference-spec.interface';

function facet(overrides: Partial<RequestedFacet> = {}): RequestedFacet {
  return {
    dimension: 'theme',
    key: 'history',
    weight: 1,
    source: 'wizard',
    required: false,
    ...overrides,
  };
}

function experienceWithComponent(overrides: Record<string, any> = {}) {
  return {
    themes: ['history'],
    qualityScore: 4.4,
    durationMinutes: 90,
    components: [
      {
        geoEntity: { latitude: -34.6, longitude: -58.38 },
      },
    ],
    metadata: {},
    ...overrides,
  };
}

describe('preference-strong-match.util', () => {
  describe('isStrongFacetMatch', () => {
    it('is strong when the candidate matches, has a resolved geographic component, clears the quality floor and classification is not known-thin', () => {
      const experience = experienceWithComponent();

      expect(isStrongFacetMatch(experience, facet())).toBe(true);
    });

    it('is not strong when qualityScore is below the floor', () => {
      const experience = experienceWithComponent({ qualityScore: 2.5 });

      expect(isStrongFacetMatch(experience, facet())).toBe(false);
    });

    it('is not strong when qualityScore is null (no magic default -- spec §10.1)', () => {
      const experience = experienceWithComponent({ qualityScore: null });

      expect(isStrongFacetMatch(experience, facet())).toBe(false);
    });

    it('is not strong when there is no resolved component with real geography', () => {
      const noComponents = experienceWithComponent({ components: [] });
      expect(isStrongFacetMatch(noComponents, facet())).toBe(false);

      const componentWithoutGeography = experienceWithComponent({
        components: [{ geoEntity: { latitude: null, longitude: null } }],
      });
      expect(isStrongFacetMatch(componentWithoutGeography, facet())).toBe(
        false,
      );
    });

    it('is not strong when classification is explicitly degraded (known-thin evidence)', () => {
      const experience = experienceWithComponent({
        metadata: { classification: { state: 'degraded' } },
      });

      expect(isStrongFacetMatch(experience, facet())).toBe(false);
    });

    it('is still eligible to be strong when classification metadata is simply absent -- absence is not proof of thinness', () => {
      const experience = experienceWithComponent({ metadata: {} });

      expect(isStrongFacetMatch(experience, facet())).toBe(true);
    });

    it('is not strong when candidateMatchesPreferenceFacet itself does not match (non-matching case)', () => {
      const experience = experienceWithComponent({ themes: ['tango'] });

      expect(isStrongFacetMatch(experience, facet({ key: 'history' }))).toBe(
        false,
      );
    });

    it('is not strong when the Experience duration obviously exceeds the entire planning window', () => {
      const experience = experienceWithComponent({ durationMinutes: 600 });

      expect(
        isStrongFacetMatch(experience, facet(), {
          planningWindowMinutes: 480,
        }),
      ).toBe(false);
      // Same candidate is strong when no planning window is supplied, or
      // when it fits within it -- the daily planner remains authoritative
      // for full feasibility; this is only an "obviously impossible" guard.
      expect(isStrongFacetMatch(experience, facet())).toBe(true);
      expect(
        isStrongFacetMatch(experience, facet(), {
          planningWindowMinutes: 700,
        }),
      ).toBe(true);
    });

    it('respects a custom quality floor from policy', () => {
      const experience = experienceWithComponent({ qualityScore: 3.2 });

      expect(
        isStrongFacetMatch(experience, facet(), { qualityFloor: 3.5 }),
      ).toBe(false);
      expect(
        isStrongFacetMatch(experience, facet(), { qualityFloor: 3.0 }),
      ).toBe(true);
    });

    it('defaults the quality floor to 3.0', () => {
      expect(DEFAULT_QUALITY_FLOOR).toBe(3.0);
    });
  });

  describe('numeric validation hardening -- invalid values are never strong', () => {
    it.each([
      ['NaN latitude', { latitude: NaN, longitude: -58.38 }],
      ['Infinity longitude', { latitude: -34.6, longitude: Infinity }],
      ['-Infinity latitude', { latitude: -Infinity, longitude: -58.38 }],
      ['out-of-range latitude (91)', { latitude: 91, longitude: -58.38 }],
      ['out-of-range latitude (-91)', { latitude: -91, longitude: -58.38 }],
      ['out-of-range longitude (181)', { latitude: -34.6, longitude: 181 }],
      ['out-of-range longitude (-181)', { latitude: -34.6, longitude: -181 }],
    ])('is not strong when geography is invalid: %s', (_label, geo) => {
      const experience = experienceWithComponent({
        components: [{ geoEntity: geo }],
      });
      expect(isStrongFacetMatch(experience, facet())).toBe(false);
    });

    it('accepts the exact +-90/+-180 lat/lng boundary as valid geography (no over-rejection)', () => {
      const corners = [
        { latitude: -90, longitude: -180 },
        { latitude: 90, longitude: 180 },
      ];
      for (const geoEntity of corners) {
        const experience = experienceWithComponent({
          components: [{ geoEntity }],
        });
        expect(isStrongFacetMatch(experience, facet())).toBe(true);
      }
    });

    it.each([
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['-Infinity', -Infinity],
      ['negative (-1)', -1],
      ['above canonical scale (5.1)', 5.1],
    ])('is not strong when qualityScore is invalid: %s', (_label, quality) => {
      const experience = experienceWithComponent({ qualityScore: quality });
      expect(isStrongFacetMatch(experience, facet())).toBe(false);
    });

    it('treats qualityScore = 0 as a valid number simply below the floor, not an invalid value', () => {
      const experience = experienceWithComponent({ qualityScore: 0 });

      // Below the default floor (3.0) -> not strong...
      expect(isStrongFacetMatch(experience, facet())).toBe(false);
      // ...but for the right reason: a valid low score, not an invalid one --
      // proven by becoming strong once the floor itself is lowered to 0.
      expect(isStrongFacetMatch(experience, facet(), { qualityFloor: 0 })).toBe(
        true,
      );
    });

    it('accepts qualityScore = 5, the top of the canonical 0..5 scale, as valid (no over-rejection)', () => {
      const experience = experienceWithComponent({ qualityScore: 5 });
      expect(isStrongFacetMatch(experience, facet())).toBe(true);
    });
  });
});
