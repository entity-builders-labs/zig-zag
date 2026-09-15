import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { satisfiesAreaScopeMembership } from './area-scope-membership-policy';

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
      satisfiesAreaScopeMembership(
        area,
        [
          { required: true, role: 'venue', latitude: 2, longitude: 2 },
          { required: true, role: 'venue', latitude: 8, longitude: 8 },
        ],
        'AREA_CONTAINED',
      ),
    ).toBe(true);
  });

  it('rejects strict containment when a required component is outside', () => {
    expect(
      satisfiesAreaScopeMembership(
        area,
        [
          { required: true, role: 'venue', latitude: 2, longitude: 2 },
          { required: true, role: 'venue', latitude: 20, longitude: 20 },
        ],
        'AREA_CONTAINED',
      ),
    ).toBe(false);
  });

  it('accepts an anchored route whose canonical geometry enters the area', () => {
    expect(
      satisfiesAreaScopeMembership(
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
      ),
    ).toBe(true);
  });

  it('rejects an unrelated route and bare AREA', () => {
    expect(
      satisfiesAreaScopeMembership(
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
      ),
    ).toBe(false);
    expect(
      satisfiesAreaScopeMembership(
        area,
        [{ required: true, role: 'area', latitude: 5, longitude: 5 }],
        'AREA_ANCHORED_ROUTE',
      ),
    ).toBe(false);
  });
});
