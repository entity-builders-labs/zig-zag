import { Injectable, Inject, Logger } from '@nestjs/common';
import { ActivityKind } from '@prisma/client';
import {
  DiscoveryRequest,
  DiscoveryResponse,
  DISCOVERY_PROVIDER,
  GROUNDED_SEARCH_PROVIDER,
  GroundedSearchProvider,
  GroundedSearchRequest,
  GroundedSearchResult,
  GroundingEvidence,
  SearchGroundedDiscoveryProvider,
  DiscoveryMode,
  EntityHint,
} from '../interfaces/activity-discovery.interface';
import { CoverageDeficit } from '../interfaces/coverage-analysis.interface';
import { EXPERIENCE_FORMAT_ACTIVITY_KIND } from '../utils/experience-format-kind.util';
import {
  ExperienceFormat,
  ExplorationStyle,
} from '../interfaces/tour-generation.interface';
import {
  SemanticDiscoveryQueryBuilder,
  SemanticDiscoveryQueryPlan,
} from '../utils/semantic-discovery-query-builder.util';
import { extractRouteHints } from '../utils/route-evidence-extraction.util';

/** Combined evidence cap across all search calls in one discoverGaps() run
 * — bounds the Groq extraction prompt regardless of how many missing kinds
 * triggered a semantic search call (SerpApi bills per request, not per
 * token, so multiplying search calls is cheap; Groq's TPM quota is not). */
const EVIDENCE_BUDGET = 30;

interface SearchOutcome {
  plan?: SemanticDiscoveryQueryPlan;
  result: GroundedSearchResult;
}

@Injectable()
export class ActivityDiscoveryService {
  private readonly logger = new Logger(ActivityDiscoveryService.name);
  private readonly queryBuilder = new SemanticDiscoveryQueryBuilder();

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
   *
   * PR 9-follow-up: one semantic search call per missing ActivityKind
   * (derived from deficits[].experienceFormat), each with its own
   * SemanticDiscoveryQueryBuilder query, instead of one combined query that
   * dilutes every requested format into a single blended search — live
   * testing showed a combined query silently drops formats entirely rather
   * than covering all of them.
   */
  async discoverGaps(
    destinationName: string,
    destinationCountry: string | undefined,
    requestedThemes: string[],
    deficits: CoverageDeficit[],
    requestedExperienceFormats?: string[],
    explorationStyle?: string,
    additionalPreferences?: string,
  ): Promise<DiscoveryResponse> {
    const mode: DiscoveryMode = { type: 'gap_fill', deficits };
    const request: DiscoveryRequest = {
      destinationName,
      destinationCountry,
      requestedThemes,
      requestedExperienceFormats,
      explorationStyle,
      additionalPreferences,
      mode,
      maxProposals: 8,
    };

    this.logger.debug(
      `Discovery request: ${destinationName}, mode=gap_fill, themes=${requestedThemes.join(',')}`,
    );

    const missingKinds = this.deriveMissingKinds(deficits);
    const plans = missingKinds.map((missingKind) =>
      this.queryBuilder.build({
        destinationName,
        destinationCountry,
        missingKind,
        themes: requestedThemes,
        explorationStyle: explorationStyle as ExplorationStyle | undefined,
        additionalPreferences,
      }),
    );

    const baseSearchRequest = {
      destinationName,
      destinationCountry,
      requestedThemes,
      requestedExperienceFormats,
      explorationStyle,
      additionalPreferences,
    };

    const outcomes: SearchOutcome[] =
      plans.length > 0
        ? await Promise.all(
            plans.map(async (plan) => ({
              plan,
              result: await this.searchProvider.search({
                ...baseSearchRequest,
                query: plan.query,
                targetKind: plan.kind,
              } as GroundedSearchRequest),
            })),
          )
        : [
            {
              result: await this.searchProvider.search({
                ...baseSearchRequest,
                query: '',
              } as GroundedSearchRequest),
            },
          ];

    const evidence = this.mergeEvidence(outcomes);

    if (evidence.length === 0) {
      const primary = outcomes[0].result;
      this.logger.warn(
        `Grounded search ${primary.groundingStatus} for ${destinationName}: ${primary.failureReason ?? 'no usable evidence'}`,
      );
      return {
        proposals: [],
        provider: 'groq',
        model: 'openai/gpt-oss-120b',
        groundingStatus: primary.groundingStatus,
        groundingProvider: primary.provider,
        groundingModel: primary.model,
        groundingEvidence: [],
        validationErrors: [`Grounded search ${primary.groundingStatus}`],
      };
    }

    const mergedSearchResult: GroundedSearchResult = {
      provider: outcomes[0].result.provider,
      model: outcomes[0].result.model,
      groundingStatus: 'applied',
      evidence,
    };

    const response = await this.provider.discover(request, mergedSearchResult);

    this.logger.debug(
      `Discovery response: ${response.proposals.length} valid proposals from ${response.provider}`,
    );

    return response;
  }

