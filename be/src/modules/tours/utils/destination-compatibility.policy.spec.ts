import { GeoEntityKind } from '@prisma/client';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { GeographicScope } from '../interfaces/experience-resolution.interface';
import {
  evaluateDestinationCompatibility,
  evaluateExperienceDestinationRelation,
  evaluateScopeDestinationRelation,
  isCoarserThanDestination,
} from './destination-compatibility.policy';

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

  it('never uses distance by default: a probe just inside a far corner is COMPATIBLE, a probe just outside a near edge is not', () => {
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

describe('destination relation facts (spec 2026-10-02 Part II §P2-9)', () => {
  // ~105 km south of the destination: a regional component no circle decides.
  const REGIONAL = { latitude: -35.57, longitude: -58.43 };

  it('compatibility is polygon-only: a probe 105 km away is INCOMPATIBLE for the same reason as one 1 km outside -- no route-scale radius exists', () => {
    for (const probe of [OUTSIDE, REGIONAL]) {
      expect(
        evaluateDestinationCompatibility({ probePoints: [probe] }, DESTINATION),
      ).toEqual({
        verdict: 'INCOMPATIBLE',
        reason: 'OUTSIDE_DESTINATION_BOUNDARY',
      });
    }
  });

  it('Experience relation: WITHIN / EXTENDS_BEYOND / OUTSIDE from component geometry', () => {
    const point = (
      key: string,
      p: { latitude: number; longitude: number },
    ) => ({
      hintKey: key,
      role: 'venue',
      latitude: p.latitude,
      longitude: p.longitude,
    });
    expect(
      evaluateExperienceDestinationRelation([point('a', INSIDE)], DESTINATION)
        .relation,
    ).toBe('WITHIN_DESTINATION');
    expect(
      evaluateExperienceDestinationRelation(
        [point('a', INSIDE), point('b', REGIONAL)],
        DESTINATION,
      ),
    ).toEqual({
      relation: 'EXTENDS_BEYOND_DESTINATION',
      outsideComponentKeys: ['b'],
      undeterminedComponentKeys: [],
    });
    expect(
      evaluateExperienceDestinationRelation(
        [point('a', REGIONAL), point('b', OUTSIDE)],
        DESTINATION,
      ).relation,
    ).toBe('OUTSIDE_DESTINATION');
  });

  it('Experience relation stays UNKNOWN when it cannot be decided (no destination, undetermined component, no components)', () => {
    expect(
      evaluateExperienceDestinationRelation(
        [{ hintKey: 'a', role: 'venue', ...INSIDE }],
        undefined,
      ).relation,
    ).toBe('UNKNOWN');
    expect(
      evaluateExperienceDestinationRelation(
        [
          { hintKey: 'a', role: 'venue', ...INSIDE },
          { hintKey: 'r', role: 'route', kind: GeoEntityKind.ROUTE },
        ],
        DESTINATION,
      ).relation,
    ).toBe('UNKNOWN');
    expect(
      evaluateExperienceDestinationRelation([], DESTINATION).relation,
    ).toBe('UNKNOWN');
  });

  it('point destination: relation through its own radius scope', () => {
    const point: GeographicScope = {
      kind: 'POINT_RADIUS',
      latitude: INSIDE.latitude,
      longitude: INSIDE.longitude,
      radiusMeters: 10_000,
    };
    expect(
      evaluateExperienceDestinationRelation(
        [
          { hintKey: 'a', role: 'venue', ...INSIDE },
          { hintKey: 'b', role: 'venue', ...REGIONAL },
        ],
        point,
      ).relation,
    ).toBe('EXTENDS_BEYOND_DESTINATION');
  });

  it('scope relation: an AREA polygon disjoint from the destination is OUTSIDE, an overlapping one INTERSECTS, a nested one INSIDE', () => {
    const square = (lon: number, lat: number, d: number): GeoJsonGeometry => ({
      type: 'Polygon',
      coordinates: [
        [
          [lon - d, lat - d],
          [lon + d, lat - d],
          [lon + d, lat + d],
          [lon - d, lat + d],
          [lon - d, lat - d],
        ],
      ],
    });
    expect(
      evaluateScopeDestinationRelation(
        square(-58.43, -35.57, 0.1),
        'area',
        DESTINATION,
      ),
    ).toBe('OUTSIDE');
    expect(
      evaluateScopeDestinationRelation(
        square(-58.33, -34.62, 0.05),
        'area',
        DESTINATION,
      ),
    ).toBe('INTERSECTS');
    expect(
      evaluateScopeDestinationRelation(
        square(-58.37, -34.6, 0.01),
        'area',
        DESTINATION,
      ),
    ).toBe('INSIDE');
    expect(
      evaluateScopeDestinationRelation(
        square(-58.37, -34.6, 0.01),
        'area',
        undefined,
      ),
    ).toBe('UNKNOWN');
  });

  it('coarse guard fires only on positive admin evidence', () => {
    expect(isCoarserThanDestination(4, DESTINATION)).toBe(true);
    expect(isCoarserThanDestination(8, DESTINATION)).toBe(false);
    expect(isCoarserThanDestination(undefined, DESTINATION)).toBe(false);
  });
});
