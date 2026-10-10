import { deriveExperiencePresentation } from './experience-presentation.util';

describe('deriveExperiencePresentation', () => {
  it('returns POINT with no geometry for a single component with no geometry', () => {
    const result = deriveExperiencePresentation([
      { role: 'venue', order: null, geometry: null },
    ]);
    expect(result).toEqual({
      geometryMode: 'POINT',
      hasIntrinsicSequence: false,
    });
  });

  it('returns POINT for a single component with a Point geometry', () => {
    const result = deriveExperiencePresentation([
      {
        role: 'venue',
        order: null,
        geometry: { type: 'Point', coordinates: [-58.37, -34.6] },
      },
    ]);
    expect(result.geometryMode).toBe('POINT');
  });

  it('returns AREA with the polygon for a single AREA-kind component', () => {
    const polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    };
    const result = deriveExperiencePresentation([
      { role: 'area', order: null, geometry: polygon },
    ]);
    expect(result).toEqual({
      geometryMode: 'AREA',
      geometry: polygon,
      hasIntrinsicSequence: false,
    });
  });

  it("returns ROUTE using the anchor component's LineString geometry, for a multi-component composite with a route anchor", () => {
    const line = {
      type: 'LineString',
      coordinates: [
        [-58.37, -34.6],
        [-58.36, -34.61],
      ],
    };
    const result = deriveExperiencePresentation([
      {
        role: 'venue',
        order: 1,
        geometry: { type: 'Point', coordinates: [-58.37, -34.6] },
      },
      { role: 'route', order: null, geometry: line },
      {
        role: 'venue',
        order: 2,
        geometry: { type: 'Point', coordinates: [-58.36, -34.61] },
      },
    ]);
    expect(result).toEqual({
      geometryMode: 'ROUTE',
      geometry: line,
      hasIntrinsicSequence: true,
    });
  });

  it('returns MULTI_POINT with no single geometry when several components have no anchor (real example: "Plazas históricas de Mendoza")', () => {
    const result = deriveExperiencePresentation([
      {
        role: 'venue',
        order: null,
        geometry: { type: 'Point', coordinates: [0, 0] },
      },
      {
        role: 'venue',
        order: null,
        geometry: { type: 'Point', coordinates: [1, 1] },
      },
    ]);
    expect(result).toEqual({
      geometryMode: 'MULTI_POINT',
      hasIntrinsicSequence: false,
    });
  });

  it('sets hasIntrinsicSequence true when any component has a non-null order, even without an anchor', () => {
    const result = deriveExperiencePresentation([
      { role: 'venue', order: 1, geometry: null },
      { role: 'venue', order: 2, geometry: null },
    ]);
    expect(result.hasIntrinsicSequence).toBe(true);
  });

  it('defaults to POINT with no geometry for zero components (defensive default)', () => {
    const result = deriveExperiencePresentation([]);
    expect(result).toEqual({
      geometryMode: 'POINT',
      hasIntrinsicSequence: false,
    });
  });
});
