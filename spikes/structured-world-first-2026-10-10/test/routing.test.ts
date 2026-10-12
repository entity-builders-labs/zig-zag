import { Gap2 } from '../src/contracts';
import { AUTHORIZED_CLASSES, ROUTING_TABLE, newRouteTrace, routeGap } from '../src/routing';

const gap = (type: Gap2['type'], kind: Gap2['kind'], questions: Gap2['questions'] = []): Gap2 => ({
  key: `${type}|scope=dest`, type, kind, scopeId: 'dest', threshold: 1, observed: 0, questions,
});
const q = { key: 'Q|RELEVANT_FOR|candidate=a|facet=theme:history', claimType: 'RELEVANT_FOR' as const, candidateId: 'a', facetKey: 'theme:history' };

describe('acquisition router (tasks 12.1, 12.2)', () => {
  it('routes discovery gaps only to structured classes', () => {
    for (const type of ['AREA_CANDIDATES', 'PLACE_CANDIDATES', 'ROUTE_CANDIDATES'] as const) {
      const d = routeGap(gap(type, 'DISCOVERY'), {});
      expect(d.strategies.length).toBeGreaterThan(0);
      for (const s of d.strategies) expect(['GEOGRAPHIC_STRUCTURE', 'STRUCTURED_POI', 'STRUCTURED_ENTITY_FACTS', 'ROUTE_GEOMETRY']).toContain(s.sourceClass);
      expect(d.strategies.some((s) => s.sourceClass === 'WEB_EVIDENCE' || s.sourceClass === 'RESEARCH_MEMORY')).toBe(false);
    }
  });

  it('meaning gaps route structured facts -> memory -> web and require offered questions', () => {
    const d = routeGap(gap('AREA_RELEVANCE', 'MEANING', [q]), {});
    expect(d.strategies.map((s) => s.sourceClass)).toEqual(['STRUCTURED_ENTITY_FACTS', 'RESEARCH_MEMORY', 'WEB_EVIDENCE']);
    expect(() => routeGap(gap('AREA_RELEVANCE', 'MEANING'), {})).toThrow(/without offered candidate questions/);
  });

  it('an unavailable structured provider leaves no strategy and never adds web research', () => {
    const d = routeGap(gap('AREA_CANDIDATES', 'DISCOVERY'), { 'osm-overpass': false, 'wikidata-sparql': false });
    expect(d.strategies).toEqual([]);
    expect(d.unavailable.map((s) => s.id)).toEqual(['osm-admin-areas', 'osm-named-places', 'wikidata-area-facts']);
  });

  it('is deterministic and the policy holds no website or domain', () => {
    expect(routeGap(gap('PLACE_RELEVANCE', 'MEANING', [q]), {})).toEqual(routeGap(gap('PLACE_RELEVANCE', 'MEANING', [q]), {}));
    const text = JSON.stringify({ ROUTING_TABLE, AUTHORIZED_CLASSES });
    expect(text).not.toMatch(/https?:|www\.|\.(com|org|ar|net|gob|gov)\b/);
  });

  it('route trace records policy version, selected and unavailable strategies', () => {
    const g = gap('PLACE_CANDIDATES', 'DISCOVERY');
    const trace = newRouteTrace(g, routeGap(g, { 'wikidata-sparql': false }));
    expect(trace).toEqual({ gapKey: g.key, gapType: 'PLACE_CANDIDATES', policyVersion: 'routing-spike2-1', selected: ['osm-pois'], unavailable: ['wikidata-place-facts'], runs: [] });
  });
});
