import {
  OsmAdminUnit,
  OsmPlacesService,
} from '@integrations/osm/services/osm-places.service';
import {
  DestinationAdminCompatibilityService,
  DestinationAdminContext,
} from './destination-admin-compatibility.service';

const rel = (
  osmId: number,
  adminLevel: number,
  name: string,
  countryCode?: string,
): OsmAdminUnit => ({
  osmType: 'relation',
  osmId,
  name,
  adminLevel,
  ...(countryCode ? { countryCode } : {}),
});

const ARGENTINA = rel(286393, 2, 'Argentina', 'AR');
const CABA = rel(3082668, 4, 'Ciudad Autónoma de Buenos Aires');
const PROVINCIA_BA = rel(1632167, 4, 'Buenos Aires');
const SAN_TELMO = rel(2223069, 9, 'San Telmo');
const PARTIDO_SAN_MARTIN = rel(1224700, 5, 'Partido de General San Martín');
const URUGUAY = rel(287072, 2, 'Uruguay', 'UY');

const CABA_DESTINATION: DestinationAdminContext = {
  name: 'Ciudad Autónoma de Buenos Aires',
  countryCode: 'AR',
  boundary: { osmType: 'relation', osmId: 3082668, adminLevel: 4 },
};

describe('DestinationAdminCompatibilityService', () => {
  // The OSM adapter returns the hierarchy already sorted coarse to fine.
  const build = (hierarchy: OsmAdminUnit[] | 'failed') => {
    const osmPlaces = {
      lookupContainingAdminUnits: jest.fn(async () =>
        hierarchy === 'failed'
          ? {
              status: 'failed' as const,
              value: [] as OsmAdminUnit[],
              failureReason: 'down',
            }
          : { status: 'success' as const, value: hierarchy },
      ),
    };
    return {
      osmPlaces,
      service: new DestinationAdminCompatibilityService(
        osmPlaces as unknown as OsmPlacesService,
      ),
    };
  };

  const point = { latitude: -34.62, longitude: -58.37 };

  it('is COMPATIBLE when the destination admin unit contains the candidate (CABA neighborhood)', async () => {
    const { service, osmPlaces } = build([ARGENTINA, CABA, SAN_TELMO]);

    const result = await service.evaluate(point, CABA_DESTINATION);

    expect(osmPlaces.lookupContainingAdminUnits).toHaveBeenCalledWith(point);
    expect(result.verdict).toBe('COMPATIBLE');
    expect(result.reason).toBe('WITHIN_DESTINATION_ADMIN_UNIT');
    expect(result.candidateHierarchy.map((u) => u.name)).toEqual([
      'Argentina',
      'Ciudad Autónoma de Buenos Aires',
      'San Telmo',
    ]);
    expect(result.candidateCountryCode).toBe('AR');
  });

  it('is INCOMPATIBLE for a same-country candidate under a different admin branch (Partido de General San Martín, Provincia de Buenos Aires)', async () => {
    const { service } = build([ARGENTINA, PROVINCIA_BA, PARTIDO_SAN_MARTIN]);

    const result = await service.evaluate(point, CABA_DESTINATION);

    expect(result.verdict).toBe('INCOMPATIBLE');
    expect(result.reason).toBe('OUTSIDE_DESTINATION_ADMIN_UNIT');
  });

  it('reports OUTSIDE_DESTINATION_ADMIN_UNIT for an out-of-destination admin unit even when it is not finer than the destination (Partido de General San Martín vs a level-8 destination)', async () => {
    const { service } = build([ARGENTINA, PROVINCIA_BA, PARTIDO_SAN_MARTIN]);

    const result = await service.evaluate(
      point,
      {
        name: 'Buenos Aires',
        countryCode: 'AR',
        boundary: { osmType: 'relation', osmId: 1224652, adminLevel: 8 },
      },
      { osmType: 'relation', osmId: 1224700 },
    );

    expect(result.verdict).toBe('INCOMPATIBLE');
    expect(result.reason).toBe('OUTSIDE_DESTINATION_ADMIN_UNIT');
  });

  it('is INCOMPATIBLE on a country mismatch, independent of the rest of the hierarchy', async () => {
    const { service } = build([URUGUAY]);

    const result = await service.evaluate(point, CABA_DESTINATION);

    expect(result.verdict).toBe('INCOMPATIBLE');
    expect(result.reason).toBe('COUNTRY_MISMATCH');
    expect(result.candidateCountryCode).toBe('UY');
  });

  it('is INCOMPATIBLE when the candidate IS the destination admin unit itself (not a component within it)', async () => {
    const { service } = build([ARGENTINA, CABA]);

    const result = await service.evaluate(point, CABA_DESTINATION, {
      osmType: 'relation',
      osmId: 3082668,
    });

    expect(result.verdict).toBe('INCOMPATIBLE');
    expect(result.reason).toBe('CANDIDATE_NOT_WITHIN_DESTINATION');
  });

  it('is INCOMPATIBLE when the candidate is an admin unit at or above the destination level, even if its probe point falls inside', async () => {
    // e.g. a province whose label point happens to sit inside the city.
    const { service } = build([ARGENTINA, PROVINCIA_BA, CABA]);

    const result = await service.evaluate(point, CABA_DESTINATION, {
      osmType: 'relation',
      osmId: 1632167,
    });

    expect(result.verdict).toBe('INCOMPATIBLE');
    expect(result.reason).toBe('CANDIDATE_NOT_WITHIN_DESTINATION');
  });

  it('is UNKNOWN (never COMPATIBLE) when the destination has no resolved admin boundary', async () => {
    const { service, osmPlaces } = build([ARGENTINA, CABA, SAN_TELMO]);

    const result = await service.evaluate(point, {
      name: 'Buenos Aires',
      countryCode: 'AR',
    });

    expect(result.verdict).toBe('UNKNOWN');
    expect(result.reason).toBe('DESTINATION_BOUNDARY_UNKNOWN');
    expect(osmPlaces.lookupContainingAdminUnits).not.toHaveBeenCalled();
  });

  it('is UNKNOWN when the admin lookup fails (fail closed, not COMPATIBLE)', async () => {
    const { service } = build('failed');

    const result = await service.evaluate(point, CABA_DESTINATION);

    expect(result.verdict).toBe('UNKNOWN');
    expect(result.reason).toBe('ADMIN_LOOKUP_FAILED');
  });

  it('is UNKNOWN when the provider returns no containing admin units at all', async () => {
    const { service } = build([]);

    const result = await service.evaluate(point, CABA_DESTINATION);

    expect(result.verdict).toBe('UNKNOWN');
    expect(result.reason).toBe('ADMIN_HIERARCHY_EMPTY');
  });

  it('never uses distance: a candidate far from the destination point but inside its admin unit is COMPATIBLE', async () => {
    const { service } = build([ARGENTINA, CABA]);

    const result = await service.evaluate(
      { latitude: -34.7, longitude: -58.5 },
      CABA_DESTINATION,
    );

    expect(result.verdict).toBe('COMPATIBLE');
  });
});
