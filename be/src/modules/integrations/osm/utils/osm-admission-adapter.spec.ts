import {
  osmTagsToAdmissionFacts,
  OSM_ADMISSION_DISCOVERY_SELECTORS,
  osmTagsToProminenceEvidence,
  osmTagsToVisitUnitFacts,
  osmCoverageDiscoverySelectors,
  osmTagsToTargetObservations,
} from './osm-admission-adapter';
import { evaluateAdmissionRule } from '@tours/admission/structured-admission-policy';

const signalTypes = (tags: Record<string, string>) =>
  osmTagsToAdmissionFacts(tags).signals.map((signal) => signal.type);

const exclusions = (tags: Record<string, string>) =>
  osmTagsToAdmissionFacts(tags).exclusions;

describe('OSM tags → canonical admission signals, exclusions and place classes', () => {
  it('maps tourism=artwork to supporting VISITABLE_PLACE_CLASS, never decisive visitor classification', () => {
    const facts = osmTagsToAdmissionFacts({
      tourism: 'artwork',
      artwork_type: 'sculpture',
    });
    expect(facts.signals).toContainEqual({
      type: 'VISITABLE_PLACE_CLASS',
      strength: 'supporting',
    });
    expect(facts.signals).not.toContainEqual(
      expect.objectContaining({ type: 'EXPLICIT_VISITOR_CLASSIFICATION' }),
    );
  });

  it('maps tourism=museum to decisive EXPLICIT_VISITOR_CLASSIFICATION', () => {
    expect(signalTypes({ tourism: 'museum' })).toContain(
      'EXPLICIT_VISITOR_CLASSIFICATION',
    );
    expect(
      osmTagsToAdmissionFacts({ tourism: 'museum' }).signals.find(
        (signal) => signal.type === 'EXPLICIT_VISITOR_CLASSIFICATION',
      )?.strength,
    ).toBe('decisive');
  });

  it('maps tourism=attraction to decisive EXPLICIT_VISITOR_CLASSIFICATION', () => {
    expect(signalTypes({ tourism: 'attraction' })).toContain(
      'EXPLICIT_VISITOR_CLASSIFICATION',
    );
  });

  it('maps historic provider data to supporting HISTORIC_CLASSIFICATION', () => {
    expect(
      osmTagsToAdmissionFacts({ historic: 'monument' }).signals,
    ).toContainEqual({
      type: 'HISTORIC_CLASSIFICATION',
      strength: 'supporting',
    });
  });

  it('maps heritage=* to decisive HERITAGE_DESIGNATION, including a heritage-tagged pharmacy', () => {
    expect(signalTypes({ amenity: 'pharmacy', heritage: '2' })).toContain(
      'HERITAGE_DESIGNATION',
    );
  });

  it('maps tourism=hotel (accommodation) to the ACCOMMODATION exclusion', () => {
    expect(exclusions({ tourism: 'hotel' })).toContain('ACCOMMODATION');
    expect(signalTypes({ tourism: 'hotel' })).not.toContain(
      'EXPLICIT_VISITOR_CLASSIFICATION',
    );
  });

  it('maps tourism=information to the INFORMATION_OR_SIGNAGE exclusion', () => {
    expect(exclusions({ tourism: 'information' })).toContain(
      'INFORMATION_OR_SIGNAGE',
    );
  });

  it('maps an ordinary non-food shop to no admission signal', () => {
    expect(signalTypes({ shop: 'clothes', name: 'La Tienda' })).toEqual([]);
  });

  it('never admits a bakery from its venue class alone', () => {
    expect(
      evaluateAdmissionRule(
        osmTagsToAdmissionFacts({ shop: 'bakery', name: 'La Panadería' })
          .signals,
        [],
      ),
    ).toEqual({
      admitted: false,
      reason: 'INSUFFICIENT_ADMISSION_EVIDENCE',
    });
  });

  it('maps a highway to the ROAD_OR_ROUTE exclusion, except highway=corridor', () => {
    expect(exclusions({ highway: 'residential' })).toContain('ROAD_OR_ROUTE');
    expect(exclusions({ highway: 'corridor' })).not.toContain('ROAD_OR_ROUTE');
    expect(signalTypes({ highway: 'corridor' })).toContain(
      'VISITABLE_PLACE_CLASS',
    );
  });

  it('records a wikidata tag as a ranking-readable encyclopedic link, not an admission signal', () => {
    const facts = osmTagsToAdmissionFacts({ wikidata: 'Q831322' });
    expect(facts.placeClasses).toContain('encyclopedic_link');
    expect(facts.signals).toEqual([]);
  });

  it('exposes discovery selectors for heritage, historic, tourism and visitable classes', () => {
    const keys = OSM_ADMISSION_DISCOVERY_SELECTORS.map((s) => s.key);
    expect(keys).toEqual([
      'tourism',
      'amenity',
      'historic',
      'heritage',
      'leisure',
      'natural',
      'highway',
    ]);
  });
});

