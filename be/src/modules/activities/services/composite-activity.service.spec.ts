import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@core/database/prisma.service';
import { VectorStoreService } from '@shared/ai/services/vector-store.service';
import { ActivityKind, VariantTheme } from '@prisma/client';
import { CompositeActivityService } from './composite-activity.service';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';

// A minimal in-memory fake of the handful of Prisma models this service
// touches — real enough to exercise the find-or-create races, the
// composite unique keys, and the transactional deletes/creates, without
// needing a real Postgres connection for pure-logic unit tests (real-DB
// behavior — actual constraint enforcement under real concurrency — is
// covered separately by the e2e spec against Postgres).
function createFakePrisma() {
  let idCounter = 0;
  const nextId = () => `id-${++idCounter}`;

  const sources: any[] = [];
  const activities: any[] = [];
  const families: any[] = [];
  const waypoints: any[] = [];
  const tourWaypoints: any[] = [];

  const conflict = () => {
    const err: any = new Error('Unique constraint failed');
    err.code = 'P2002';
    return err;
  };

  const source = {
    findUnique: jest.fn(
      async ({ where }: any) =>
        sources.find((s) => s.name === where.name) ?? null,
    ),
    create: jest.fn(async ({ data }: any) => {
      if (sources.some((s) => s.name === data.name)) throw conflict();
      const row = { id: nextId(), ...data };
      sources.push(row);
      return row;
    }),
  };

  const activity = {
    findUnique: jest.fn(async ({ where }: any) => {
      if (where.id) return activities.find((a) => a.id === where.id) ?? null;
      if (where.sourceId_externalId) {
        const { sourceId, externalId } = where.sourceId_externalId;
        return (
          activities.find(
            (a) => a.sourceId === sourceId && a.externalId === externalId,
          ) ?? null
        );
      }
      return null;
    }),
    create: jest.fn(async ({ data }: any) => {
      const sourceId = data.source?.connect?.id ?? data.sourceId;
      const familyId = data.family?.connect?.id ?? data.familyId ?? null;
      if (
        sourceId &&
        data.externalId &&
        activities.some(
          (a) => a.sourceId === sourceId && a.externalId === data.externalId,
        )
      ) {
        throw conflict();
      }
      const row = {
        id: nextId(),
        name: data.name,
        description: data.description ?? null,
        kind: data.kind,
        variantTheme: data.variantTheme ?? null,
        boundary: data.boundary ?? null,
        familyId,
        latitude: data.latitude,
        longitude: data.longitude,
        sourceId,
        externalId: data.externalId,
        metadata: data.metadata ?? null,
        isArchived: false,
      };
      activities.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = activities.find((a) => a.id === where.id);
      Object.assign(row, data);
      return row;
    }),
  };

  const activityFamily = {
    findUnique: jest.fn(async ({ where }: any) => {
      const { areaActivityId, kind } = where.areaActivityId_kind;
      return (
        families.find(
          (f) => f.areaActivityId === areaActivityId && f.kind === kind,
        ) ?? null
      );
    }),
    create: jest.fn(async ({ data }: any) => {
      if (
        families.some(
          (f) =>
            f.areaActivityId === data.areaActivityId && f.kind === data.kind,
        )
      ) {
        throw conflict();
      }
      const row = { id: nextId(), ...data };
      families.push(row);
      return row;
    }),
  };

  const activityWaypoint = {
    findUnique: jest.fn(async ({ where }: any) => {
      const key = where.compositeActivityId_waypointActivityId;
      return (
        waypoints.find(
          (w) =>
            w.compositeActivityId === key.compositeActivityId &&
            w.waypointActivityId === key.waypointActivityId,
        ) ?? null
      );
    }),
    findMany: jest.fn(async ({ where }: any = {}) =>
      waypoints.filter(
        (w) =>
          (where?.waypointActivityId === undefined ||
            w.waypointActivityId === where.waypointActivityId) &&
          (where?.compositeActivityId === undefined ||
            w.compositeActivityId === where.compositeActivityId),
      ),
    ),
    createMany: jest.fn(async ({ data }: any) => {
      data.forEach((d: any) => waypoints.push({ id: nextId(), ...d }));
      return { count: data.length };
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      const before = waypoints.length;
      for (let i = waypoints.length - 1; i >= 0; i--) {
        const w = waypoints[i];
        const matches =
          (where.waypointActivityId === undefined ||
            w.waypointActivityId === where.waypointActivityId) &&
          (where.compositeActivityId === undefined ||
            w.compositeActivityId === where.compositeActivityId);
        if (matches) waypoints.splice(i, 1);
      }
      return { count: before - waypoints.length };
    }),
    delete: jest.fn(async ({ where }: any) => {
      const idx = waypoints.findIndex((w) => w.id === where.id);
      const [removed] = waypoints.splice(idx, 1);
      return removed;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = waypoints.find((w) => w.id === where.id);
      Object.assign(row, data);
      return row;
    }),
    count: jest.fn(
      async ({ where }: any) =>
        waypoints.filter(
          (w) => w.compositeActivityId === where.compositeActivityId,
        ).length,
    ),
  };

  const tourActivityWaypoint = {
    findUnique: jest.fn(async ({ where }: any) => {
      const key = where.tourActivityId_waypointActivityId;
      return (
        tourWaypoints.find(
          (w) =>
            w.tourActivityId === key.tourActivityId &&
            w.waypointActivityId === key.waypointActivityId,
        ) ?? null
      );
    }),
    findMany: jest.fn(async ({ where }: any = {}) =>
      tourWaypoints.filter(
        (w) =>
          where?.waypointActivityId === undefined ||
          w.waypointActivityId === where.waypointActivityId,
      ),
    ),
    delete: jest.fn(async ({ where }: any) => {
      const idx = tourWaypoints.findIndex((w) => w.id === where.id);
      const [removed] = tourWaypoints.splice(idx, 1);
      return removed;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = tourWaypoints.find((w) => w.id === where.id);
      Object.assign(row, data);
      return row;
    }),
  };

  const client: any = {
    source,
    activity,
    activityFamily,
    activityWaypoint,
    tourActivityWaypoint,
    $transaction: jest.fn(async (cb: any) => cb(client)),
  };

  // Test-only seam for arranging fixtures directly.
  client.__seed = { sources, activities, families, waypoints, tourWaypoints };

  return client;
}

