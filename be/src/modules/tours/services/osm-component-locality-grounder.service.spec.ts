import { OsmComponentLocalityGrounder } from './osm-component-locality-grounder.service';

const square = (west: number, south: number, east: number, north: number) => ({
  type: 'Polygon' as const,
  coordinates: [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ],
});
const ASSERTION = {
  locality: 'Lujan de Cuyo',
  evidenceKey: 'ev-1',
  supportSpan: 'Wine and lunch at Ojo de Agua in Lujan de Cuyo',
};
const relation = (
  osmId: number,
  name: string,
  latitude: number,
  longitude: number,
) => ({
  osmType: 'relation',
  osmId,
  class: 'boundary',
  type: 'administrative',
  displayName: `${name}, Mendoza, Argentina`,
  importance: 0.3,
  latitude,
  longitude,
});

function build(results: unknown[], geometries: Record<number, unknown>) {
  const nominatim = { search: jest.fn().mockResolvedValue(results) };
  const osmPlaces = {
    lookupBoundaryById: jest.fn(async (_type: string, osmId: number) => ({
      status: 'success',
      value: geometries[osmId]
        ? { id: `osm:relation:${osmId}`, geometry: geometries[osmId] }
        : null,
    })),
  };
  return {
    grounder: new OsmComponentLocalityGrounder(
      osmPlaces as any,
      nominatim as any,
    ),
    nominatim,
  };
}

describe('OsmComponentLocalityGrounder', () => {
  it('grounds a department and its same-name district (one nested chain) to the OUTERMOST boundary, whichever contains whose label point', async () => {
    // The department's label point sits inside the district (its capital),
    // so containment of points alone is mutual: extent decides.
    const { grounder, nominatim } = build(
      [
        relation(2989586, 'Distrito Ciudad de Luján de Cuyo', -33.04, -68.88),
        relation(2989830, 'Departamento Luján de Cuyo', -33.04, -68.88),
        {
          osmType: 'way',
          osmId: 1,
          class: 'highway',
          type: 'residential',
          displayName: 'Luján de Cuyo, Godoy Cruz, Mendoza, Argentina',
          importance: 0.1,
          latitude: -32.93,
          longitude: -68.85,
        },
      ],
      {
        2989830: square(-69.6, -33.5, -68.75, -32.95),
        2989586: square(-68.92, -33.07, -68.84, -33.0),
      },
    );

    const grounding = await grounder.groundLocality(ASSERTION, 'AR');

    expect(nominatim.search).toHaveBeenCalledWith('Lujan de Cuyo', {
      countryCode: 'AR',
      resultWindow: 'PROVIDER_MAXIMUM',
    });
    expect(grounding).toMatchObject({
      status: 'GROUNDED',
      boundary: {
        externalId: 'osm:relation:2989830',
        name: 'Departamento Luján de Cuyo',
      },
    });
  });

  it('unrelated same-name boundaries in different places are AMBIGUOUS_BOUNDARY', async () => {
    const { grounder } = build(
      [
        relation(1, 'Departamento San Martín', -33.08, -68.47),
        relation(2, 'Partido de General San Martín', -34.57, -58.54),
      ],
      {
        1: square(-68.6, -33.2, -68.3, -32.9),
        2: square(-58.6, -34.6, -58.5, -34.5),
      },
    );

    expect(
      await grounder.groundLocality(
        { ...ASSERTION, locality: 'San Martín' },
        'AR',
      ),
    ).toMatchObject({ status: 'UNGROUNDED', reason: 'AMBIGUOUS_BOUNDARY' });
  });

  it('a name that is only a suffix-free substring, or no boundary at all, is NO_BOUNDARY', async () => {
    const { grounder } = build(
      [relation(3, 'Luján de Cuyo Norte', -33.0, -68.9)],
      { 3: square(-69, -33.1, -68.8, -32.9) },
    );

    expect(await grounder.groundLocality(ASSERTION, 'AR')).toMatchObject({
      status: 'UNGROUNDED',
      reason: 'NO_BOUNDARY',
    });
  });

  it('a provider failure or a missing country is explicit missing evidence', async () => {
    const failing = new OsmComponentLocalityGrounder(
      { lookupBoundaryById: jest.fn() } as any,
      { search: jest.fn().mockRejectedValue(new Error('down')) } as any,
    );
    expect(await failing.groundLocality(ASSERTION, 'AR')).toMatchObject({
      status: 'UNGROUNDED',
      reason: 'PROVIDER_FAILURE',
    });
    expect(await failing.groundLocality(ASSERTION, undefined)).toMatchObject({
      status: 'UNGROUNDED',
      reason: 'NO_COUNTRY',
    });
  });
});
