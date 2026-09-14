import { filterOverlappingExperienceCandidates } from './candidate-overlap-filter.util';

describe('filterOverlappingExperienceCandidates', () => {
  it('excludes a standalone POI candidate whose only component overlaps a composite candidate (real regression: Plaza Dorrego)', () => {
    // Verified live: "San Telmo Antique Fair and Historic Quarter Walk"
    // resolved "Plaza Dorrego" as one of its own components, while a
    // standalone "Plaza Dorrego" Experience existed as its own separate
    // catalog entry (a different GeoEntity row, ~3m away) — both reached the
    // same candidate pool and the solver booked the traveler into the same
    // real plaza twice, on two different days.
    const composite = {
      id: 'composite-san-telmo-walk',
      compositionOrderScore: 2,
      components: [
        {
          geoEntity: {
            name: 'Plaza Dorrego',
            latitude: -34.6204917,
            longitude: -58.3717807,
          },
        },
        {
          geoEntity: {
            name: 'San Telmo Fair',
            latitude: -34.6114448,
            longitude: -58.371905,
          },
        },
      ],
    };
    const standalonePlazaDorrego = {
      id: 'standalone-plaza-dorrego',
      compositionOrderScore: 5, // score cannot overcome component-count priority
      components: [
        {
          geoEntity: {
            name: 'Plaza Dorrego',
            latitude: -34.6204914,
            longitude: -58.3717481, // ~3m from the composite's own component
          },
        },
      ],
    };
    const unrelated = {
      id: 'museo-moderno',
      compositionOrderScore: 1,
      components: [
        {
          geoEntity: {
            name: 'Museo Moderno',
            latitude: -34.6220479,
            longitude: -58.3705415,
          },
        },
      ],
    };

    const result = filterOverlappingExperienceCandidates([
      composite,
      standalonePlazaDorrego,
      unrelated,
    ]);

    expect(result.kept.map((c) => c.id).sort()).toEqual(
      ['composite-san-telmo-walk', 'museo-moderno'].sort(),
    );
    expect(result.excluded).toEqual([
      {
        id: 'standalone-plaza-dorrego',
        reason: 'REDUNDANT_WITH_OTHER_CANDIDATE',
        overlapsWith: 'composite-san-telmo-walk',
      },
    ]);
  });

  it('keeps two candidates whose components share a name but sit far apart', () => {
    const nearby = {
      id: 'plaza-dorrego-san-telmo',
      components: [
        {
          geoEntity: {
            name: 'Plaza Mayor',
            latitude: -34.6204917,
            longitude: -58.3717807,
          },
        },
      ],
    };
    const distant = {
      id: 'plaza-mayor-otra-ciudad',
      components: [
        {
          geoEntity: {
            name: 'Plaza Mayor',
            latitude: -31.4201, // a different city entirely
            longitude: -64.1888,
          },
        },
      ],
    };

    const result = filterOverlappingExperienceCandidates([nearby, distant]);

    expect(result.kept.map((c) => c.id).sort()).toEqual(
      ['plaza-dorrego-san-telmo', 'plaza-mayor-otra-ciudad'].sort(),
    );
    expect(result.excluded).toEqual([]);
  });

  it('keeps two candidates that sit close together but are genuinely different places', () => {
    const plaza = {
      id: 'plaza-dorrego',
      components: [
        {
          geoEntity: {
            name: 'Plaza Dorrego',
            latitude: -34.6204917,
            longitude: -58.3717807,
          },
        },
      ],
    };
    const cafeFacingIt = {
      id: 'cafe-britanico',
      components: [
        {
          geoEntity: {
            name: 'Café Británico',
            latitude: -34.6204917, // same coordinates, different real place
            longitude: -58.3717807,
          },
        },
      ],
    };

    const result = filterOverlappingExperienceCandidates([plaza, cafeFacingIt]);

    expect(result.kept.map((c) => c.id).sort()).toEqual(
      ['cafe-britanico', 'plaza-dorrego'].sort(),
    );
    expect(result.excluded).toEqual([]);
  });

  it('prefers the higher composition-order candidate when both have the same component count', () => {
    const lowerScore = {
      id: 'lower-score',
      compositionOrderScore: 2,
      components: [
        {
          geoEntity: {
            name: 'Plaza Dorrego',
            latitude: -34.6204917,
            longitude: -58.3717807,
          },
        },
      ],
    };
    const higherScore = {
      id: 'higher-score',
      compositionOrderScore: 5,
      components: [
        {
          geoEntity: {
            name: 'Plaza Dorrego',
            latitude: -34.6204914,
            longitude: -58.3717481,
          },
        },
      ],
    };

    const result = filterOverlappingExperienceCandidates([
      lowerScore,
      higherScore,
    ]);

    expect(result.kept.map((c) => c.id)).toEqual(['higher-score']);
    expect(result.excluded).toEqual([
      {
        id: 'lower-score',
        reason: 'REDUNDANT_WITH_OTHER_CANDIDATE',
        overlapsWith: 'higher-score',
      },
    ]);
  });

  it('prefers requested weighted coverage before component count', () => {
    const broad = {
      id: 'broad-composite',
      weightedPreferenceCoverage: 1,
      components: [
        { geoEntity: { name: 'Shared Place', latitude: 1, longitude: 1 } },
        { geoEntity: { name: 'Second Place', latitude: 1.001, longitude: 1 } },
      ],
    };
    const preferred = {
      id: 'preferred-poi',
      weightedPreferenceCoverage: 3,
      components: [
        { geoEntity: { name: 'Shared Place', latitude: 1, longitude: 1 } },
      ],
    };

    const result = filterOverlappingExperienceCandidates([broad, preferred]);

    expect(result.kept.map((candidate) => candidate.id)).toEqual([
      'preferred-poi',
    ]);
  });

  it('preserves a resolved MUST over an overlapping ordinary candidate', () => {
    const must = {
      id: 'must-place',
      mustInclude: true,
      components: [
        { geoEntity: { name: 'Shared Place', latitude: 1, longitude: 1 } },
      ],
    };
    const ordinary = {
      id: 'ordinary-composite',
      components: [
        { geoEntity: { name: 'Shared Place', latitude: 1, longitude: 1 } },
        { geoEntity: { name: 'Another Place', latitude: 1.001, longitude: 1 } },
      ],
    };

    const result = filterOverlappingExperienceCandidates([ordinary, must]);

    expect(result.kept.map((candidate) => candidate.id)).toEqual([
      'must-place',
    ]);
  });
});
