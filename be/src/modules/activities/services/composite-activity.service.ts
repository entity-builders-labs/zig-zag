import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import { VectorStoreService } from '@shared/ai/services/vector-store.service';
import {
  Activity,
  ActivityFamily,
  ActivityKind,
  VariantTheme,
  Prisma,
} from '@prisma/client';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { MIN_WAYPOINTS_FOR_MULTI_STOP } from '@tours/utils/composite-activity-verification.util';

export interface NarrativeSource {
  qid: string;
  label?: string;
  extract?: string;
}

export interface CreateOrReuseCompositeInput {
  name: string;
  kind: ActivityKind;
  variantTheme: VariantTheme;
  themeReasoning?: string;
  areaCandidate: OsmCandidate;
  waypointIds: string[];
  candidateOsmFeaturesById: Map<string, OsmCandidate>;
  narrativeSources?: NarrativeSource[];
  /**
   * Explicit curation override (e.g. `generate-templates --update-existing`):
   * when a variant for this familyId+variantTheme already exists, replace
   * its ActivityWaypoint content with this proposal's instead of leaving it
   * untouched. Never set by live tour generation — an ordinary generation
   * call must never mutate a shared variant as a side effect.
   */
  forceUpdateWaypoints?: boolean;
}

const OSM_SOURCE_NAME = 'openstreetmap';
const OSM_SOURCE_URL = 'https://www.openstreetmap.org';
const AI_ENGINE_SOURCE_NAME = 'zigzag-activity-engine';

/**
 * Resolves and persists Area -> Family -> Variant for composite activities
 * (neighborhood walks, routes, areas), and the operations that maintain
 * them afterward. See tour-activity-generation.service.ts for where this
 * gets called from during live tour generation.
 */
@Injectable()
export class CompositeActivityService {
  private readonly logger = new Logger(CompositeActivityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vectorStoreService: VectorStoreService,
  ) {}

  /**
   * Runs `find`, and only calls `create` on a genuine miss. If two callers
   * race and both miss, the loser's `create` fails with a real unique
   * constraint violation (P2002) — caught here and resolved by re-running
   * `find` rather than left to bubble as an unhandled error. Shared by
   * every find-or-create in this service (area, family, variant) since all
   * three have the identical race.
   */
  private async findOrCreateWithRace<T>(
    find: () => Promise<T | null>,
    create: () => Promise<T>,
  ): Promise<T> {
    const existing = await find();
    if (existing) return existing;

    try {
      return await create();
    } catch (error: any) {
      if (error?.code === 'P2002') {
        const retried = await find();
        if (retried) return retried;
      }
      throw error;
    }
  }

  private async ensureSource(
    name: string,
    type: string,
    baseUrl?: string,
  ): Promise<string> {
    const source = await this.findOrCreateWithRace(
      () => this.prisma.source.findUnique({ where: { name } }),
      () => this.prisma.source.create({ data: { name, type, baseUrl } }),
    );
    return source.id;
  }

  private centroidOfPoints(points: { latitude: number; longitude: number }[]): {
    latitude: number;
    longitude: number;
  } {
    const latitude =
      points.reduce((sum, p) => sum + p.latitude, 0) / points.length;
    const longitude =
      points.reduce((sum, p) => sum + p.longitude, 0) / points.length;
    return { latitude, longitude };
  }

  private centroidOfGeometry(geometry: GeoJsonGeometry): {
    latitude: number;
    longitude: number;
  } {
    const ring: [number, number][] =
      geometry.type === 'LineString'
        ? geometry.coordinates
        : geometry.type === 'Polygon'
          ? geometry.coordinates[0]
          : geometry.coordinates[0][0];

    const longitude = ring.reduce((sum, [lon]) => sum + lon, 0) / ring.length;
    const latitude = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
    return { latitude, longitude };
  }

