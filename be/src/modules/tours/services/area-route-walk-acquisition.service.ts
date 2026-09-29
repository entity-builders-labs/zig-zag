import { Injectable } from '@nestjs/common';
import { Coordinates } from '@shared/utils/distance.utils';
import { ExperienceCatalogService } from './experience-catalog.service';
import {
  BuildPlanInput,
  ExperienceAcquisitionPlannerService,
} from './experience-acquisition-planner.service';
import { ExperienceAcquisitionService } from './experience-acquisition.service';
import { AcquisitionExecutionLedger } from '../utils/acquisition-source-plan-fingerprint.util';
import {
  CURRENT_CLASSIFICATION_PROMPT_VERSION,
  canReuseClassification,
} from './experience-classification.service';
import { ResolvedAnchor } from '../interfaces/preference-spec.interface';
import { PreferenceFacetDeficit } from '../interfaces/experience-acquisition-plan.interface';
import { ExperienceDiscoveryScope } from '../interfaces/experience-discovery.interface';
import {
  ExperienceValidationScope,
  GeographicScope,
  FinalExperienceResolutionResponse,
} from '../interfaces/experience-resolution.interface';
import { ExperienceAcquisitionPlan } from '../interfaces/experience-acquisition-plan.interface';
import { ExecuteAcquisitionPlanResult } from './experience-acquisition.service';
import { normalizeWizardFacet } from '../utils/preference-facet-merge.util';
import { candidateMatchesPreferenceFacet } from '../utils/preference-facet-matching.util';
import { normalizeGeoName } from '../utils/nominatim-match.util';
import {
  convergeExperienceClassification,
  ClassificationAuditRecord,
} from '../utils/experience-classification-convergence.util';
import { ExperienceClassificationService } from './experience-classification.service';
import { ClassificationFailure } from './experience-classification.service';

export interface AreaRouteWalkAcquisitionInput {
  /**
   * Kind 'area' | 'route'; caller guarantees EXACTLY ONE relevant area/
   * route anchor for THIS single-anchor primitive (2+ relevant anchors for
   * one deficit is mode D — not handled here, see the plan's non-goals)
   * and filters out 'venue'/'unknown' anchors before calling.
   */
  anchor: ResolvedAnchor;
  intentKey: 'walk' | 'route_like';
  /** .latitude/.longitude/.radiusMeters feed the tourism-route identity
   * check (mode C) when the canonical ROUTE does not resolve. */
  destination: ExperienceDiscoveryScope;
  destinationCountryCode?: string;
  destinationPoint?: Coordinates;
  geographicScope?: GeographicScope;
  executionLedger?: AcquisitionExecutionLedger;
  [key: string]: unknown;
  /** The canonical facet deficit this call is acquiring for -- routed
   * straight into the plan, never recomputed from a candidate pool. */
  deficit: PreferenceFacetDeficit;
  semanticQuery?: string;
}

export interface ClassificationRefreshAttempt {
  experienceId: string;
  outcome:
    | 'insufficient_evidence'
    | 'degraded'
    | 'classified_mismatch'
    | 'classified_match';
  provider?: string;
  model?: string;
  failure?: ClassificationFailure;
}

export type AreaRouteWalkAcquisitionResult =
  | { outcome: 'reused'; experienceId: string }
  | {
      outcome: 'classification_refreshed';
      experienceId: string;
      refreshResult: ClassificationAuditRecord;
      classificationRefresh?: {
        attempts: ClassificationRefreshAttempt[];
      };
    }
  | {
      outcome: 'acquired';
      experienceId: string;
      lifecycle: AreaRouteWalkAcquisitionLifecycle;
    }
  | {
      outcome: 'no_result';
      reason?:
        | 'anchor_unresolved'
        | 'no_source_plan'
        | 'no_accepted_results'
        | 'no_semantically_eligible_result'
        | 'classification_refresh_failed'
        | 'insufficient_persisted_evidence';
      diagnostics?: AreaRouteWalkAcquisitionDiagnostics;
      lifecycle?: AreaRouteWalkAcquisitionLifecycle;
      classificationRefresh?: {
        attempts: ClassificationRefreshAttempt[];
      };
    };

