import {
  osmTagsToAdmissionFacts,
  OSM_ADMISSION_DISCOVERY_SELECTORS,
  osmTagsToProminenceEvidence,
  osmTagsToVisitUnitFacts,
  osmCoverageDiscoverySelectors,
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
