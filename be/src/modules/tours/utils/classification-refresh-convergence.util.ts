/**
 * Classification refresh convergence for warm catalog reuse.
 *
 * When a canonical Experience already exists in the catalog but its
 * classification is degraded/stale/malformed, this helper coordinates a
 * classification refresh using ONLY persisted evidence — never triggering
 * Internet reacquisition.
 *
 * This is NOT a second classification authority. It delegates all semantic
 * classification to the canonical `ExperienceClassificationService.classify()`
 * and persists through the canonical `ExperienceCatalogService.applyEvidenceClassification()`.
 * This helper only orchestrates: read persisted evidence → classify → persist.
 */
import {
  ExperienceCatalogService,
  VerifiedExperienceRow,
} from '../services/experience-catalog.service';
import {
  ExperienceClassificationService,
  ClassificationResult,
  ClassificationFailure,
} from '../services/experience-classification.service';
import { ExperienceGroundingEvidence } from '../interfaces/experience-grounding.interface';

export interface ClassificationRefreshDeps {
  catalog: Pick<
    ExperienceCatalogService,
    'findVerifiedByIds' | 'applyEvidenceClassification'
  >;
  classifier: Pick<ExperienceClassificationService, 'classify'> &
    Partial<Pick<ExperienceClassificationService, 'getAuditIdentity'>>;
}

export type ClassificationRefreshResult =
  | {
      status: 'refreshed';
      experienceId: string;
      classification: ClassificationResult;
      provider?: string;
      model?: string;
    }
  | {
      status: 'insufficient_evidence';
      experienceId: string;
      reason: 'NO_PERSISTED_EVIDENCE';
    }
  | {
      status: 'refresh_failed';
      experienceId: string;
      classification: ClassificationResult;
      failure: ClassificationFailure;
      provider?: string;
      model?: string;
    };

/**
 * Reconstructs `ExperienceGroundingEvidence[]` from persisted `ExperienceEvidence` rows.
 * Maps the persisted record shape to the canonical classification input contract.
 */
function reconstructGroundingEvidence(
  evidence: NonNullable<VerifiedExperienceRow['metadata']> extends never
    ? never
    : Array<{
        id: string;
        source: string;
        url?: string | null;
        title?: string | null;
        snippet?: string | null;
      }>,
): ExperienceGroundingEvidence[] {
  return evidence
    .filter(
      (item) => typeof item.snippet === 'string' && item.snippet.length > 0,
    )
    .map((item) => ({
      key: item.id,
      source: item.source,
      snippet: item.snippet as string,
      ...(item.title ? { title: item.title } : {}),
      ...(item.url ? { url: item.url } : {}),
    }));
}

/**
 * Attempts to refresh a degraded/stale/malformed classification using ONLY
 * persisted evidence already associated with the canonical Experience.
 *
 * This function NEVER performs Internet acquisition, web search, source-content
 * retrieval, candidate extraction, entity resolution, or geography validation.
 * It reads persisted `ExperienceEvidence` rows and calls the canonical classifier.
 *
 * Returns a typed result that callers can use to decide whether to reuse the
 * Experience or return an honest bounded outcome.
 */
export async function refreshClassificationFromPersistedEvidence(
  experienceId: string,
  deps: ClassificationRefreshDeps,
): Promise<ClassificationRefreshResult> {
  const [experience] = await deps.catalog.findVerifiedByIds([experienceId]);
  if (!experience) {
    return {
      status: 'insufficient_evidence',
      experienceId,
      reason: 'NO_PERSISTED_EVIDENCE',
    };
  }

  // Reconstruct grounding evidence from persisted ExperienceEvidence rows.
  // The `evidence` field is included in findVerifiedByIds via Prisma include.
  const persistedEvidence = (
    experience as unknown as {
      evidence?: Array<{
        id: string;
        source: string;
        url?: string | null;
        title?: string | null;
        snippet?: string | null;
      }>;
    }
  ).evidence;

  const groundingEvidence = reconstructGroundingEvidence(
    persistedEvidence ?? [],
  );

  if (groundingEvidence.length === 0) {
    return {
      status: 'insufficient_evidence',
      experienceId,
      reason: 'NO_PERSISTED_EVIDENCE',
    };
  }

  const classification = await deps.classifier.classify(
    experience.canonicalName,
    groundingEvidence,
  );

  if (classification.state === 'degraded') {
    const identity = deps.classifier.getAuditIdentity?.();
    return {
      status: 'refresh_failed',
      experienceId,
      classification,
      failure: classification.failure ?? {
        stage: 'provider_call',
        reason: 'PROVIDER_ERROR',
      },
      provider: identity?.provider,
      model: identity?.model ?? classification.modelId,
    };
  }

  await deps.catalog.applyEvidenceClassification(experienceId, classification);
  const identity = deps.classifier.getAuditIdentity?.();
  return {
    status: 'refreshed',
    experienceId,
    classification,
    provider: identity?.provider,
    model: identity?.model ?? classification.modelId,
  };
}
