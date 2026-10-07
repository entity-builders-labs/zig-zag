import { SerializableTraceStepInput } from '../generation-trace-recorder.util';
import {
  CandidateResolutionAudit,
  ComponentResolutionAudit,
  ComponentResolutionFact,
  ExperienceGeographicValidationResult,
  ExperienceResolutionResponse,
  FinalExperienceResolutionResponse,
  IdentityEvidence,
  ResolutionAttemptAudit,
} from '../../interfaces/experience-resolution.interface';
import { identityEvidenceRole } from '../identity-evidence-role.policy';
import { traceCandidateKey } from '../experience-candidate-correlation.util';
import {
  buildCompositeOutcome,
  describeComponentResolution,
  describeCompositeOutcome,
} from '../component-resolution-facts.util';
import {
  DEFAULT_GEOGRAPHIC_AUTHORIZATION,
  projectGeographicPolicy,
} from '../geographic-validation-authorization.util';

export function projectEntityResolutionStepInput(
  resolution: ExperienceResolutionResponse,
  acquisitionContext?: { strategy: string; passNumber: number },
): SerializableTraceStepInput {
  const acceptedEntities = resolution.resolved.filter(
    (r) => r.status === 'accepted',
  );
  const rejectedEntities = resolution.resolved.filter(
    (r) => r.status !== 'accepted',
  );
  const componentResolutionDetails = resolution.resolved
    .map((entry) => describeComponentResolution(entry.componentResolution))
    .filter(Boolean)
    .join('');

  const forensicAudits: CandidateResolutionAudit[] =
    resolution.entityResolution?.forensicAudit ??
    (resolution as { forensicAudit?: CandidateResolutionAudit[] })
      .forensicAudit ??
    [];

  return {
    name: 'resolution.entity',
    description: `Resolución de identidades reales: ${acceptedEntities.length} aceptadas, ${rejectedEntities.length} rechazadas${componentResolutionDetails}`,
    component: 'ExperienceProposalResolverService',
    decision: {
      status: acceptedEntities.length > 0 ? 'PASS' : 'WARN',
      outcome:
        acceptedEntities.length > 0
          ? 'ENTITIES_RESOLVED'
          : 'NO_ENTITIES_RESOLVED',
      reasonCodes: rejectedEntities.flatMap((r) => r.rejectionReasons),
    },
    facts: {
      acquisitionContext,
      totalCandidates: resolution.totalCandidates,
      acceptedCount: acceptedEntities.length,
      rejectedCount: rejectedEntities.length,
      entityResolutionAudit: forensicAudits.map(
        (audit: CandidateResolutionAudit) => ({
          candidateTraceKey: audit.candidateTraceKey,
          candidateName: audit.candidateName,
          hints: audit.componentAudits.map((comp: ComponentResolutionAudit) => {
            const fact = audit.componentResolution?.components?.find(
              (item: ComponentResolutionFact) => item.hintKey === comp.hintKey,
            );
            return {
              key: comp.hintKey,
              name: comp.hintName,
              ...(comp.sourceName ? { sourceName: comp.sourceName } : {}),
              ...(comp.normalizationKind
                ? { normalizationKind: comp.normalizationKind }
                : {}),
              status: comp.finalStatus,
              reason: comp.finalReason,
              resolvedGeoEntity: comp.resolvedGeoEntity,
              attempts: comp.attempts,
              ...(fact
                ? {
                    identityStatus: fact.identityStatus,
                    ...(fact.resolved ? { geography: fact.resolved } : {}),
                    ...(fact.deficit ? { deficit: fact.deficit } : {}),
                  }
                : {}),
            };
          }),
          ...(audit.componentResolution
            ? {
                coverage: audit.componentResolution.coverage,
                componentScope: audit.componentResolution.scope,
              }
            : {}),
        }),
      ),
    },
    subjects: resolution.resolved.map((entry) => {
      const componentDesc = describeComponentResolution(
        entry.componentResolution,
      );
      const baseReason = entry.rejectionReasons.join(', ');
      const combinedReason = baseReason
        ? `${baseReason}${componentDesc}`
        : componentDesc || undefined;
      return {
        subject: {
          kind: 'candidate',
          id: traceCandidateKey(entry.candidate),
          label: entry.candidate.name,
        },
        decision: {
          status:
            entry.status === 'accepted' ? ('PASS' as const) : ('FAIL' as const),
          outcome: entry.status.toUpperCase(),
          reason: combinedReason,
          reasonCodes: entry.rejectionReasons,
        },
        references: entry.experienceId
          ? [
              {
                kind: 'experience',
                id: entry.experienceId,
                label: entry.candidate.name,
              },
            ]
          : undefined,
      };
    }),
  };
}

