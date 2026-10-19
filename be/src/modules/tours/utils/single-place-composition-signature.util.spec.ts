import { singlePlaceCompositionSignature } from './single-place-composition-signature.util';

describe('singlePlaceCompositionSignature', () => {
  it('is stable for the same constitutive GeoEntity', () => {
    expect(singlePlaceCompositionSignature('geo-1')).toBe(
      singlePlaceCompositionSignature('geo-1'),
    );
  });

  it('changes when the constitutive GeoEntity changes', () => {
    expect(singlePlaceCompositionSignature('geo-1')).not.toBe(
      singlePlaceCompositionSignature('geo-2'),
    );
  });

  it('rejects an empty identity instead of creating an anonymous composition', () => {
    expect(() => singlePlaceCompositionSignature(' ')).toThrow(
      'A GeoEntity id is required for a place composition',
    );
  });
});
