import { geometryContainsPoint } from './geojson-containment.util';
import { GeoJsonGeometry } from './osm-geometry.util';

describe('geometryContainsPoint', () => {
  it('accepts a point inside a polygon and rejects one outside', () => {
    const polygon: GeoJsonGeometry = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
          [0, 0],
        ],
      ],
    };

    expect(geometryContainsPoint(polygon, 2, 2)).toBe(true);
    expect(geometryContainsPoint(polygon, 5, 2)).toBe(false);
  });

  it('rejects a point inside a polygon hole', () => {
    const polygonWithHole: GeoJsonGeometry = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [5, 0],
          [5, 5],
          [0, 5],
          [0, 0],
        ],
        [
          [1, 1],
          [3, 1],
          [3, 3],
          [1, 3],
          [1, 1],
        ],
      ],
    };

    expect(geometryContainsPoint(polygonWithHole, 2, 2)).toBe(false);
    expect(geometryContainsPoint(polygonWithHole, 4, 4)).toBe(true);
  });

  it('does not treat points or lines as containment boundaries', () => {
    expect(
      geometryContainsPoint({ type: 'Point', coordinates: [1, 2] }, 1, 2),
    ).toBe(false);
    expect(
      geometryContainsPoint(
        {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
        0.5,
        0.5,
      ),
    ).toBe(false);
  });
});
