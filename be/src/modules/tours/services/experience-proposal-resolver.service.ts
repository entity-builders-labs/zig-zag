import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { GeoEntityKind } from '@prisma/client';
import {
  OsmCandidate,
  OsmLookupResult,
  OsmPlacesService,
} from '@integrations/osm/services/osm-places.service';
import { geometryContainsPoint } from '@integrations/osm/utils/geojson-containment.util';
import {
  INominatimApiService,
  NominatimResult,
} from '@integrations/osm/interfaces/nominatim.interface';
import { ExperienceCatalogService } from './experience-catalog.service';
import { CompositeGeographicValidationService } from './composite-geographic-validation.service';
import { ExperienceEmbeddingIndexerService } from '@shared/ai/services/experience-embedding-indexer.service';
import {
  ExperienceProposalResolver,
  ExperienceResolutionRequest,
  ExperienceResolutionResponse,
  ResolvedExperienceCandidate,
  ResolvedGeoEntity,
} from '../interfaces/experience-resolution.interface';

@Injectable()
export class ExperienceProposalResolverService
  implements ExperienceProposalResolver
{
  private readonly logger = new Logger(ExperienceProposalResolverService.name);

  constructor(
    private readonly osmPlaces: OsmPlacesService,
    private readonly catalog: ExperienceCatalogService,
    private readonly geographicValidator: CompositeGeographicValidationService,
    @Optional()
    private readonly embeddingIndexer?: ExperienceEmbeddingIndexerService,
    @Optional()
    @Inject('NominatimApiService')
    private readonly nominatim?: INominatimApiService,
  ) {}

  async resolve(
    input: ExperienceResolutionRequest,
  ): Promise<ExperienceResolutionResponse> {
    const candidates = Array.isArray(input?.candidates) ? input.candidates : [];
    const evidence = input.evidence ?? [];
    const boundary = input?.destinationBoundary as OsmCandidate | undefined;
    if (!boundary) {
      throw new Error('Experience resolution requires destinationBoundary');
    }

    const [streetLookup, poiLookup] = await Promise.all([
      this.osmPlaces.lookupStreetsWithin(boundary),
      this.osmPlaces.lookupPoisWithin(boundary),
    ]);

    const resolvedCandidates = await Promise.all(
      candidates.map((candidate: any) =>
        this.resolveCandidate(
          candidate,
          boundary,
          streetLookup.value,
          poiLookup.value,
          { streets: streetLookup, pois: poiLookup },
          input.destinationName,
          evidence,
        ),
      ),
    );

    const acceptedForValidation = resolvedCandidates.filter(
      (item) => item.status === 'accepted',
    ) as ResolvedExperienceCandidate[];
    const validationResults = acceptedForValidation.map((item) =>
      this.geographicValidator.validate(
        item,
        this.validationBoundaryFor(item, boundary),
      ),
    );
    const validationByName = new Map(
      validationResults.map((result) => [result.proposalName, result]),
    );

    const resolved = await Promise.all(
      resolvedCandidates.map(async (candidate) => {
        if (candidate.status !== 'accepted') return candidate;

        const geographicResult = validationByName.get(candidate.candidate.name);
        if (!geographicResult?.accepted) {
          return {
            ...candidate,
            status: 'rejected' as const,
            rejectionReasons: geographicResult?.rejectionReasons ?? [
              'GEOGRAPHIC_VALIDATION_FAILED',
            ],
          };
        }

        const experience = await this.catalog.persistVerifiedExperience({
          canonicalName: candidate.candidate.name,
          description: candidate.candidate.description,
          durationMinutes: candidate.candidate.suggestedDurationMinutes,
          metadata: {
            themes: candidate.candidate.themes,
            traits: candidate.candidate.traits,
            intents: candidate.candidate.intents ?? [],
            source: 'grounded_experience_discovery',
          },
          components: candidate.resolvedEntities
            .filter(
              (entity: any) =>
                entity.status === 'resolved' && entity.geoEntityId,
            )
            .map((entity: any, index: number) => ({
              geoEntityId: entity.geoEntityId,
              order: index + 1,
              role: entity.role,
              required: true,
            })),
          evidence: evidence
            .filter((item: { key?: string }) =>
              candidate.candidate.evidenceKeys?.includes(item.key ?? ''),
            )
            .map(
              (item: {
                source: string;
                url?: string;
                title?: string;
                snippet?: string;
              }) => ({
                source: item.source,
                url: item.url,
                title: item.title,
                snippet: item.snippet,
              }),
            ),
        });

        if ((experience as any).dedupeDecision === 'AMBIGUOUS') {
          return {
            ...candidate,
            status: 'rejected' as const,
            rejectionReasons: ['AMBIGUOUS_DEDUPE'],
            dedupeEvidence: (experience as any).dedupeEvidence,
            dedupeCandidates: (experience as any).dedupeCandidates,
          };
        }

        if (
          this.embeddingIndexer &&
          ((experience as any).dedupeDecision === 'NEW' ||
            (experience as any).semanticDocumentChanged)
        ) {
          const embeddingResult = await this.embeddingIndexer.index([
            experience.id,
          ]);
          if (embeddingResult.status === 'unavailable') {
            this.logger.warn(
              `Experience embedding deferred for ${experience.id}: ${embeddingResult.reason ?? 'provider unavailable'}`,
            );
          }
        }

        return {
          ...candidate,
          experienceId: experience.id,
          dedupeDecision: (experience as any).dedupeDecision,
          dedupeEvidence: (experience as any).dedupeEvidence,
        };
      }),
    );

    this.logger.log(
      `Resolved ${resolved.filter((item) => item.status === 'accepted').length}/${resolved.length} Experience candidate(s) against trusted geography`,
    );

    return {
      totalCandidates: resolved.length,
      acceptedCount: resolved.filter((item) => item.status === 'accepted')
        .length,
      rejectedCount: resolved.filter((item) => item.status === 'rejected')
        .length,
      resolved,
    };
  }

  private async resolveCandidate(
    candidate: any,
    boundary: OsmCandidate,
    streets: OsmCandidate[],
    pois: OsmCandidate[],
    osmLookups: {
      streets: OsmLookupResult<OsmCandidate[]>;
      pois: OsmLookupResult<OsmCandidate[]>;
    },
    destinationName?: string,
    evidence: ExperienceResolutionRequest['evidence'] = [],
  ) {
    const entities: ResolvedGeoEntity[] = [];
    const destinationAssociationVerified = this.hasDestinationAssociationEvidence(
      candidate,
      destinationName,
      evidence,
    );

    for (const hint of candidate?.componentHints ?? []) {
      const pool =
        hint.expectedKind === 'ROUTE' || hint.role === 'route'
          ? streets
          : hint.expectedKind === 'AREA' || hint.role === 'area'
            ? [boundary]
            : pois;
      const matched = this.matchCandidate(hint.name, pool);

      if (matched) {
        entities.push(await this.persistOsmEntity(hint, matched));
        continue;
      }

      if (destinationAssociationVerified) {
        const globallyResolved = await this.resolveTrustedGlobalHint(hint);
        if (globallyResolved) {
          entities.push(globallyResolved);
          continue;
        }
      }

      const lookup =
        hint.expectedKind === 'ROUTE' || hint.role === 'route'
          ? osmLookups.streets
          : osmLookups.pois;
      const reason =
        lookup.status === 'failed'
          ? 'OSM_PROVIDER_FAILED'
          : lookup.value.length === 0
            ? 'OSM_QUERY_EMPTY'
            : 'NO_OSM_MATCH';
      entities.push({
        hintKey: hint.key,
        hintName: hint.name,
        provider: 'openstreetmap',
        externalId: '',
        role: hint.role,
        status: 'unresolved',
        reason,
      });
    }

    const required = (candidate?.componentHints ?? []).filter(
      (hint: any) => hint.required,
    );
    const unresolvedRequired = required.some(
      (hint: any) =>
        !entities.find(
          (entity) =>
            entity.hintKey === hint.key && entity.status === 'resolved',
        ),
    );
    const resolvedEntities = entities.filter(
      (entity) => entity.status === 'resolved',
    );

    if (resolvedEntities.length === 0 || unresolvedRequired) {
      return {
        candidate,
        status: 'rejected' as const,
        resolvedEntities: entities,
        destinationAssociationVerified,
        rejectionReasons: [
          resolvedEntities.length === 0
            ? entities.some((entity) => entity.reason === 'OSM_PROVIDER_FAILED')
              ? 'OSM_PROVIDER_FAILED'
              : entities.some((entity) => entity.reason === 'OSM_QUERY_EMPTY')
                ? 'OSM_QUERY_EMPTY'
                : 'NO_OSM_MATCH'
            : 'UNRESOLVED_REQUIRED_COMPONENT',
        ],
      };
    }

    return {
      candidate,
      status: 'accepted' as const,
      resolvedEntities: entities,
      destinationAssociationVerified,
      rejectionReasons: [] as string[],
    };
  }

  private async persistOsmEntity(
    hint: any,
    matched: OsmCandidate,
  ): Promise<ResolvedGeoEntity> {
    const kind =
      hint.expectedKind === 'ROUTE'
        ? GeoEntityKind.ROUTE
        : hint.expectedKind === 'AREA'
          ? GeoEntityKind.AREA
          : GeoEntityKind.PLACE;
    const point = this.representativePoint(matched);
    const geo = await this.catalog.upsertGeoEntity({
      name: matched.name,
      kind,
      provider: 'openstreetmap',
      externalId: matched.id,
      latitude: point?.latitude,
      longitude: point?.longitude,
      geometry: matched.geometry,
      metadata: { tags: matched.tags },
    });
    return Object.assign(
      {
        hintKey: hint.key,
        hintName: hint.name,
        provider: 'openstreetmap',
        externalId: matched.id,
        canonicalName: matched.name,
        latitude: point?.latitude,
        longitude: point?.longitude,
        geometry: matched.geometry,
        role: hint.role,
        status: 'resolved' as const,
      },
      { geoEntityId: geo.id },
    );
  }

  private async resolveTrustedGlobalHint(
    hint: any,
  ): Promise<ResolvedGeoEntity | undefined> {
    if (!this.nominatim || hint.expectedKind === 'ROUTE') return undefined;

    try {
      const results = await this.nominatim.search(hint.name);
      const match = this.bestNominatimMatch(hint.name, results);
      if (
        !match ||
        !Number.isFinite(match.latitude) ||
        !Number.isFinite(match.longitude)
      ) {
        return undefined;
      }

      if (
        hint.expectedKind === 'AREA' &&
        (match.osmType === 'way' || match.osmType === 'relation')
      ) {
        const boundary = await this.osmPlaces.lookupBoundaryById(
          match.osmType,
          match.osmId,
        );
        if (boundary.value) {
          return this.persistOsmEntity(hint, boundary.value);
        }
        return undefined;
      }

      if (hint.expectedKind !== 'PLACE') return undefined;

      const externalId = `osm:${match.osmType}:${match.osmId}`;
      const canonicalName = match.displayName.split(',')[0]?.trim() || hint.name;
      const geometry = {
        type: 'Point' as const,
        coordinates: [match.longitude as number, match.latitude as number],
      };
      const geo = await this.catalog.upsertGeoEntity({
        name: canonicalName,
        kind: GeoEntityKind.PLACE,
        provider: 'nominatim',
        externalId,
        latitude: match.latitude,
        longitude: match.longitude,
        geometry,
        metadata: {
          displayName: match.displayName,
          addresstype: match.addresstype,
          address: match.address,
        },
      });
      return Object.assign(
        {
          hintKey: hint.key,
          hintName: hint.name,
          provider: 'nominatim',
          externalId,
          canonicalName,
          latitude: match.latitude,
          longitude: match.longitude,
          geometry,
          role: hint.role,
          status: 'resolved' as const,
          adminContext: {
            country: match.address?.country,
            region: match.address?.state,
            locality:
              match.address?.city ??
              match.address?.town ??
              match.address?.village ??
              match.address?.municipality,
            municipality: match.address?.municipality,
          },
        },
        { geoEntityId: geo.id },
      );
    } catch (error: any) {
      this.logger.warn(
        `Global trusted resolution failed for "${hint.name}": ${error?.message ?? error}`,
      );
      return undefined;
    }
  }

  private hasDestinationAssociationEvidence(
    candidate: any,
    destinationName: string | undefined,
    evidence: ExperienceResolutionRequest['evidence'],
  ): boolean {
    if (!destinationName || !candidate?.evidenceKeys?.length) return false;
    const destinationTokens = this.normalize(destinationName)
      .split(' ')
      .filter((token) => token.length >= 4);
    if (destinationTokens.length === 0) return false;

    const candidateEvidence = (evidence ?? []).filter((item) =>
      candidate.evidenceKeys.includes(item.key ?? ''),
    );
    return candidateEvidence.some((item) => {
      const text = this.normalize(`${item.title ?? ''} ${item.snippet ?? ''}`);
      return destinationTokens.some((token) => text.includes(token));
    });
  }

  private validationBoundaryFor(
    candidate: ResolvedExperienceCandidate,
    destinationBoundary: OsmCandidate,
  ): OsmCandidate {
    if (!candidate.destinationAssociationVerified) return destinationBoundary;
    const anchors = candidate.resolvedEntities.filter(
      (entity) =>
        entity.status === 'resolved' &&
        Number.isFinite(entity.latitude) &&
        Number.isFinite(entity.longitude),
    );
    if (anchors.length === 0) return destinationBoundary;

    const allOutside = anchors.every(
      (entity) => !this.isInsideBoundary(entity, destinationBoundary),
    );
    if (!allOutside) return destinationBoundary;

    const latitudes = anchors.map((entity) => entity.latitude as number);
    const longitudes = anchors.map((entity) => entity.longitude as number);
    const minLat = Math.min(...latitudes);
    const maxLat = Math.max(...latitudes);
    const minLon = Math.min(...longitudes);
    const maxLon = Math.max(...longitudes);
    const margin = 0.002;
    return {
      id: 'synthetic:grounded-association-scope',
      name: `Grounded association scope for ${candidate.candidate.name}`,
      osmType: 'relation',
      osmId: 0,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [minLon - margin, minLat - margin],
            [maxLon + margin, minLat - margin],
            [maxLon + margin, maxLat + margin],
            [minLon - margin, maxLat + margin],
            [minLon - margin, minLat - margin],
          ],
        ],
      },
      tags: {
        synthetic: 'true',
        validation_scope: 'grounded_destination_association',
      },
    };
  }

  private isInsideBoundary(
    entity: ResolvedGeoEntity,
    boundary: OsmCandidate,
  ): boolean {
    if (
      !Number.isFinite(entity.latitude) ||
      !Number.isFinite(entity.longitude)
    ) {
      return false;
    }
    return geometryContainsPoint(
      boundary.geometry,
      entity.longitude as number,
      entity.latitude as number,
    );
  }

  private bestNominatimMatch(
    name: string,
    results: NominatimResult[],
  ): NominatimResult | undefined {
    const needle = this.normalize(name);
    return results
      .filter((result) => {
        const display = this.normalize(result.displayName);
        return display === needle || display.startsWith(`${needle} `);
      })
      .sort((a, b) => b.importance - a.importance)[0];
  }

  private matchCandidate(
    name: string,
    pool: OsmCandidate[],
  ): OsmCandidate | undefined {
    const needle = this.normalize(name);
    return pool.find((candidate) => {
      const haystack = this.normalize(candidate.name);
      return (
        haystack === needle ||
        haystack.includes(needle) ||
        needle.includes(haystack)
      );
    });
  }

  private normalize(value: string): string {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private representativePoint(
    candidate: OsmCandidate,
  ): { latitude: number; longitude: number } | undefined {
    const geometry = candidate.geometry;
    if (geometry.type === 'Point') {
      return {
        latitude: geometry.coordinates[1],
        longitude: geometry.coordinates[0],
      };
    }

    const coordinates: Array<[number, number]> =
      geometry.type === 'LineString'
        ? geometry.coordinates
        : geometry.type === 'Polygon'
          ? geometry.coordinates[0]
          : geometry.type === 'MultiPolygon'
            ? (geometry.coordinates[0]?.[0] ?? [])
            : [];
    if (coordinates.length === 0) return undefined;

    return {
      latitude:
        coordinates.reduce((sum, [, latitude]) => sum + latitude, 0) /
        coordinates.length,
      longitude:
        coordinates.reduce((sum, [longitude]) => sum + longitude, 0) /
        coordinates.length,
    };
  }
}
