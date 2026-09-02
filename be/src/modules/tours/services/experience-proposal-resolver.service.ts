import { Injectable, Logger } from '@nestjs/common';
import { GeoEntityKind } from '@prisma/client';
import { OsmCandidate, OsmPlacesService } from '@integrations/osm/services/osm-places.service';
import { ExperienceCatalogService } from './experience-catalog.service';
import {
  ExperienceProposalResolver,
  ExperienceResolutionResponse,
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
  ) {}

  async resolve(
    input: any,
    _destinationBoundary?: unknown,
  ): Promise<ExperienceResolutionResponse> {
    const proposals = Array.isArray(input)
      ? input
      : Array.isArray(input?.proposals)
        ? input.proposals
        : [];

    const boundary = _destinationBoundary as OsmCandidate | undefined;
    const [streets, pois] = boundary
      ? await Promise.all([
          this.osmPlaces.findStreetsWithin(boundary),
          this.osmPlaces.findPoisWithin(boundary),
        ])
      : [[], []];

    const resolved = await Promise.all(
      proposals.map((proposal: any) => this.resolveProposal(proposal, boundary, streets, pois)),
    );

    this.logger.log(`Resolved ${resolved.filter((item) => item.status === 'accepted').length}/${resolved.length} Experience candidate(s) against OSM`);

    return {
      totalProposals: resolved.length,
      acceptedCount: 0,
      rejectedCount: resolved.length,
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
    const experience = await this.catalog.persistVerifiedExperience({
      canonicalName: proposal.name,
      description: proposal.description,
      durationMinutes: proposal.suggestedDurationMinutes,
      metadata: { themes: proposal.themes, traits: proposal.traits, source: 'grounded_experience_discovery' },
      components: resolvedEntities.map((entity: any, index) => ({ geoEntityId: entity.geoEntityId, order: index + 1, role: entity.role, required: true })),
    });
    return { proposal, status: 'accepted' as const, resolvedEntities: entities, rejectionReasons: [] as string[], experienceId: experience.id };
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
