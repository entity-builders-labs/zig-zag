import { Injectable, Logger } from '@nestjs/common';
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

  async resolve(
    input: any,
    _destinationBoundary?: unknown,
  ): Promise<ExperienceResolutionResponse> {
    const proposals = Array.isArray(input)
      ? input
      : Array.isArray(input?.proposals)
        ? input.proposals
        : [];

    const resolved = proposals.map((proposal: any) => ({
      proposal,
      status: 'rejected' as const,
      resolvedEntities: [] as ResolvedGeoEntity[],
      rejectionReasons: ['geo_entity_resolution_unavailable'],
    }));

    this.logger.warn(
      `Experience resolution rejected ${resolved.length} candidate(s): provider-backed GeoEntity resolution is not configured`,
    );

    return {
      totalProposals: resolved.length,
      acceptedCount: 0,
      rejectedCount: resolved.length,
      resolved,
    };
  }
}
