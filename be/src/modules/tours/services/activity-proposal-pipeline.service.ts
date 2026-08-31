import { Injectable } from '@nestjs/common';
import {
  IProposalResolver,
  ProposalResolutionRequest,
  ProposalResolutionResponse,
} from '../interfaces/proposal-resolution.interface';
import { ActivityProposalResolutionService } from './activity-proposal-resolution.service';
import { CompositeGeographicValidationService } from './composite-geographic-validation.service';
import { ActivityProposalMaterializationService } from './activity-proposal-materialization.service';

@Injectable()
export class ActivityProposalPipelineService implements IProposalResolver {
  constructor(
    private readonly entityResolution: ActivityProposalResolutionService,
    private readonly geographicValidation: CompositeGeographicValidationService,
    private readonly materialization: ActivityProposalMaterializationService,
  ) {}

  async resolve(
    request: ProposalResolutionRequest,
  ): Promise<ProposalResolutionResponse> {
    const resolution = await this.entityResolution.resolve(request);
    if (!request.destinationBoundary) {
      return {
        ...resolution,
        entityResolution: resolution,
      };
    }

    const validation = this.geographicValidation.validateBatch(
      resolution,
      request.destinationBoundary,
    );
    const materialization = await this.materialization.materializeBatch(
      resolution,
      validation,
      request,
    );

    return {
      resolved: materialization.resolved,
      totalProposals: resolution.totalProposals,
      acceptedCount: materialization.materializedCount,
      rejectedCount: materialization.rejectedCount,
      entityResolution: resolution,
      geographicValidation: validation,
      materialization,
    };
  }
}
