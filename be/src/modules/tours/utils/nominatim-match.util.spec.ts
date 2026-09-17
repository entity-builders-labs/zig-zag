import {
  bestNominatimMatch,
  hasSpecificNameOverlap,
  isAreaScaleEligible,
  matchOsmCandidateByName,
  normalizeGeoName,
  rankNominatimCandidates,
} from './nominatim-match.util';
import { NominatimResult } from '@integrations/osm/interfaces/nominatim.interface';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';

function result(overrides: Partial<NominatimResult> = {}): NominatimResult {
  return {
    displayName: 'Plaza Dorrego, San Telmo, Buenos Aires, Argentina',
    osmType: 'way',
    osmId: 1,
    latitude: -34.6212,
    longitude: -58.3731,
    importance: 0.2,
    addresstype: 'square',
    placeRank: 20,
    address: {},
    ...overrides,
  } as NominatimResult;
}

function osmCandidate(overrides: Partial<OsmCandidate> = {}): OsmCandidate {
  return {
    id: 'way/1',
    name: 'Caminito',
    osmType: 'way',
    osmId: 1,
    geometry: { type: 'LineString', coordinates: [] },
    tags: {},
    ...overrides,
  } as OsmCandidate;
}

describe('normalizeGeoName', () => {
  it('strips diacritics, lowercases, and collapses punctuation', () => {
    expect(normalizeGeoName('Ruta del Vino, Mendoza!')).toBe(
      'ruta del vino mendoza',
    );
    expect(normalizeGeoName('San Telmó')).toBe('san telmo');
  });
});

describe('bestNominatimMatch', () => {
  it('prefers an exact (or exact-prefix) displayName match', () => {
    const exact = result({ displayName: 'Plaza Dorrego, San Telmo' });
    const other = result({ displayName: 'Some Other Place' });
    const match = bestNominatimMatch('Plaza Dorrego', [other, exact]);
    expect(match).toBe(exact);
  });

  it('falls back to significant-token overlap for a translated name', () => {
    const spanish = result({
      displayName: 'Parque Provincial Ischigualasto, San Juan, Argentina',
    });
    const match = bestNominatimMatch('Ischigualasto Provincial Park', [
      spanish,
    ]);
    expect(match).toBe(spanish);
  });

  it('never matches on a short/generic token alone', () => {
    const generic = result({ displayName: 'Park Avenue, New York' });
    const match = bestNominatimMatch('Central Park', [generic]);
    expect(match).toBeUndefined();
  });

  it('breaks ties on same-name candidates by proximity to the destination', () => {
    const near = result({
      displayName: 'Catedral San Juan Bautista, San Juan, Argentina',
      importance: 0.199,
      latitude: -31.5375,
      longitude: -68.5364,
    });
    const far = result({
      displayName: 'Catedral San Juan Bautista, Buenos Aires, Argentina',
      importance: 0.208,
      latitude: -34.6037,
      longitude: -58.3816,
    });
    const match = bestNominatimMatch(
      'Catedral San Juan Bautista',
      [far, near],
      { latitude: -31.5375, longitude: -68.5364 },
    );
    expect(match).toBe(near);
  });
});

describe('rankNominatimCandidates', () => {
  it('returns undefined for an empty list', () => {
    expect(rankNominatimCandidates([])).toBeUndefined();
  });

  it('falls back to importance when no destination point is given', () => {
    const low = result({ importance: 0.1 });
    const high = result({ importance: 0.9 });
    expect(rankNominatimCandidates([low, high])).toBe(high);
  });
});

