import { discoveryKey, evaluationQuestionKey, Spike2Catalog } from '../src/catalog';
import { CandidateFacts } from '../src/contracts';
import { AuthorityViolation, GeographyResolutionAuthority, GroundingAuthority } from '../src/spike1';

const entity = (id: string, extId: string) => ({
  id, kind: 'AREA' as const, name: 'San Telmo', identities: [{ provider: 'openstreetmap', externalId: extId }],
  geometry: { type: 'Point' as const, coordinates: [-58.37, -34.62] as [number, number] }, centroid: { lng: -58.37, lat: -34.62 },
});

describe('spike 2 contracts and catalog (tasks 11.1, 11.2)', () => {
  it('keys are built only from typed fields', () => {
    expect(evaluationQuestionKey('RELEVANT_FOR', 'geo:osm:relation:2', 'theme:history')).toBe('Q|RELEVANT_FOR|candidate=geo:osm:relation:2|facet=theme:history');
    expect(discoveryKey('PLACE', 'geo:osm:relation:2')).toBe('DISCOVERY|PLACE|scope=geo:osm:relation:2');
  });

  it('a point-only named place carries extent UNKNOWN and keeps provider names', () => {
    const catalog = Spike2Catalog.empty();
    catalog.recordCandidate(new GeographyResolutionAuthority(), entity('geo:osm:node:9', 'osm:node:9'), {
      kind: 'AREA', names: ['Palermo Soho'], areaClass: 'NAMED_PLACE', extent: 'UNKNOWN', parentAreaIds: [],
      discoveredBy: { kind: 'AREA', scopeId: 'dest', strategies: ['osm-named-places'] }, facts: [], prominence: { tagSignals: [] },
    });
    const facts = catalog.snapshot().candidates['geo:osm:node:9'];
    expect(facts).toMatchObject({ areaClass: 'NAMED_PLACE', extent: 'UNKNOWN', names: ['Palermo Soho'] });
  });

  it('candidate facts accept writes only with the geography-resolution authority', () => {
    const catalog = Spike2Catalog.empty();
    expect(() => catalog.recordCandidate(new GroundingAuthority() as unknown as GeographyResolutionAuthority, entity('g', 'osm:node:1'), {
      kind: 'AREA', names: ['x'], parentAreaIds: [], discoveredBy: { kind: 'AREA', scopeId: 'd', strategies: [] }, facts: [], prominence: { tagSignals: [] },
    })).toThrow(AuthorityViolation);
  });

  it('records sharing a strong identity merge into one candidate', () => {
    const catalog = Spike2Catalog.empty();
    const token = new GeographyResolutionAuthority();
    const base: Pick<CandidateFacts, 'kind' | 'parentAreaIds' | 'facts' | 'prominence'> = { kind: 'AREA', parentAreaIds: [], facts: [], prominence: { tagSignals: [] } };
    catalog.recordCandidate(token, entity('g1', 'osm:relation:2'), { ...base, names: ['San Telmo'], discoveredBy: { kind: 'AREA', scopeId: 'd', strategies: ['osm-admin'] } });
    const second = catalog.recordCandidate(token, entity('g2', 'osm:relation:2'), { ...base, names: ['Barrio de San Telmo'], discoveredBy: { kind: 'AREA', scopeId: 'd', strategies: ['osm-named-places'] } });
    expect(second.id).toBe('g1');
    expect(catalog.snapshot().candidates.g1.names).toEqual(['San Telmo', 'Barrio de San Telmo']);
    expect(catalog.snapshot().candidates.g1.discoveredBy.strategies).toEqual(['osm-admin', 'osm-named-places']);
  });
});
