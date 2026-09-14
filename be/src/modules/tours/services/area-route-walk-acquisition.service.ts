import { Injectable } from '@nestjs/common';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import { Coordinates } from '@shared/utils/distance.utils';
import { AreaRouteAnchorResolverService } from './area-route-anchor-resolver.service';
import { ExperienceCatalogService } from './experience-catalog.service';
import {
  BuildPlanInput,
  ExperienceAcquisitionPlannerService,
} from './experience-acquisition-planner.service';
import {
  ExperienceAcquisitionService,
  ResolverEvidenceItem,
} from './experience-acquisition.service';
import {
  CURRENT_CLASSIFICATION_PROMPT_VERSION,
  canReuseClassification,
  ExperienceClassificationService,
} from './experience-classification.service';
import { AnchoredPlace } from '../interfaces/preference-spec.interface';
import { PreferenceFacetDeficit } from '../interfaces/experience-acquisition-plan.interface';
import { ExperienceDiscoveryScope } from '../interfaces/experience-discovery.interface';
import { ExperienceValidationScope } from '../interfaces/experience-resolution.interface';
import { normalizeWizardFacet } from '../utils/preference-facet-merge.util';
import { candidateMatchesPreferenceFacet } from '../utils/preference-facet-matching.util';
import { normalizeGeoName } from '../utils/nominatim-match.util';

export interface AreaRouteWalkAcquisitionInput {
  /**
   * Kind 'area' | 'route'; caller guarantees EXACTLY ONE relevant area/
   * route anchor for THIS single-anchor primitive (2+ relevant anchors for
   * one deficit is mode D — not handled here, see the plan's non-goals)
   * and filters out 'venue'/'unknown' anchors before calling.
   */
  anchor: AnchoredPlace;
  intentKey: 'walk' | 'route_like';
  /** .latitude/.longitude/.radiusMeters feed the tourism-route identity
   * check (mode C) when the canonical ROUTE does not resolve. */
  destination: ExperienceDiscoveryScope;
  destinationCountryCode?: string;
  destinationPoint?: Coordinates;
  /** OsmCandidate-shaped at runtime. */
  destinationBoundary: unknown;
  destinationPointRadius?: {
    latitude: number;
    longitude: number;
    radiusMeters: number;
  };
  /** The canonical facet deficit this call is acquiring for -- routed
   * straight into the plan, never recomputed from a candidate pool. */
  deficit: PreferenceFacetDeficit;
  semanticQuery?: string;
}

export type AreaRouteWalkAcquisitionResult =
  | { outcome: 'reused'; experienceId: string }
  | { outcome: 'acquired'; experienceId: string }
  | { outcome: 'no_result' };

/**
 * Task B5 (D5) — for a single area/route anchor combined with
 * intent:walk/route_like, checks the catalog FIRST for a compatible
 * persisted multi-component Experience genuinely inside/along that named
 * area/route; only on a genuine miss does it acquire. Reuse-first holds
 * for all 3 anchor shapes this primitive supports: a single AREA, a
 * canonical geographic ROUTE, and a named tourism-route Experience with no
 * canonical ROUTE geometry (mode C) — the last of which requires a real,
 * evidence-only Stage-6 classification pass this service itself owns
 * (rounds 7-9), not a hypothetical future wiring step.
 */
@Injectable()
export class AreaRouteWalkAcquisitionService {
  constructor(
    private readonly anchorResolver: AreaRouteAnchorResolverService,
    private readonly catalog: ExperienceCatalogService,
    private readonly acquisitionPlanner: ExperienceAcquisitionPlannerService,
    private readonly acquisitionService: ExperienceAcquisitionService,
    private readonly classifier: ExperienceClassificationService,
  ) {}

