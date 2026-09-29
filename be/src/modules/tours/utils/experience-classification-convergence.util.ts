/**
 * Cutover M4 — the ONE place evidence-only classification converges for
 * EVERY acquisition strategy's materialized output (spec cutover plan §6).
 *
 * `ExperienceAcquisitionService.materializeExecution()` calls this
 * immediately after `ExperienceProposalResolverService.resolve()` returns,
 * so classification is a property of the shared materialization boundary
 * itself, never a per-strategy opt-in. `AreaRouteWalkAcquisitionService`
 * (Task B5) previously implemented this exact grouping/classification
 * logic as its own local step; that step is now deleted in favor of this
 * shared primitive (single source of policy truth).
 *
 * This primitive also owns warm persisted classification refresh: when a
 * canonical Experience exists but its classification is degraded/stale/
 * malformed, the same convergence path runs using persisted evidence.
 */
import {
  ExperienceCatalogService,
  VerifiedExperienceRow,
} from '../services/experience-catalog.service';
import {
  CURRENT_CLASSIFICATION_PROMPT_VERSION,
  ExperienceClassificationService,
  canReuseClassification,
  readPersistedClassification,
  ClassificationFailure,
} from '../services/experience-classification.service';
import { ResolverEvidenceItem } from '../services/experience-acquisition.service';
import { ResolvedExperienceCandidate } from '../interfaces/experience-resolution.interface';
import { ExperienceGroundingEvidence } from '../interfaces/experience-grounding.interface';

export interface ClassificationConvergenceDeps {
  catalog: Pick<
    ExperienceCatalogService,
    | 'findVerifiedByIds'
    | 'applyEvidenceClassification'
    | 'findClassificationContextById'
  >;
  classifier: Pick<ExperienceClassificationService, 'classify'> &
    Partial<Pick<ExperienceClassificationService, 'getAuditIdentity'>>;
}

export interface ClassificationAuditRecord {
  experienceId: string;
  state: 'classified' | 'degraded' | 'reused';
  provider?: string;
  model?: string;
  promptVersion?: number;
  themes: string[];
  intents: string[];
  traits: string[];
  reasoningEvidence: Array<{
    facet: string;
    evidenceKeys: string[];
    reason: string;
  }>;
  failure?: ClassificationFailure;
}

/**
 * The ONE canonical classification convergence primitive.
 *
 * Owns: canReuseClassification, classifier.classify, applyEvidenceClassification,
 * provider/model audit identity, classified/degraded/reused result projection.
 *
 * Used by both:
 * - COLD acquisition classification (via classifyAcceptedResultsByExperience)
 * - WARM persisted classification refresh (via AreaRouteWalkAcquisitionService)
 *
 * Behavior:
 * - canReuseClassification == true → return reused, classifier NOT called
 * - Non-reusable + usable evidence → classify → persist → return classified/degraded
 * - Non-reusable + no usable evidence → return degraded (honest empty)
 */
export async function convergeExperienceClassification(
  experienceId: string,
  groundingEvidence: ExperienceGroundingEvidence[],
  deps: ClassificationConvergenceDeps,
): Promise<ClassificationAuditRecord> {
  const [experience]: VerifiedExperienceRow[] =
    await deps.catalog.findVerifiedByIds([experienceId]);
  if (!experience) {
    return {
      experienceId,
      state: 'degraded',
      themes: [],
      intents: [],
      traits: [],
      reasoningEvidence: [],
      failure: {
        stage: 'response_validation',
        reason: 'MALFORMED_RESPONSE',
      },
    };
  }

  if (
    canReuseClassification(
      experience.metadata,
      CURRENT_CLASSIFICATION_PROMPT_VERSION,
    )
  ) {
    const persisted = readPersistedClassification(experience.metadata);
    return {
      experienceId,
      state: 'reused',
      themes: persisted?.themes ?? [],
      intents: persisted?.intents ?? [],
      traits: persisted?.traits ?? [],
      reasoningEvidence: persisted?.reasoningEvidence ?? [],
      promptVersion: persisted?.promptVersion,
      model: persisted?.modelId || undefined,
    };
  }

  const classification = await deps.classifier.classify(
    experience.canonicalName,
    groundingEvidence,
  );
  await deps.catalog.applyEvidenceClassification(experienceId, classification);
  const identity = deps.classifier.getAuditIdentity?.();
  return {
    experienceId,
    state: classification.state,
    provider: identity?.provider,
    model: identity?.model ?? classification.modelId,
    promptVersion: classification.promptVersion,
    themes: classification.themes,
    intents: classification.intents,
    traits: classification.traits,
    reasoningEvidence: classification.reasoningEvidence,
    ...(classification.failure ? { failure: classification.failure } : {}),
  };
}

/**
 * Groups this materialization call's own accepted results by canonical
 * `experienceId` (several accepted candidates can legitimately dedupe onto
 * the same canonical Experience — classifying per converging candidate
 * instead of per canonical id would make the final persisted classification
 * depend on candidate/provider iteration order), then classifies each
 * canonical id AT MOST once, using the deduplicated union of evidenceKeys
 * cited by every candidate that converged to it.
 *
 * A canonical id whose CURRENT metadata already satisfies
 * `canReuseClassification` is left untouched — valid current classification
 * is reused, never unconditionally recomputed. Evidence items with no
 * snippet text (nothing to substantiate a claim from) are dropped before
 * classifying rather than coerced or given a fabricated placeholder; if
 * that leaves zero usable evidence, `ExperienceClassificationService.
 * classify()` itself returns an honest empty/degraded result — this
 * function never fabricates themes/intents to fill an evidence gap.
 *
 * Never reads requested preferences/facets — only the Experience's own
 * canonical name and its own cited evidence, matching the classification
 * boundary's evidence-only invariant.
 */
export async function classifyAcceptedResultsByExperience(
  resolved: ResolvedExperienceCandidate[],
  evidence: ResolverEvidenceItem[] | undefined,
  deps: ClassificationConvergenceDeps,
): Promise<ClassificationAuditRecord[]> {
  const acceptedResults = resolved.filter(
    (
      result,
    ): result is ResolvedExperienceCandidate & { experienceId: string } =>
      result.status === 'accepted' && typeof result.experienceId === 'string',
  );
  const audit: ClassificationAuditRecord[] = [];
  if (acceptedResults.length === 0) return audit;

  const evidenceByKey = new Map(
    (evidence ?? [])
      .filter(
        (item): item is ResolverEvidenceItem & { key: string } =>
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
    const evidenceKeys = Array.from(
      new Set(results.flatMap((result) => result.candidate.evidenceKeys)),
    ).sort();
    const candidateEvidence = evidenceKeys
      .map((key) => evidenceByKey.get(key))
      .filter(
        (item): item is ResolverEvidenceItem & { snippet: string } =>
          typeof item?.snippet === 'string',
      );

    const record = await convergeExperienceClassification(
      experienceId,
      candidateEvidence,
      deps,
    );
    audit.push(record);
  }
  return audit;
}