describe('CompositeActivityService', () => {
  let prisma: any;
  let vectorStoreService: jest.Mocked<
    Pick<VectorStoreService, 'saveActivityEmbedding'>
  >;
  let service: CompositeActivityService;

  const osmCandidate = (
    overrides: Partial<OsmCandidate> = {},
  ): OsmCandidate => ({
    id: 'osm:relation:49518',
    name: 'San Telmo',
    osmType: 'relation',
    osmId: 49518,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-58.372, -34.62],
          [-58.372, -34.63],
          [-58.362, -34.63],
          [-58.372, -34.62],
        ],
      ],
    },
    tags: { name: 'San Telmo', admin_level: '10' },
    ...overrides,
  });

  beforeEach(async () => {
    prisma = createFakePrisma();
    vectorStoreService = {
      saveActivityEmbedding: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompositeActivityService,
        { provide: PrismaService, useValue: prisma },
        { provide: VectorStoreService, useValue: vectorStoreService },
      ],
    }).compile();

    service = module.get(CompositeActivityService);
  });

  describe('waypoint token materialization', () => {
    it('materializes an "osm:way:…" token as kind: ROUTE, never POI', async () => {
      // A pre-existing POI so the composite has >=2 real waypoints.
      const poi = await prisma.activity.create({
        data: {
          name: 'Plaza Dorrego',
          kind: ActivityKind.POI,
          latitude: -34.62,
          longitude: -58.37,
        },
      });

      const streetCandidate = osmCandidate({
        id: 'osm:way:1',
        osmType: 'way',
        osmId: 1,
        name: 'Defensa',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-58.37, -34.62],
            [-58.371, -34.621],
          ],
        },
      });

      const variant = await service.createOrReuseComposite({
        name: 'San Telmo Historic Walk',
        kind: ActivityKind.NEIGHBORHOOD_WALK,
        variantTheme: VariantTheme.HISTORY,
        areaCandidate: osmCandidate(),
        waypointIds: [poi.id, 'osm:way:1'],
        candidateOsmFeaturesById: new Map([['osm:way:1', streetCandidate]]),
      });

      const rows = await prisma.activityWaypoint.findMany({
        where: { compositeActivityId: variant.id },
      });
      const materialized = await prisma.activity.findUnique({
        where: {
          id: rows.find((r: any) => r.waypointActivityId !== poi.id)
            .waypointActivityId,
        },
      });

      expect(materialized.kind).toBe(ActivityKind.ROUTE);
      expect(materialized.kind).not.toBe(ActivityKind.POI);
    });

    it('materializes an "osm:node:…" POI token (Point geometry) without throwing', async () => {
      const poi = await prisma.activity.create({
        data: {
          name: 'Plaza Dorrego',
          kind: ActivityKind.POI,
          latitude: -34.62,
          longitude: -58.37,
        },
      });

      const nodeCandidate = osmCandidate({
        id: 'osm:node:123',
        osmType: 'node',
        osmId: 123,
        name: 'Casa Mínima',
        geometry: { type: 'Point', coordinates: [-58.371, -34.621] },
        tags: { name: 'Casa Mínima', historic: 'yes' },
      });

      const variant = await service.createOrReuseComposite({
        name: 'San Telmo Historic Walk',
        kind: ActivityKind.NEIGHBORHOOD_WALK,
        variantTheme: VariantTheme.HISTORY,
        areaCandidate: osmCandidate(),
        waypointIds: [poi.id, 'osm:node:123'],
        candidateOsmFeaturesById: new Map([['osm:node:123', nodeCandidate]]),
      });

      const rows = await prisma.activityWaypoint.findMany({
        where: { compositeActivityId: variant.id },
      });
      const materialized = await prisma.activity.findUnique({
        where: {
          id: rows.find((r: any) => r.waypointActivityId !== poi.id)
            .waypointActivityId,
        },
      });

      expect(materialized.kind).toBe(ActivityKind.ROUTE);
      expect(materialized.latitude).toBeCloseTo(-34.621);
      expect(materialized.longitude).toBeCloseTo(-58.371);
    });
  });

  describe('area resolution', () => {
    it('reuses an existing kind: AREA Activity with the same externalId instead of duplicating it', async () => {
      const first = await service.resolveArea(osmCandidate());
      const second = await service.resolveArea(osmCandidate());

      expect(second.id).toBe(first.id);
      expect(
        prisma.__seed.activities.filter(
          (a: any) => a.kind === ActivityKind.AREA,
        ),
      ).toHaveLength(1);
    });
  });

  describe('family resolution', () => {
    it('creates a family on first call and reuses it (findFirst({areaActivityId, kind})) after', async () => {
      const area = await service.resolveArea(osmCandidate());

      const first = await service.resolveFamily(
        area.id,
        ActivityKind.NEIGHBORHOOD_WALK,
        'San Telmo Walk',
      );
      const second = await service.resolveFamily(
        area.id,
        ActivityKind.NEIGHBORHOOD_WALK,
        'San Telmo Walk',
      );

      expect(second.id).toBe(first.id);
      expect(prisma.__seed.families).toHaveLength(1);
    });
  });

  describe('variant identity — the case that motivated familyId+variantTheme over waypoint hashing', () => {
    const poi1 = {
      id: 'poi-1',
      kind: ActivityKind.POI,
      latitude: -34.62,
      longitude: -58.37,
    };
    const poi2 = {
      id: 'poi-2',
      kind: ActivityKind.POI,
      latitude: -34.621,
      longitude: -58.371,
    };

    beforeEach(() => {
      prisma.__seed.activities.push({ ...poi1 }, { ...poi2 });
    });

    it('reuses an existing variant (same familyId+variantTheme) instead of duplicating, and does NOT overwrite its waypoints', async () => {
      const input = {
        name: 'San Telmo Historic Walk',
        kind: ActivityKind.NEIGHBORHOOD_WALK,
        variantTheme: VariantTheme.HISTORY,
        areaCandidate: osmCandidate(),
        candidateOsmFeaturesById: new Map(),
      };

      const first = await service.createOrReuseComposite({
        ...input,
        waypointIds: [poi1.id, poi2.id],
      });
      // Same family+theme, but a DIFFERENT waypoint set proposed this time.
      const second = await service.createOrReuseComposite({
        ...input,
        waypointIds: [poi1.id],
      });

      expect(second.id).toBe(first.id);
      const rows = await prisma.activityWaypoint.findMany({
        where: { compositeActivityId: first.id },
      });
      // The original 2-waypoint content survives untouched — the second
      // call's differing waypointIds were never persisted.
      expect(rows).toHaveLength(2);
    });

    it('creates two separate Activities for the same familyId when variantTheme differs, even with identical waypoints', async () => {
      const area = osmCandidate();
      const historic = await service.createOrReuseComposite({
        name: 'San Telmo Historic Walk',
        kind: ActivityKind.NEIGHBORHOOD_WALK,
        variantTheme: VariantTheme.HISTORY,
        areaCandidate: area,
        waypointIds: [poi1.id, poi2.id],
        candidateOsmFeaturesById: new Map(),
      });
      const architecture = await service.createOrReuseComposite({
        name: 'San Telmo Architecture Walk',
        kind: ActivityKind.NEIGHBORHOOD_WALK,
        variantTheme: VariantTheme.ARCHITECTURE,
        areaCandidate: area,
        waypointIds: [poi1.id, poi2.id], // same waypoints, different theme
        candidateOsmFeaturesById: new Map(),
      });

      expect(architecture.id).not.toBe(historic.id);
      expect(
        prisma.__seed.activities.filter(
          (a: any) => a.kind === ActivityKind.NEIGHBORHOOD_WALK,
        ),
      ).toHaveLength(2);
    });

    it('a materialized kind: ROUTE Activity ("Pasear por Caminito") can be reused both standalone and as a waypoint of another composite', async () => {
      const caminito = osmCandidate({
        id: 'osm:way:99',
        osmType: 'way',
        osmId: 99,
        name: 'Caminito',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-58.36, -34.63],
            [-58.361, -34.631],
          ],
        },
      });

      const standalone = await service.createOrReuseComposite({
        name: 'Pasear por Caminito',
        kind: ActivityKind.ROUTE,
        variantTheme: VariantTheme.PHOTOGRAPHY,
        areaCandidate: osmCandidate(),
        waypointIds: ['osm:way:99'],
        candidateOsmFeaturesById: new Map([['osm:way:99', caminito]]),
      });

      // Now a DIFFERENT composite references the same OSM way as one of
      // its own stops (not its own top-level geometry).
      const artWalk = await service.createOrReuseComposite({
        name: 'La Boca Art Walk',
        kind: ActivityKind.NEIGHBORHOOD_WALK,
        variantTheme: VariantTheme.ART,
        areaCandidate: osmCandidate(),
        waypointIds: [poi1.id, 'osm:way:99'],
        candidateOsmFeaturesById: new Map([['osm:way:99', caminito]]),
      });

      const materializedRouteRows = prisma.__seed.activities.filter(
        (a: any) => a.kind === ActivityKind.ROUTE && a.externalId === 'way/99',
      );
      // Only ONE materialized Activity for that OSM way, reused both times.
      expect(materializedRouteRows).toHaveLength(1);
      expect(standalone.id).not.toBe(artWalk.id);
      const artWalkWaypoints = await prisma.activityWaypoint.findMany({
        where: { compositeActivityId: artWalk.id },
      });
      expect(artWalkWaypoints.map((w: any) => w.waypointActivityId)).toContain(
        materializedRouteRows[0].id,
      );
    });
  });

  describe('createOrReuseComposite with forceUpdateWaypoints (generate-templates --update-existing)', () => {
    const poi1 = {
      id: 'poi-1',
      kind: ActivityKind.POI,
      latitude: -34.62,
      longitude: -58.37,
    };
    const poi2 = {
      id: 'poi-2',
      kind: ActivityKind.POI,
      latitude: -34.621,
      longitude: -58.371,
    };
    const poi3 = {
      id: 'poi-3',
      kind: ActivityKind.POI,
      latitude: -34.622,
      longitude: -58.372,
    };

    beforeEach(() => {
      prisma.__seed.activities.push({ ...poi1 }, { ...poi2 }, { ...poi3 });
    });

    it("replaces an existing variant's waypoints instead of leaving it untouched", async () => {
      const input = {
        name: 'San Telmo Historic Walk',
        kind: ActivityKind.NEIGHBORHOOD_WALK,
        variantTheme: VariantTheme.HISTORY,
        areaCandidate: osmCandidate(),
        candidateOsmFeaturesById: new Map(),
      };

      const first = await service.createOrReuseComposite({
        ...input,
        waypointIds: [poi1.id, poi2.id],
      });
      const updated = await service.createOrReuseComposite({
        ...input,
        waypointIds: [poi2.id, poi3.id],
        forceUpdateWaypoints: true,
      });

      expect(updated.id).toBe(first.id);
      const rows = await prisma.activityWaypoint.findMany({
        where: { compositeActivityId: first.id },
      });
      expect(rows.map((r: any) => r.waypointActivityId).sort()).toEqual([
        poi2.id,
        poi3.id,
      ]);
      expect(vectorStoreService.saveActivityEmbedding).toHaveBeenCalled();
    });

    it('still creates a brand-new variant on a genuine miss, even with forceUpdateWaypoints set', async () => {
      const variant = await service.createOrReuseComposite({
        name: 'San Telmo Historic Walk',
        kind: ActivityKind.NEIGHBORHOOD_WALK,
        variantTheme: VariantTheme.HISTORY,
        areaCandidate: osmCandidate(),
        waypointIds: [poi1.id, poi2.id],
        candidateOsmFeaturesById: new Map(),
        forceUpdateWaypoints: true,
      });

      expect(variant.kind).toBe(ActivityKind.NEIGHBORHOOD_WALK);
      const rows = await prisma.activityWaypoint.findMany({
        where: { compositeActivityId: variant.id },
      });
      expect(rows).toHaveLength(2);
    });
  });

  describe('updateVariantWaypoints', () => {
    it('replaces the content wholesale and regenerates the embedding', async () => {
      prisma.__seed.activities.push(
        { id: 'poi-a', kind: ActivityKind.POI },
        { id: 'poi-b', kind: ActivityKind.POI },
        { id: 'poi-c', kind: ActivityKind.POI },
      );
      const variant = await prisma.activity.create({
        data: {
          name: 'Variant',
          kind: ActivityKind.NEIGHBORHOOD_WALK,
          latitude: 0,
          longitude: 0,
        },
      });
      await prisma.activityWaypoint.createMany({
        data: [
          {
            compositeActivityId: variant.id,
            waypointActivityId: 'poi-a',
            order: 1,
          },
        ],
      });

      await service.updateVariantWaypoints(variant.id, ['poi-b', 'poi-c']);

      const rows = await prisma.activityWaypoint.findMany({
        where: { compositeActivityId: variant.id },
      });
      expect(rows.map((r: any) => r.waypointActivityId).sort()).toEqual([
        'poi-b',
        'poi-c',
      ]);
      expect(vectorStoreService.saveActivityEmbedding).toHaveBeenCalled();
    });
  });

  describe('removeWaypointFromActiveVariants', () => {
    it('removes the waypoint from ActivityWaypoint but never touches TourActivityWaypoint (historical snapshots stay intact)', async () => {
      prisma.__seed.activities.push({
        id: 'poi-1',
        kind: ActivityKind.POI,
        isArchived: false,
      });
      const variant = await prisma.activity.create({
        data: {
          name: 'V',
          kind: ActivityKind.NEIGHBORHOOD_WALK,
          latitude: 0,
          longitude: 0,
        },
      });
      await prisma.activityWaypoint.createMany({
        data: [
          {
            compositeActivityId: variant.id,
            waypointActivityId: 'poi-1',
            order: 1,
          },
          {
            compositeActivityId: variant.id,
            waypointActivityId: 'poi-2',
            order: 2,
          },
        ],
      });
      prisma.__seed.tourWaypoints.push({
        id: 'tw-1',
        tourActivityId: 'ta-1',
        waypointActivityId: 'poi-1',
        order: 1,
      });

      await service.removeWaypointFromActiveVariants('poi-1');

      const liveWaypoints = await prisma.activityWaypoint.findMany({
        where: { compositeActivityId: variant.id },
      });
      expect(liveWaypoints.map((w: any) => w.waypointActivityId)).toEqual([
        'poi-2',
      ]);
      // The historical tour snapshot is untouched — this is the whole point.
      expect(prisma.__seed.tourWaypoints).toHaveLength(1);
      expect(prisma.__seed.tourWaypoints[0].waypointActivityId).toBe('poi-1');
    });

    it('archives the POI being removed', async () => {
      prisma.__seed.activities.push({
        id: 'poi-1',
        kind: ActivityKind.POI,
        isArchived: false,
      });

      await service.removeWaypointFromActiveVariants('poi-1');

      const poi = prisma.__seed.activities.find((a: any) => a.id === 'poi-1');
      expect(poi.isArchived).toBe(true);
    });

    it('archives a NEIGHBORHOOD_WALK/EXPERIENCE variant that falls below the minimum of 2 waypoints', async () => {
      prisma.__seed.activities.push({
        id: 'poi-1',
        kind: ActivityKind.POI,
        isArchived: false,
      });
      const variant = await prisma.activity.create({
        data: {
          name: 'V',
          kind: ActivityKind.NEIGHBORHOOD_WALK,
          latitude: 0,
          longitude: 0,
        },
      });
      await prisma.activityWaypoint.createMany({
        data: [
          {
            compositeActivityId: variant.id,
            waypointActivityId: 'poi-1',
            order: 1,
          },
        ],
      });

      await service.removeWaypointFromActiveVariants('poi-1');

      const updated = prisma.__seed.activities.find(
        (a: any) => a.id === variant.id,
      );
      expect(updated.isArchived).toBe(true);
    });

    it('does NOT archive a variant that still has 2+ waypoints after the removal', async () => {
      prisma.__seed.activities.push({
        id: 'poi-1',
        kind: ActivityKind.POI,
        isArchived: false,
      });
      const variant = await prisma.activity.create({
        data: {
          name: 'V',
          kind: ActivityKind.NEIGHBORHOOD_WALK,
          latitude: 0,
          longitude: 0,
        },
      });
      await prisma.activityWaypoint.createMany({
        data: [
          {
            compositeActivityId: variant.id,
            waypointActivityId: 'poi-1',
            order: 1,
          },
          {
            compositeActivityId: variant.id,
            waypointActivityId: 'poi-2',
            order: 2,
          },
          {
            compositeActivityId: variant.id,
            waypointActivityId: 'poi-3',
            order: 3,
          },
        ],
      });

      await service.removeWaypointFromActiveVariants('poi-1');

      const updated = prisma.__seed.activities.find(
        (a: any) => a.id === variant.id,
      );
      expect(updated.isArchived).toBe(false);
    });

    it('does NOT apply the minimum-waypoints rule to a ROUTE (it has no such minimum)', async () => {
      prisma.__seed.activities.push({
        id: 'poi-1',
        kind: ActivityKind.POI,
        isArchived: false,
      });
      const route = await prisma.activity.create({
        data: {
          name: 'A Route',
          kind: ActivityKind.ROUTE,
          latitude: 0,
          longitude: 0,
        },
      });
      await prisma.activityWaypoint.createMany({
        data: [
          {
            compositeActivityId: route.id,
            waypointActivityId: 'poi-1',
            order: 1,
          },
        ],
      });

      await service.removeWaypointFromActiveVariants('poi-1');

      const updated = prisma.__seed.activities.find(
        (a: any) => a.id === route.id,
      );
      expect(updated.isArchived).toBe(false);
    });
  });

  describe('mergeWaypointIdentity', () => {
    it('repoints references in BOTH ActivityWaypoint and TourActivityWaypoint (unlike removeWaypointFromActiveVariants)', async () => {
      prisma.__seed.activities.push(
        { id: 'old-poi', kind: ActivityKind.POI },
        { id: 'canonical-poi', kind: ActivityKind.POI },
      );
      const variant = await prisma.activity.create({
        data: {
          name: 'V',
          kind: ActivityKind.NEIGHBORHOOD_WALK,
          latitude: 0,
          longitude: 0,
        },
      });
      await prisma.activityWaypoint.createMany({
        data: [
          {
            compositeActivityId: variant.id,
            waypointActivityId: 'old-poi',
            order: 1,
          },
        ],
      });
      prisma.__seed.tourWaypoints.push({
        id: 'tw-1',
        tourActivityId: 'ta-1',
        waypointActivityId: 'old-poi',
        order: 1,
      });

      await service.mergeWaypointIdentity('old-poi', 'canonical-poi');

      const liveWaypoints = await prisma.activityWaypoint.findMany({
        where: { compositeActivityId: variant.id },
      });
      expect(liveWaypoints[0].waypointActivityId).toBe('canonical-poi');
      expect(prisma.__seed.tourWaypoints[0].waypointActivityId).toBe(
        'canonical-poi',
      );
    });

    it('dedupes instead of creating a duplicate when the canonical id is already a waypoint of the same variant', async () => {
      prisma.__seed.activities.push(
        { id: 'old-poi', kind: ActivityKind.POI },
        { id: 'canonical-poi', kind: ActivityKind.POI },
      );
      const variant = await prisma.activity.create({
        data: {
          name: 'V',
          kind: ActivityKind.NEIGHBORHOOD_WALK,
          latitude: 0,
          longitude: 0,
        },
      });
      await prisma.activityWaypoint.createMany({
        data: [
          {
            compositeActivityId: variant.id,
            waypointActivityId: 'old-poi',
            order: 1,
          },
          {
            compositeActivityId: variant.id,
            waypointActivityId: 'canonical-poi',
            order: 2,
          },
        ],
      });

      await service.mergeWaypointIdentity('old-poi', 'canonical-poi');

      const liveWaypoints = await prisma.activityWaypoint.findMany({
        where: { compositeActivityId: variant.id },
      });
      expect(liveWaypoints).toHaveLength(1);
      expect(liveWaypoints[0].waypointActivityId).toBe('canonical-poi');
    });
  });
});