  /**
   * Bootstrap a new destination profile from scratch. No deficits exist yet
   * for a brand-new destination, so there's nothing to derive missing kinds
   * from — stays on the single general search call, unchanged.
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

    // Real grounding via search provider. If search fails or returns no
    // usable evidence, discovery is unavailable — never fall back to model
    // memory while claiming grounded output.
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
      // Bootstrap has no coverage deficits to derive a missing kind from —
      // empty query keeps SerpApiGroundedSearchService on its general
      // (engine=google) path, unchanged from before this fix.
      query: '',
    };
  }

  private deriveMissingKinds(deficits: CoverageDeficit[]): ActivityKind[] {
    const kinds = new Set<ActivityKind>();
    for (const deficit of deficits) {
      if (deficit.reason !== 'missing_requested_experience_format') continue;
      const kind = deficit.experienceFormat
        ? EXPERIENCE_FORMAT_ACTIVITY_KIND[
            deficit.experienceFormat as ExperienceFormat
          ]
        : undefined;
      if (kind) kinds.add(kind);
    }
    return [...kinds];
  }

  /**
   * Merges evidence from every search call into one bounded list. Semantic
   * (per-kind) calls are prioritized over the general fallback call when
   * trimming to budget — they're higher-signal (a query built for exactly
   * one missing kind vs. a generic keyword-concat query). A ROUTE call's
   * result also gets its evidence-aware extraction pass folded in here (see
   * route-evidence-extraction.util.ts) as additional synthetic evidence
   * entries the extraction step may cite — still just candidates; PR 8
   * remains the sole identity authority.
   */
  private mergeEvidence(outcomes: SearchOutcome[]): GroundingEvidence[] {
    const prioritized: GroundingEvidence[] = [];
    const deprioritized: GroundingEvidence[] = [];

    outcomes.forEach((outcome, index) => {
      let evidence = outcome.result.evidence ?? [];

      if (outcome.plan?.kind === ActivityKind.ROUTE) {
        const routeHints = extractRouteHints({
          evidence,
          textBlocks: outcome.result.textBlocks,
        });
        evidence = [...evidence, ...this.routeHintsToEvidence(routeHints)];
      }

      const rekeyed = evidence.map((item) => ({
        ...item,
        key: `c${index}-${item.key}`,
      }));

      if (outcome.plan) {
        prioritized.push(...rekeyed);
      } else {
        deprioritized.push(...rekeyed);
      }
    });

    const dedupedPrioritized = this.dedupeEvidence(prioritized);
    if (dedupedPrioritized.length >= EVIDENCE_BUDGET) {
      return dedupedPrioritized.slice(0, EVIDENCE_BUDGET);
    }

    const remainingBudget = EVIDENCE_BUDGET - dedupedPrioritized.length;
    const dedupedDeprioritized = this.dedupeEvidence(
      deprioritized,
      dedupedPrioritized,
    );
    return [
      ...dedupedPrioritized,
      ...dedupedDeprioritized.slice(0, remainingBudget),
    ];
  }

  private dedupeEvidence(
    evidence: GroundingEvidence[],
    against: GroundingEvidence[] = [],
  ): GroundingEvidence[] {
    const seen = new Set(against.map((item) => this.evidenceFingerprint(item)));
    const result: GroundingEvidence[] = [];
    for (const item of evidence) {
      const fingerprint = this.evidenceFingerprint(item);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      result.push(item);
    }
    return result;
  }

  private evidenceFingerprint(item: GroundingEvidence): string {
    return `${item.snippet.trim().toLowerCase()}|${item.url ?? ''}`;
  }

  private routeHintsToEvidence(hints: EntityHint[]): GroundingEvidence[] {
    return hints.map((hint, index) => ({
      key: `route-${index + 1}`,
      source: 'route_evidence_extraction',
      snippet: `Candidate real ${hint.expectedType} name identified in evidence: "${hint.name}".`,
    }));
  }
}