  async acquireOrReuse(
    input: AreaRouteWalkAcquisitionInput,
  ): Promise<AreaRouteWalkAcquisitionResult> {
    const facet = normalizeWizardFacet('intent', input.intentKey);

    // Resolve ONCE per call -- reused by the warm check, the
    // validationScope passed into acquisition/materialization, AND the
    // post-acquisition re-check.
    const resolution =
      input.anchor.kind === 'area'
        ? await this.anchorResolver.resolveArea(
            input.anchor,
            input.destinationCountryCode,
            input.destinationPoint,
          )
        : input.anchor.kind === 'route'
          ? await this.anchorResolver.resolveRoute(
              input.anchor,
              input.destinationBoundary as OsmCandidate | undefined,
              input.destinationPointRadius,
            )
          : ({ resolved: false } as const);

    // Geographic/identity lookup, SPLIT from the intent-facet/semantic
    // filter. Uniform across all 3 single-anchor modes (A/B/C) -- each has
    // its own real catalog-native identity check.
    const geographicMatches = async (): Promise<
      Array<{ id: string; metadata?: unknown }>
    > => {
      if (input.anchor.kind === 'area') {
        if (!resolution.resolved) return [];
        return this.catalog.findVerifiedMultiComponentCoveredByArea(
          resolution.geoEntityId,
        );
      }
      if (input.anchor.kind === 'route') {
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
    const warmHit = (await geographicMatches()).find(isSemanticallyEligible);
    if (warmHit) return { outcome: 'reused', experienceId: warmHit.id };

    // MISS: delegate to the existing, unchanged acquisition pipeline,
    // anchor name(s) flowing into the web query (routing changes), plus
    // the resolved anchor threaded through as non-authoritative
    // validation context.
    const planInput: BuildPlanInput = {
      destination: input.destination,
      deficits: [input.deficit],
      semanticQuery: input.semanticQuery,
      anchors: [input.anchor],
      breadth: 'focused',
    };
    const plan = this.acquisitionPlanner.buildAcquisitionPlan(planInput);
    if (plan.sourcePlans.length === 0) return { outcome: 'no_result' };

    const execution = await this.acquisitionService.executePlan(plan);
    const validationScope: ExperienceValidationScope | undefined =
      resolution.resolved
        ? {
            kind: input.anchor.kind === 'area' ? 'AREA' : 'ROUTE',
            anchorName: input.anchor.rawName,
            geoEntityId: resolution.geoEntityId,
            geometry: resolution.geometry,
          }
        : undefined; // mode C (tourism route, unresolved) has no external geometry to gate on -- ordinary validateExperience + the tourism-route identity check alone carry it
    const materialized = await this.acquisitionService.materializeExecution(
      execution,
      {
        destinationName: input.destination.destinationName,
        destinationCountryCode: input.destinationCountryCode,
        destinationBoundary: input.destinationBoundary,
        destinationPointRadius: input.destinationPointRadius,
        validationScope,
        validationIntent: input.intentKey,
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
    if (acceptedIds.size === 0) return { outcome: 'no_result' };

    // Classify exactly ONCE per CANONICAL experienceId, using the
    // deduplicated union of evidenceKeys cited by EVERY accepted candidate
    // that converged to that same experienceId -- never per accepted
    // candidate (multiple accepted candidates can legitimately dedupe onto
    // the same canonical Experience), and never a different canonical
    // Experience's evidence. Real evidence-only convergence, using the
    // already-built B2 classifier + B4 merge util (via
    // applyEvidenceClassification), scoped to what THIS call accepted --
    // never a rewrite of the resolver's general persistence path.
    const evidenceByKey = new Map(
      (execution.evidence ?? [])
        .filter(
          (item): item is typeof item & { key: string } =>
            typeof item.key === 'string',
        )
        .map((item) => [item.key, item]),
    );
    const acceptedByExperienceId = new Map<string, typeof acceptedResults>();
    for (const accepted of acceptedResults) {
      const group = acceptedByExperienceId.get(accepted.experienceId) ?? [];
      group.push(accepted);
      acceptedByExperienceId.set(accepted.experienceId, group);
    }
    for (const [experienceId, results] of acceptedByExperienceId) {
      const [experience] = await this.catalog.findVerifiedByIds([experienceId]);
      if (!experience) continue;
      const evidenceKeys = Array.from(
        new Set(results.flatMap((result) => result.candidate.evidenceKeys)),
      ).sort();
      // ExperienceClassificationService only accepts evidence that actually
      // carries snippet text -- an evidence item with no snippet has
      // nothing to substantiate a claim from, so it is dropped here rather
      // than coerced with a cast or a fabricated placeholder.
      const candidateEvidence = evidenceKeys
        .map((key) => evidenceByKey.get(key))
        .filter(
          (item): item is ResolverEvidenceItem & { snippet: string } =>
            typeof item?.snippet === 'string',
        );
      const classification = await this.classifier.classify(
        experience.canonicalName,
        candidateEvidence,
      );
      await this.catalog.applyEvidenceClassification(
        experienceId,
        classification,
      );
    }

    // POST-acquisition check: geography/identity intersected with THIS
    // execution's own accepted ids, AND current semantic eligibility
    // (the same isSemanticallyEligible predicate the WARM check uses, now
    // evaluated against the freshly persisted classification from the
    // loop above). A candidate that geographically/structurally accepted
    // but classified into a DIFFERENT intent than requested remains valid,
    // persisted catalog knowledge -- it is simply not a successful result
    // for THIS request.
    const postHit = (await geographicMatches()).find(
      (row) => acceptedIds.has(row.id) && isSemanticallyEligible(row),
    );
    return postHit
      ? { outcome: 'acquired', experienceId: postHit.id }
      : { outcome: 'no_result' };
  }
}
