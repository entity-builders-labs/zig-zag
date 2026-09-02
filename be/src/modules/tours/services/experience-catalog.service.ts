import { Injectable, Inject } from '@nestjs/common';
import { ExperienceStatus, GeoEntityKind, Prisma } from '@prisma/client';
import { PrismaService } from '@core/database/prisma.service';
import { IPlacesApiService } from '@integrations/google-places/interfaces/places-api.interface';

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
  constructor(
    private readonly prisma: PrismaService,
    @Inject('PlacesApiService') private readonly placesApi: IPlacesApiService,
  ) {}

  private isAdmissiblePlace(place: any): boolean {
    const tourismTypes = new Set([
      'tourist_attraction', 'museum', 'art_gallery', 'park', 'national_park',
      'historical_landmark', 'historical_place', 'church', 'zoo', 'aquarium',
      'amusement_park', 'observation_deck', 'visitor_center', 'cultural_center',
    ]);
    const types = [place.primaryType, ...(place.types ?? [])].filter(Boolean);
    return types.some((type) => tourismTypes.has(type));
  }

  async acquireNearbyAsExperiences(input: {
    latitude: number;
    longitude: number;
    radius: number;
    interests?: string[];
    maxResultCount?: number;
  }) {
    const result = await this.placesApi.searchNearby({
      latitude: input.latitude,
      longitude: input.longitude,
      radius: input.radius,
      maxResultCount: input.maxResultCount ?? 20,
      rankPreference: 'POPULARITY',
    });
    const acquired = [] as any[];
    for (const place of result.data) {
      if (!place.location || !place.id) continue;
      if (!this.isAdmissiblePlace(place)) continue;
      const entity = await this.upsertGeoEntity({
        name: place.displayName?.text ?? place.name ?? place.id,
        kind: GeoEntityKind.PLACE,
        provider: result.provenance.provider,
        externalId: place.id,
        latitude: place.location.latitude,
        longitude: place.location.longitude,
        address: place.formattedAddress,
        metadata: { types: place.types, primaryType: place.primaryType },
      });
      const experience = await this.persistVerifiedExperience({
        canonicalName: place.displayName?.text ?? place.name ?? place.id,
        description: place.formattedAddress,
        durationMinutes: 90,
        latitude: place.location.latitude,
        longitude: place.location.longitude,
        qualityScore: place.rating,
        metadata: { source: 'places_acquisition', provider: result.provenance.provider, placeId: place.id, interests: input.interests ?? [] },
        components: [{ geoEntityId: entity.id, role: 'venue', required: true }],
        evidence: [{ source: result.provenance.provider, title: place.displayName?.text ?? place.name, snippet: place.formattedAddress }],
      });
      acquired.push({ id: experience.id, name: experience.canonicalName, latitude: experience.latitude, longitude: experience.longitude, duration: 1.5, metadata: { source: 'experience_catalog', experienceId: experience.id }, components: experience.components });
    }
    return { experienceIds: acquired.map((item) => item.id), experiences: acquired, provenance: result.provenance };
  }

  async findVerifiedWithin(
    latitude: number,
    longitude: number,
    radiusMeters: number,
    limit = 100,
  ) {
    const experiences = await this.prisma.experience.findMany({
      where: { status: ExperienceStatus.VERIFIED },
      include: { components: { include: { geoEntity: true } }, traits: { include: { traitDefinition: true } } },
      take: limit * 4,
      orderBy: { qualityScore: 'desc' },
    });
    const radiusSquared = radiusMeters * radiusMeters;
    return experiences
      .map((experience) => {
        const component = experience.components.find(
          (item) => Number.isFinite(item.geoEntity.latitude) && Number.isFinite(item.geoEntity.longitude),
        )?.geoEntity;
        const lat = experience.latitude ?? component?.latitude;
        const lon = experience.longitude ?? component?.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
        const distanceSquared =
          ((lat! - latitude) * 111_000) ** 2 +
          ((lon! - longitude) * 111_000 * Math.cos((latitude * Math.PI) / 180)) ** 2;
        if (distanceSquared > radiusSquared) return undefined;
        return {
          id: experience.id,
          name: experience.canonicalName,
          description: experience.description,
          qualityScore: experience.qualityScore,
          latitude: lat,
          longitude: lon,
          duration: (experience.durationMinutes ?? 120) / 60,
          themes: experience.traits.map((trait) => trait.traitDefinition.label),
          traits: experience.traits.map((trait) => trait.traitDefinition.label),
          metadata: { source: 'experience_catalog', experienceId: experience.id },
          components: experience.components,
        };
      })
      .filter((experience): experience is NonNullable<typeof experience> => !!experience)
      .slice(0, limit);
  }

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
      const normalizedName = input.canonicalName.trim().toLocaleLowerCase();
      // Serialize the identity check for concurrent discovery/refill workers.
      // The lock is transaction-scoped and does not require a legacy column or
      // a product-visible compatibility key.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${normalizedName}))`;
      const existing = await tx.experience.findMany({
        where: { status: ExperienceStatus.VERIFIED },
        include: { components: true, evidence: true, traits: true },
      });
      const same = existing.find((candidate) => {
        const candidateName = candidate.canonicalName.trim().toLocaleLowerCase();
        const sharedComponent = candidate.components.some((component) =>
          input.components.some((incoming) => incoming.geoEntityId === component.geoEntityId),
        );
        return candidateName === normalizedName && sharedComponent;
      });
      if (same) {
        const knownEvidence = new Set(same.evidence.map((item) => `${item.source}|${item.url ?? ''}|${item.title ?? ''}`));
        const missingEvidence = (input.evidence ?? []).filter((item) => !knownEvidence.has(`${item.source}|${item.url ?? ''}|${item.title ?? ''}`));
        if (missingEvidence.length) {
          await tx.experienceEvidence.createMany({ data: missingEvidence.map((item) => ({ ...item, experienceId: same.id })) });
        }
        return { ...same, dedupeDecision: 'SAME' as const };
      }
      const sameName = existing.find((candidate) => candidate.canonicalName.trim().toLocaleLowerCase() === normalizedName);
      if (sameName) {
        return { ...sameName, dedupeDecision: 'AMBIGUOUS' as const };
      }
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

      return { ...experience, dedupeDecision: 'NEW' as const };
    });
  }

  private geoEntityKind(kind: string): GeoEntityKind {
    if (kind === 'AREA') return GeoEntityKind.AREA;
    if (kind === 'ROUTE') return GeoEntityKind.ROUTE;
    return GeoEntityKind.PLACE;
  }
}
