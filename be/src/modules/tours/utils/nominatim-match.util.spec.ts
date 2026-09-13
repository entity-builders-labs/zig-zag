import {
  bestNominatimMatch,
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