describe('isAreaScaleEligible', () => {
  // Cutover M3.5 -- solves the general scale-model problem: a real,
  // resolvable way/relation with genuine urban/administrative context is
  // area-scale-eligible regardless of what specific narrow term Nominatim
  // gives it, never an enumerated whitelist of "acceptable" place names.

  it('rejects a bare node (no usable boundary geometry exists at all)', () => {
    expect(
      isAreaScaleEligible(
        result({ osmType: 'node', class: 'place', addresstype: 'city' }),
      ),
    ).toBe(false);
  });

  it('accepts a genuine administrative city boundary', () => {
    expect(
      isAreaScaleEligible(
        result({
          osmType: 'relation',
          class: 'boundary',
          type: 'administrative',
          addresstype: 'city',
        }),
      ),
    ).toBe(true);
  });

  it.each([12, 13, 15, 16, 25, 26])(
    'applies the canonical administrative AREA rank boundary: %s',
    (placeRank) => {
      expect(
        isAreaScaleEligible(
          result({
            osmType: 'relation',
            class: 'boundary',
            type: 'administrative',
            addresstype: 'city',
            placeRank,
          }),
        ),
      ).toBe(placeRank >= 13 && placeRank <= 25);
    },
  );

  it('accepts a city boundary when place rank 15 is valid even if address rank is 20', () => {
    expect(
      isAreaScaleEligible(
        result({
          osmType: 'relation',
          class: 'boundary',
          type: 'administrative',
          addresstype: 'city',
          placeRank: 15,
          addressRank: 20,
        }),
      ),
    ).toBe(true);
  });

  // The headline regression case (RW1): a neighborhood-scale urban area
  // must resolve canonically, not degrade to point+radius merely because
  // it isn't city/town/village.
  it('accepts a suburb-classified real place (San Telmo-style neighborhood)', () => {
    expect(
      isAreaScaleEligible(
        result({ osmType: 'relation', class: 'place', addresstype: 'suburb' }),
      ),
    ).toBe(true);
  });

  it('accepts a neighbourhood-classified real place (general, not suburb-specific)', () => {
    expect(
      isAreaScaleEligible(
        result({
          osmType: 'way',
          class: 'place',
          addresstype: 'neighbourhood',
        }),
      ),
    ).toBe(true);
  });

  it('accepts a quarter-classified real place (general, not suburb-specific)', () => {
    expect(
      isAreaScaleEligible(
        result({ osmType: 'relation', class: 'place', addresstype: 'quarter' }),
      ),
    ).toBe(true);
  });

  it('accepts a borough-classified real place (general, not suburb-specific)', () => {
    expect(
      isAreaScaleEligible(
        result({ osmType: 'relation', class: 'place', addresstype: 'borough' }),
      ),
    ).toBe(true);
  });

  it('rejects a country result even though it is a genuine administrative boundary (too broad)', () => {
    expect(
      isAreaScaleEligible(
        result({
          osmType: 'relation',
          class: 'boundary',
          type: 'administrative',
          addresstype: 'country',
          placeRank: 4,
        }),
      ),
    ).toBe(false);
  });

  it('rejects a state/region result even though it is a genuine administrative boundary (too broad)', () => {
    expect(
      isAreaScaleEligible(
        result({
          osmType: 'relation',
          class: 'boundary',
          type: 'administrative',
          addresstype: 'state',
          placeRank: 10,
        }),
      ),
    ).toBe(false);
  });

  it('rejects a continent result (too broad)', () => {
    expect(
      isAreaScaleEligible(
        result({
          osmType: 'relation',
          class: 'boundary',
          type: 'administrative',
          addresstype: 'continent',
          placeRank: 4,
        }),
      ),
    ).toBe(false);
  });

  it.each([
    ['region', 8],
    ['province', 10],
    ['county', 12],
  ])(
    'rejects an unbounded administrative scale (%s)',
    (addresstype, placeRank) => {
      expect(
        isAreaScaleEligible(
          result({
            osmType: 'relation',
            class: 'boundary',
            type: 'administrative',
            addresstype,
            placeRank,
          }),
        ),
      ).toBe(false);
    },
  );

  it('uses address rank when place rank is unavailable', () => {
    expect(
      isAreaScaleEligible(
        result({
          osmType: 'relation',
          class: 'place',
          addresstype: 'quarter',
          placeRank: undefined,
          addressRank: 22,
        }),
      ),
    ).toBe(true);
  });

  it('rejects an otherwise valid area when both scale signals are unknown', () => {
    expect(
      isAreaScaleEligible(
        result({
          osmType: 'relation',
          class: 'place',
          addresstype: 'suburb',
          placeRank: undefined,
          addressRank: undefined,
        }),
      ),
    ).toBe(false);
  });

  // Required regression (correction round): class === 'boundary' alone
  // never proves administrative eligibility -- Nominatim overloads
  // `boundary` with several genuinely non-administrative kinds.
  it.each(['national_park', 'protected_area', 'maritime', 'postal_code'])(
    'rejects a %s boundary -- class is "boundary" but type is not "administrative"',
    (type) => {
      expect(
        isAreaScaleEligible(
          result({
            osmType: 'relation',
            class: 'boundary',
            type,
            addresstype: 'suburb',
          }),
        ),
      ).toBe(false);
    },
  );

  it('rejects a boundary-classified result with a missing/unknown type -- unknown never proves administrative eligibility', () => {
    expect(
      isAreaScaleEligible(
        result({
          osmType: 'relation',
          class: 'boundary',
          type: undefined,
          addresstype: 'city',
        }),
      ),
    ).toBe(false);
  });

  it('rejects a way/relation with no urban/admin classification at all (a building/POI/street, not a whitelist name match)', () => {
    // Same osmType/addresstype shape a real neighborhood could have, but
    // `class` says this is NOT actually a place/boundary concept -- proves
    // the check reads real provider type, not just a name/addresstype
    // coincidence.
    expect(
      isAreaScaleEligible(
        result({ osmType: 'way', class: 'building', addresstype: 'suburb' }),
      ),
    ).toBe(false);
    expect(
      isAreaScaleEligible(
        result({ osmType: 'way', class: 'highway', addresstype: 'road' }),
      ),
    ).toBe(false);
    expect(
      isAreaScaleEligible(
        result({ osmType: 'node', class: 'amenity', addresstype: 'hotel' }),
      ),
    ).toBe(false);
  });

  it('rejects when class is missing/unknown -- unknown never defaults to eligible', () => {
    expect(
      isAreaScaleEligible(
        result({ osmType: 'relation', class: undefined, addresstype: 'city' }),
      ),
    ).toBe(false);
  });
});

