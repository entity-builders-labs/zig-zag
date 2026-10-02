import {
  sanitizeOverpassName,
  sanitizeOverpassTagToken,
  buildBoundaryByNameQuery,
  buildContainingBoundaryQuery,
  buildBoundaryByIdQuery,
  buildAdminBoundariesWithinAreaQuery,
  buildPoisWithinAreaQuery,
  buildPoisQuery,
  buildFeaturesNearQuery,
  buildHighwaysByNameQuery,
  HIGHWAYS_BY_NAME_OPERATIONAL_MAX_RADIUS_METERS,
  buildContainingAdminBoundariesQuery,
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
      childAdminLevel: 9,
    });

    expect(query).toContain('relation(1224652)');
    expect(query).toContain('map_to_area->.a');
    expect(query).toContain('["admin_level"="9"](area.a)');
    expect(query).toContain('[!"highway"](area.a)(if:is_closed())');
    expect(query).not.toContain('around:');
    expect(query).toContain('out tags center;');
  });

  it('rejects an invalid child admin level', () => {
    expect(() =>
      buildAdminBoundariesWithinAreaQuery({
        osmType: 'relation',
        osmId: 1224652,
        childAdminLevel: 13,
      }),
    ).toThrow(RangeError);
  });
});

describe('buildPoisWithinAreaQuery', () => {
  it('uses map_to_area and includes named nodes/ways/relations relevant to travel experiences', () => {
    const query = buildPoisWithinAreaQuery({
      osmType: 'relation',
      osmId: 2223069,
    });

    expect(query).toContain('map_to_area->.a');
    expect(query).toContain('nwr["historic"]["name"](area.a)');
    expect(query).toContain(
      'nwr["leisure"~"^(park|square|beach_resort)$"]["name"](area.a)',
    );
    expect(query).toContain('nwr["natural"="beach"]["name"](area.a)');
    expect(query).not.toContain('around:');
  });

  it('excludes accommodation-only tourism=* subtypes (hotel/hostel/guest_house/motel/...) -- not tourist experiences, live-verified as 33-40% of the real local pool otherwise (docs/superpowers/characterization/2026-09-18-task-a8-root-cause-5-live-remeasure.md follow-up: several real false-positive collisions matched a hotel, e.g. "Recoleta Cemetery" -> "Hotel Urban Suites Recoleta")', () => {
    const query = buildPoisWithinAreaQuery({
      osmType: 'relation',
      osmId: 2223069,
    });

    expect(query).toContain(
      'nwr["tourism"]["tourism"!~"^(hotel|hostel|guest_house|motel|apartment|camp_site|caravan_site|chalet|wilderness_hut)$"]["name"](area.a)',
    );
  });

  it('includes named indoor pedestrian galleries/arcades (highway=corridor) -- real gap, live-verified against the real local Overpass instance: "Galería Güemes" (a well-known 1915 Buenos Aires shopping arcade, has its own Wikipedia article) is tagged only highway=corridor + indoor=yes, no tourism/historic/amenity/leisure tag at all, so it never entered the local pool before this. Scanning a 15km radius around Buenos Aires turned up only 6 real named corridors total (all real historic galleries/passages), so this is a narrow, safe tag-category addition, not a name-specific patch', () => {
    const query = buildPoisWithinAreaQuery({
      osmType: 'relation',
      osmId: 2223069,
    });

    expect(query).toContain('nwr["highway"="corridor"]["name"](area.a)');
  });
});

describe('buildPoisQuery', () => {
  it('filters the same tourism/amenity/historic/leisure/natural categories as buildPoisWithinAreaQuery, around a point instead of within an area', () => {
    const query = buildPoisQuery({
      latitude: -34.6201,
      longitude: -58.3715,
      radiusMeters: 2500,
    });

    expect(query).toContain('(around:2500,-34.6201,-58.3715)');
    expect(query).toContain('nwr["historic"]["name"]');
    expect(query).toContain(
      'nwr["leisure"~"^(park|square|beach_resort)$"]["name"]',
    );
    expect(query).toContain('nwr["natural"="beach"]["name"]');
  });

  it('excludes accommodation-only tourism=* subtypes, same exclusion as buildPoisWithinAreaQuery', () => {
    const query = buildPoisQuery({
      latitude: -34.6201,
      longitude: -58.3715,
      radiusMeters: 2500,
    });

    expect(query).toContain(
      'nwr["tourism"]["tourism"!~"^(hotel|hostel|guest_house|motel|apartment|camp_site|caravan_site|chalet|wilderness_hut)$"]["name"]',
    );
  });

  it('includes named indoor pedestrian galleries/arcades (highway=corridor), same category as buildPoisWithinAreaQuery', () => {
    const query = buildPoisQuery({
      latitude: -34.6201,
      longitude: -58.3715,
      radiusMeters: 2500,
    });

    expect(query).toContain(
      'nwr["highway"="corridor"]["name"](around:2500,-34.6201,-58.3715)',
    );
  });
});

describe('sanitizeOverpassTagToken', () => {
  it('accepts real OSM tag tokens', () => {
    expect(sanitizeOverpassTagToken('tourism')).toBe('tourism');
    expect(sanitizeOverpassTagToken('arts_centre')).toBe('arts_centre');
    expect(sanitizeOverpassTagToken('route')).toBe('route');
    expect(sanitizeOverpassTagToken('addr:city')).toBe('addr:city');
  });

  it('rejects anything outside [A-Za-z0-9_:]', () => {
    for (const bad of ['a"b', 'na me', 'wine*', 'park]', 'x;out', 'y\n', '']) {
      expect(() => sanitizeOverpassTagToken(bad)).toThrow(
        /Invalid Overpass tag token/,
      );
    }
  });
});

