import { Injectable } from '@nestjs/common';
import { ActivityProposalResolutionService } from './activity-proposal-resolution.service';
import { CompositeGeographicValidationService } from './composite-geographic-validation.service';
import { ActivityProposalMaterializationService } from './activity-proposal-materialization.service';
import {
  IProposalResolver,
  ProposalResolutionRequest,
  ProposalResolutionResponse,
} from '../interfaces/proposal-resolution.interface';

/**
 * Compatibility façade for the existing PROPOSAL_RESOLVER token.
 *
 * Callers still make one `resolve()` call, but the authority boundary is now
 * explicit and auditable: resolve provider identities -> deterministic
 * geographic validation -> persist only GEO_VERIFIED proposals.
 */
@Injectable()
export class ActivityProposalPipelineService implements IProposalResolver {
  constructor(
    private readonly entityResolver: ActivityProposalResolutionService,
    private readonly geographicValidator: CompositeGeographicValidationService,
    private readonly materializer: ActivityProposalMaterializationService,
  ) {}

  async resolve(
    request: ProposalResolutionRequest,
  ): Promise<ProposalResolutionResponse> {
    const entityResolution = await this.entityResolver.resolve(request);
    if (!request.destinationBoundary) {
      return {
        ...entityResolution,
        entityResolution,
      };
    }

    const geographicValidation = this.geographicValidator.validateBatch(
      entityResolution,
      request.destinationBoundary,
    );
    const materialization = await this.materializer.materializeBatch(
      entityResolution,
      geographicValidation,
      request,
    );

    // Keep the intermediate resolution attached to the final response and
    // enrich that trace payload with the subsequent deterministic stages.
    // Existing callers still consume the final materialized `resolved` rows,
    // while the Bitácora can render the authority boundaries without issuing
    // another provider lookup or reverse-engineering decisions in the UI.
    const tracedEntityResolution: ProposalResolutionResponse = {
      ...entityResolution,
      geographicValidation,
      materialization,
    };

    return {
      resolved: materialization.resolved,
      totalProposals: materialization.totalProposals,
      acceptedCount: materialization.materializedCount,
      rejectedCount: materialization.rejectedCount,
      entityResolution: tracedEntityResolution,
      geographicValidation,
      materialization,
    };
  }
}
