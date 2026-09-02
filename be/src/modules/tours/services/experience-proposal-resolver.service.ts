import { Injectable, Logger, Optional } from '@nestjs/common';
import { GeoEntityKind } from '@prisma/client';
import {
  OsmCandidate,
  OsmLookupResult,
  OsmPlacesService,
} from '@integrations/osm/services/osm-places.service';
import { ExperienceCatalogService } from './experience-catalog.service';
import { CompositeGeographicValidationService } from './composite-geographic-validation.service';
import { ExperienceEmbeddingIndexerService } from '@shared/ai/services/experience-embedding-indexer.service';
import {
  ExperienceProposalResolver,
  ExperienceResolutionRequest,
  ExperienceResolutionResponse,
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
        ),
      ),
    );

    const validation = this.geographicValidator.validateBatch(
      {
        resolved: resolvedCandidates.filter(
          (item) => item.status === 'accepted',
        ),
      } as any,
      boundary,
    );
    const validationByName = new Map(
      validation.results.map((result) => [result.proposalName, result]),
    );

    const resolved = await Promise.all(
      resolvedCandidates.map(async (candidate) => {
        if (candidate.status !== 'accepted') return candidate;

        const geographicResult = validationByName.get(candidate.candidate.name);
        if (!geographicResult?.accepted) {
          return {
            ...candidate,
            status: 'rejected' as const,
            rejectionReasons:
              geographicResult?.rejectionReasons ?? [
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
            intents:
              candidate.candidate.intents ??
              candidate.candidate.archetypes ??
              [],
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
      `Resolved ${resolved.filter((item) => item.status === 'accepted').length}/${resolved.length} Experience candidate(s) against OSM`,
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
  ) {
    const entities: ResolvedGeoEntity[] = [];

    for (const hint of candidate?.componentHints ?? []) {
      const pool =
        hint.expectedKind === 'ROUTE' || hint.role === 'route'
          ? streets
          : hint.expectedKind === 'AREA' || hint.role === 'area'
            ? [boundary]
            : pois;
      const matched = this.matchCandidate(hint.name, pool);

      if (!matched) {
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
        continue;
      }

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
      entities.push({
        hintKey: hint.key,
        hintName: hint.name,
        provider: 'openstreetmap',
        externalId: matched.id,
        canonicalName: matched.name,
        latitude: point?.latitude,
        longitude: point?.longitude,
        geometry: matched.geometry,
        role: hint.role,
        status: 'resolved',
      });
      (entities[entities.length - 1] as any).geoEntityId = geo.id;
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
        rejectionReasons: [
          resolvedEntities.length === 0
            ? entities.some(
                (entity) => entity.reason === 'OSM_PROVIDER_FAILED',
              )
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
      rejectionReasons: [] as string[],
    };
  }

  private matchCandidate(
    name: string,
    pool: OsmCandidate[],
  ): OsmCandidate | undefined {
    const normalize = (value: string) =>
      value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    const needle = normalize(name);
    return pool.find((candidate) => {
      const haystack = normalize(candidate.name);
      return (
        haystack === needle ||
        haystack.includes(needle) ||
        needle.includes(haystack)
      );
    });
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
            ? geometry.coordinates[0]?.[0] ?? []
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
