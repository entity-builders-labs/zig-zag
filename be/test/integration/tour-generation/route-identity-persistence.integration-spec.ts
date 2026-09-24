import { GeoEntityKind } from '@prisma/client';
import { ExperienceCatalogService } from 'src/modules/tours/services/experience-catalog.service';
import { getPrisma, resetDb, closeDb } from '../support/test-db';

/**
 * Stage 3 cutover — canonical multi-way ROUTE identity against real
 * Postgres. One real street = one GeoEntity(kind=ROUTE) + one
 * GeoEntityIdentity per provider-native OSM way. Never a synthetic
 * cluster identity; never a proximity-decided merge.
 */
describe('tour-generation integration · canonical multi-way ROUTE identity', () => {
  let catalog: ExperienceCatalogService;

  const way = (id: number) => `osm:way:${id}`;
  // A real-shaped segment: a short line of two vertices along one axis.
  const line = (i: number): [number, number][] => [
    [-58.371, -34.61 - i * 0.001],
    [-58.371, -34.611 - i * 0.001],
  ];
  const routeInput = (ids: number[], name = 'Defensa') => ({
    name,
    kind: GeoEntityKind.ROUTE,
    latitude: -34.62,
    longitude: -58.371,
    geometry: {
      type: 'MultiLineString' as const,
      coordinates: ids.map((id) => line(id)),
    },
    identities: ids.map((id) => ({
      provider: 'openstreetmap',
      externalId: way(id),
    })),
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

  it('persists one 14-way cluster as ONE ROUTE GeoEntity with 14 provider-native identities', async () => {
    const ids = Array.from({ length: 14 }, (_, i) => 1000 + i);
    const prisma = await getPrisma();

    const result = await catalog.upsertGeoEntityWithIdentities(routeInput(ids));

    expect(result.status).toBe('CREATED');
    expect(await prisma.geoEntity.count()).toBe(1);
    const identities = await prisma.geoEntityIdentity.findMany({
      orderBy: { externalId: 'asc' },
    });
    expect(identities).toHaveLength(14);
    expect(new Set(identities.map((i) => i.geoEntityId)).size).toBe(1);
    expect(identities.every((i) => i.provider === 'openstreetmap')).toBe(true);
    expect(identities.every((i) => /^osm:way:\d+$/.test(i.externalId))).toBe(
      true,
    );
    const entity = await prisma.geoEntity.findFirstOrThrow();
    expect(entity.kind).toBe('ROUTE');
    expect((entity.geometry as any).type).toBe('MultiLineString');
    expect((entity.geometry as any).coordinates).toHaveLength(14);
  });

  it('a later acquisition returning a different subset [B C D E] of [A B C D] reuses the same GeoEntity and attaches only E', async () => {
    const prisma = await getPrisma();
    const first = await catalog.upsertGeoEntityWithIdentities(
      routeInput([1, 2, 3, 4]),
    );
    const second = await catalog.upsertGeoEntityWithIdentities(
      routeInput([2, 3, 4, 5]),
    );

    expect(first.status).toBe('CREATED');
    expect(second.status).toBe('REUSED');
    if (first.status === 'IDENTITY_CONFLICT') throw new Error('unreachable');
    if (second.status === 'IDENTITY_CONFLICT') throw new Error('unreachable');
    expect(second.geoEntity.id).toBe(first.geoEntity.id);
    expect(second.attachedExternalIds).toEqual([way(5)]);
    expect(await prisma.geoEntity.count()).toBe(1);
    const identities = await prisma.geoEntityIdentity.findMany({
      orderBy: { externalId: 'asc' },
    });
    expect(identities.map((i) => i.externalId).sort()).toEqual(
      [1, 2, 3, 4, 5].map(way).sort(),
    );
    // Geometry is the union of real segments -- E is added, A is kept, no
    // duplicate lines for B/C/D, and no synthetic connector line.
    const entity = await prisma.geoEntity.findFirstOrThrow();
    expect((entity.geometry as any).coordinates).toHaveLength(5);
  });

  it('never silently merges: a cluster whose identities belong to TWO GeoEntities is an explicit IDENTITY_CONFLICT with no writes', async () => {
    const prisma = await getPrisma();
    const a = await catalog.upsertGeoEntityWithIdentities(routeInput([1]));
    const b = await catalog.upsertGeoEntityWithIdentities(routeInput([2]));
    if (a.status === 'IDENTITY_CONFLICT' || b.status === 'IDENTITY_CONFLICT') {
      throw new Error('unreachable');
    }

    const conflict = await catalog.upsertGeoEntityWithIdentities(
      routeInput([1, 2, 3]),
    );

    expect(conflict).toEqual({
      status: 'IDENTITY_CONFLICT',
      conflictingGeoEntityIds: [a.geoEntity.id, b.geoEntity.id].sort(),
    });
    expect(await prisma.geoEntity.count()).toBe(2);
    expect(await prisma.geoEntityIdentity.count()).toBe(2);
    expect(
      await prisma.geoEntityIdentity.findUnique({
        where: {
          provider_externalId: {
            provider: 'openstreetmap',
            externalId: way(3),
          },
        },
      }),
    ).toBeNull();
  });

  it('correlates an acquisition by strong identity: any known way id maps to its GeoEntity, unknown ids map to nothing', async () => {
    const created = await catalog.upsertGeoEntityWithIdentities(
      routeInput([1, 2]),
    );
    if (created.status === 'IDENTITY_CONFLICT') throw new Error('unreachable');

    await expect(
      catalog.findGeoEntityIdsByIdentities('openstreetmap', [way(2), way(9)]),
    ).resolves.toEqual([created.geoEntity.id]);
    await expect(
      catalog.findGeoEntityIdsByIdentities('openstreetmap', [way(9)]),
    ).resolves.toEqual([]);
  });

  it('serializes concurrent acquisitions of overlapping segment sets onto one GeoEntity', async () => {
    const prisma = await getPrisma();

    const results = await Promise.all([
      catalog.upsertGeoEntityWithIdentities(routeInput([1, 2, 3])),
      catalog.upsertGeoEntityWithIdentities(routeInput([3, 4, 5])),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(['CREATED', 'REUSED']);
    expect(await prisma.geoEntity.count()).toBe(1);
    expect(await prisma.geoEntityIdentity.count()).toBe(5);
  });
});
