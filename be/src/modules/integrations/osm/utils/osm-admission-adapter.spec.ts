import {
  osmTagsToAdmissionFacts,
  OSM_ADMISSION_DISCOVERY_SELECTORS,
} from './osm-admission-adapter';

const signalTypes = (tags: Record<string, string>) =>
  osmTagsToAdmissionFacts(tags).signals.map((signal) => signal.type);

const exclusions = (tags: Record<string, string>) =>
  osmTagsToAdmissionFacts(tags).exclusions;

describe('OSM admission adapter (task 37.1)', () => {
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

  it('maps historic=* to decisive HISTORIC_CLASSIFICATION', () => {
    expect(signalTypes({ historic: 'monument' })).toContain(
      'HISTORIC_CLASSIFICATION',
    );
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

  it('maps an ordinary shop to no admission signal (not required)', () => {
    expect(signalTypes({ shop: 'bakery', name: 'La Panadería' })).toEqual([]);
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
