import { sanitizeOverpassTagToken } from '@integrations/osm/utils/overpass-query.util';
import { SOURCE_CAPABILITY_ROUTES } from './acquisition-source-routing';
import {
  OSM_ACQUISITION_CONCEPTS,
  OSM_UNSUPPORTED_CONCEPTS,
  resolveOsmConcepts,
} from './osm-acquisition-concepts';

describe('osm-acquisition-concepts registry', () => {
  it('every selector tag token is safe (passes sanitizeOverpassTagToken)', () => {
    for (const [concept, def] of Object.entries(OSM_ACQUISITION_CONCEPTS)) {
      for (const selector of def.selectors) {
        expect(() => sanitizeOverpassTagToken(selector.key)).not.toThrow();
        if (selector.value !== undefined) {
          expect(() =>
            sanitizeOverpassTagToken(selector.value as string),
          ).not.toThrow();
        }
        expect(['place', 'area', 'route']).toContain(def.evidenceType);
        // If a selector restricts element types at all, `node` is never part
        // of an AREA restriction (the provider downgrades node -> place at
        // runtime instead of filtering it out).
        if (def.evidenceType === 'area' && selector.elementTypes) {
          expect(selector.elementTypes).not.toContain('node');
        }
        expect(concept).toMatch(/^[a-z_]+$/);
      }
    }
  });

  it('every osmConcept in the routing table is either mapped or explicitly unsupported', () => {
    const routed = new Set<string>();
    for (const route of Object.values(SOURCE_CAPABILITY_ROUTES)) {
      for (const concept of route.osmConcepts ?? []) routed.add(concept);
    }
    for (const concept of routed) {
      const known =
        !!OSM_ACQUISITION_CONCEPTS[concept] ||
        OSM_UNSUPPORTED_CONCEPTS.has(concept);
      expect(known).toBe(true);
    }
  });

  it('does not both support and unsupport the same concept', () => {
    for (const concept of OSM_UNSUPPORTED_CONCEPTS) {
      expect(OSM_ACQUISITION_CONCEPTS[concept]).toBeUndefined();
    }
  });

  it('treats generic food / nightlife venues as unsupported for proactive Experience acquisition', () => {
    for (const concept of ['restaurant', 'cafe', 'bar', 'pub', 'nightclub']) {
      expect(OSM_ACQUISITION_CONCEPTS[concept]).toBeUndefined();
      expect(OSM_UNSUPPORTED_CONCEPTS.has(concept)).toBe(true);

      const { selectors, supported, unsupported } = resolveOsmConcepts([
        concept,
      ]);
      expect(selectors).toEqual([]);
      expect(supported).toEqual([]);
      expect(unsupported).toEqual([concept]);
    }
  });

  it('winery accepts only craft=winery, never shop=wine (a vinoteca is not a winery)', () => {
    const wineryTokens = OSM_ACQUISITION_CONCEPTS.winery.selectors.map(
      (s) => `${s.key}=${s.value}`,
    );
    expect(wineryTokens).toEqual(['craft=winery']);
    expect(wineryTokens).not.toContain('shop=wine');
  });

  describe('resolveOsmConcepts', () => {
    it('splits supported vs unsupported, dedupes+sorts, exposes normalized requested, and flattens selectors', () => {
      const { requested, selectors, supported, unsupported } =
        resolveOsmConcepts([
          'park',
          ' museum ',
          'museum',
          'building',
          'street_art_style',
        ]);

      expect(requested).toEqual([
        'building',
        'museum',
        'park',
        'street_art_style',
      ]);
      expect(supported).toEqual(['museum', 'park']);
      expect(unsupported).toEqual(['building', 'street_art_style']);
      expect(selectors).toEqual([
        ...OSM_ACQUISITION_CONCEPTS.museum.selectors,
        ...OSM_ACQUISITION_CONCEPTS.park.selectors,
      ]);
    });

    it('produces identical output for reversed concept input order', () => {
      expect(resolveOsmConcepts(['park', 'museum'])).toEqual(
        resolveOsmConcepts(['museum', 'park']),
      );
    });

    it('returns no selectors when every concept is unsupported (incl. food/nightlife)', () => {
      const { selectors, supported } = resolveOsmConcepts([
        'building',
        'tourism',
        'route',
        'restaurant',
        'bar',
      ]);
      expect(selectors).toEqual([]);
      expect(supported).toEqual([]);
    });
  });
});