describe('osmTagsToProminenceEvidence: OSM heritage and visitor-destination tags → typed prominence facts', () => {
  const observedAt = new Date('2026-10-23T00:00:00Z');

  it('a wikidata tag or a historic class alone yields no prominence fact', () => {
    expect(
      osmTagsToProminenceEvidence(
        { historic: 'memorial', wikidata: 'Q1' },
        'osm:node:1',
        observedAt,
      ),
    ).toEqual([]);
  });

  it('records heritage with its issuer only when the record names one, and an explicit visitor class', () => {
    expect(
      osmTagsToProminenceEvidence(
        { tourism: 'museum', heritage: '2', 'heritage:operator': 'cnmlbh' },
        'osm:way:7',
        observedAt,
      ),
    ).toEqual([
      {
        kind: 'EXPLICIT_VISITOR_CLASSIFICATION',
        sourceProvider: 'openstreetmap',
        providerIdentity: 'osm:way:7',
        sourceRecordId: 'osm:way:7',
        fieldPath: 'tags.tourism',
        textValue: 'tourism=museum',
        observedAt,
      },
      {
        kind: 'HERITAGE_DESIGNATION',
        sourceProvider: 'openstreetmap',
        providerIdentity: 'osm:way:7',
        sourceRecordId: 'osm:way:7',
        fieldPath: 'tags.heritage',
        designationLevel: '2',
        heritageScope: 'NATIONAL',
        authority: 'cnmlbh',
        observedAt,
      },
    ]);
    expect(
      osmTagsToProminenceEvidence(
        { heritage: 'yes' },
        'osm:node:8',
        observedAt,
      )[0],
    ).not.toHaveProperty('authority');
  });
});

describe('osmTagsToVisitUnitFacts: tomb child class', () => {
  it('classifies historic=tomb as a grave child, so a tomb inside a cemetery can be recognized as part of it', () => {
    expect(osmTagsToVisitUnitFacts({ historic: 'tomb' }).childClass).toBe(
      'grave',
    );
  });
});

describe('food-and-drink discovery coverage and food venue admission evidence', () => {
  it('requests food venue classes only together with an encyclopedic identity link', () => {
    expect(osmCoverageDiscoverySelectors(['FOOD_AND_DRINK'])).toEqual([
      { key: 'amenity', value: 'cafe', requireKeys: ['wikidata'] },
      { key: 'amenity', value: 'restaurant', requireKeys: ['wikidata'] },
      { key: 'amenity', value: 'food_court', requireKeys: ['wikidata'] },
      { key: 'amenity', value: 'marketplace', requireKeys: ['wikidata'] },
      { key: 'shop', value: 'bakery', requireKeys: ['wikidata'] },
    ]);
    expect(osmCoverageDiscoverySelectors([])).toEqual([]);
  });

  it('treats a food venue class as supporting evidence that never admits on its own', () => {
    for (const tags of [
      { amenity: 'cafe' },
      { amenity: 'restaurant', cuisine: 'grill' },
      { amenity: 'food_court' },
      { shop: 'bakery' },
    ]) {
      expect(signalTypes(tags)).toEqual(['VISITABLE_PLACE_CLASS']);
    }
  });

  it('keeps destination-wide base discovery free of ordinary food venue classes', () => {
    const amenity = OSM_ADMISSION_DISCOVERY_SELECTORS.find(
      (selector) => selector.key === 'amenity',
    );
    expect(amenity?.includeValues).toEqual(['marketplace', 'place_of_worship']);
    expect(
      OSM_ADMISSION_DISCOVERY_SELECTORS.some(
        (selector) => selector.key === 'shop',
      ),
    ).toBe(false);
  });
});

