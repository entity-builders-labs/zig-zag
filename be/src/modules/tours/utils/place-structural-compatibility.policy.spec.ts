import {
  structuralKindFromNominatim,
  structuralKindFromOsmTags,
  structuralKindFromPlaceFeatureClass,
} from './candidate-structural-kind.util';
import { evaluateStructuralCompatibility } from './place-structural-compatibility.policy';

describe('evaluateStructuralCompatibility', () => {
  it.each([
    ['ROAD', 'INCOMPATIBLE'],
    ['ADMINISTRATIVE_AREA', 'INCOMPATIBLE'],
    ['POSTAL_UNIT', 'INCOMPATIBLE'],
    ['TRANSPORT_STOP', 'INCOMPATIBLE'],
    ['POINT_OF_INTEREST', 'COMPATIBLE'],
    ['SETTLEMENT', 'COMPATIBLE'],
    ['NATURAL_FEATURE', 'COMPATIBLE'],
    ['UNKNOWN', 'COMPATIBLE'],
  ] as const)('a %s record for a PLACE hint is %s', (kind, expected) => {
    expect(evaluateStructuralCompatibility('PLACE', kind)).toBe(expected);
  });

  it('defines no exclusion for other kinds or an unstated kind', () => {
    expect(evaluateStructuralCompatibility('AREA', 'TRANSPORT_STOP')).toBe(
      'COMPATIBLE',
    );
    expect(evaluateStructuralCompatibility('ROUTE', 'ROAD')).toBe('COMPATIBLE');
    expect(evaluateStructuralCompatibility(undefined, 'ROAD')).toBe(
      'COMPATIBLE',
    );
  });
});

describe('transport infrastructure normalizes to one kind for every provider', () => {
  it('OSM public_transport (any role) is a TRANSPORT_STOP, even beside a highway tag', () => {
    expect(
      structuralKindFromOsmTags({ public_transport: 'stop_position' }),
    ).toBe('TRANSPORT_STOP');
    expect(
      structuralKindFromOsmTags({
        public_transport: 'platform',
        highway: 'bus_stop',
      }),
    ).toBe('TRANSPORT_STOP');
  });

  it('a venue key still outranks it', () => {
    expect(
      structuralKindFromOsmTags({
        amenity: 'cafe',
        public_transport: 'station',
      }),
    ).toBe('POINT_OF_INTEREST');
  });

  it('Nominatim and Places map their own transport classes to it', () => {
    expect(
      structuralKindFromNominatim({
        class: 'public_transport',
        type: 'station',
      }),
    ).toBe('TRANSPORT_STOP');
    expect(structuralKindFromPlaceFeatureClass('transport_stop')).toBe(
      'TRANSPORT_STOP',
    );
    expect(structuralKindFromPlaceFeatureClass('postcode')).toBe('POSTAL_UNIT');
  });
});
