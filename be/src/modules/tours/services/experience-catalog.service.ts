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

  private geoEntityKind(kind: string): GeoEntityKind {
    if (kind === 'AREA') return GeoEntityKind.AREA;
    if (kind === 'ROUTE') return GeoEntityKind.ROUTE;
    return GeoEntityKind.PLACE;
  }
}
