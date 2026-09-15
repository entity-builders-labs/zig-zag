import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { evaluateAreaScopeMembership } from './area-scope-membership-policy';

const area: GeoJsonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
  ],
};

describe('area scope membership policy', () => {
  it('accepts strict contained components', () => {
    expect(
      evaluateAreaScopeMembership(
        area,
        [
          { required: true, role: 'venue', latitude: 2, longitude: 2 },
          { required: true, role: 'venue', latitude: 8, longitude: 8 },
        ],
        'AREA_CONTAINED',
      ).passes,
    ).toBe(true);
  });

  it('rejects strict containment when a required component is outside', () => {
    expect(
      evaluateAreaScopeMembership(
        area,
        [
          { required: true, role: 'venue', latitude: 2, longitude: 2 },
          { required: true, role: 'venue', latitude: 20, longitude: 20 },
        ],
        'AREA_CONTAINED',
      ).passes,
    ).toBe(false);
  });

  it('accepts an anchored route whose canonical geometry enters the area', () => {
    expect(
      evaluateAreaScopeMembership(
        area,
        [
          { required: true, role: 'waypoint', latitude: 20, longitude: 20 },
          {
            required: true,
            role: 'route',
            geometry: {
              type: 'LineString',
              coordinates: [
                [-2, 5],
                [5, 5],
              ],
            },
          },
        ],
        'AREA_ANCHORED_ROUTE',
      ).passes,
    ).toBe(true);
  });

  it('rejects an unrelated route and bare AREA', () => {
    expect(
      evaluateAreaScopeMembership(
        area,
        [
          {
            required: true,
            role: 'route',
            geometry: {
              type: 'LineString',
              coordinates: [
                [20, 20],
                [30, 30],
              ],
            },
          },
        ],
        'AREA_ANCHORED_ROUTE',
      ).passes,
    ).toBe(false);
    expect(
      evaluateAreaScopeMembership(
        area,
        [{ required: true, role: 'area', latitude: 5, longitude: 5 }],
        'AREA_ANCHORED_ROUTE',
      ).passes,
    ).toBe(false);
  });
});
