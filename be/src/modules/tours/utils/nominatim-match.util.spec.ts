import {
  bestNominatimMatch,
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
});
