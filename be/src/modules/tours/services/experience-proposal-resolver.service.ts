import { Injectable, Logger } from '@nestjs/common';
import { GeoEntityKind } from '@prisma/client';
import { OsmCandidate, OsmPlacesService, OsmLookupResult } from '@integrations/osm/services/osm-places.service';
import { ExperienceCatalogService } from './experience-catalog.service';
import { CompositeGeographicValidationService } from './composite-geographic-validation.service';
import {
  ExperienceProposalResolver,
  ExperienceResolutionResponse,
  ExperienceResolutionRequest,
  ResolvedGeoEntity,
} from '../interfaces/experience-resolution.interface';

/**
 * Native V2 resolver boundary.
 *
 * Resolution is intentionally fail-closed until the provider-backed
 * GeoEntity resolver is wired: grounded text alone must never become a
 * schedulable Experience. Keeping that decision here makes the runtime
 * contract explicit and prevents Nest from booting with an accidental
 * Experience resolver: concepts are proposed by discovery, then resolved
 * independently against provider-backed geographic entities.
 */
@Injectable()
export class ExperienceProposalResolverService
  implements ExperienceProposalResolver
{
  private readonly logger = new Logger(ExperienceProposalResolverService.name);

  constructor(
    private readonly osmPlaces: OsmPlacesService,
    private readonly catalog: ExperienceCatalogService,
    private readonly geographicValidator: CompositeGeographicValidationService,
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
    const streets = streetLookup.value;
    const pois = poiLookup.value;

    const resolvedCandidates = await Promise.all(
      candidates.map((candidate: any) =>
        this.resolveCandidate(candidate, boundary, streets, pois, {
          streets: streetLookup,
          pois: poiLookup,
        }, input.evidence ?? []),
      ),
    );
    const validation = this.geographicValidator.validateBatch(
      { resolved: resolvedCandidates.filter((item) => item.status === 'accepted') } as any,
      boundary,
    );
    const validationByName = new Map(validation.results.map((result) => [result.proposalName, result]));
    const resolved = await Promise.all(resolvedCandidates.map(async (candidate) => {
      if (candidate.status !== 'accepted') return candidate;
      const result = validationByName.get(candidate.candidate.name);
      if (!result?.accepted) {
        return { ...candidate, status: 'rejected' as const, rejectionReasons: result?.rejectionReasons ?? ['geographic_validation_failed'] };
      }
      const experience = await this.catalog.persistVerifiedExperience({
        canonicalName: candidate.candidate.name,
        description: candidate.candidate.description,
        durationMinutes: candidate.candidate.suggestedDurationMinutes,
        metadata: { themes: candidate.candidate.themes, traits: candidate.candidate.traits, source: 'grounded_experience_discovery' },
        components: candidate.resolvedEntities.filter((entity: any) => entity.status === 'resolved' && entity.geoEntityId).map((entity: any, index: number) => ({ geoEntityId: entity.geoEntityId, order: index + 1, role: entity.role, required: true })),
        evidence: evidence
          .filter((item: { key?: string }) => candidate.candidate.evidenceKeys?.includes(item.key ?? ''))
          .map((item: { source: string; url?: string; title?: string; snippet?: string }) => ({ source: item.source, url: item.url, title: item.title, snippet: item.snippet })),
      });
      return { ...candidate, experienceId: experience.id };
    }));

    this.logger.log(`Resolved ${resolved.filter((item) => item.status === 'accepted').length}/${resolved.length} Experience candidate(s) against OSM`);

    return {
      totalCandidates: resolved.length,
      acceptedCount: resolved.filter((item) => item.status === 'accepted').length,
      rejectedCount: resolved.filter((item) => item.status === 'rejected').length,
      resolved,
    };
  }

  private async resolveCandidate(
    candidate: any,
    boundary: OsmCandidate | undefined,
    streets: OsmCandidate[],
    pois: OsmCandidate[],
    osmLookups: {
      streets: OsmLookupResult<OsmCandidate[]>;
      pois: OsmLookupResult<OsmCandidate[]>;
    },
    evidence: Array<{ key?: string; source: string; url?: string; title?: string; snippet?: string }>,
  ) {
    const entities: ResolvedGeoEntity[] = [];
    for (const hint of candidate?.componentHints ?? []) {
      const pool = hint.expectedKind === 'ROUTE' || hint.role === 'route' ? streets : hint.expectedKind === 'AREA' || hint.role === 'area' ? (boundary ? [boundary] : []) : pois;
      const candidate = this.matchCandidate(hint.name, pool);
      if (!candidate) {
        const lookup = hint.expectedKind === 'ROUTE' || hint.role === 'route'
          ? osmLookups.streets
          : osmLookups.pois;
        const reason = lookup.status === 'failed'
          ? 'OSM_PROVIDER_FAILED'
          : lookup.value.length === 0
            ? 'OSM_QUERY_EMPTY'
            : 'NO_OSM_MATCH';
        entities.push({ hintKey: hint.key, hintName: hint.name, provider: 'openstreetmap', externalId: '', role: hint.role, status: 'unresolved', reason });
        continue;
      }
      const kind = hint.expectedKind === 'ROUTE' ? GeoEntityKind.ROUTE : hint.expectedKind === 'AREA' ? GeoEntityKind.AREA : GeoEntityKind.PLACE;
      const geo = await this.catalog.upsertGeoEntity({ name: candidate.name, kind, provider: 'openstreetmap', externalId: candidate.id, geometry: candidate.geometry, metadata: { tags: candidate.tags } });
      entities.push({ hintKey: hint.key, hintName: hint.name, provider: 'openstreetmap', externalId: candidate.id, canonicalName: candidate.name, latitude: this.point(candidate)?.latitude, longitude: this.point(candidate)?.longitude, geometry: candidate.geometry, role: hint.role, status: 'resolved' });
      (entities[entities.length - 1] as any).geoEntityId = geo.id;
    }
    const required = (candidate?.componentHints ?? []).filter((hint: any) => hint.required);
    const unresolvedRequired = required.some((hint: any) => !entities.find((entity) => entity.hintKey === hint.key && entity.status === 'resolved'));
    const resolvedEntities = entities.filter((entity) => entity.status === 'resolved');
    if (resolvedEntities.length === 0 || unresolvedRequired) {
      return { candidate, status: 'rejected' as const, resolvedEntities: entities, rejectionReasons: [
        resolvedEntities.length === 0
          ? entities.some((entity) => entity.reason === 'OSM_PROVIDER_FAILED')
            ? 'OSM_PROVIDER_FAILED'
            : entities.some((entity) => entity.reason === 'OSM_QUERY_EMPTY')
              ? 'OSM_QUERY_EMPTY'
              : 'NO_OSM_MATCH'
          : 'UNRESOLVED_REQUIRED_COMPONENT',
      ] };
    }
    return { candidate, status: 'accepted' as const, resolvedEntities: entities, rejectionReasons: [] as string[] };
  }

  private matchCandidate(name: string, pool: OsmCandidate[]): OsmCandidate | undefined {
    const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const needle = normalize(name);
    return pool.find((candidate) => {
      const haystack = normalize(candidate.name);
      return haystack === needle || haystack.includes(needle) || needle.includes(haystack);
    });
  }

  private point(candidate: OsmCandidate): { latitude: number; longitude: number } | undefined {
    if (candidate.geometry.type !== 'Point') return undefined;
    return { latitude: candidate.geometry.coordinates[1], longitude: candidate.geometry.coordinates[0] };
  }
}