describe('buildFeaturesNearQuery', () => {
  const base = { latitude: -34.6037, longitude: -58.3816, radiusMeters: 3000 };

  it('builds one bounded union query with out tags center', () => {
    const query = buildFeaturesNearQuery({
      ...base,
      selectors: [{ key: 'tourism', value: 'museum', requireName: true }],
    });
    expect(query).toContain('[out:json][timeout:25];');
    expect(query).toContain('(\n');
    expect(query).toContain(
      'nwr["tourism"="museum"]["name"](around:3000,-34.6037,-58.3816);',
    );
    expect(query.trimEnd().endsWith('out tags center;')).toBe(true);
    expect(query).not.toContain('out geom');
  });

  it('emits one line per selector inside a single union', () => {
    const query = buildFeaturesNearQuery({
      ...base,
      selectors: [
        { key: 'tourism', value: 'museum', requireName: true },
        { key: 'historic', value: 'monument', requireName: true },
      ],
    });
    expect((query.match(/around:3000/g) || []).length).toBe(2);
    expect((query.match(/^\(/gm) || []).length).toBe(1);
    expect(query).toContain('nwr["tourism"="museum"]["name"]');
    expect(query).toContain('nwr["historic"="monument"]["name"]');
  });

  it('omits the name filter when requireName is false and supports key-presence selectors', () => {
    const query = buildFeaturesNearQuery({
      ...base,
      selectors: [{ key: 'historic', requireName: false }],
    });
    expect(query).toContain('nwr["historic"](around:3000,-34.6037,-58.3816);');
    expect(query).not.toContain('["name"]');
  });

  it('restricts element types to a strict subset with one line per type (no nwr shorthand)', () => {
    const query = buildFeaturesNearQuery({
      ...base,
      selectors: [
        {
          key: 'leisure',
          value: 'park',
          requireName: true,
          elementTypes: ['way', 'relation'],
        },
      ],
    });
    expect(query).toContain('way["leisure"="park"]["name"](around:3000');
    expect(query).toContain('relation["leisure"="park"]["name"](around:3000');
    expect(query).not.toContain('nwr["leisure"="park"]');
    expect(query).not.toContain('node["leisure"="park"]');
  });

  it('caps the radius defensively', () => {
    const query = buildFeaturesNearQuery({
      ...base,
      radiusMeters: 100000,
      selectors: [{ key: 'natural', value: 'peak' }],
    });
    expect(query).toContain('around:8000,');
    expect(query).not.toContain('around:100000');
  });

  it('rejects an unsafe tag token instead of interpolating it', () => {
    expect(() =>
      buildFeaturesNearQuery({
        ...base,
        selectors: [{ key: 'amenity"];out;("', value: 'x' }],
      }),
    ).toThrow(/Invalid Overpass tag token/);
  });

  it('throws on an empty selector list', () => {
    expect(() => buildFeaturesNearQuery({ ...base, selectors: [] })).toThrow(
      /at least one selector/,
    );
  });
});

describe('buildHighwaysByNameQuery', () => {
  const base = {
    latitude: -34.6037,
    longitude: -58.3816,
    radiusMeters: 20000,
  };

  it('emits one exact-name, highway-only way query bounded by around:', () => {
    const query = buildHighwaysByNameQuery({ ...base, name: 'Defensa' });
    expect(query).toContain(
      'way["highway"]["name"="Defensa"](around:20000,-34.6037,-58.3816);',
    );
    // out geom carries node refs (topological grouping) plus geometry.
    expect(query).toContain('out geom;');
    // A targeted exact match, never a regex/fuzzy name match or an area
    // (map_to_area) scoped lookup.
    expect(query).not.toContain('~');
    expect(query).not.toContain('area');
    expect(query).not.toMatch(/\bnode\[|\brelation\[|\bnwr\[/);
  });

  it('keeps accents and dots verbatim (exact-value match, not a regex)', () => {
    const query = buildHighwaysByNameQuery({
      ...base,
      name: 'Doctor José M. Giuffra',
    });
    expect(query).toContain('["name"="Doctor José M. Giuffra"]');
  });

  it('strips quotes, backslashes and control characters', () => {
    const query = buildHighwaysByNameQuery({
      ...base,
      name: 'Def"ensa\\\n',
    });
    expect(query).toContain('["name"="Defensa"]');
  });

  it('refuses a window above the operational cap instead of silently clamping it (a clamped search would turn missing coverage into NOT_FOUND)', () => {
    expect(() =>
      buildHighwaysByNameQuery({
        ...base,
        name: 'Defensa',
        radiusMeters: HIGHWAYS_BY_NAME_OPERATIONAL_MAX_RADIUS_METERS + 1,
      }),
    ).toThrow(/operational cap/);
    expect(
      buildHighwaysByNameQuery({
        ...base,
        name: 'Defensa',
        radiusMeters: HIGHWAYS_BY_NAME_OPERATIONAL_MAX_RADIUS_METERS,
      }),
    ).toContain(`(around:${HIGHWAYS_BY_NAME_OPERATIONAL_MAX_RADIUS_METERS},`);
  });

  it('rejects an empty name after sanitization', () => {
    expect(() => buildHighwaysByNameQuery({ ...base, name: ' "" ' })).toThrow();
  });
});

describe('buildContainingAdminBoundariesQuery', () => {
  it('asks is_in for the administrative relations containing a point, tags only', () => {
    const query = buildContainingAdminBoundariesQuery({
      latitude: -34.6247943,
      longitude: -58.3711431,
    });
    expect(query).toContain('is_in(-34.6247943,-58.3711431)->.a;');
    expect(query).toContain('rel(pivot.a)["boundary"="administrative"];');
    expect(query).toContain('out tags;');
    expect(query).not.toContain('out geom');
  });
});
