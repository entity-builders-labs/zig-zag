import { OsmPlacesService } from '../../../src/modules/integrations/osm/services/osm-places.service';
import { StructuredPoiAcquisitionProvider } from '../../../src/modules/tours/providers/structured-poi-acquisition.provider';
import { StructuredPoiCatalogAcquisitionService } from '../../../src/modules/tours/services/structured-poi-catalog-acquisition.service';
import { StructuredKnowledgePersistenceService } from '../../../src/modules/tours/services/structured-knowledge-persistence.service';
import { ExperienceCatalogService } from '../../../src/modules/tours/services/experience-catalog.service';
import { closeDb, getPrisma, resetDb } from '../support/test-db';

const destination = {
  destinationName: 'Fixture City',
  latitude: -34.6,
  longitude: -58.38,
  radiusMeters: 5_000,
};

/** A square area of `half` degrees around (lon, lat). */
function square(lon: number, lat: number, half: number) {
  return {
    type: 'Polygon' as const,
    coordinates: [
      [
        [lon - half, lat - half],
        [lon + half, lat - half],
        [lon + half, lat + half],
        [lon - half, lat + half],
        [lon - half, lat - half],
      ],
    ],
  };
}

type Feature = {
  osmType: 'node' | 'way';
  osmId: number;
  lon: number;
  lat: number;
  tags: Record<string, string>;
};

