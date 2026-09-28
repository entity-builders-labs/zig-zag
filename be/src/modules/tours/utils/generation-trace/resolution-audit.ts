import { SerializableTraceStepInput } from '../generation-trace-recorder.util';
import {
  CandidateResolutionAudit,
  ComponentResolutionAudit,
  ComponentResolutionFact,
  ExperienceGeographicValidationResult,
  ExperienceResolutionResponse,
  FinalExperienceResolutionResponse,
} from '../../interfaces/experience-resolution.interface';
import { traceCandidateKey } from '../experience-candidate-correlation.util';
import {
  buildCompositeOutcome,
  describeComponentResolution,
  describeCompositeOutcome,
} from '../component-resolution-facts.util';

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
      validationIntent: result.validationIntent,
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
            validationIntent: result.validationIntent,
            destinationBoundary: result.destinationBoundary,
            rejectionReasons: entry.rejectionReasons,
            coherence: entry.coherence,
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
