import { Command, CommandRunner, Option } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { ActivityKind, Prisma, VariantTheme } from '@prisma/client';
import { PrismaService } from '@core/database/prisma.service';
import { CompositeActivityService } from '@activities/services/composite-activity.service';

type BoundaryKind =
  | 'none'
  | 'polygon'
  | 'polygon-hole'
  | 'multipolygon'
  | 'linestring';

interface SeedE2eCompositeOptions {
  ownerEmail?: string;
  boundaryKind?: BoundaryKind;
  simulateLaterEdit?: boolean;
  tourName?: string;
  waypointCount?: number;
}

// Fixed San Telmo-ish coordinates, matching the fixtures already used
// elsewhere in this codebase's specs — arbitrary otherwise.
const BASE_LAT = -34.62;
const BASE_LNG = -58.37;

function polygonBoundary(): Prisma.InputJsonValue {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [BASE_LNG - 0.002, BASE_LAT - 0.002],
        [BASE_LNG + 0.002, BASE_LAT - 0.002],
        [BASE_LNG + 0.002, BASE_LAT + 0.002],
        [BASE_LNG - 0.002, BASE_LAT + 0.002],
        [BASE_LNG - 0.002, BASE_LAT - 0.002],
      ],
    ],
  } as unknown as Prisma.InputJsonValue;
}

function polygonWithHoleBoundary(): Prisma.InputJsonValue {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [BASE_LNG - 0.004, BASE_LAT - 0.004],
        [BASE_LNG + 0.004, BASE_LAT - 0.004],
        [BASE_LNG + 0.004, BASE_LAT + 0.004],
        [BASE_LNG - 0.004, BASE_LAT + 0.004],
        [BASE_LNG - 0.004, BASE_LAT - 0.004],
      ],
      [
        [BASE_LNG - 0.001, BASE_LAT - 0.001],
        [BASE_LNG + 0.001, BASE_LAT - 0.001],
        [BASE_LNG + 0.001, BASE_LAT + 0.001],
        [BASE_LNG - 0.001, BASE_LAT + 0.001],
        [BASE_LNG - 0.001, BASE_LAT - 0.001],
      ],
    ],
  } as unknown as Prisma.InputJsonValue;
}

function multiPolygonBoundary(): Prisma.InputJsonValue {
  return {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [BASE_LNG - 0.006, BASE_LAT - 0.006],
          [BASE_LNG - 0.003, BASE_LAT - 0.006],
          [BASE_LNG - 0.003, BASE_LAT - 0.003],
          [BASE_LNG - 0.006, BASE_LAT - 0.003],
          [BASE_LNG - 0.006, BASE_LAT - 0.006],
        ],
      ],
      [
        [
          [BASE_LNG + 0.003, BASE_LAT + 0.003],
          [BASE_LNG + 0.006, BASE_LAT + 0.003],
          [BASE_LNG + 0.006, BASE_LAT + 0.006],
          [BASE_LNG + 0.003, BASE_LAT + 0.006],
          [BASE_LNG + 0.003, BASE_LAT + 0.003],
        ],
      ],
    ],
  } as unknown as Prisma.InputJsonValue;
}

function lineStringBoundary(): Prisma.InputJsonValue {
  return {
    type: 'LineString',
    coordinates: [
      [BASE_LNG - 0.003, BASE_LAT - 0.001],
      [BASE_LNG, BASE_LAT],
      [BASE_LNG + 0.003, BASE_LAT + 0.001],
    ],
  } as unknown as Prisma.InputJsonValue;
}

function boundaryFor(kind: BoundaryKind): Prisma.InputJsonValue | undefined {
  switch (kind) {
    case 'polygon':
      return polygonBoundary();
    case 'polygon-hole':
      return polygonWithHoleBoundary();
    case 'multipolygon':
      return multiPolygonBoundary();
    case 'linestring':
      return lineStringBoundary();
    case 'none':
    default:
      return undefined;
  }
}