describe('matchOsmCandidateByName', () => {
  it('matches exact, substring, and superstring names', () => {
    const pool = [osmCandidate({ name: 'Caminito' })];
    expect(matchOsmCandidateByName('Caminito', pool)).toBe(pool[0]);
    expect(matchOsmCandidateByName('Calle Caminito', pool)).toBe(pool[0]);
  });

  it('returns undefined when nothing matches', () => {
    const pool = [osmCandidate({ name: 'Avenida de Mayo' })];
    expect(matchOsmCandidateByName('Caminito', pool)).toBeUndefined();
  });

  it('rejects a short/generic candidate name that merely appears as a letter sequence inside a longer, unrelated hint (real regression: "B" matched MALBA, La Bombonera and Museo Nacional de Bellas Artes; "MO" matched "Mercado de San Telmo"; "CE" matched "Centro Científico Tecnológicos")', () => {
    const pool = [osmCandidate({ name: 'B' })];
    expect(matchOsmCandidateByName('MALBA Museum', pool)).toBeUndefined();
    expect(matchOsmCandidateByName('La Bombonera', pool)).toBeUndefined();

    const moPool = [osmCandidate({ name: 'MO' })];
    expect(
      matchOsmCandidateByName('Mercado de San Telmo', moPool),
    ).toBeUndefined();

    const cePool = [osmCandidate({ name: 'CE' })];
    expect(
      matchOsmCandidateByName('Centro Científico Tecnológicos', cePool),
    ).toBeUndefined();
  });

  it('rejects a single generic category word matching only because it is one of several tokens in a longer, more specific hint (real regression: "Iglesia" matched "Iglesia San Ignacio de Loyola", ~8km from the real one)', () => {
    const pool = [osmCandidate({ name: 'Iglesia' })];
    expect(
      matchOsmCandidateByName('Iglesia San Ignacio de Loyola', pool),
    ).toBeUndefined();
  });

  it('still matches when the candidate name is a genuine, specific token shared with the hint (regression guard: must not become too strict)', () => {
    const pool = [osmCandidate({ name: 'Riachuelo' })];
    expect(matchOsmCandidateByName('Riachuelo', pool)).toBe(pool[0]);

    const galeriaPool = [osmCandidate({ name: 'Mirador Galería Güemes' })];
    expect(matchOsmCandidateByName('Galería Güemes', galeriaPool)).toBe(
      galeriaPool[0],
    );

    const malbaPool = [
      osmCandidate({
        name: 'Museo de Arte Latinoamericano de Buenos Aires (MALBA)',
      }),
    ];
    expect(matchOsmCandidateByName('MALBA', malbaPool)).toBe(malbaPool[0]);
  });

  it('prefers an exact match later in the pool over an earlier fuzzy match on a shared generic token (real regression: "Venue 007" matched "Venue 000" because the distinguishing digits are below the 4-char token-length floor)', () => {
    const pool = [
      osmCandidate({ id: 'osm:node:0', name: 'Venue 000' }),
      osmCandidate({ id: 'osm:node:7', name: 'Venue 007' }),
    ];
    expect(matchOsmCandidateByName('Venue 007', pool)).toBe(pool[1]);
    // Sanity: the fuzzy path alone (no exact match anywhere in the pool)
    // still falls back to the first token-overlap match, unchanged.
    const fuzzyOnlyPool = [osmCandidate({ id: 'osm:node:0', name: 'Venue X' })];
    expect(matchOsmCandidateByName('Venue 007', fuzzyOnlyPool)).toBe(
      fuzzyOnlyPool[0],
    );
  });
});

describe('hasSpecificNameOverlap (exported for cross-source confirmation reuse)', () => {
  it('is importable and behaves identically to the existing matchOsmCandidateByName guards', () => {
    expect(hasSpecificNameOverlap('riachuelo', 'riachuelo')).toBe(true);
    expect(hasSpecificNameOverlap('malba museum', 'b')).toBe(false);
    expect(
      hasSpecificNameOverlap(
        'malba museum',
        'museo de arte latinoamericano de buenos aires malba',
      ),
    ).toBe(true);
  });
});