describe('tour-generation integration · child places inside a parent-site area', () => {
  beforeEach(async () => resetDb());

  afterAll(async () => closeDb());

  async function run(
    features: Feature[],
    areas: Record<string, ReturnType<typeof square>>,
    areaStatus: 'success' | 'failed' = 'success',
  ) {
    const prisma = await getPrisma();
    const osm = {
      lookupFeaturesNear: jest.fn().mockResolvedValue({
        status: 'success',
        rawResultCount: features.length,
        value: features.map((feature) => ({
          id: `osm:${feature.osmType}:${feature.osmId}`,
          name: `Fixture ${feature.osmId}`,
          osmType: feature.osmType,
          osmId: feature.osmId,
          // Discovery returns way centers only (`out body center`).
          geometry: { type: 'Point', coordinates: [feature.lon, feature.lat] },
          tags: feature.tags,
        })),
      }),
      lookupAreaGeometries: jest.fn().mockResolvedValue(
        areaStatus === 'failed'
          ? {
              status: 'failed',
              value: new Map(),
              failedIds: Object.keys(areas),
            }
          : {
              status: 'success',
              value: new Map(Object.entries(areas)),
              failedIds: [],
            },
      ),
    } as unknown as OsmPlacesService;
    const catalog = new ExperienceCatalogService(prisma, {} as any);
    const discovered = await new StructuredPoiAcquisitionProvider(osm).acquire(
      destination,
      { radiusMeters: 5_000 },
    );
    const result = await new StructuredPoiCatalogAcquisitionService(
      prisma,
      catalog,
      new StructuredKnowledgePersistenceService(prisma),
    ).persist(discovered.value);
    const composed =
      await catalog.composeAdmittedPlacesWithinScope(destination);
    return { prisma, osm, discovered, result, composed };
  }

  const geoIdOf = async (prisma: any, externalId: string) =>
    (
      await prisma.geoEntityIdentity.findUniqueOrThrow({
        where: {
          provider_externalId: { provider: 'openstreetmap', externalId },
        },
      })
    ).geoEntityId;

  it('a grave inside an admitted cemetery area becomes its sub-feature through declared containment', async () => {
    const { prisma, osm, discovered, result, composed } = await run(
      [
        {
          osmType: 'way',
          osmId: 10,
          lon: -58.38,
          lat: -34.6,
          tags: { landuse: 'cemetery', tourism: 'attraction' },
        },
        {
          osmType: 'node',
          osmId: 11,
          lon: -58.3801,
          lat: -34.6001,
          tags: { historic: 'tomb', heritage: '2' },
        },
      ],
      { 'osm:way:10': square(-58.38, -34.6, 0.002) },
    );

    expect((osm as any).lookupAreaGeometries).toHaveBeenCalledWith([
      'osm:way:10',
    ]);
    expect(discovered.provenance).toMatchObject({
      parentAreas: { requested: 1, resolved: 1, failed: 0 },
    });
    const cemetery = await geoIdOf(prisma, 'osm:way:10');
    const tomb = await geoIdOf(prisma, 'osm:node:11');
    const relations = await prisma.geoEntityRelation.findMany();
    expect(relations).toEqual([
      expect.objectContaining({
        childId: tomb,
        parentId: cemetery,
        type: 'PART_OF',
        evidenceSource: 'DECLARED_CONTAINMENT',
        visitUnitClassification: 'CHILD_REQUIRES_PARENT_VISIT',
        evidence: expect.objectContaining({
          basis: 'CONTAINMENT',
          relationshipClass: 'grave:cemetery',
          parent: 'osm:way:10',
          member: 'osm:node:11',
        }),
      }),
    ]);
    expect(
      result.candidateOutcomes.find((o: any) => o.externalId === 'osm:node:11'),
    ).toMatchObject({ visitUnitOutcome: 'SUB_FEATURE_OF' });
    // The child keeps its own admission (heritage) yet is not offered alone.
    expect(composed).toEqual([expect.any(String)]);
    expect(result.offeredGeoEntityIds).toEqual([cemetery]);
    expect(result.relationDiagnostics).toMatchObject({
      containmentMatches: 1,
      upsertAttempts: 1,
      upsertSucceeded: 1,
    });
  });

  it('containment without a declared relationship class establishes no relationship', async () => {
    const { prisma, result } = await run(
      [
        {
          osmType: 'way',
          osmId: 20,
          lon: -58.38,
          lat: -34.6,
          tags: { leisure: 'park' },
        },
        {
          osmType: 'node',
          osmId: 21,
          lon: -58.3801,
          lat: -34.6001,
          tags: { tourism: 'artwork', heritage: '2' },
        },
      ],
      { 'osm:way:20': square(-58.38, -34.6, 0.002) },
    );
    expect(await prisma.geoEntityRelation.count()).toBe(0);
    expect(result.relationDiagnostics).toMatchObject({
      containmentWithoutDeclaredClass: 1,
      containmentMatches: 0,
    });
  });

  it('a venue inside a park keeps PART_OF knowledge and stays independently visitable', async () => {
    const { prisma, result } = await run(
      [
        {
          osmType: 'way',
          osmId: 30,
          lon: -58.38,
          lat: -34.6,
          tags: { leisure: 'park' },
        },
        {
          osmType: 'node',
          osmId: 31,
          lon: -58.3801,
          lat: -34.6001,
          tags: { amenity: 'place_of_worship', heritage: '3' },
        },
      ],
      { 'osm:way:30': square(-58.38, -34.6, 0.002) },
    );
    const venue = await geoIdOf(prisma, 'osm:node:31');
    expect(await prisma.geoEntityRelation.findMany()).toEqual([
      expect.objectContaining({
        childId: venue,
        visitUnitClassification: 'CHILD_INDEPENDENTLY_VISITABLE',
      }),
    ]);
    expect(result.offeredGeoEntityIds).toContain(venue);
  });

  it('an unavailable parent area derives no relationship (UNKNOWN, not negative)', async () => {
    const { prisma, discovered } = await run(
      [
        {
          osmType: 'way',
          osmId: 40,
          lon: -58.38,
          lat: -34.6,
          tags: { landuse: 'cemetery', tourism: 'attraction' },
        },
        {
          osmType: 'node',
          osmId: 41,
          lon: -58.3801,
          lat: -34.6001,
          tags: { historic: 'tomb', heritage: '2' },
        },
      ],
      { 'osm:way:40': square(-58.38, -34.6, 0.002) },
      'failed',
    );
    expect(await prisma.geoEntityRelation.count()).toBe(0);
    expect(discovered.provenance).toMatchObject({
      parentAreas: { requested: 1, resolved: 0, failed: 1 },
    });
  });

  it('a point outside the parent area is not contained', async () => {
    const { prisma } = await run(
      [
        {
          osmType: 'way',
          osmId: 50,
          lon: -58.38,
          lat: -34.6,
          tags: { landuse: 'cemetery', tourism: 'attraction' },
        },
        {
          osmType: 'node',
          osmId: 51,
          lon: -58.37,
          lat: -34.59,
          tags: { historic: 'tomb', heritage: '2' },
        },
      ],
      { 'osm:way:50': square(-58.38, -34.6, 0.002) },
    );
    expect(await prisma.geoEntityRelation.count()).toBe(0);
  });
});