  /**
   * Materializes an OSM boundary candidate as a real, recommendable
   * `kind: AREA` Activity, or reuses the existing one for that boundary —
   * this is what ActivityFamily.areaActivityId ultimately points to.
   */
  async resolveArea(candidate: OsmCandidate): Promise<Activity> {
    const sourceId = await this.ensureSource(
      OSM_SOURCE_NAME,
      'external',
      OSM_SOURCE_URL,
    );
    const externalId = `${candidate.osmType}/${candidate.osmId}`;
    const centroid = this.centroidOfGeometry(candidate.geometry);

    return this.findOrCreateWithRace(
      () =>
        this.prisma.activity.findUnique({
          where: { sourceId_externalId: { sourceId, externalId } },
        }),
      () =>
        this.prisma.activity.create({
          data: {
            name: candidate.name,
            kind: ActivityKind.AREA,
            boundary: candidate.geometry as unknown as Prisma.InputJsonValue,
            latitude: centroid.latitude,
            longitude: centroid.longitude,
            source: { connect: { id: sourceId } },
            externalId,
          },
        }),
    );
  }

  /**
   * Finds or creates the ActivityFamily container for an area+kind pair.
   * `@@unique([areaActivityId, kind])` is what makes this dedupe-safe
   * under concurrent generations targeting the same area.
   */
  async resolveFamily(
    areaActivityId: string,
    kind: ActivityKind,
    familyName: string,
  ): Promise<ActivityFamily> {
    return this.findOrCreateWithRace(
      () =>
        this.prisma.activityFamily.findUnique({
          where: { areaActivityId_kind: { areaActivityId, kind } },
        }),
      () =>
        this.prisma.activityFamily.create({
          data: { areaActivityId, kind, name: familyName },
        }),
    );
  }

  /**
   * Resolves a single waypoint reference to a real, persisted Activity — a
   * UUID is an existing Activity, used as-is. An "osm:way:…"/
   * "osm:relation:…" token gets materialized as `kind: ROUTE` (never
   * `POI` — a street/way isn't a point) with its own `boundary` set to
   * that feature's real geometry, reusing the same dedup as resolveArea.
   */
  private async resolveWaypointActivity(
    waypointId: string,
    candidateOsmFeaturesById: Map<string, OsmCandidate>,
  ): Promise<Activity> {
    if (!waypointId.startsWith('osm:')) {
      const existing = await this.prisma.activity.findUnique({
        where: { id: waypointId },
      });
      if (!existing) {
        throw new Error(
          `Waypoint id "${waypointId}" does not exist as a real Activity`,
        );
      }
      return existing;
    }

    const candidate = candidateOsmFeaturesById.get(waypointId);
    if (!candidate) {
      throw new Error(
        `OSM waypoint token "${waypointId}" was not in the offered candidate set`,
      );
    }

    const sourceId = await this.ensureSource(
      OSM_SOURCE_NAME,
      'external',
      OSM_SOURCE_URL,
    );
    const externalId = `${candidate.osmType}/${candidate.osmId}`;
    const centroid = this.centroidOfGeometry(candidate.geometry);

    return this.findOrCreateWithRace(
      () =>
        this.prisma.activity.findUnique({
          where: { sourceId_externalId: { sourceId, externalId } },
        }),
      () =>
        this.prisma.activity.create({
          data: {
            name: candidate.name,
            kind: ActivityKind.ROUTE,
            boundary: candidate.geometry as unknown as Prisma.InputJsonValue,
            latitude: centroid.latitude,
            longitude: centroid.longitude,
            source: { connect: { id: sourceId } },
            externalId,
          },
        }),
    );
  }

  /**
   * Resolves the boundary + real waypoint Activities for a composite
   * proposal — shared by both the create path and the forceUpdateWaypoints
   * path of createOrReuseComposite, since both need the exact same
   * ROUTE-vs-other-kind resolution rules.
   */
  private async resolveWaypointsForComposite(
    kind: ActivityKind,
    waypointIds: string[],
    candidateOsmFeaturesById: Map<string, OsmCandidate>,
  ): Promise<{
    boundary: GeoJsonGeometry | null;
    waypointActivities: Activity[];
  }> {
    if (kind === ActivityKind.ROUTE) {
      const osmIds = waypointIds.filter((id) =>
        candidateOsmFeaturesById.has(id),
      );
      const activityIds = waypointIds.filter(
        (id) => !candidateOsmFeaturesById.has(id),
      );
      const primaryOsmCandidate = osmIds[0]
        ? candidateOsmFeaturesById.get(osmIds[0])
        : undefined;
      const boundary = primaryOsmCandidate?.geometry ?? null;
      const waypointActivities = await Promise.all(
        activityIds.map((id) =>
          this.resolveWaypointActivity(id, candidateOsmFeaturesById),
        ),
      );
      return { boundary, waypointActivities };
    }

    const waypointActivities = await Promise.all(
      waypointIds.map((id) =>
        this.resolveWaypointActivity(id, candidateOsmFeaturesById),
      ),
    );
    return { boundary: null, waypointActivities };
  }

