import { Injectable, Logger } from '@nestjs/common';
import { GeoEntityKind } from '@prisma/client';
import { OsmCandidate, OsmPlacesService } from '@integrations/osm/services/osm-places.service';
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
 * Activity-era resolver.
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
    const proposals = Array.isArray(input?.proposals) ? input.proposals : [];
    const boundary = input?.destinationBoundary as OsmCandidate | undefined;
    if (!boundary) {
      throw new Error('Experience resolution requires destinationBoundary');
    }
    const [streets, pois] = boundary
      ? await Promise.all([
          this.osmPlaces.findStreetsWithin(boundary),
          this.osmPlaces.findPoisWithin(boundary),
        ])
      : [[], []];

    const candidates = await Promise.all(
      proposals.map((proposal: any) => this.resolveProposal(proposal, boundary, streets, pois)),
    );
    const validation = this.geographicValidator.validateBatch(
      { resolved: candidates.filter((item) => item.status === 'accepted') } as any,
      boundary,
    );
    const validationByName = new Map(validation.results.map((result) => [result.proposalName, result]));
    const resolved = await Promise.all(candidates.map(async (candidate) => {
      if (candidate.status !== 'accepted') return candidate;
      const result = validationByName.get(candidate.proposal.name);
      if (!result?.accepted) {
        return { ...candidate, status: 'rejected' as const, rejectionReasons: result?.rejectionReasons ?? ['geographic_validation_failed'] };
      }
      const experience = await this.catalog.persistVerifiedExperience({
        canonicalName: candidate.proposal.name,
        description: candidate.proposal.description,
        durationMinutes: candidate.proposal.suggestedDurationMinutes,
        metadata: { themes: candidate.proposal.themes, traits: candidate.proposal.traits, source: 'grounded_experience_discovery' },
        components: candidate.resolvedEntities.filter((entity: any) => entity.status === 'resolved' && entity.geoEntityId).map((entity: any, index: number) => ({ geoEntityId: entity.geoEntityId, order: index + 1, role: entity.role, required: true })),
      });
      return { ...candidate, experienceId: experience.id };
    }));

    this.logger.log(`Resolved ${resolved.filter((item) => item.status === 'accepted').length}/${resolved.length} Experience candidate(s) against OSM`);

    return {
      totalProposals: resolved.length,
      acceptedCount: resolved.filter((item) => item.status === 'accepted').length,
      rejectedCount: resolved.filter((item) => item.status === 'rejected').length,
      resolved,
    };
  }

  private async resolveProposal(
    proposal: any,
    boundary: OsmCandidate | undefined,
    streets: OsmCandidate[],
    pois: OsmCandidate[],
  ) {
    const entities: ResolvedGeoEntity[] = [];
    for (const hint of proposal?.componentHints ?? proposal?.entityHints ?? []) {
      const pool = hint.expectedKind === 'ROUTE' || hint.role === 'route' ? streets : hint.expectedKind === 'AREA' || hint.role === 'area' ? (boundary ? [boundary] : []) : pois;
      const candidate = this.matchCandidate(hint.name, pool);
      if (!candidate) {
        entities.push({ hintKey: hint.key, hintName: hint.name, provider: 'openstreetmap', externalId: '', role: hint.role, status: 'unresolved', reason: 'no_osm_match' });
        continue;
      }
      const kind = hint.expectedKind === 'ROUTE' ? GeoEntityKind.ROUTE : hint.expectedKind === 'AREA' ? GeoEntityKind.AREA : GeoEntityKind.PLACE;
      const geo = await this.catalog.upsertGeoEntity({ name: candidate.name, kind, provider: 'openstreetmap', externalId: candidate.id, geometry: candidate.geometry, metadata: { tags: candidate.tags } });
      entities.push({ hintKey: hint.key, hintName: hint.name, provider: 'openstreetmap', externalId: candidate.id, canonicalName: candidate.name, latitude: this.point(candidate)?.latitude, longitude: this.point(candidate)?.longitude, geometry: candidate.geometry, role: hint.role, status: 'resolved' });
      (entities[entities.length - 1] as any).geoEntityId = geo.id;
    }
    const required = (proposal?.componentHints ?? proposal?.entityHints ?? []).filter((hint: any) => hint.required);
    const unresolvedRequired = required.some((hint: any) => !entities.find((entity) => entity.hintKey === hint.key && entity.status === 'resolved'));
    const resolvedEntities = entities.filter((entity) => entity.status === 'resolved');
    if (resolvedEntities.length === 0 || unresolvedRequired) {
      return { proposal, status: 'rejected' as const, resolvedEntities: entities, rejectionReasons: [resolvedEntities.length === 0 ? 'no_osm_match' : 'unresolved_required_component'] };
    }
    return { proposal, status: 'accepted' as const, resolvedEntities: entities, rejectionReasons: [] as string[] };
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
