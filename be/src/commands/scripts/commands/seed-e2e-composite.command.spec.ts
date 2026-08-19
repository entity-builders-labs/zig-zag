import { ActivityKind } from '@prisma/client';
import { SeedE2eCompositeCommand } from './seed-e2e-composite.command';

describe('SeedE2eCompositeCommand', () => {
  let prisma: any;
  let compositeActivityService: any;
  let command: SeedE2eCompositeCommand;
  let logSpy: jest.SpyInstance;

  const owner = { id: 'owner-1', email: 'e2e@example.com' };

  beforeEach(() => {
    let idCounter = 0;
    const nextId = () => `id-${++idCounter}`;

    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(owner) },
      activity: {
        create: jest.fn(async ({ data }: any) => ({ id: nextId(), ...data })),
      },
      activityFamily: {
        create: jest.fn(async ({ data }: any) => ({ id: nextId(), ...data })),
      },
      activityWaypoint: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      tour: {
        create: jest.fn(async ({ data }: any) => ({ id: nextId(), ...data })),
      },
      tourActivity: {
        create: jest.fn(async ({ data }: any) => ({ id: nextId(), ...data })),
      },
      tourActivityWaypoint: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    compositeActivityService = {
      updateVariantWaypoints: jest.fn().mockResolvedValue(undefined),
    };
    command = new SeedE2eCompositeCommand(prisma, compositeActivityService);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('requires --owner-email and never touches the database without it', async () => {
    await expect(command.run([], {})).rejects.toThrow();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('throws when no User exists with the given email', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      command.run([], { ownerEmail: 'nope@example.com' }),
    ).rejects.toThrow(/No user found/);
  });

  it('creates a NEIGHBORHOOD_WALK variant with 2 waypoints by default (boundary-kind=none)', async () => {
    await command.run([], { ownerEmail: owner.email });

    expect(prisma.activity).toBeDefined();
    const variantCreateCall = prisma.activity.create.mock.calls.find(
      (c: any) => c[0].data.kind === ActivityKind.NEIGHBORHOOD_WALK,
    );
    expect(variantCreateCall).toBeDefined();
    expect(variantCreateCall[0].data.boundary).toBeUndefined();
    expect(prisma.activityWaypoint.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ order: 1 }),
          expect.objectContaining({ order: 2 }),
        ]),
      }),
    );
    expect(prisma.tourActivityWaypoint.createMany).toHaveBeenCalled();
    expect(prisma.tour.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerId: owner.id }),
      }),
    );
  });

  it('creates 3 waypoints when --waypoint-count=3', async () => {
    await command.run([], { ownerEmail: owner.email, waypointCount: 3 });

    expect(prisma.activityWaypoint.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ order: 1 }),
          expect.objectContaining({ order: 2 }),
          expect.objectContaining({ order: 3 }),
        ]),
      }),
    );
  });

  it('rejects a --waypoint-count outside 2..3', async () => {
    await expect(
      command.run([], { ownerEmail: owner.email, waypointCount: 5 }),
    ).rejects.toThrow(/--waypoint-count/);
  });

  it('creates a Polygon boundary on the variant for --boundary-kind=polygon', async () => {
    await command.run([], {
      ownerEmail: owner.email,
      boundaryKind: 'polygon',
    });

    const variantCreateCall = prisma.activity.create.mock.calls.find(
      (c: any) => c[0].data.kind === ActivityKind.NEIGHBORHOOD_WALK,
    );
    expect(variantCreateCall[0].data.boundary).toEqual(
      expect.objectContaining({ type: 'Polygon' }),
    );
  });

  it('creates a MultiPolygon boundary for --boundary-kind=multipolygon', async () => {
    await command.run([], {
      ownerEmail: owner.email,
      boundaryKind: 'multipolygon',
    });

    const variantCreateCall = prisma.activity.create.mock.calls.find(
      (c: any) => c[0].data.kind === ActivityKind.NEIGHBORHOOD_WALK,
    );
    expect(variantCreateCall[0].data.boundary).toEqual(
      expect.objectContaining({ type: 'MultiPolygon' }),
    );
  });

  it('creates a top-level ROUTE with a LineString boundary and no waypoints for --boundary-kind=linestring', async () => {
    await command.run([], {
      ownerEmail: owner.email,
      boundaryKind: 'linestring',
    });

    const variantCreateCall = prisma.activity.create.mock.calls.find(
      (c: any) => c[0].data.kind === ActivityKind.ROUTE,
    );
    expect(variantCreateCall).toBeDefined();
    expect(variantCreateCall[0].data.boundary).toEqual(
      expect.objectContaining({ type: 'LineString' }),
    );
    expect(prisma.activityWaypoint.createMany).not.toHaveBeenCalled();
    expect(prisma.tourActivityWaypoint.createMany).not.toHaveBeenCalled();
  });

  it('calls updateVariantWaypoints (live edit) without touching the snapshot when --simulate-later-edit is set', async () => {
    await command.run([], {
      ownerEmail: owner.email,
      simulateLaterEdit: true,
    });

    expect(compositeActivityService.updateVariantWaypoints).toHaveBeenCalled();
    // The snapshot write already happened before the "later edit" call —
    // asserting call order confirms the edit really is AFTER the snapshot.
    const snapshotCallOrder =
      prisma.tourActivityWaypoint.createMany.mock.invocationCallOrder[0];
    const editCallOrder =
      compositeActivityService.updateVariantWaypoints.mock
        .invocationCallOrder[0];
    expect(snapshotCallOrder).toBeLessThan(editCallOrder);
  });

  it('never calls updateVariantWaypoints when --simulate-later-edit is not set', async () => {
    await command.run([], { ownerEmail: owner.email });

    expect(
      compositeActivityService.updateVariantWaypoints,
    ).not.toHaveBeenCalled();
  });

  it('prints a single parseable E2E_FIXTURE_JSON line with the created ids', async () => {
    await command.run([], { ownerEmail: owner.email });

    const jsonLine = logSpy.mock.calls
      .map((c) => c[0])
      .find((line: string) => line.startsWith('E2E_FIXTURE_JSON:'));
    expect(jsonLine).toBeDefined();
    const parsed = JSON.parse(jsonLine.replace('E2E_FIXTURE_JSON:', ''));
    expect(parsed.tourId).toBeDefined();
    expect(parsed.tourActivityId).toBeDefined();
    expect(parsed.variantId).toBeDefined();
    expect(Array.isArray(parsed.waypointIds)).toBe(true);
  });
});