  /**
   * The main entry point: resolves Area -> Family -> Variant for a
   * verified composite proposal. If the variant (identified by
   * familyId+variantTheme, never by its waypoint set) already exists, it's
   * reused exactly as-is — reusing a variant never overwrites its
   * ActivityWaypoint content as a side effect of an ordinary generation
   * call; only updateVariantWaypoints() (deliberate curation) may do that.
   */
  async createOrReuseComposite(
    input: CreateOrReuseCompositeInput,
  ): Promise<Activity> {
    const area = await this.resolveArea(input.areaCandidate);
    const family = await this.resolveFamily(
      area.id,
      input.kind,
      `${area.name} Walk`,
    );

    const aiSourceId = await this.ensureSource(AI_ENGINE_SOURCE_NAME, 'ai');
    const externalId = `variant:${family.id}:${input.variantTheme}`;

    const existing = await this.prisma.activity.findUnique({
      where: { sourceId_externalId: { sourceId: aiSourceId, externalId } },
    });
    if (existing) {
      if (!input.forceUpdateWaypoints) {
        this.logger.debug(
          `Reusing existing variant ${existing.id} (${externalId}) — not overwriting its content.`,
        );
        return existing;
      }
      this.logger.debug(
        `Updating existing variant ${existing.id} (${externalId}) content (forceUpdateWaypoints=true).`,
      );
      const { waypointActivities } = await this.resolveWaypointsForComposite(
        input.kind,
        input.waypointIds,
        input.candidateOsmFeaturesById,
      );
      return this.updateVariantWaypoints(
        existing.id,
        waypointActivities.map((a) => a.id),
      );
    }

    // For a top-level ROUTE, an OSM-token waypointId contributes its
    // geometry directly to this variant's own boundary — no
    // self-referential ActivityWaypoint would make sense. Only real,
    // pre-existing Activity ids become actual ActivityWaypoint stops along
    // it. For any other composite kind, every waypointId becomes a real
    // stop, materializing OSM tokens into their own Activity rows first.
    const { boundary, waypointActivities } =
      await this.resolveWaypointsForComposite(
        input.kind,
        input.waypointIds,
        input.candidateOsmFeaturesById,
      );

    const centroid = boundary
      ? this.centroidOfGeometry(boundary)
      : this.centroidOfPoints(
          waypointActivities.map((a) => ({
            latitude: a.latitude as number,
            longitude: a.longitude as number,
          })),
        );

    const created = await this.findOrCreateWithRace(
      () =>
        this.prisma.activity.findUnique({
          where: { sourceId_externalId: { sourceId: aiSourceId, externalId } },
        }),
      () =>
        this.prisma.$transaction(async (tx) => {
          const variant = await tx.activity.create({
            data: {
              name: input.name,
              description: input.themeReasoning,
              kind: input.kind,
              variantTheme: input.variantTheme,
              boundary: boundary
                ? (boundary as unknown as Prisma.InputJsonValue)
                : undefined,
              family: { connect: { id: family.id } },
              latitude: centroid.latitude,
              longitude: centroid.longitude,
              source: { connect: { id: aiSourceId } },
              externalId,
              metadata: input.narrativeSources?.length
                ? ({
                    narrativeSources: input.narrativeSources,
                  } as unknown as Prisma.InputJsonValue)
                : undefined,
            },
          });

          if (waypointActivities.length > 0) {
            await tx.activityWaypoint.createMany({
              data: waypointActivities.map((wp, index) => ({
                compositeActivityId: variant.id,
                waypointActivityId: wp.id,
                order: index + 1,
              })),
            });
          }

          return variant;
        }),
    );

    await this.vectorStoreService.saveActivityEmbedding([created]);
    return created;
  }