export interface AreaRouteWalkAcquisitionLifecycle {
  plan: ExperienceAcquisitionPlan;
  execution: ExecuteAcquisitionPlanResult;
  materialization: FinalExperienceResolutionResponse;
}

export interface AreaRouteWalkAcquisitionDiagnostics {
  anchorResolved: boolean;
  sourcePlanProviders: string[];
  execution: {
    candidateCount: number;
    structuredCandidateCount?: number;
    webCandidateCount?: number;
    webResults: Array<{
      status: string;
      groundingStatus?: string;
      evidenceCount: number;
      extractorProvider?: string;
      extractorModel?: string;
      candidateCount: number;
      validationErrors: string[];
      failureReason?: string;
    }>;
  };
  materialization: {
    resolvedCount: number;
    acceptedCount: number;
    rejectedCount: number;
    rejectionReasons: Record<string, number>;
    semanticallyEligibleCount: number;
  };
}

/**
 * Task B5 (D5) — for a single area/route anchor combined with
 * intent:walk/route_like, checks the catalog FIRST for a compatible
 * persisted multi-component Experience genuinely inside/along that named
 * area/route; only on a genuine miss does it acquire. Reuse-first holds
 * for all 3 anchor shapes this primitive supports: a single AREA, a
 * canonical geographic ROUTE, and a named tourism-route Experience with no
 * canonical ROUTE geometry (mode C) — the last of which requires a real,
 * evidence-only Stage-6 classification pass to converge before warm reuse
 * works. Cutover M4: that classification pass is no longer owned here —
 * it runs inside `ExperienceAcquisitionService.materializeExecution()`, the
 * shared canonical materialization boundary every acquisition strategy
 * converges on. This service holds no classification authority of its own.
 */
@Injectable()
export class AreaRouteWalkAcquisitionService {
  constructor(
    private readonly catalog: ExperienceCatalogService,
    private readonly acquisitionPlanner: ExperienceAcquisitionPlannerService,
    private readonly acquisitionService: ExperienceAcquisitionService,
    private readonly classificationService: ExperienceClassificationService,
  ) {}