export function projectCatalogMaterializationStepInput(
  resolution: ExperienceResolutionResponse,
): SerializableTraceStepInput {
  const materialization = resolution.materialization;
  const finalResolved = materialization?.resolved ?? resolution.resolved;
  const materialized = finalResolved.filter(
    (entry) => entry.status === 'accepted' && entry.experienceId,
  );
  const persistedExperienceIds = materialized.map(
    (entry) => entry.experienceId as string,
  );
  const rejectedMaterialization = finalResolved.filter(
    (entry) => !entry.experienceId,
  );
  const validationByTraceKey = new Map<
    string,
    ExperienceGeographicValidationResult
  >();
  (resolution.geographicValidation?.results ?? []).forEach(
    (validation, index) => {
      const validated = resolution.geographicValidation?.resolved?.[index];
      if (validated) {
        validationByTraceKey.set(
          traceCandidateKey(validated.candidate),
          validation,
        );
      }
    },
  );
  const compositeOutcomes = finalResolved.map((entry) =>
    buildCompositeOutcome(
      entry,
      validationByTraceKey.get(traceCandidateKey(entry.candidate)),
    ),
  );
  const outcomeSummaries = finalResolved.map((entry, index) =>
    describeCompositeOutcome(entry.candidate.name, compositeOutcomes[index]),
  );
  const outcomeText = outcomeSummaries.length
    ? ` — ${outcomeSummaries.join('; ')}`
    : '';
  const materializationAudit = finalResolved.map((entry, index) => ({
    candidateTraceKey: traceCandidateKey(entry.candidate),
    candidateName: entry.candidate.name,
    accepted: entry.status === 'accepted' && Boolean(entry.experienceId),
    experienceId: entry.experienceId,
    canonicalName: entry.experienceId ? entry.candidate.name : undefined,
    persistedComponentCount: entry.experienceId
      ? entry.resolvedEntities.filter(
          (entity) => entity.status === 'resolved' && entity.geoEntityId,
        ).length
      : undefined,
    rejectionReasons: entry.rejectionReasons,
    compositeOutcome: compositeOutcomes[index],
  }));

  return {
    name: 'catalog.materialization',
    description: `Materialización en catálogo (${persistedExperienceIds.length} creadas/actualizadas, ${rejectedMaterialization.length} no materializadas)${outcomeText}`,
    component: 'ExperienceCatalogService',
    decision: {
      status:
        persistedExperienceIds.length > 0
          ? rejectedMaterialization.length === 0
            ? 'PASS'
            : 'WARN'
          : 'WARN',
      outcome:
        persistedExperienceIds.length > 0
          ? 'MATERIALIZED'
          : 'NO_MATERIALIZED_EXPERIENCES',
    },
    facts: {
      materializedCount: persistedExperienceIds.length,
      rejectedCount: rejectedMaterialization.length,
      persistedExperienceIds,
      materializationAudit,
    },
    references: persistedExperienceIds.map((id) => ({
      kind: 'experience',
      id,
    })),
  };
}

