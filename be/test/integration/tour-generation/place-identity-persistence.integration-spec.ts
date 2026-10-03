import { GeoEntityKind } from '@prisma/client';
import { ExperienceCatalogService } from 'src/modules/tours/services/experience-catalog.service';
import { getPrisma, resetDb, closeDb } from '../support/test-db';

/**
 * Stage 3 PLACE cutover — multi-identity PLACE persistence against real
 * Postgres, through the SAME authority as canonical ROUTE identity
 * (`upsertGeoEntityWithIdentities`): one real place = one
 * GeoEntity(kind=PLACE) + every strong provider-native identity it was
 * verified with. Reconciliation is by exact identity only.
 */
describe('tour-generation integration · multi-identity PLACE persistence', () => {
  let catalog: ExperienceCatalogService;

  const FARMACIA_OSM = {
    provider: 'openstreetmap',
    externalId: 'osm:node:3348573778',
  };
  const farmacia = (
    identities: Array<{ provider: string; externalId: string }>,
  ) => ({
    name: 'Farmacia de la Estrella',
    kind: GeoEntityKind.PLACE,
    latitude: -34.6102605,
    longitude: -58.3721513,
    geometry: {
      type: 'Point' as const,
      coordinates: [-58.3721513, -34.6102605] as [number, number],
    },
    identities,
  });

  beforeAll(async () => {
    const prisma = await getPrisma();
    catalog = new ExperienceCatalogService(prisma, {
      getStatus: () => ({ provider: 'none' }),
    } as any);
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  it('COLD: persists ONE PLACE GeoEntity carrying the Geoapify handle AND the explicit OSM identity', async () => {
    const prisma = await getPrisma();

    const result = await catalog.upsertGeoEntityWithIdentities(
      farmacia([
        { provider: 'geoapify', externalId: 'geoapify:text-mode-id' },
        FARMACIA_OSM,
      ]),
    );

    expect(result.status).toBe('CREATED');
    expect(await prisma.geoEntity.count()).toBe(1);
    const entity = await prisma.geoEntity.findFirstOrThrow({
      include: { identities: { orderBy: { provider: 'asc' } } },
    });
    expect(entity.kind).toBe('PLACE');
    expect(
      entity.identities.map(({ provider, externalId }) => ({
        provider,
        externalId,
      })),
    ).toEqual([
      { provider: 'geoapify', externalId: 'geoapify:text-mode-id' },
      FARMACIA_OSM,
    ]);
  });

  it('a later acquisition of the same OSM object under a DIFFERENT Geoapify handle reuses the entity (OSM id is the stable key)', async () => {
    const prisma = await getPrisma();
    const first = await catalog.upsertGeoEntityWithIdentities(
      farmacia([
        { provider: 'geoapify', externalId: 'geoapify:text-mode-id' },
        FARMACIA_OSM,
      ]),
    );

    const second = await catalog.upsertGeoEntityWithIdentities(
      farmacia([
        { provider: 'geoapify', externalId: 'geoapify:structured-mode-id' },
        FARMACIA_OSM,
      ]),
    );

    expect(second).toMatchObject({
      status: 'REUSED',
      attachedExternalIds: ['geoapify:structured-mode-id'],
    });
    expect(second.status !== 'IDENTITY_CONFLICT' && second.geoEntity.id).toBe(
      first.status !== 'IDENTITY_CONFLICT' && first.geoEntity.id,
    );
    expect(await prisma.geoEntity.count()).toBe(1);
    expect(await prisma.geoEntityIdentity.count()).toBe(3);
  });

  it('an identical re-verification (WARM re-acquisition) writes no duplicate entity or identity', async () => {
    const prisma = await getPrisma();
    const identities = [
      { provider: 'geoapify', externalId: 'geoapify:text-mode-id' },
      FARMACIA_OSM,
    ];
    await catalog.upsertGeoEntityWithIdentities(farmacia(identities));

    const again = await catalog.upsertGeoEntityWithIdentities(
      farmacia(identities),
    );

    expect(again).toMatchObject({ status: 'REUSED', attachedExternalIds: [] });
    expect(await prisma.geoEntity.count()).toBe(1);
    expect(await prisma.geoEntityIdentity.count()).toBe(2);
  });

  it('attaches the OSM + Wikidata identities to a PLACE first persisted from a single OSM identity (Nominatim/local OSM path)', async () => {
    const prisma = await getPrisma();
    const single = await catalog.upsertGeoEntity({
      name: 'Mafalda, Susanita y Manolito',
      kind: GeoEntityKind.PLACE,
      provider: 'openstreetmap',
      externalId: 'osm:node:2472979623',
      latitude: -34.6159617,
      longitude: -58.3716913,
    });

    const multi = await catalog.upsertGeoEntityWithIdentities({
      name: 'Mafalda, Susanita and Manolito',
      kind: GeoEntityKind.PLACE,
      latitude: -34.6159617,
      longitude: -58.3716913,
      identities: [
        { provider: 'geoapify', externalId: 'geoapify:mafalda' },
        { provider: 'openstreetmap', externalId: 'osm:node:2472979623' },
        { provider: 'wikidata', externalId: 'Q111038841' },
      ],
    });

    expect(multi).toMatchObject({
      status: 'REUSED',
      geoEntity: { id: single.id },
    });
    expect(await prisma.geoEntity.count()).toBe(1);
    expect(await prisma.geoEntityIdentity.count()).toBe(3);
  });

  it('identities owned by TWO different PLACE GeoEntities are an explicit IDENTITY_CONFLICT with no writes (never a name/proximity merge)', async () => {
    const prisma = await getPrisma();
    await catalog.upsertGeoEntityWithIdentities(
      farmacia([{ provider: 'geoapify', externalId: 'geoapify:a' }]),
    );
    await catalog.upsertGeoEntityWithIdentities(farmacia([FARMACIA_OSM]));

    const conflict = await catalog.upsertGeoEntityWithIdentities(
      farmacia([
        { provider: 'geoapify', externalId: 'geoapify:a' },
        FARMACIA_OSM,
      ]),
    );

    expect(conflict.status).toBe('IDENTITY_CONFLICT');
    expect(await prisma.geoEntity.count()).toBe(2);
    expect(await prisma.geoEntityIdentity.count()).toBe(2);
  });
});
