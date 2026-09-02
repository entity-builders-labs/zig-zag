import { Injectable, Inject } from '@nestjs/common';
import { ExperienceStatus, GeoEntityKind, Prisma } from '@prisma/client';
import { PrismaService } from '@core/database/prisma.service';
import { IPlacesApiService } from '@integrations/google-places/interfaces/places-api.interface';
import {
  decideExperienceDedupe,
  DedupeExperienceFingerprint,
} from '../utils/experience-dedupe.util';

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
  price?: number;
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
 * resolved before this service is called; this class never upgrades an
 * unresolved proposal into a verified Experience.
 */
@Injectable()
export class ExperienceCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject('PlacesApiService') private readonly placesApi: IPlacesApiService,
  ) {}

  private isAdmissiblePlace(place: any): boolean {
    const tourismTypes = new Set([
      'tourist_attraction',
      'museum',
      'art_gallery',
      'park',
      'national_park',
      'historical_landmark',
      'historical_place',
      'church',
      'zoo',
      'aquarium',
      'amusement_park',
      'observation_deck',
      'visitor_center',
      'cultural_center',
      'restaurant',
      'winery',
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
      if (!place.location || !place.id || !this.isAdmissiblePlace(place)) continue;
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
        metadata: {
          source: 'places_acquisition',
          provider: result.provenance.provider,
          placeId: place.id,
          themes: input.interests ?? [],
        },
        components: [{ geoEntityId: entity.id, role: 'venue', required: true }],
        evidence: [
          {
            source: result.provenance.provider,
            title: place.displayName?.text ?? place.name,
            snippet: place.formattedAddress,
          },
        ],
      });
      if ((experience as any).dedupeDecision === 'AMBIGUOUS') continue;
      acquired.push({
        id: experience.id,
        name: (experience as any).canonicalName,
        latitude: (experience as any).latitude,
        longitude: (experience as any).longitude,
        duration: 1.5,
        metadata: { source: 'experience_catalog', experienceId: experience.id },
        components: (experience as any).components,
      });
    }
    return {
      experienceIds: acquired.map((item) => item.id),
      experiences: acquired,
      provenance: result.provenance,
    };
  }

  async findVerifiedWithin(
    latitude: number,
    longitude: number,
    radiusMeters: number,
    limit = 100,
  ) {
    const experiences = await this.prisma.experience.findMany({
      where: { status: ExperienceStatus.VERIFIED },
      include: {
        components: { include: { geoEntity: true } },
        traits: { include: { traitDefinition: true } },
      },
      take: limit * 4,
      orderBy: { qualityScore: 'desc' },
    });
    const radiusSquared = radiusMeters * radiusMeters;
    return experiences
      .map((experience) => {
        const component = experience.components.find(
          (item) =>
            Number.isFinite(item.geoEntity.latitude) &&
            Number.isFinite(item.geoEntity.longitude),
        )?.geoEntity;
        const lat = experience.latitude ?? component?.latitude;
        const lon = experience.longitude ?? component?.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
        const distanceSquared =
          ((lat! - latitude) * 111_000) ** 2 +
          ((lon! - longitude) *
            111_000 *
            Math.cos((latitude * Math.PI) / 180)) ** 2;
        if (distanceSquared > radiusSquared) return undefined;
        const metadata = this.objectMetadata(experience.metadata);
        return {
          id: experience.id,
          name: experience.canonicalName,
          canonicalName: experience.canonicalName,
          description: experience.description,
          qualityScore: experience.qualityScore,
          latitude: lat,
          longitude: lon,
          distance: Math.sqrt(distanceSquared) / 1000,
          duration: (experience.durationMinutes ?? 120) / 60,
          durationMinutes: experience.durationMinutes,
          themes: this.stringList(metadata.themes),
          intents: this.stringList(metadata.intents ?? metadata.archetypes),
          traits: experience.traits.flatMap((trait) =>
            [trait.traitDefinition.label, trait.traitDefinition.key].filter(
              (value): value is string => !!value,
            ),
          ),
          metadata: { ...metadata, source: 'experience_catalog', experienceId: experience.id },
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
      const componentIds = [...new Set(input.components.map((component) => component.geoEntityId))].sort();
      const identityLock = `${normalizedName}|${componentIds.join('|')}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${identityLock}))`;

      const existing = await tx.experience.findMany({
        where: {
          status: ExperienceStatus.VERIFIED,
          OR: [
            { canonicalName: { equals: input.canonicalName, mode: 'insensitive' } },
            { components: { some: { geoEntityId: { in: componentIds } } } },
          ],
        },
        include: {
          components: true,
          evidence: true,
          traits: true,
        },
        take: 50,
      });

      const incomingFingerprint: DedupeExperienceFingerprint = {
        canonicalName: input.canonicalName,
        latitude: input.latitude,
        longitude: input.longitude,
        components: input.components,
        provenance: (input.evidence ?? []).map((item) => item.source),
      };
      const decision = decideExperienceDedupe(
        incomingFingerprint,
        existing.map((candidate) => ({
          id: candidate.id,
          canonicalName: candidate.canonicalName,
          latitude: candidate.latitude,
          longitude: candidate.longitude,
          components: candidate.components,
          provenance: candidate.evidence.map((item) => item.source),
        })),
      );

      if (decision.decision === 'AMBIGUOUS') {
        return {
          id: decision.candidates[0],
          dedupeDecision: 'AMBIGUOUS' as const,
          dedupeEvidence: decision.evidence,
          dedupeCandidates: decision.candidates,
        };
      }

      if (decision.decision === 'SAME') {
        const same = existing.find(
          (candidate) => candidate.id === decision.canonicalExperienceId,
        );
        if (!same) {
          throw new Error('Dedupe SAME referenced an Experience outside the candidate set');
        }

        const knownEvidence = new Set(
          same.evidence.map(
            (item) => `${item.source}|${item.url ?? ''}|${item.title ?? ''}`,
          ),
        );
        const missingEvidence = (input.evidence ?? []).filter(
          (item) =>
            !knownEvidence.has(
              `${item.source}|${item.url ?? ''}|${item.title ?? ''}`,
            ),
        );
        if (missingEvidence.length) {
          await tx.experienceEvidence.createMany({
            data: missingEvidence.map((item) => ({ ...item, experienceId: same.id })),
          });
        }

        if (input.traitDefinitionIds?.length) {
          await tx.experienceTrait.createMany({
            data: input.traitDefinitionIds.map((traitDefinitionId) => ({
              experienceId: same.id,
              traitDefinitionId,
            })),
            skipDuplicates: true,
          });
        }

        const updated = await tx.experience.update({
          where: { id: same.id },
          data: {
            description: this.preferRicherText(same.description, input.description),
            durationMinutes: input.durationMinutes ?? same.durationMinutes,
            price: input.price ?? same.price,
            qualityScore: Math.max(same.qualityScore ?? 0, input.qualityScore ?? 0) || null,
            latitude: input.latitude ?? same.latitude,
            longitude: input.longitude ?? same.longitude,
            metadata: this.mergeMetadata(same.metadata, input.metadata),
            // Any material enrichment invalidates the previous semantic vector.
            embedding: Prisma.DbNull as never,
            embeddingProvider: null,
            embeddingModel: null,
            embeddingDimensions: null,
            embeddingDocumentVersion: null,
            embeddedAt: null,
          },
          include: { components: true, evidence: true, traits: true },
        });
        return {
          ...updated,
          dedupeDecision: 'SAME' as const,
          dedupeEvidence: decision.evidence,
          semanticDocumentChanged: true,
        };
      }

      const experience = await tx.experience.create({
        data: {
          canonicalName: input.canonicalName,
          description: input.description,
          durationMinutes: input.durationMinutes,
          price: input.price,
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
          evidence: input.evidence?.length ? { create: input.evidence } : undefined,
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

      return {
        ...experience,
        dedupeDecision: 'NEW' as const,
        dedupeEvidence: decision.evidence,
        semanticDocumentChanged: true,
      };
    });
  }

  private preferRicherText(current?: string | null, incoming?: string): string | null | undefined {
    if (!incoming?.trim()) return current;
    if (!current?.trim()) return incoming;
    return incoming.trim().length > current.trim().length ? incoming : current;
  }

  private mergeMetadata(current: unknown, incoming: unknown): Prisma.InputJsonValue | undefined {
    const left = this.objectMetadata(current);
    const right = this.objectMetadata(incoming);
    const merged = { ...left, ...right };
    return Object.keys(merged).length ? (merged as Prisma.InputJsonValue) : undefined;
  }

  private objectMetadata(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, any>)
      : {};
  }

  private stringList(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }
}