describe('osmTagsToProminenceEvidence: heritage scope from the protecting authority level', () => {
  const observedAt = new Date('2026-10-24T00:00:00Z');
  const scopeOf = (value: string) =>
    osmTagsToProminenceEvidence(
      { heritage: value },
      'osm:node:9',
      observedAt,
    )[0].heritageScope;

  it('maps level 1 to international, 2 to national and 3-11 to subnational', () => {
    expect(scopeOf('1')).toBe('INTERNATIONAL');
    expect(scopeOf('2')).toBe('NATIONAL');
    expect(scopeOf('4')).toBe('SUBNATIONAL');
    expect(scopeOf('11')).toBe('SUBNATIONAL');
  });

  it('claims no scope for values that are not an administrative level', () => {
    expect(scopeOf('yes')).toBe('UNSPECIFIED');
    expect(scopeOf('12')).toBe('UNSPECIFIED');
    expect(scopeOf('2;4')).toBe('UNSPECIFIED');
  });
});

describe('osmTagsToTargetObservations: structured classes → typed concept observations', () => {
  const targets = (tags: Record<string, string>) =>
    osmTagsToTargetObservations(tags, 'osm:node:5').map(
      (fact) => `${fact.target.dimension}:${fact.target.key}`,
    );

  it('maps historic and heritage classes to the history theme', () => {
    expect(targets({ historic: 'memorial' })).toEqual(['theme:history']);
    expect(targets({ heritage: '2' })).toEqual(['theme:history']);
  });

  it('maps historic building types and places of worship to architecture', () => {
    expect(targets({ historic: 'building' })).toEqual([
      'theme:history',
      'theme:architecture',
    ]);
    expect(targets({ amenity: 'place_of_worship' })).toEqual([
      'theme:architecture',
    ]);
  });

  it('maps food venue classes to gastronomy, food and the food intent', () => {
    for (const tags of [
      { amenity: 'cafe' },
      { shop: 'bakery' },
      { amenity: 'marketplace' },
    ]) {
      expect(targets(tags)).toEqual([
        'theme:gastronomy',
        'theme:food',
        'intent:food',
      ]);
    }
  });

  it('maps galleries and artworks to the art theme', () => {
    expect(targets({ tourism: 'gallery' })).toEqual(['theme:art']);
    expect(targets({ tourism: 'artwork' })).toEqual(['theme:art']);
  });

  it('records only positive observations with a stable source-fact identity per class and concept', () => {
    expect(
      osmTagsToTargetObservations({ amenity: 'cafe' }, 'osm:node:5')[0],
    ).toEqual({
      target: { dimension: 'theme', key: 'gastronomy' },
      observation: {
        sourceFactId: 'osm:node:5#amenity=cafe>theme:gastronomy',
        state: 'SATISFIES',
      },
    });
    expect(targets({ tourism: 'attraction', name: 'Historic cafe' })).toEqual(
      [],
    );
    expect(targets({ wikidata: 'Q1' })).toEqual([]);
  });
});

describe('osmTagsToTargetObservations: museum subtypes', () => {
  const targets = (tags: Record<string, string>) =>
    osmTagsToTargetObservations(tags, 'osm:way:3').map(
      (fact) => `${fact.target.dimension}:${fact.target.key}`,
    );

  it('maps art museums to the art theme and history museums to the history theme', () => {
    expect(targets({ tourism: 'museum', museum: 'art' })).toEqual([
      'theme:art',
    ]);
    for (const subtype of ['history', 'local_history', 'military']) {
      expect(targets({ tourism: 'museum', museum: subtype })).toEqual([
        'theme:history',
      ]);
    }
  });

  it('derives no concept from a museum without a subtype or with another subtype', () => {
    expect(targets({ tourism: 'museum' })).toEqual([]);
    expect(targets({ tourism: 'museum', museum: 'science' })).toEqual([]);
  });
});