  /**
   * "These two IDs always represented the same real place" (e.g. a crawl
   * duplicate) — repoints oldPoiId -> canonicalPoiId in BOTH
   * ActivityWaypoint (live variant content) and TourActivityWaypoint
   * (historical tour snapshots). Correct to touch history here: nothing
   * shown to a user is changing, only how it's referenced. Dedupes if the
   * canonical id was already a waypoint of the same composite/tour.
   */
  async mergeWaypointIdentity(
    oldPoiId: string,
    canonicalPoiId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const waypointRows = await tx.activityWaypoint.findMany({
        where: { waypointActivityId: oldPoiId },
      });
      for (const row of waypointRows) {
        const duplicate = await tx.activityWaypoint.findUnique({
          where: {
            compositeActivityId_waypointActivityId: {
              compositeActivityId: row.compositeActivityId,
              waypointActivityId: canonicalPoiId,
            },
          },
        });
        if (duplicate) {
          await tx.activityWaypoint.delete({ where: { id: row.id } });
        } else {
          await tx.activityWaypoint.update({
            where: { id: row.id },
            data: { waypointActivityId: canonicalPoiId },
          });
        }
      }

      const snapshotRows = await tx.tourActivityWaypoint.findMany({
        where: { waypointActivityId: oldPoiId },
      });
      for (const row of snapshotRows) {
        const duplicate = await tx.tourActivityWaypoint.findUnique({
          where: {
            tourActivityId_waypointActivityId: {
              tourActivityId: row.tourActivityId,
              waypointActivityId: canonicalPoiId,
            },
          },
        });
        if (duplicate) {
          await tx.tourActivityWaypoint.delete({ where: { id: row.id } });
        } else {
          await tx.tourActivityWaypoint.update({
            where: { id: row.id },
            data: { waypointActivityId: canonicalPoiId },
          });
        }
      }
    });
  }

  /**
   * "This POI is retired from the catalog" (editorial decision, not an
   * identity correction) — removes references ONLY from ActivityWaypoint
   * (live content), NEVER TourActivityWaypoint: a generated tour is a
   * historical record of what a user was shown, and must not change
   * retroactively. Archives the POI itself, and any NEIGHBORHOOD_WALK/
   * EXPERIENCE variant that falls below its minimum viable waypoint count
   * as a result (ROUTE has no such minimum).
   */
  async removeWaypointFromActiveVariants(poiId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const affectedRows = await tx.activityWaypoint.findMany({
        where: { waypointActivityId: poiId },
      });
      const affectedCompositeIds = Array.from(
        new Set(affectedRows.map((row) => row.compositeActivityId)),
      );

      await tx.activityWaypoint.deleteMany({
        where: { waypointActivityId: poiId },
      });
      await tx.activity.update({
        where: { id: poiId },
        data: { isArchived: true },
      });

      for (const compositeId of affectedCompositeIds) {
        const composite = await tx.activity.findUnique({
          where: { id: compositeId },
        });
        if (!composite || composite.kind === ActivityKind.ROUTE) continue;

        const remaining = await tx.activityWaypoint.count({
          where: { compositeActivityId: compositeId },
        });
        if (remaining < MIN_WAYPOINTS_FOR_MULTI_STOP) {
          await tx.activity.update({
            where: { id: compositeId },
            data: { isArchived: true },
          });
        }
      }
    });
  }

  /**
   * Deliberate curation (e.g. `generate-templates --update-existing`):
   * replaces a variant's ActivityWaypoint content wholesale and
   * regenerates its embedding, since the content changed. Unlike
   * mergeWaypointIdentity, never touches TourActivityWaypoint of past
   * tours — this is a forward-looking content update to the shared
   * variant, not a retroactive identity correction.
   */
  async updateVariantWaypoints(
    variantId: string,
    waypointActivityIds: string[],
  ): Promise<Activity> {
    const variant = await this.prisma.$transaction(async (tx) => {
      await tx.activityWaypoint.deleteMany({
        where: { compositeActivityId: variantId },
      });
      if (waypointActivityIds.length > 0) {
        await tx.activityWaypoint.createMany({
          data: waypointActivityIds.map((id, index) => ({
            compositeActivityId: variantId,
            waypointActivityId: id,
            order: index + 1,
          })),
        });
      }
      return tx.activity.update({
        where: { id: variantId },
        data: { updatedAt: new Date() },
      });
    });

    await this.vectorStoreService.saveActivityEmbedding([variant]);
    return variant;
  }
}
