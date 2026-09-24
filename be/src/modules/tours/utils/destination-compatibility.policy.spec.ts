import { GeographicScope } from '../interfaces/experience-resolution.interface';
import { evaluateDestinationCompatibility } from './destination-compatibility.policy';

// A square "CABA" destination admin boundary (admin_level 8, like the real
// resolved relation 1224652) with a hole, to prove hole handling.
const DESTINATION: GeographicScope = {
  kind: 'AREA_BOUNDARY',
  boundary: {
    id: 'osm:relation:1224652',
    name: 'Buenos Aires',
    osmType: 'relation',
    osmId: 1224652,
    tags: { boundary: 'administrative', admin_level: '8' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-58.53, -34.71],
          [-58.33, -34.71],
          [-58.33, -34.53],
          [-58.53, -34.53],
          [-58.53, -34.71],
        ],
        [
          [-58.45, -34.65],
          [-58.44, -34.65],
          [-58.44, -34.64],
          [-58.45, -34.64],
          [-58.45, -34.65],
        ],
      ],
    },
  },
};

const INSIDE = { latitude: -34.62, longitude: -58.371 }; // San Telmo
const OUTSIDE = { latitude: -34.575, longitude: -58.537 }; // Partido de San Martín
const IN_HOLE = { latitude: -34.645, longitude: -58.445 };

describe('evaluateDestinationCompatibility (single destination-scope owner)', () => {
  it('COMPATIBLE when a probe lies inside the destination admin boundary', () => {
    expect(
      evaluateDestinationCompatibility({ probePoints: [INSIDE] }, DESTINATION),
    ).toEqual({ verdict: 'COMPATIBLE', reason: 'WITHIN_DESTINATION_BOUNDARY' });
  });

  it('INCOMPATIBLE when every probe is outside (San Martín -> Partido de General San Martín)', () => {
    expect(
      evaluateDestinationCompatibility(
        {
          probePoints: [OUTSIDE],
          self: { osmType: 'relation', osmId: 9168783, adminLevel: 8 },
        },
        DESTINATION,
      ),
    ).toEqual({
      verdict: 'INCOMPATIBLE',
      reason: 'OUTSIDE_DESTINATION_BOUNDARY',
    });
  });

  it('respects boundary holes', () => {
    expect(
      evaluateDestinationCompatibility({ probePoints: [IN_HOLE] }, DESTINATION)
        .verdict,
    ).toBe('INCOMPATIBLE');
  });

  it('a multi-probe candidate (a ROUTE crossing the limit) is COMPATIBLE when ANY probe is inside', () => {
    expect(
      evaluateDestinationCompatibility(
        { probePoints: [OUTSIDE, INSIDE] },
        DESTINATION,
      ).verdict,
    ).toBe('COMPATIBLE');
  });

  it('the destination itself is COMPATIBLE with the destination', () => {
    expect(
      evaluateDestinationCompatibility(
        {
          probePoints: [INSIDE],
          self: { osmType: 'relation', osmId: 1224652, adminLevel: 8 },
        },
        DESTINATION,
      ),
    ).toEqual({ verdict: 'COMPATIBLE', reason: 'SAME_AS_DESTINATION' });
  });

  it('an admin unit COARSER than the destination is INCOMPATIBLE even if its label point falls inside', () => {
    expect(
      evaluateDestinationCompatibility(
        {
          probePoints: [INSIDE],
          self: { osmType: 'relation', osmId: 1632167, adminLevel: 4 },
        },
        DESTINATION,
      ),
    ).toEqual({
      verdict: 'INCOMPATIBLE',
      reason: 'CANDIDATE_COARSER_THAN_DESTINATION',
    });
  });

  it('UNKNOWN (never COMPATIBLE) for a point-scale destination -- a radius is not an admin unit', () => {
    expect(
      evaluateDestinationCompatibility(
        { probePoints: [INSIDE] },
        {
          kind: 'POINT_RADIUS',
          latitude: -34.62,
          longitude: -58.37,
          radiusMeters: 5000,
        },
      ),
    ).toEqual({ verdict: 'UNKNOWN', reason: 'DESTINATION_BOUNDARY_UNKNOWN' });
  });

  it('UNKNOWN without a destination at all', () => {
    expect(
      evaluateDestinationCompatibility({ probePoints: [INSIDE] }, undefined)
        .verdict,
    ).toBe('UNKNOWN');
  });

  it('UNKNOWN when the candidate has no usable location', () => {
    expect(
      evaluateDestinationCompatibility(
        { probePoints: [{ latitude: NaN, longitude: -58.37 }] },
        DESTINATION,
      ),
    ).toEqual({ verdict: 'UNKNOWN', reason: 'CANDIDATE_LOCATION_UNKNOWN' });
  });

  it('never uses distance: a probe just inside a far corner is COMPATIBLE, a probe just outside a near edge is not', () => {
    expect(
      evaluateDestinationCompatibility(
        { probePoints: [{ latitude: -34.705, longitude: -58.525 }] },
        DESTINATION,
      ).verdict,
    ).toBe('COMPATIBLE');
    expect(
      evaluateDestinationCompatibility(
        { probePoints: [{ latitude: -34.62, longitude: -58.329 }] },
        DESTINATION,
      ).verdict,
    ).toBe('INCOMPATIBLE');
  });
});
