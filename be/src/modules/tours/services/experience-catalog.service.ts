import { Injectable } from '@nestjs/common';
import { ExperienceStatus, GeoEntityKind, Prisma } from '@prisma/client';
import { PrismaService } from '@core/database/prisma.service';

export interface GeoEntityInput {
  name: string;
  kind: GeoEntityKind;
  provider: string;
  externalId: string;
  latitude?: number;
  longitude?: number;
  geometry?: unknown;
  address?: string;
  metadata?: unknown;
}

export interface VerifiedExperienceInput {
  canonicalName: string;
  description?: string;
  durationMinutes?: number;
  qualityScore?: number;
  latitude?: number;
  longitude?: number;
  metadata?: unknown;
  components: Array<{
    geoEntityId: string;
    order?: number;
    role?: string;
    required?: boolean;
  }>;
  evidence?: Array<{
    source: string;
    url?: string;
    title?: string;
    snippet?: string;
  }>;
  traitDefinitionIds?: string[];
}

/**
 * Persistence boundary for the V2 verified catalog. Provider identities are
 * resolved before this service is called; this class never searches providers
 * and never upgrades an unverified candidate by itself.
 */
@Injectable()
export class ExperienceCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertGeoEntity(input: GeoEntityInput) {
    const identity = await this.prisma.geoEntityIdentity.findUnique({
      where: {
        provider_externalId: {
          provider: input.provider,
          externalId: input.externalId,
        },
      },
      select: { geoEntityId: true },
    });

    const data = {
      name: input.name,
      kind: input.kind,
      latitude: input.latitude,
      longitude: input.longitude,
      geometry: input.geometry as Prisma.InputJsonValue | undefined,
      address: input.address,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    };

    if (identity) {
      return this.prisma.geoEntity.update({
        where: { id: identity.geoEntityId },
        data,
      });
    }

    return this.prisma.geoEntity.create({
      data: {
        ...data,
        identities: {
          create: {
            provider: input.provider,
            externalId: input.externalId,
          },
        },
      },
    });
  }

  async persistVerifiedExperience(input: VerifiedExperienceInput) {
    if (input.components.length === 0) {
      throw new Error('A verified Experience requires at least one component');
    }

    return this.prisma.$transaction(async (tx) => {
      const experience = await tx.experience.create({
        data: {
          canonicalName: input.canonicalName,
          description: input.description,
          durationMinutes: input.durationMinutes,
          qualityScore: input.qualityScore,
          latitude: input.latitude,
          longitude: input.longitude,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
          status: ExperienceStatus.VERIFIED,
          components: {
            create: input.components.map((component) => ({
              geoEntityId: component.geoEntityId,
              order: component.order,
              role: component.role,
              required: component.required ?? true,
            })),
          },
          evidence: input.evidence?.length
            ? { create: input.evidence }
            : undefined,
          traits: input.traitDefinitionIds?.length
            ? {
                create: input.traitDefinitionIds.map((traitDefinitionId) => ({
                  traitDefinitionId,
                })),
              }
            : undefined,
        },
        include: { components: true, evidence: true, traits: true },
      });

      return experience;
    });
  }

  /** Transitional idempotent bridge used by the tour worker. */
  async persistActivityAsExperience(
    tx: Prisma.TransactionClient,
    activity: {
      id: string;
      name: string;
      description?: string | null;
      duration?: number | null;
      latitude?: number | null;
      longitude?: number | null;
      type?: string | null;
      kind: string;
      boundary?: unknown;
    },
    waypointIds: string[] = [],
  ) {
    const componentActivities = waypointIds.length
      ? await tx.activity.findMany({
          where: { id: { in: waypointIds } },
          select: { id: true, name: true, latitude: true, longitude: true, kind: true, boundary: true },
        })
      : [activity];

    const components = [];
    for (const component of componentActivities) {
      const identity = await tx.geoEntityIdentity.findUnique({
        where: { provider_externalId: { provider: 'legacy_activity', externalId: component.id } },
        select: { geoEntityId: true },
      });
      const data = {
        name: component.name,
        kind: this.geoEntityKind(component.kind),
        latitude: component.latitude ?? undefined,
        longitude: component.longitude ?? undefined,
        geometry: component.boundary as Prisma.InputJsonValue | undefined,
      };
      const geoEntity = identity
        ? await tx.geoEntity.update({ where: { id: identity.geoEntityId }, data })
        : await tx.geoEntity.create({
            data: {
              ...data,
              identities: { create: { provider: 'legacy_activity', externalId: component.id } },
            },
          });
      components.push({ geoEntityId: geoEntity.id, order: components.length + 1 });
    }

    return tx.experience.upsert({
      where: { id: activity.id },
      create: {
        id: activity.id,
        canonicalName: activity.name,
        description: activity.description ?? undefined,
        durationMinutes: activity.duration ? Math.round(activity.duration * 60) : undefined,
        latitude: activity.latitude ?? undefined,
        longitude: activity.longitude ?? undefined,
        status: ExperienceStatus.VERIFIED,
        metadata: { migratedFromActivityId: activity.id, type: activity.type },
        components: { create: components },
      },
      update: {
        canonicalName: activity.name,
        description: activity.description ?? undefined,
        status: ExperienceStatus.VERIFIED,
        components: { deleteMany: {}, create: components },
      },
      include: { components: true },
    });
  }

  private geoEntityKind(kind: string): GeoEntityKind {
    if (kind === 'AREA') return GeoEntityKind.AREA;
    if (kind === 'ROUTE') return GeoEntityKind.ROUTE;
    return GeoEntityKind.PLACE;
  }
}
