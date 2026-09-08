import { Injectable, Inject, Logger } from '@nestjs/common';
import { ExperienceStatus, GeoEntityKind, Prisma } from '@prisma/client';
import { PrismaService } from '@core/database/prisma.service';
import { IPlacesApiService } from '@integrations/google-places/interfaces/places-api.interface';
import { NormalizedOpeningHours } from '../interfaces/daily-planning.interface';
import { parseOpeningHours } from '../utils/normalized-opening-hours.util';
import {
  distanceMeters,
  normalizeRealWorldName,
  REAL_WORLD_RECONCILIATION_RADIUS_METERS,
  realWorldNamesMatch,
} from '../utils/real-world-entity-matching.util';
import {
  decideExperienceDedupe,
  DedupeExperienceFingerprint,
} from '../utils/experience-dedupe.util';

// Two different resolution paths (a Nominatim lookup done while resolving a
// composite's `venue` component hint, a Google Places lookup done while
// acquiring the *same* real place as its own standalone POI Experience on a
// different pass) commonly mint two different (provider, externalId) pairs
// for one physical place — GeoEntityIdentity's exact-match dedupe never
// catches that, since the identities genuinely differ. Verified live: a real
// Buenos Aires plaza (Plaza Dorrego) ended up as two independent GeoEntity
// rows ~3m apart, so the same physical place was offered to a traveler twice
// in one tour (once standalone, once as a composite's component) with no way
// for the daily-planning solver to know they were the same place. Tight
// enough to not conflate two distinct, unrelated things that happen to sit
// close together (e.g. a plaza and the café facing it); wide enough to
// absorb real cross-provider geocoding jitter for the same building/plaza —
// also verified live: a real, extended place (Caminito, a ~150-200m
// pedestrian street in La Boca, not a small point) resolved ~80m apart across
// two paths and slipped past an earlier 75m radius, so this needs to cover a
// street-scale feature's own real extent, not just point jitter.
const GEO_ENTITY_RECONCILIATION_RADIUS_METERS =
  REAL_WORLD_RECONCILIATION_RADIUS_METERS;

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
  openingHours?: NormalizedOpeningHours;
  metadata?: unknown;
  components: Array<{
    geoEntityId: string;
    /** `null` (not just absent) means no intrinsic sequence evidence exists. */
    order?: number | null;
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

@Injectable()
export class ExperienceCatalogService {
  private readonly logger = new Logger(ExperienceCatalogService.name);

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
      if (!place.location || !place.id || !this.isAdmissiblePlace(place))
        continue;
      const openingHours = parseOpeningHours(place.openingHoursWeekdayText);
      const entity = await this.upsertGeoEntity({
        name: place.displayName?.text ?? place.name ?? place.id,
        kind: GeoEntityKind.PLACE,
        provider: result.provenance.provider,
        externalId: place.id,
        latitude: place.location.latitude,
        longitude: place.location.longitude,
        address: place.formattedAddress,
        metadata: {
          types: place.types,
          primaryType: place.primaryType,
          openingHoursWeekdayText: place.openingHoursWeekdayText,
        },
      });
      const experience = await this.persistVerifiedExperience({
        canonicalName: place.displayName?.text ?? place.name ?? place.id,
        description: place.formattedAddress,
        durationMinutes: 90,
        latitude: place.location.latitude,
        longitude: place.location.longitude,
        qualityScore: place.rating,
        openingHours,
        metadata: {
          source: 'places_acquisition',
          provider: result.provenance.provider,
          placeId: place.id,
          // These are hints carried from the acquisition request, not proof of
          // semantic relevance. Focused deficits are handled by grounded
          // discovery before this quantity-only refill is allowed to run.
          requestedThemes: input.interests ?? [],
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
        openingHours: (experience as any).openingHours,
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
    // This method owns geography only. Do not pre-rank the catalog by quality
    // here: doing so can discard lower-rated but highly relevant Experiences
    // before semantic/preference ranking ever sees them. Scan a bounded,
    // deterministic pool, filter by radius, then keep the geographically
    // nearest rows with a stable id tie-break. Relevance is applied later.
    const scanLimit = Math.max(limit * 4, 1000);
    const experiences = await this.prisma.experience.findMany({
      where: { status: ExperienceStatus.VERIFIED },
      include: {
        components: { include: { geoEntity: true } },
        traits: { include: { traitDefinition: true } },
      },
      take: scanLimit,
      orderBy: { id: 'asc' },
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
            Math.cos((latitude * Math.PI) / 180)) **
            2;
        if (distanceSquared > radiusSquared) return undefined;
        const metadata = this.objectMetadata(experience.metadata);
        const relationalTraits = experience.traits.flatMap((trait) =>
          [trait.traitDefinition.label, trait.traitDefinition.key].filter(
            (value): value is string => !!value,
          ),
        );
        const metadataDimensioned = Array.isArray(metadata.dimensionedTraits)
          ? (metadata.dimensionedTraits as Array<{
              dimension: string;
              key: string;
              label?: string;
            }>)
          : [];
        const dimensionedTraits = [
          ...metadataDimensioned,
          ...experience.traits.map((trait) => ({
            dimension: trait.traitDefinition.dimension,
            key: trait.traitDefinition.key,
            label: trait.traitDefinition.label ?? undefined,
          })),
        ];
        return {
          id: experience.id,
          name: experience.canonicalName,
          canonicalName: experience.canonicalName,
          description: experience.description,
          price: experience.price,
          qualityScore: experience.qualityScore,
          latitude: lat,
          longitude: lon,
          distance: Math.sqrt(distanceSquared) / 1000,
          distanceSquared,
          duration: (experience.durationMinutes ?? 120) / 60,
          durationMinutes: experience.durationMinutes,
          openingHours: experience.openingHours,
          themes: this.stringList(metadata.themes),
          intents: this.stringList(metadata.intents ?? metadata.archetypes),
          traits: Array.from(
            new Set([...this.stringList(metadata.traits), ...relationalTraits]),
          ),
          dimensionedTraits,
          metadata: {
            ...metadata,
            dimensionedTraits,
            source: 'experience_catalog',
            experienceId: experience.id,
          },
          components: experience.components,
        };
      })
      .filter(
        (experience): experience is NonNullable<typeof experience> =>
          !!experience,
      )
      .sort(
        (left, right) =>
          left.distanceSquared - right.distanceSquared ||
          left.id.localeCompare(right.id),
      )
      .slice(0, limit)
      .map(({ distanceSquared, ...experience }) => {
        void distanceSquared;
        return experience;
      });
  }

  /**
   * A single verified Experience with everything a detail screen needs:
   * resolved address (from its first geolocatable component's GeoEntity),
   * real persisted media (matches the `DocumentaryPhoto[]` shape 1:1, so the
   * frontend's existing `getPhotoGallery` needs no adaptation), and its raw
   * components for the multi-component ("composite") detail branch.
   */
  async findById(id: string) {
    const experience = await this.prisma.experience.findUnique({
      where: { id },
      include: {
        components: { include: { geoEntity: true } },
        traits: { include: { traitDefinition: true } },
        media: { orderBy: { position: 'asc' } },
      },
    });
    if (!experience || experience.status !== ExperienceStatus.VERIFIED) {
      return null;
    }
    const metadata = this.objectMetadata(experience.metadata);
    const relationalTraits = experience.traits.flatMap((trait) =>
      [trait.traitDefinition.label, trait.traitDefinition.key].filter(
        (value): value is string => !!value,
      ),
    );
    const metadataDimensioned = Array.isArray(metadata.dimensionedTraits)
      ? (metadata.dimensionedTraits as Array<{
          dimension: string;
          key: string;
          label?: string;
        }>)
      : [];
    const dimensionedTraits = [
      ...metadataDimensioned,
      ...experience.traits.map((trait) => ({
        dimension: trait.traitDefinition.dimension,
        key: trait.traitDefinition.key,
        label: trait.traitDefinition.label ?? undefined,
      })),
    ];
    const primaryGeoEntity = experience.components.find(
      (item) =>
        Number.isFinite(item.geoEntity.latitude) &&
        Number.isFinite(item.geoEntity.longitude),
    )?.geoEntity;
    return {
      id: experience.id,
      name: experience.canonicalName,
      canonicalName: experience.canonicalName,
      description: experience.description,
      price: experience.price,
      qualityScore: experience.qualityScore,
      latitude: experience.latitude ?? primaryGeoEntity?.latitude,
      longitude: experience.longitude ?? primaryGeoEntity?.longitude,
      address: primaryGeoEntity?.address,
      duration: (experience.durationMinutes ?? 120) / 60,
      durationMinutes: experience.durationMinutes,
      openingHours: experience.openingHours,
      themes: this.stringList(metadata.themes),
      intents: this.stringList(metadata.intents ?? metadata.archetypes),
      traits: Array.from(
        new Set([...this.stringList(metadata.traits), ...relationalTraits]),
      ),
      dimensionedTraits,
      metadata: {
        ...metadata,
        dimensionedTraits,
        source: 'experience_catalog',
        experienceId: experience.id,
      },
      type: this.stringList(metadata.themes)[0],
      photos: experience.media,
      mediaUpdatedAt: experience.mediaUpdatedAt,
      components: experience.components,
    };
  }

  /**
   * Resolves freeform trait strings (as emitted by discovery/extraction —
   * `ExperienceCandidate.traits: string[]`, no taxonomy) against
   * `TraitDefinition` via find-or-create, returning ids ready for
   * `persistVerifiedExperience`'s `traitDefinitionIds`. Without this, that
   * field is always empty in practice — no real caller ever populated it.
   *
   * There is no real `dimension` taxonomy for freeform trait strings today,
   * so everything buckets under `'general'`, normalizing the string into
   * `key` and keeping the original as `label`. Revisit if/when a closed
   * taxonomy is defined for the discovery prompt to emit instead.
   */
  async resolveOrCreateTraitDefinitions(traits: string[]): Promise<string[]> {
    const normalized = Array.from(
      new Set(
        traits
          .map((trait) => trait.trim())
          .filter((trait): trait is string => trait.length > 0),
      ),
    );
    if (normalized.length === 0) return [];

    const ids: string[] = [];
    for (const trait of normalized) {
      const key = trait.toLowerCase();
      const definition = await this.prisma.traitDefinition.upsert({
        where: { dimension_key: { dimension: 'general', key } },
        update: {},
        create: { dimension: 'general', key, label: trait },
      });
      ids.push(definition.id);
    }
    return ids;
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

    // No exact (provider, externalId) match — before minting a brand-new
    // GeoEntity, check whether the *same real place* already exists under a
    // different provider's identity (verified live: a Nominatim-resolved
    // composite component and a later Google-Places-resolved standalone POI
    // both named "Plaza Dorrego" ended up ~3m apart as two unrelated
    // GeoEntity rows, so the tour offered the same real plaza twice). This
    // whole "identity doesn't exist yet" section runs under one advisory
    // lock per kind so two concurrent resolutions (Promise.all in
    // ExperienceProposalResolverService) can't both race past this check —
    // matching the pattern persistVerifiedExperience already uses for its
    // own identity locks.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'geo-entity-reconcile:' + input.kind}))`;

      // Re-check now that we hold the lock: a concurrent call may have just
      // created this exact identity while we were waiting.
      const identityAfterLock = await tx.geoEntityIdentity.findUnique({
        where: {
          provider_externalId: {
            provider: input.provider,
            externalId: input.externalId,
          },
        },
        select: { geoEntityId: true },
      });
      if (identityAfterLock) {
        return tx.geoEntity.update({
          where: { id: identityAfterLock.geoEntityId },
          data,
        });
      }

      const nearbyMatch = await this.findNearbyMatchingGeoEntity(tx, input);
      if (nearbyMatch) {
        this.logger.log(
          `Reconciled "${input.name}" (${input.provider}:${input.externalId}) onto existing GeoEntity ${nearbyMatch.id} instead of creating a duplicate for the same real place`,
        );
        await tx.geoEntityIdentity.create({
          data: {
            geoEntityId: nearbyMatch.id,
            provider: input.provider,
            externalId: input.externalId,
          },
        });
        return tx.geoEntity.update({
          where: { id: nearbyMatch.id },
          data,
        });
      }

      try {
        return await tx.geoEntity.create({
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
      } catch (error) {
        // Defense in depth: the advisory lock above should make this
        // unreachable in normal operation, but a P2002 here still means
        // "someone else just created this identity" rather than a real
        // failure — recover the same way the pre-lock code path used to,
        // instead of crashing generation on it.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const winner = await tx.geoEntityIdentity.findUniqueOrThrow({
            where: {
              provider_externalId: {
                provider: input.provider,
                externalId: input.externalId,
              },
            },
            select: { geoEntityId: true },
          });
          return tx.geoEntity.update({
            where: { id: winner.geoEntityId },
            data,
          });
        }
        throw error;
      }
    });
  }

  /**
   * Finds an existing GeoEntity of the same kind, within
   * GEO_ENTITY_RECONCILIATION_RADIUS_METERS, whose name matches — the
   * cross-provider reconciliation `upsertGeoEntity` needs so the same real
   * place never ends up as two unrelated GeoEntity rows. A plain bounding-box
   * prefilter (reusing the existing `[latitude, longitude]` index) narrows
   * the candidate set before the precise Haversine + name check.
   */
  private async findNearbyMatchingGeoEntity(
    tx: Prisma.TransactionClient,
    input: GeoEntityInput,
  ) {
    if (input.latitude == null || input.longitude == null) return undefined;

    const radiusMeters = GEO_ENTITY_RECONCILIATION_RADIUS_METERS;
    const latDeltaDegrees = radiusMeters / 111_320;
    const lonDeltaDegrees =
      radiusMeters /
      (111_320 * Math.max(Math.cos((input.latitude * Math.PI) / 180), 0.01));

    const candidates = await tx.geoEntity.findMany({
      where: {
        kind: input.kind,
        latitude: {
          gte: input.latitude - latDeltaDegrees,
          lte: input.latitude + latDeltaDegrees,
        },
        longitude: {
          gte: input.longitude - lonDeltaDegrees,
          lte: input.longitude + lonDeltaDegrees,
        },
      },
    });

    let best: { id: string; distanceKm: number } | undefined;
    for (const candidate of candidates) {
      if (candidate.latitude == null || candidate.longitude == null) continue;
      if (!realWorldNamesMatch(input.name, candidate.name)) continue;

      const distMeters = distanceMeters(
        { latitude: input.latitude, longitude: input.longitude },
        { latitude: candidate.latitude, longitude: candidate.longitude },
      );
      if (distMeters > radiusMeters) continue;
      const distanceKm = distMeters / 1000;
      if (!best || distanceKm < best.distanceKm) {
        best = { id: candidate.id, distanceKm };
      }
    }

    return best ? { id: best.id } : undefined;
  }

  private normalizeGeoEntityName(value: string): string {
    return normalizeRealWorldName(value);
  }

  async persistVerifiedExperience(input: VerifiedExperienceInput) {
    if (input.components.length === 0) {
      throw new Error('A verified Experience requires at least one component');
    }

    return this.prisma.$transaction(async (tx) => {
      const normalizedName = input.canonicalName.trim().toLocaleLowerCase();
      const componentIds = [
        ...new Set(input.components.map((component) => component.geoEntityId)),
      ].sort();

      // Serialize all identity domains that can make two writes compete. Keys
      // are sorted to keep acquisition workers from deadlocking each other.
      const identityLocks = [
        `experience:name:${normalizedName}`,
        ...componentIds.map((id) => `experience:component:${id}`),
      ].sort();
      for (const identityLock of identityLocks) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${identityLock}))`;
      }

      const existing = await tx.experience.findMany({
        where: {
          status: ExperienceStatus.VERIFIED,
          OR: [
            {
              canonicalName: {
                equals: input.canonicalName,
                mode: 'insensitive',
              },
            },
            { components: { some: { geoEntityId: { in: componentIds } } } },
          ],
        },
        include: {
          components: true,
          evidence: true,
          traits: { include: { traitDefinition: true } },
        },
        take: 50,
      });

      const incomingFingerprint: DedupeExperienceFingerprint = {
        canonicalName: input.canonicalName,
        semanticTerms: this.semanticTerms(
          input.description,
          input.metadata,
          [],
        ),
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
          semanticTerms: this.semanticTerms(
            candidate.description,
            candidate.metadata,
            candidate.traits.flatMap(({ traitDefinition }) => [
              traitDefinition.label,
              traitDefinition.key,
              `${traitDefinition.dimension}:${traitDefinition.key}`,
            ]),
          ),
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
          throw new Error(
            'Dedupe SAME referenced an Experience outside the candidate set',
          );
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
            data: missingEvidence.map((item) => ({
              ...item,
              experienceId: same.id,
            })),
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
            description: this.preferRicherText(
              same.description,
              input.description,
            ),
            durationMinutes: input.durationMinutes ?? same.durationMinutes,
            price: input.price ?? same.price,
            qualityScore:
              input.qualityScore == null
                ? same.qualityScore
                : same.qualityScore == null
                  ? input.qualityScore
                  : Math.max(same.qualityScore, input.qualityScore),
            latitude: input.latitude ?? same.latitude,
            longitude: input.longitude ?? same.longitude,
            openingHours: input.openingHours as unknown as
              | Prisma.InputJsonValue
              | undefined,
            metadata: this.mergeMetadata(same.metadata, input.metadata),
            embeddingProvider: null,
            embeddingModel: null,
            embeddingDimensions: null,
            embeddingDocumentVersion: null,
            embeddedAt: null,
          },
          include: { components: true, evidence: true, traits: true },
        });
        await tx.$executeRaw`UPDATE "experience" SET "embedding" = NULL WHERE "id" = ${same.id}`;

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
          openingHours: input.openingHours as unknown as
            | Prisma.InputJsonValue
            | undefined,
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

      return {
        ...experience,
        dedupeDecision: 'NEW' as const,
        dedupeEvidence: decision.evidence,
        semanticDocumentChanged: true,
      };
    });
  }

  private semanticTerms(
    description: string | null | undefined,
    metadataValue: unknown,
    relationalTraits: Array<string | null | undefined>,
  ): string[] {
    const metadata = this.objectMetadata(metadataValue);
    return [
      description,
      ...this.stringList(metadata.themes),
      ...this.stringList(metadata.traits),
      ...this.stringList(metadata.intents ?? metadata.archetypes),
      ...relationalTraits,
    ].filter(
      (value): value is string => typeof value === 'string' && !!value.trim(),
    );
  }

  private preferRicherText(
    current?: string | null,
    incoming?: string,
  ): string | null | undefined {
    if (!incoming?.trim()) return current;
    if (!current?.trim()) return incoming;
    return incoming.trim().length > current.trim().length ? incoming : current;
  }

  private mergeMetadata(
    current: unknown,
    incoming: unknown,
  ): Prisma.InputJsonValue | undefined {
    const left = this.objectMetadata(current);
    const right = this.objectMetadata(incoming);
    const merged = { ...left, ...right };
    return Object.keys(merged).length
      ? (merged as Prisma.InputJsonValue)
      : undefined;
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