export function projectGeographicValidationStepInput(
  result: FinalExperienceResolutionResponse,
): SerializableTraceStepInput {
  const geoValidation = result.geographicValidation;
  const acceptedGeo = geoValidation?.results?.filter((e) => e.accepted) ?? [];
  const rejectedGeo = geoValidation?.results?.filter((e) => !e.accepted) ?? [];
  return {
    name: 'geography.validation',
    description: `Validación geográfica: ${acceptedGeo.length} aceptadas, ${rejectedGeo.length} rechazadas`,
    component: 'CompositeGeographicValidationService',
    decision: {
      status:
        rejectedGeo.length === 0
          ? 'PASS'
          : acceptedGeo.length > 0
            ? 'WARN'
            : 'FAIL',
      outcome:
        rejectedGeo.length === 0
          ? 'ALL_ACCEPTED'
          : acceptedGeo.length > 0
            ? 'PARTIAL_ACCEPTED'
            : 'ALL_REJECTED',
      reasonCodes: rejectedGeo.flatMap((r) => r.rejectionReasons ?? []),
    },
    facts: {
      acceptedCount: geoValidation?.acceptedCount ?? 0,
      rejectedCount: geoValidation?.rejectedCount ?? 0,
      destinationBoundary: result.destinationBoundary,
      validationScope: result.validationScope,
      geographicValidationAudit: (geoValidation?.results ?? []).map(
        (entry, index) => {
          const resolvedCandidate = geoValidation?.resolved?.[index];
          const decisionEntities = new Map(
            (entry.decisionEntities ?? []).map((decision) => [
              decision.hintKey ?? decision.geoEntityId,
              decision,
            ]),
          );
          return {
            candidateTraceKey: resolvedCandidate
              ? traceCandidateKey(resolvedCandidate.candidate)
              : `unmatched-validation-result-${index}`,
            candidateName: entry.proposalName,
            accepted: entry.accepted,
            status: entry.status,
            strategy: entry.strategy,
            // Trace vocabulary: `geographicPolicy`, never a key containing
            // "authorization" -- the trace sanitizer redacts such keys as
            // credentials (generation-trace-recorder.util.ts SECRET_KEY).
            geographicPolicy: projectGeographicPolicy(
              resolvedCandidate?.geographicAuthorization ??
                DEFAULT_GEOGRAPHIC_AUTHORIZATION,
            ),
            destinationBoundary: result.destinationBoundary,
            rejectionReasons: entry.rejectionReasons,
            coherence: entry.coherence,
            ...(entry.experienceScope
              ? { experienceScope: entry.experienceScope }
              : {}),
            ...(entry.destinationRelation
              ? { destinationRelation: entry.destinationRelation }
              : {}),
            components: (resolvedCandidate?.resolvedEntities ?? []).map(
              (entity) => {
                const decision = decisionEntities.get(
                  entity.hintKey ?? entity.geoEntityId,
                );
                return {
                  hintName: entity.hintName,
                  hintKey: entity.hintKey,
                  role: entity.role,
                  resolvedGeoEntityId: entity.geoEntityId,
                  relation: decision?.relation ?? 'evaluated',
                  decisionReason: decision?.decisionReason,
                  distanceToBoundaryMeters: decision?.distanceToBoundaryMeters,
                  distanceFromRouteMeters: decision?.distanceFromRouteMeters,
                };
              },
            ),
          };
        },
      ),
    },
  };
}

/**
 * COLD #11 observability prerequisite: one compact, bounded step per
 * MULTI-component candidate with exactly the per-component identity facts
 * needed to diagnose a composite (no raw provider payloads, no identity
 * evidence lists, no rejected-place name lists). The full
 * `resolution.entity` step can exceed the trace step payload limit and be
 * truncated; this projection is sized per candidate instead.
 */
