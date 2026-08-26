import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  DiscoveryRequest,
  DiscoveryResponse,
  DISCOVERY_PROVIDER,
  GROUNDED_SEARCH_PROVIDER,
  GroundedSearchProvider,
  GroundedSearchRequest,
  SearchGroundedDiscoveryProvider,
  DiscoveryMode,
} from '../interfaces/activity-discovery.interface';
import { CoverageDeficit } from '../interfaces/coverage-analysis.interface';

@Injectable()
export class ActivityDiscoveryService {
  private readonly logger = new Logger(ActivityDiscoveryService.name);

  constructor(
    @Inject(GROUNDED_SEARCH_PROVIDER)
    private readonly searchProvider: GroundedSearchProvider,
    @Inject(DISCOVERY_PROVIDER)
    private readonly provider: SearchGroundedDiscoveryProvider,
  ) {}

  /**
   * Run grounded discovery for a destination with specific coverage deficits.
   *
   * PR 7.1 contract:
   * - Search provider owns evidence (never the extraction LLM)
   * - Receives deficits from CoverageAnalyzer (never invents its own)
   * - Never persists, never touches Prisma
   * - Every proposal still requires Places/OSM resolution (PR 8) before use
   */
  async discoverGaps(
    destinationName: string,
    destinationCountry: string | undefined,
    requestedThemes: string[],
    deficits: CoverageDeficit[],
    requestedExperienceFormats?: string[],
  ): Promise<DiscoveryResponse> {
    const mode: DiscoveryMode = { type: 'gap_fill', deficits };

    return this.discover({
      destinationName,
      destinationCountry,
      requestedThemes,
      requestedExperienceFormats,
      mode,
      maxProposals: 8,
    });
  }

  /**
   * Bootstrap a new destination profile from scratch.
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

    // 1. Real grounding via search provider. If search fails or returns no
    //    usable evidence, discovery is unavailable — never fall back to model
    //    memory while claiming grounded output.
    const searchResult = await this.searchProvider.search(
      this.toSearchRequest(request),
    );

    if (searchResult.groundingStatus !== 'applied') {
      this.logger.warn(
        `Grounded search ${searchResult.groundingStatus} for ${request.destinationName}: ${searchResult.failureReason ?? 'no usable evidence'}`,
      );
      return {
        proposals: [],
        provider: 'groq',
        model: 'openai/gpt-oss-120b',
        groundingStatus: searchResult.groundingStatus,
        groundingProvider: searchResult.provider,
        groundingModel: searchResult.model,
        groundingEvidence: [],
        validationErrors: [`Grounded search ${searchResult.groundingStatus}`],
      };
    }

    // 2. Structured extraction using the evidence.
    const response = await this.provider.discover(request, searchResult);

    this.logger.debug(
      `Discovery response: ${response.proposals.length} valid proposals from ${response.provider}`,
    );

    return response;
  }

  private toSearchRequest(request: DiscoveryRequest): GroundedSearchRequest {
    return {
      destinationName: request.destinationName,
      destinationCountry: request.destinationCountry,
      requestedThemes: request.requestedThemes,
      requestedExperienceFormats: request.requestedExperienceFormats,
      explorationStyle: request.explorationStyle,
      additionalPreferences: request.additionalPreferences,
      query: this.buildQuery(request),
    };
  }

  private buildQuery(request: DiscoveryRequest): string {
    const terms: string[] = [
      request.destinationName,
      ...request.requestedThemes,
    ];
    if (request.requestedExperienceFormats?.length) {
      terms.push(...request.requestedExperienceFormats);
    }
    return terms.join(' ');
  }
}
