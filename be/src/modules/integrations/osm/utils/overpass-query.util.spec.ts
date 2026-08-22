import {
  sanitizeOverpassName,
  buildBoundaryByNameQuery,
  buildContainingBoundaryQuery,
  buildStreetsQuery,
  buildBoundaryByIdQuery,
  buildAdminBoundariesWithinAreaQuery,
  buildStreetsWithinAreaQuery,
  buildPoisWithinAreaQuery,
} from './overpass-query.util';

describe('sanitizeOverpassName', () => {
  it('leaves an ordinary name untouched', () => {
    expect(sanitizeOverpassName('San Telmo')).toBe('San Telmo');
  });

  it('preserves apostrophes and accented characters', () => {
    expect(sanitizeOverpassName("Coeur d'Alene")).toBe("Coeur d'Alene");
    expect(sanitizeOverpassName('Ñuñoa')).toBe('Ñuñoa');
  });

  it('strips double quotes so the QL string literal cannot be broken out of', () => {
    expect(sanitizeOverpassName('San "Telmo"')).not.toContain('"');
  });

  it('strips control characters, including newlines', () => {
    const withNewline = 'San\nTelmo';
    const sanitized = sanitizeOverpassName(withNewline);
    expect(sanitized).not.toMatch(/[\r\n]/);
  });

  it('escapes regex metacharacters instead of passing them through raw', () => {
    const sanitized = sanitizeOverpassName('San (Telmo)+');
    // Every metacharacter must be preceded by a backslash — this is what
    // stops the input being interpreted as a regex pattern (ReDoS surface)
    // rather than literal text.
    expect(sanitized).toBe('San \\(Telmo\\)\\+');
  });

  it('truncates names longer than the length cap', () => {
    const longName = 'a'.repeat(500);
    expect(sanitizeOverpassName(longName).length).toBeLessThanOrEqual(200);
  });
});

describe('buildBoundaryByNameQuery', () => {
  it('embeds the sanitized name and radius into a valid-looking QL query', () => {
    const query = buildBoundaryByNameQuery({
      name: 'San Telmo',
      latitude: -34.62,
      longitude: -58.37,
      radiusMeters: 3000,
    });

    expect(query).toContain('San Telmo');
    expect(query).toContain('(around:3000,-34.62,-58.37)');
    expect(query).toContain('out geom;');
  });

  it('never lets a raw double quote from the name reach the query string', () => {
    const cleanQuery = buildBoundaryByNameQuery({
      name: 'Clean Name',
      latitude: 0,
      longitude: 0,
      radiusMeters: 1000,
    });
    const dirtyQuery = buildBoundaryByNameQuery({
      name: 'San "Telmo"',
      latitude: 0,
      longitude: 0,
      radiusMeters: 1000,
    });

    // A name with embedded quotes must not add any extra quote characters
    // to the query relative to an equivalent clean name — every quote in
    // the dirty case has to come from the template, not from the input.
    const quoteCount = (str: string) => (str.match(/"/g) || []).length;
    expect(quoteCount(dirtyQuery)).toBe(quoteCount(cleanQuery));
    expect(dirtyQuery).toContain('San Telmo');
  });
});

describe('buildContainingBoundaryQuery', () => {
  it('uses is_in + pivot, not a name filter', () => {
    const query = buildContainingBoundaryQuery({
      latitude: -34.6201,
      longitude: -58.3715,
    });

    expect(query).toContain('is_in(-34.6201,-58.3715)');
    expect(query).toContain('pivot.a');
    expect(query).not.toContain('~"');
  });
});

describe('buildStreetsQuery', () => {
  it('filters by highway + name within the given radius', () => {
    const query = buildStreetsQuery({
      latitude: -34.6201,
      longitude: -58.3715,
      radiusMeters: 2500,
    });

    expect(query).toContain('["highway"]["name"]');
    expect(query).toContain('(around:2500,-34.6201,-58.3715)');
  });
});

describe('buildBoundaryByIdQuery', () => {
  it('queries a specific relation by id and asks for full geometry', () => {
    const query = buildBoundaryByIdQuery({
      osmType: 'relation',
      osmId: 1224652,
    });

    expect(query).toContain('relation(1224652)');
    expect(query).toContain('out geom;');
  });

  it('queries a specific way by id when the boundary is a way, not a relation', () => {
    const query = buildBoundaryByIdQuery({ osmType: 'way', osmId: 42 });

    expect(query).toContain('way(42)');
    expect(query).toContain('out geom;');
  });
});

describe('OverpassElement center field', () => {
  it('is typed as optional on OverpassElement, for the out tags center response shape', () => {
    // Compile-time check, not a runtime assertion: buildAdminBoundariesWithinAreaQuery
    // and buildStreetsWithinAreaQuery/buildPoisWithinAreaQuery below all use
    // `out tags center;`, not `out geom;` — deliberately (a city can have
    // dozens of neighborhoods; fetching every one's full polygon would risk
    // the same 413 payload problem street-candidate capping already guards
    // against elsewhere). Overpass's `center` modifier adds a lightweight
    // { lat, lon } to each way/relation instead of full geometry — see
    // osm-geometry.util.ts's centroid fallback (Task 9) for how that's
    // turned into a usable OsmCandidate despite having no polygon.
    const el: import('../interfaces/overpass.interface').OverpassElement = {
      type: 'relation',
      id: 1,
      tags: { name: 'San Telmo' },
      center: { lat: -34.62, lon: -58.37 },
    };
    expect(el.center).toEqual({ lat: -34.62, lon: -58.37 });
  });
});

describe('buildAdminBoundariesWithinAreaQuery', () => {
  it('uses map_to_area on the given relation, not a radius', () => {
    const query = buildAdminBoundariesWithinAreaQuery({
      osmType: 'relation',
      osmId: 1224652,
    });

    expect(query).toContain('relation(1224652)');
    expect(query).toContain('map_to_area->.a');
    expect(query).toContain('["boundary"="administrative"](area.a)');
    expect(query).not.toContain('around:');
    expect(query).toContain('out tags center;');
  });
});

describe('buildStreetsWithinAreaQuery', () => {
  it('uses map_to_area, filtering named highways, not a radius', () => {
    const query = buildStreetsWithinAreaQuery({
      osmType: 'relation',
      osmId: 2223069,
    });

    expect(query).toContain('relation(2223069)');
    expect(query).toContain('map_to_area->.a');
    expect(query).toContain('way["highway"]["name"](area.a)');
    expect(query).not.toContain('around:');
  });
});

describe('buildPoisWithinAreaQuery', () => {
  it('uses map_to_area, filtering named tourism/amenity/historic/leisure nodes', () => {
    const query = buildPoisWithinAreaQuery({
      osmType: 'relation',
      osmId: 2223069,
    });

    expect(query).toContain('map_to_area->.a');
    expect(query).toContain('node["tourism"]["name"](area.a)');
    expect(query).toContain('node["historic"]["name"](area.a)');
    expect(query).not.toContain('around:');
  });
});