export function projectComponentIdentityStepInputs(
  resolution: ExperienceResolutionResponse,
  context: { strategy: string; passNumber: number; workUnitKind: string },
): SerializableTraceStepInput[] {
  const forensicAudits: CandidateResolutionAudit[] =
    resolution.entityResolution?.forensicAudit ??
    (resolution as { forensicAudit?: CandidateResolutionAudit[] })
      .forensicAudit ??
    [];
  const resolvedByKey = new Map(
    resolution.resolved.map((entry) => [
      traceCandidateKey(entry.candidate),
      entry,
    ]),
  );

  return forensicAudits
    .filter((audit) => audit.componentAudits.length >= 2)
    .map((audit) => {
      const resolved = resolvedByKey.get(audit.candidateTraceKey);
      const policy = projectGeographicPolicy(
        audit.geographicAuthorization ?? DEFAULT_GEOGRAPHIC_AUTHORIZATION,
      );
      const components = audit.componentAudits.map(projectComponentIdentity);
      const resolvedCount = components.filter(
        (component) => component.finalStatus === 'resolved',
      ).length;
      return {
        name: 'resolution.component_identity',
        description: `Identidad por componente de "${audit.candidateName}": ${resolvedCount}/${components.length} resueltos (política geográfica ${policy.kind})`,
        component: 'ExperienceProposalResolverService',
        decision: {
          status:
            resolvedCount === components.length
              ? ('PASS' as const)
              : ('WARN' as const),
          outcome:
            resolvedCount === components.length
              ? 'ALL_COMPONENTS_RESOLVED'
              : resolvedCount > 0
                ? 'PARTIAL_COMPONENTS_RESOLVED'
                : 'NO_COMPONENTS_RESOLVED',
        },
        facts: {
          acquisitionContext: {
            strategy: context.strategy,
            passNumber: context.passNumber,
            workUnitKind: context.workUnitKind,
          },
          candidateTraceKey: audit.candidateTraceKey,
          candidateName: audit.candidateName,
          geographicPolicy: policy,
          ...(audit.componentSearchScope
            ? { componentSearchScope: audit.componentSearchScope }
            : {}),
          ...(resolved
            ? {
                candidateStatus: resolved.status,
                rejectionReasons: resolved.rejectionReasons,
              }
            : {}),
          components,
        },
        subjects: [
          {
            subject: {
              kind: 'candidate',
              id: audit.candidateTraceKey,
              label: audit.candidateName,
            },
            decision: {
              status:
                resolvedCount === components.length
                  ? ('PASS' as const)
                  : ('WARN' as const),
              outcome: `${resolvedCount}_OF_${components.length}_RESOLVED`,
            },
          },
        ],
      };
    });
}

/**
 * Why IdentityVerifier decided what it did for one attempt, from normalized
 * facts only (no provider payloads): the rule, the evidence it read with
 * each fact's role, the candidate's strong identities, and the qualifiers
 * every identity decision depends on (contextual correspondence, the basis
 * of geographic grounding, competitor examination).
 */
function projectIdentityDecision(attempt: ResolutionAttemptAudit) {
  if (!attempt.verificationRule) return undefined;
  const find = <T extends IdentityEvidence['type']>(type: T) =>
    attempt.identityEvidence.find(
      (item): item is Extract<IdentityEvidence, { type: T }> =>
        item.type === type,
    );
  const contextual = find('CONTEXTUAL_CORRESPONDENCE');
  const geographic = find('GEOGRAPHIC_CORRESPONDENCE');
  const competitors = find('COMPETITOR_EXAMINATION');
  return {
    rule: attempt.verificationRule,
    decisiveEvidence: (attempt.decisiveEvidence ?? []).map((item) => ({
      ...item,
      role: identityEvidenceRole(item),
    })),
    evidence: attempt.identityEvidence.map((item) => ({
      type: item.type,
      role: identityEvidenceRole(item),
    })),
    candidateStrongIds: (attempt.selectedCandidate?.identities ?? []).map(
      (identity) => `${identity.provider}/${identity.externalId}`,
    ),
    ...(contextual ? { contextualCorrespondence: contextual.outcome } : {}),
    ...(geographic ? { geographicCorrespondence: geographic.basis } : {}),
    ...(competitors
      ? {
          competitors: {
            outcome: competitors.outcome,
            competitorCount: competitors.competitorCount,
          },
        }
      : {}),
  };
}