  async acquireOrReuse(
    input: AreaRouteWalkAcquisitionInput,
  ): Promise<AreaRouteWalkAcquisitionResult> {
    const isAreaAnchor =
      input.anchor.status === 'resolved' && input.anchor.kind === 'area';
    const isRouteAnchor =
      (input.anchor.status === 'resolved' && input.anchor.kind === 'route') ||
      (input.anchor.status === 'unresolved' &&
        input.anchor.usage === 'named_path');
    const facet = normalizeWizardFacet('intent', input.intentKey);

    // Resolve ONCE per call -- reused by the warm check, the
    // validationScope passed into acquisition/materialization, AND the
    // post-acquisition re-check.
    // Geo resolution is authoritative and request-scoped. Once the planner
    // receives a ResolvedAnchor, this stage consumes that immutable fact; it
    // must not reinterpret rawName or ask the resolver to decide again.
    const resolution =
      input.anchor.status === 'resolved' &&
      input.anchor.geoEntityId &&
      input.anchor.geometry
        ? {
            resolved: true,
            geoEntityId: input.anchor.geoEntityId,
            canonicalName: input.anchor.canonicalName,
            provider: input.anchor.provider,
            externalId: input.anchor.externalId,
            geometry: input.anchor.geometry,
            osmBoundary: input.anchor.osmBoundary,
          }
        : { resolved: false as const };

    if (
      input.anchor.status === 'unresolved' &&
      input.anchor.usage === 'geographic_scope'
    ) {
      return {
        outcome: 'no_result',
        reason: 'anchor_unresolved',
        diagnostics: {
          anchorResolved: false,
          sourcePlanProviders: [],
          execution: { candidateCount: 0, webResults: [] },
          materialization: {
            resolvedCount: 0,
            acceptedCount: 0,
            rejectedCount: 0,
            rejectionReasons: {},
            semanticallyEligibleCount: 0,
          },
        },
      };
    }

    // An AREA anchor is a request-level geographic scope, not optional
    // context. Without a canonical boundary, materialization could persist
    // an experience unrelated to the requested area. Tourism-route mode C
    // intentionally remains available for unresolved ROUTE anchors below.
    if (isAreaAnchor && !resolution.resolved) {
      return {
        outcome: 'no_result',
        reason: 'anchor_unresolved',
        diagnostics: {
          anchorResolved: false,
          sourcePlanProviders: [],
          execution: { candidateCount: 0, webResults: [] },
          materialization: {
            resolvedCount: 0,
            acceptedCount: 0,
            rejectedCount: 0,
            rejectionReasons: {},
            semanticallyEligibleCount: 0,
          },
        },
      };
    }

    // Geographic/identity lookup, SPLIT from the intent-facet/semantic
    // filter. Uniform across all 3 single-anchor modes (A/B/C) -- each has
    // its own real catalog-native identity check.
    const geographicMatches = async (): Promise<
      Array<{ id: string; metadata?: unknown }>
    > => {
      if (isAreaAnchor) {
        if (!resolution.resolved) return [];
        return this.catalog.findVerifiedMultiComponentInArea(
          resolution.geoEntityId,
          input.intentKey === 'walk' || input.intentKey === 'route_like'
            ? 'AREA_ANCHORED_ROUTE'
            : 'AREA_CONTAINED',
        );
      }
      if (isRouteAnchor) {
        if (resolution.resolved) {
          return this.catalog.findVerifiedMultiComponentByExactComponent(
            resolution.geoEntityId,
          );
        }
        // Mode C: tourism-route Experience, no canonical ROUTE identity.
        if (
          !Number.isFinite(input.destination.latitude) ||
          !Number.isFinite(input.destination.longitude) ||
          !Number.isFinite(input.destination.radiusMeters)
        ) {
          return []; // no destination geo scope known -- can't run this check at all, MISS
        }
        return this.catalog.findVerifiedTourismRouteByName(
          normalizeGeoName(input.anchor.rawName),
          input.destination.latitude as number,
          input.destination.longitude as number,
          input.destination.radiusMeters as number,
        );
      }
      return [];
    };

    // A geographically/identity-compatible row is not enough on its own --
    // it must also carry a CURRENT, reusable classification
    // (canReuseClassification, the same B2 validity gate used everywhere
    // else) that actually satisfies the requested intent. A stale/
    // degraded/malformed/never-classified row is a conservative MISS here,
    // never trusted from a legacy metadata.intents value.
    const isSemanticallyEligible = (row: {
      id: string;
      metadata?: unknown;
    }): boolean =>
      !!facet &&
      canReuseClassification(
        row.metadata,
        CURRENT_CLASSIFICATION_PROMPT_VERSION,
      ) &&
      candidateMatchesPreferenceFacet(row, facet);

    // WARM check: geography/identity AND current semantic eligibility. A
    // pre-existing row may have been persisted for an unrelated purpose
    // (wrong intent) or classified into something else entirely -- both
    // are real, valid MISSes, not bugs.
    const geographicCandidates = await geographicMatches();
    const warmHit = geographicCandidates.find(isSemanticallyEligible);
    if (warmHit) return { outcome: 'reused', experienceId: warmHit.id };

    // CLASSIFICATION REFRESH: a geographically/identity-compatible Experience
    // exists but its classification is degraded/stale/malformed. Attempt a
    // refresh using ONLY persisted evidence before falling back to Internet
    // reacquisition. This delegates to the canonical convergence primitive.
    const refreshAttempts: ClassificationRefreshAttempt[] = [];
    let sawSemanticMismatch = false;
    let sawRefreshFailure = false;
    let sawInsufficientEvidence = false;

    for (const candidate of geographicCandidates) {
      const context = await this.catalog.findClassificationContextById(
        candidate.id,
      );
      if (!context || context.evidence.length === 0) {
        sawInsufficientEvidence = true;
        refreshAttempts.push({
          experienceId: candidate.id,
          outcome: 'insufficient_evidence',
        });
        continue;
      }

      const refreshResult = await convergeExperienceClassification(
        candidate.id,
        context.evidence,
        {
          catalog: this.catalog,
          classifier: this.classificationService,
        },
      );

      if (refreshResult.state === 'degraded') {
        sawRefreshFailure = true;
        refreshAttempts.push({
          experienceId: candidate.id,
          outcome: 'degraded',
          provider: refreshResult.provider,
          model: refreshResult.model,
          failure: refreshResult.failure,
        });
        continue;
      }

      // Check if the refreshed classification satisfies the requested facet.
      const refreshedRow = {
        id: candidate.id,
        metadata: {
          ...(context.metadata as Record<string, unknown>),
          themes: refreshResult.themes,
          intents: refreshResult.intents,
          classification: {
            state: refreshResult.state,
            promptVersion: refreshResult.promptVersion,
            modelId: refreshResult.model,
            themes: refreshResult.themes,
            intents: refreshResult.intents,
            traits: refreshResult.traits,
            reasoningEvidence: refreshResult.reasoningEvidence,
          },
        },
      };
      if (candidateMatchesPreferenceFacet(refreshedRow, facet)) {
        return {
          outcome: 'classification_refreshed',
          experienceId: candidate.id,
          refreshResult,
          classificationRefresh: { attempts: refreshAttempts },
        };
      }

      // Refresh succeeded but classification does not match requested facet.
      sawSemanticMismatch = true;
      refreshAttempts.push({
        experienceId: candidate.id,
        outcome: 'classified_mismatch',
        provider: refreshResult.provider,
        model: refreshResult.model,
      });
    }

    // If at least one canonical geographic candidate existed but none can
    // satisfy the requested facet after valid/reusable classification or
    // bounded refresh, return no_result. Do NOT Internet reacquire merely
    // because classification was degraded.
    if (geographicCandidates.length > 0) {
      // Precedence: semantic mismatch > refresh failure > insufficient evidence
      if (sawSemanticMismatch) {
        return {
          outcome: 'no_result',
          reason: 'no_semantically_eligible_result',
          classificationRefresh: { attempts: refreshAttempts },
        };
      }
      if (sawRefreshFailure) {
        return {
          outcome: 'no_result',
          reason: 'classification_refresh_failed',
          classificationRefresh: { attempts: refreshAttempts },
        };
      }
      if (sawInsufficientEvidence) {
        return {
          outcome: 'no_result',
          reason: 'insufficient_persisted_evidence',
          classificationRefresh: { attempts: refreshAttempts },
        };
      }
      return {
        outcome: 'no_result',
        reason: 'no_semantically_eligible_result',
        classificationRefresh: { attempts: refreshAttempts },
      };
    }

    // MISS: delegate to the existing, unchanged acquisition pipeline,
    // anchor name(s) flowing into the web query (routing changes), plus
    // the resolved anchor threaded through as non-authoritative
    // validation context.
    const planInput: BuildPlanInput = {
      destination: input.destination,
      deficits: [input.deficit],
      anchors: [input.anchor],
      breadth: 'focused',
    };
    const plan = this.acquisitionPlanner.buildAcquisitionPlan(planInput);
    const baseDiagnostics = (
      execution: Parameters<
        ExperienceAcquisitionService['materializeExecution']
      >[0],
      materialization: {
        resolvedCount: number;
        acceptedCount: number;
        rejectedCount: number;
        rejectionReasons: Record<string, number>;
        semanticallyEligibleCount: number;
      },
    ): AreaRouteWalkAcquisitionDiagnostics => ({
      anchorResolved: resolution.resolved,
      sourcePlanProviders: plan.sourcePlans.map((source) => source.provider),
      execution: {
        candidateCount: execution.candidates.length,
        structuredCandidateCount: execution.structuredCandidateCount,
        webCandidateCount: execution.webCandidateCount,
        webResults: (execution.webResults ?? []).map((web) => ({
          status: web.status,
          groundingStatus: web.groundingStatus,
          evidenceCount: web.evidenceKeys.length,
          extractorProvider: web.extractorProvider,
          extractorModel: web.extractorModel,
          candidateCount: web.candidateCount,
          validationErrors: web.validationErrors,
          failureReason: web.failureReason,
        })),
      },
      materialization,
    });

    if (plan.sourcePlans.length === 0) {
      return {
        outcome: 'no_result',
        reason: 'no_source_plan',
        diagnostics: baseDiagnostics(
          {
            candidates: [],
            observations: [],
            providerResults: {},
          },
          {
            resolvedCount: 0,
            acceptedCount: 0,
            rejectedCount: 0,
            rejectionReasons: {},
            semanticallyEligibleCount: 0,
          },
        ),
      };
    }

    const execution = await this.acquisitionService.executePlan(
      plan,
      input.executionLedger,
    );
    const validationScope: ExperienceValidationScope | undefined =
      resolution.resolved
        ? {
            kind:
              input.anchor.status === 'resolved' && input.anchor.kind === 'area'
                ? 'AREA'
                : 'ROUTE',
            anchorName: input.anchor.rawName,
            geoEntityId: resolution.geoEntityId,
            geometry: resolution.geometry,
          }
        : undefined; // mode C (tourism route, unresolved) has no external geometry to gate on -- ordinary validateExperience + the tourism-route identity check alone carry it
    // Task A6 (Root Cause #4) — only for a resolved AREA anchor with a
    // real OSM way/relation boundary in hand: narrow entity resolution's
    // own local OSM pool query to it, instead of the whole destination.
    // A ROUTE anchor has no polygon to query "within" (a real Overpass
    // area query needs a way/relation, not a LineString), so this stays
    // undefined for every other case — resolve() then falls back to
    // geographicScope, exactly today's behavior.
    const entityResolutionScope: GeographicScope | undefined =
      resolution.resolved &&
      input.anchor.status === 'resolved' &&
      input.anchor.kind === 'area' &&
      resolution.osmBoundary
        ? { kind: 'AREA_BOUNDARY', boundary: resolution.osmBoundary }
        : undefined;
    const materialized = await this.acquisitionService.materializeExecution(
      execution,
      {
        destinationName: input.destination.destinationName,
        destinationCountryCode: input.destinationCountryCode,
        geographicScope: input.geographicScope,
        validationScope,
        validationIntent: input.intentKey,
        entityResolutionScope,
      },
    );

    // Results below must be restricted to Experiences THIS execution
    // actually accepted -- a bare geographic/identity lookup can otherwise
    // return an unrelated, pre-existing, geographically-compatible catalog
    // row (e.g. a "Food Crawl San Telmo" that has nothing to do with this
    // walk request).
    const acceptedResults = materialized.resolved.filter(
      (r): r is typeof r & { experienceId: string } =>
        r.status === 'accepted' && typeof r.experienceId === 'string',
    );
    const acceptedIds = new Set(acceptedResults.map((r) => r.experienceId));
    const rejectionReasons: Record<string, number> = {};
    for (const result of materialized.resolved) {
      if (result.status !== 'rejected') continue;
      for (const reason of result.rejectionReasons) {
        rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
      }
    }
    const semanticallyEligible = (await geographicMatches()).filter(
      isSemanticallyEligible,
    );
    const diagnostics = baseDiagnostics(execution, {
      resolvedCount: materialized.resolved.length,
      acceptedCount: acceptedIds.size,
      rejectedCount: materialized.resolved.filter(
        (result) => result.status === 'rejected',
      ).length,
      rejectionReasons,
      semanticallyEligibleCount: semanticallyEligible.length,
    });
    if (acceptedIds.size === 0) {
      return {
        outcome: 'no_result',
        reason: 'no_accepted_results',
        diagnostics,
        lifecycle: { plan, execution, materialization: materialized },
      };
    }

    // Cutover M4 -- classification already happened inside
    // materializeExecution() above (the shared canonical materialization
    // boundary, spec cutover plan §6). This service no longer owns any
    // classification authority of its own.

    // POST-acquisition check: geography/identity intersected with THIS
    // execution's own accepted ids, AND current semantic eligibility (the
    // same isSemanticallyEligible predicate the WARM check uses, now
    // evaluated against the classification materializeExecution() just
    // persisted). A candidate that geographically/structurally accepted
    // but classified into a DIFFERENT intent than requested remains valid,
    // persisted catalog knowledge -- it is simply not a successful result
    // for THIS request.
    const postHit = semanticallyEligible.find((row) => acceptedIds.has(row.id));
    return postHit
      ? {
          outcome: 'acquired',
          experienceId: postHit.id,
          lifecycle: { plan, execution, materialization: materialized },
        }
      : {
          outcome: 'no_result',
          reason: 'no_semantically_eligible_result',
          diagnostics,
          lifecycle: { plan, execution, materialization: materialized },
        };
  }
}
