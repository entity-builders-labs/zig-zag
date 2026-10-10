import {
  acquisitionLabelToPlacesProvider,
  canonicalPlacesExternalId,
  placesAcquisitionLabel,
} from './places-external-identity.util';

describe('placesAcquisitionLabel', () => {
  it('maps google -> google_places', () => {
    expect(placesAcquisitionLabel('google')).toBe('google_places');
  });

  it('maps geoapify -> geoapify', () => {
    expect(placesAcquisitionLabel('geoapify')).toBe('geoapify');
  });
});

describe('acquisitionLabelToPlacesProvider', () => {
  it('maps google_places -> google', () => {
    expect(acquisitionLabelToPlacesProvider('google_places')).toBe('google');
  });

  it('maps geoapify -> geoapify', () => {
    expect(acquisitionLabelToPlacesProvider('geoapify')).toBe('geoapify');
  });

  it('returns undefined for a non-Places acquisition provider (wikivoyage/wikidata/web never carry a Places-fetchable externalId)', () => {
    expect(acquisitionLabelToPlacesProvider('wikivoyage')).toBeUndefined();
    expect(acquisitionLabelToPlacesProvider('wikidata')).toBeUndefined();
    expect(acquisitionLabelToPlacesProvider('web')).toBeUndefined();
  });

  it('round-trips with placesAcquisitionLabel for both real Places providers', () => {
    (['google', 'geoapify'] as const).forEach((provider) => {
      expect(
        acquisitionLabelToPlacesProvider(placesAcquisitionLabel(provider)),
      ).toBe(provider);
    });
  });
});

describe('canonicalPlacesExternalId', () => {
  it('produces the exact same string resolveViaPlaces already persists for a google record (regression guard: real bug found in review -- reuse must never fragment one real place into two GeoEntityIdentity rows by using a different externalId format for the same record)', () => {
    expect(canonicalPlacesExternalId('google', 'ChIJABC123')).toBe(
      'google_places:ChIJABC123',
    );
  });

  it('produces the exact same string resolveViaPlaces already persists for a geoapify record', () => {
    expect(canonicalPlacesExternalId('geoapify', 'xyz789')).toBe(
      'geoapify:xyz789',
    );
  });
});