function projectComponentIdentity(component: ComponentResolutionAudit) {
  const attempts = component.attempts.map((attempt) => ({
    strategy: attempt.strategy,
    ...(attempt.provider ? { provider: attempt.provider } : {}),
    executionStatus: attempt.executionStatus,
    candidateAcquired: attempt.candidateAcquired,
    ...(attempt.selectedCandidate
      ? {
          selectedCandidate: {
            name: attempt.selectedCandidate.canonicalName,
            kind: attempt.selectedCandidate.kind,
            ...(attempt.selectedCandidate.latitude !== undefined &&
            attempt.selectedCandidate.longitude !== undefined
              ? {
                  latitude: attempt.selectedCandidate.latitude,
                  longitude: attempt.selectedCandidate.longitude,
                }
              : {}),
          },
        }
      : {}),
    ...(attempt.verificationDecision
      ? { verificationDecision: attempt.verificationDecision }
      : {}),
    ...(attempt.verificationRule
      ? { verificationRule: attempt.verificationRule }
      : {}),
    ...(attempt.destinationCompatibility
      ? { destinationCompatibility: attempt.destinationCompatibility }
      : {}),
    ...(attempt.placeSearch
      ? {
          placeSearch: {
            resultCount: attempt.placeSearch.resultCount,
            viableCount: attempt.placeSearch.viableCount,
            rejectedCount: attempt.placeSearch.rejected.length,
            ...(attempt.placeSearch.searchWindow
              ? { searchWindow: attempt.placeSearch.searchWindow }
              : {}),
          },
        }
      : {}),
    ...(attempt.failureReason ? { failureReason: attempt.failureReason } : {}),
  }));
  // The attempt whose candidate decided the component: the verified one,
  // else the last attempt that acquired a candidate.
  const deciding =
    [...component.attempts]
      .reverse()
      .find((attempt) => attempt.verificationDecision === 'VERIFIED') ??
    [...component.attempts]
      .reverse()
      .find((attempt) => attempt.candidateAcquired);
  return {
    hintKey: component.hintKey,
    name: component.hintName,
    role: component.role,
    ...(component.expectedKind ? { expectedKind: component.expectedKind } : {}),
    strategiesAttempted: component.attempts.map((attempt) => attempt.strategy),
    candidateAcquired: component.attempts.some(
      (attempt) => attempt.candidateAcquired,
    ),
    ...(deciding?.selectedCandidate
      ? {
          selectedCandidate: {
            name: deciding.selectedCandidate.canonicalName,
            provider: deciding.provider,
            ...(deciding.selectedCandidate.latitude !== undefined &&
            deciding.selectedCandidate.longitude !== undefined
              ? {
                  latitude: deciding.selectedCandidate.latitude,
                  longitude: deciding.selectedCandidate.longitude,
                }
              : {}),
          },
        }
      : {}),
    ...(deciding?.verificationDecision
      ? { identityVerdict: deciding.verificationDecision }
      : {}),
    // The full explanation is kept for the deciding attempt only, so a
    // heavy composite's step stays bounded; every attempt keeps its rule.
    ...(deciding?.verificationRule
      ? {
          identityRule: deciding.verificationRule,
          identityDecision: projectIdentityDecision(deciding),
        }
      : {}),
    ...(deciding?.destinationCompatibility
      ? { destinationCompatibility: deciding.destinationCompatibility }
      : {}),
    finalStatus: component.finalStatus,
    ...(component.finalReason ? { finalReason: component.finalReason } : {}),
    attempts,
  };
}