/**
 * Seeds a tour with a composite (neighborhood_walk/route) stop directly via
 * Prisma, for frontend Playwright e2e tests (composite-area-polygon.spec.ts,
 * composite-stop-rendering.spec.ts, tour-review-edit-waypoints.spec.ts).
 * There is deliberately no HTTP endpoint to create composite Activities
 * (see CompositeActivityService's module doc) — this bypasses that
 * guardrail on purpose, the same way be/prisma/seed.ts bypasses normal
 * app flows for seeding.
 *
 * Prints exactly one line, `E2E_FIXTURE_JSON:{...}`, to stdout — the
 * Playwright-side helper parses that line to get the created tourId/ids.
 */
@Injectable()
@Command({
  name: 'seed-e2e-composite',
  description:
    'Seed a tour with a composite (waypoint/boundary) stop for frontend e2e tests',
})
export class SeedE2eCompositeCommand extends CommandRunner {
  private readonly logger = new Logger(SeedE2eCompositeCommand.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly compositeActivityService: CompositeActivityService,
  ) {
    super();
  }

  async run(
    _inputs: string[],
    options: SeedE2eCompositeOptions,
  ): Promise<void> {
    const { ownerEmail, tourName } = options;
    const boundaryKind = options.boundaryKind || 'none';
    const waypointCount = options.waypointCount || 2;
    if (!ownerEmail) {
      throw new Error(
        'Usage: yarn script seed-e2e-composite --owner-email=<email> [--boundary-kind=none|polygon|polygon-hole|multipolygon|linestring] [--simulate-later-edit] [--waypoint-count=2|3] [--tour-name="..."]',
      );
    }
    if (waypointCount < 2 || waypointCount > 3) {
      throw new Error(
        '--waypoint-count must be 2 or 3 (only 3 fixture POIs exist).',
      );
    }

    const owner = await this.prisma.user.findUnique({
      where: { email: ownerEmail },
    });
    if (!owner) {
      throw new Error(
        `No user found with email "${ownerEmail}" — log in via the real auth flow first (e.g. apiLogin() in e2e/auth-helper.ts) so this fixture has a real owner.`,
      );
    }

    const area = await this.prisma.activity.create({
      data: {
        name: 'E2E Fixture Area',
        kind: ActivityKind.AREA,
        latitude: BASE_LAT,
        longitude: BASE_LNG,
      },
    });
    const family = await this.prisma.activityFamily.create({
      data: {
        areaActivityId: area.id,
        kind: ActivityKind.NEIGHBORHOOD_WALK,
        name: 'E2E Fixture Family',
      },
    });

    const poi1 = await this.prisma.activity.create({
      data: {
        name: 'E2E Fixture Stop 1',
        kind: ActivityKind.POI,
        latitude: BASE_LAT,
        longitude: BASE_LNG,
      },
    });
    const poi2 = await this.prisma.activity.create({
      data: {
        name: 'E2E Fixture Stop 2',
        kind: ActivityKind.POI,
        latitude: BASE_LAT + 0.001,
        longitude: BASE_LNG + 0.001,
      },
    });
    const poi3 = await this.prisma.activity.create({
      data: {
        name: 'E2E Fixture Stop 3',
        kind: ActivityKind.POI,
        latitude: BASE_LAT + 0.002,
        longitude: BASE_LNG - 0.001,
      },
    });

    // linestring boundary-kind means a top-level ROUTE (its own trace IS
    // the content, e.g. "Pasear por Caminito") — no waypoints. Every other
    // kind (including 'none') is a NEIGHBORHOOD_WALK with real waypoint
    // stops; a Polygon/MultiPolygon boundary on a NEIGHBORHOOD_WALK isn't
    // something live generation ever produces (only kind=AREA gets one) but
    // nothing in the schema forbids it, and it's exactly the shape the
    // Fase 6 polygon-rendering pipeline needs to be exercised against.
    const isRoute = boundaryKind === 'linestring';
    const variant = await this.prisma.activity.create({
      data: {
        name: isRoute ? 'E2E Fixture Route' : 'E2E Fixture Walk',
        description: 'Seeded for a frontend e2e test.',
        kind: isRoute ? ActivityKind.ROUTE : ActivityKind.NEIGHBORHOOD_WALK,
        variantTheme: VariantTheme.HISTORY,
        boundary: boundaryFor(boundaryKind),
        familyId: isRoute ? undefined : family.id,
        latitude: BASE_LAT,
        longitude: BASE_LNG,
      },
    });

    const snapshotWaypoints = isRoute
      ? []
      : [poi1, poi2, poi3].slice(0, waypointCount);
    if (snapshotWaypoints.length > 0) {
      await this.prisma.activityWaypoint.createMany({
        data: snapshotWaypoints.map((wp, index) => ({
          compositeActivityId: variant.id,
          waypointActivityId: wp.id,
          order: index + 1,
        })),
      });
    }

    const tour = await this.prisma.tour.create({
      data: {
        name: tourName || 'E2E Fixture Tour',
        description: 'Seeded directly for a frontend e2e test.',
        ownerId: owner.id,
        totalDays: 1,
        metadata: {
          generationStatus: 'completed',
          generationMessage: 'Seeded fixture, not really generated.',
        } as unknown as Prisma.InputJsonValue,
      },
    });
    const tourActivity = await this.prisma.tourActivity.create({
      data: {
        tourId: tour.id,
        activityId: variant.id,
        activityName: variant.name,
        activityType: variant.kind,
        activityLatitude: variant.latitude,
        activityLongitude: variant.longitude,
        notes: 'A themed walk through the fixture area.',
        dayNumber: 1,
        order: 1,
      },
    });
    if (snapshotWaypoints.length > 0) {
      await this.prisma.tourActivityWaypoint.createMany({
        data: snapshotWaypoints.map((wp, index) => ({
          tourActivityId: tourActivity.id,
          waypointActivityId: wp.id,
          order: index + 1,
        })),
      });
    }

    // Simulates the variant's shared/live content being edited (curated)
    // AFTER this tour was generated — the TourActivityWaypoint snapshot
    // above must stay frozen at [poi1, poi2] regardless of this update, per
    // composite-stop-rendering.spec.ts's "snapshot stays stable in time"
    // case.
    if (options.simulateLaterEdit && !isRoute) {
      await this.compositeActivityService.updateVariantWaypoints(variant.id, [
        poi2.id,
        poi3.id,
        poi1.id,
      ]);
    }

    const fixture = {
      tourId: tour.id,
      tourActivityId: tourActivity.id,
      variantId: variant.id,
      areaId: area.id,
      familyId: family.id,
      waypointIds: snapshotWaypoints.map((wp) => wp.id),
      liveWaypointIdsAfterEdit: options.simulateLaterEdit
        ? [poi2.id, poi3.id, poi1.id]
        : undefined,
    };

    this.logger.log(`Seeded e2e composite fixture for tour ${tour.id}.`);
    // The one line the Playwright-side helper actually parses — deliberately
    // plain console.log (not this.logger), so it isn't prefixed/formatted.
    console.log(`E2E_FIXTURE_JSON:${JSON.stringify(fixture)}`);
  }

  @Option({
    flags: '--owner-email <ownerEmail>',
    description:
      'Email of an existing User (created via the real auth flow) to own the fixture tour',
  })
  parseOwnerEmail(val: string): string {
    return val;
  }

  @Option({
    flags: '--boundary-kind <boundaryKind>',
    description:
      'none|polygon|polygon-hole|multipolygon|linestring — shape of the composite stop’s own Activity.boundary',
  })
  parseBoundaryKind(val: string): BoundaryKind {
    return val as BoundaryKind;
  }

  @Option({
    flags: '--simulate-later-edit',
    description:
      "Edit the variant's live waypoints after creating the tour, to test that the tour's own snapshot stays stable",
  })
  parseSimulateLaterEdit(): boolean {
    return true;
  }

  @Option({
    flags: '--tour-name <tourName>',
    description: 'Override the seeded tour name',
  })
  parseTourName(val: string): string {
    return val;
  }

  @Option({
    flags: '--waypoint-count <waypointCount>',
    description:
      'Number of waypoints in the snapshot/live content — 2 (default) or 3',
  })
  parseWaypointCount(val: string): number {
    return Number(val);
  }
}
