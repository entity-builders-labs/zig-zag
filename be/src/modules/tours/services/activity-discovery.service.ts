import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  DiscoveryRequest,
  DiscoveryResponse,
  DISCOVERY_PROVIDER,
  SearchGroundedDiscoveryProvider,
  DiscoveryMode,
} from '../interfaces/activity-discovery.interface';
import { CoverageDeficit } from '../interfaces/coverage-analysis.interface';

@Injectable()
export class ActivityDiscoveryService {
  private readonly logger = new Logger(ActivityDiscoveryService.name);

  constructor(
    @Inject(DISCOVERY_PROVIDER)
    private readonly provider: SearchGroundedDiscoveryProvider,
  ) {}

  /**
   * Run grounded discovery for a destination with specific coverage deficits.
   * The provider adapter is injected and can be swapped by configuration.
   *
   * PR 7 contract:
   * - Receives deficits from CoverageAnalyzer (never invents its own)
   * - Never persists, never touches Prisma
   * - Returns only ActivityProposal objects with evidence
   * - Every proposal still requires Places/OSM resolution (PR 8) before use
   */
  async discoverGaps(
    destinationName: string,
    destinationCountry: string | undefined,
    requestedThemes: string[],
    deficits: CoverageDeficit[],
  ): Promise<DiscoveryResponse> {
    const mode: DiscoveryMode = { type: 'gap_fill', deficits };

    return this.discover({
      destinationName,
      destinationCountry,
      requestedThemes,
      mode,
      maxProposals: 8,
    });
  }

  /**
   * Bootstrap a new destination profile from scratch.
   * Used when CoverageAnalyzer reports an unprofiled destination.
   */
  async discoverBootstrap(
    destinationName: string,
    destinationCountry: string | undefined,
    requestedThemes: string[],
  ): Promise<DiscoveryResponse> {
    const mode: DiscoveryMode = {
      type: 'bootstrap',
      reason: 'new_destination',
    };

    return this.discover({
      destinationName,
      destinationCountry,
      requestedThemes,
      mode,
      maxProposals: 8,
    });
  }

  private async discover(
    request: DiscoveryRequest,
  ): Promise<DiscoveryResponse> {
    this.logger.debug(
      `Discovery request: ${request.destinationName}, mode=${request.mode.type}, themes=${request.requestedThemes.join(',')}`,
    );

    const response = await this.provider.discover(request);

    this.logger.debug(
      `Discovery response: ${response.proposals.length} valid proposals from ${response.provider}`,
    );

    return response;
  }
}
