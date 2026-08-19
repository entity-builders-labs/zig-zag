import {
  sanitizeOverpassName,
  buildBoundaryByNameQuery,
  buildContainingBoundaryQuery,
  buildStreetsQuery,
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
