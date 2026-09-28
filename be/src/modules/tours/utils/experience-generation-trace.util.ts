import {
  GenerationTraceRecorder,
  SerializableTraceStepInput,
} from './generation-trace-recorder.util';
import {
  TraceJsonValue,
  TraceRuleV5,
  TraceStepV5,
} from '../interfaces/generation-trace-v5.interface';
import { TourGenerationRequest } from '../interfaces/tour-generation.interface';
import {
  PreferenceSpec,
  PreferenceCoverageResult,
} from '../interfaces/preference-spec.interface';
import { DailyPlanningSolution } from '../interfaces/daily-planning.interface';
import { TourCompletenessResult } from '../interfaces/tour-completeness.interface';
import { ExecuteAcquisitionPlanResult } from '../services/experience-acquisition.service';
import { ExperienceAcquisitionPlan } from '../interfaces/experience-acquisition-plan.interface';
import {
  ExperienceGeographicValidationResult,
  ExperienceResolutionResponse,
  FinalExperienceResolutionResponse,
} from '../interfaces/experience-resolution.interface';
import { AreaRouteWalkAcquisitionResult } from '../services/area-route-walk-acquisition.service';
import { CandidateScoreBreakdown } from './candidate-ranking.util';
import { traceCandidateKey } from './experience-candidate-correlation.util';
import {
  buildCompositeOutcome,
  describeComponentResolution,
  describeCompositeOutcome,
} from './component-resolution-facts.util';
import { PreferenceInterpretationTrace } from '../interfaces/preference-interpretation.interface';

export function recordPreferenceInterpretationStep(
  recorder: GenerationTraceRecorder,
  input: {
    preferenceInterpretation: {
      intent: any;
      trace: PreferenceInterpretationTrace;
    };
    preferenceSpec: PreferenceSpec;
    request: TourGenerationRequest;
  },
): TraceStepV5 {
  const { preferenceInterpretation, preferenceSpec, request } = input;
  const normalizedPreferences = preferenceInterpretation.intent;
  return recorder.record({
    name: 'preference.interpretation',
    description:
      preferenceInterpretation.trace.status === 'applied'
        ? 'Preferencias libres normalizadas y combinadas con filtros.'
        : preferenceInterpretation.trace.status === 'fallback'
          ? 'Preferencias estructuradas aplicadas con respaldo determinístico.'
          : 'Filtros estructurados aplicados.',
    component: 'PreferenceInterpreterService',
    decision: {
      status:
        preferenceInterpretation.trace.status === 'applied'
          ? 'PASS'
          : preferenceInterpretation.trace.status === 'fallback'
            ? 'WARN'
            : 'INFO',
      outcome: preferenceInterpretation.trace.status.toUpperCase(),
    },
    input: {
      hasAdditionalPreferences: Boolean(
        request.intent.additionalPreferences?.trim(),
      ),
      intents: request.intent.intents ?? [],
      dietaryRestrictions: request.dietaryRestrictions,
      accessibilityNeeds: request.mobility.accessibilityNeeds,
      budgetLevel: request.budgetLevel,
      groupType: request.groupType,
    },
    output: { intent: normalizedPreferences, preferenceSpec },
    facts: {
      ...preferenceInterpretation.trace,
      parsedResponse: normalizedPreferences,
    },
    timing: { durationMs: preferenceInterpretation.trace.durationMs },
  });
}

export function recordRequestIntentStep(
  recorder: GenerationTraceRecorder,
  input: {
    request: TourGenerationRequest;
    preferenceSpec: PreferenceSpec;
  },
): TraceStepV5 {
  const { request, preferenceSpec } = input;
  const hasAdditionalPreferences = Boolean(
    request.intent.additionalPreferences?.trim(),
  );
  return recorder.record({
    name: 'request.intent',
    description: 'Intención y movilidad solicitadas',
    component: 'TourGenerationRequest',
    decision: { status: 'PASS', outcome: 'ACCEPTED' },
    rules: [
      {
        id: 'INTENT-CANONICAL-001',
        name: 'Usar el wizard canónico como fuente de restricciones explícitas',
        status: 'PASS',
        reason:
          'La generación parte de TourGenerationRequest contractVersion=1.',
        facts: { contractVersion: request.contractVersion },
      },
      {
        id: 'INTENT-FREETEXT-001',
        name: 'Conservar preferencias adicionales como intención suplementaria',
        status: hasAdditionalPreferences ? 'PASS' : 'SKIPPED',
        reason: hasAdditionalPreferences
          ? 'Hay texto adicional disponible para búsqueda/ranking semántico.'
          : 'No se suministraron preferencias adicionales.',
      },
    ],
    facts: {
      destination: request.destination.label,
      days: request.days,
      themes: request.intent.interests,
      explorationStyle: request.intent.explorationStyle,
      additionalPreferences: request.intent.additionalPreferences ?? null,
      allowedTransportationModes: request.mobility.allowedTransportationModes,
      maxWalkingDistancePerDayMeters:
        request.mobility.maxWalkingDistancePerDayMeters,
      maxContinuousWalkingDistanceMeters:
        request.mobility.maxContinuousWalkingDistanceMeters,
      travelPace: request.mobility.travelPace,
      accessibilityNeeds: request.mobility.accessibilityNeeds,
      facets: preferenceSpec.facets,
    },
  });
}

export function recordDestinationResolutionStep(
  recorder: GenerationTraceRecorder,
  input: {
    destinationText?: string;
    resolution: any;
    canonicalDestinationName: string;
  },
): TraceStepV5 {
  const { destinationText, resolution, canonicalDestinationName } = input;
  const area = resolution.scale === 'area';
  const providerFailed =
    !area && resolution.degradationReason === 'provider_failed';
  return recorder.record({
    name: 'destination.resolution',
    description: area
      ? `"${destinationText}" resolvió a un límite real de ciudad: ${resolution.boundary.name}. Se usa ese límite real en vez de un único punto+radio.`
      : `"${destinationText}" se mantiene como destino puntual (${resolution.pointReason ?? resolution.degradationReason ?? 'punto_seleccionado'}).`,
    component: 'DestinationResolutionService',
    decision: {
      status: providerFailed ? 'WARN' : 'PASS',
      outcome: area ? 'USE_ADMINISTRATIVE_BOUNDARY' : 'USE_POINT_RADIUS',
      reasonCodes: [
        area
          ? 'AREA_BOUNDARY_RESOLVED'
          : (resolution.degradationReason ??
            resolution.pointReason ??
            'POINT_DESTINATION'),
      ],
    },
    input: {
      destinationText: destinationText ?? null,
      attemptedQueries: resolution.attemptedQueries ?? [],
    },
    output: {
      scale: resolution.scale,
      countryCode: resolution.countryCode,
      canonicalName: canonicalDestinationName,
      boundaryId: area ? resolution.boundary.id : null,
      boundaryName: area ? resolution.boundary.name : null,
    },
    rules: [
      {
        id: 'DEST-SCALE-001',
        name: 'Determinar si el destino puede usar boundary real o debe degradar a punto',
        status: area ? 'PASS' : providerFailed ? 'WARN' : 'PASS',
        reason: area
          ? 'Se obtuvo boundary administrativo utilizable.'
          : `Se usa punto. Motivo: ${resolution.pointReason ?? resolution.degradationReason ?? 'point_destination'}.`,
        facts: { scale: resolution.scale },
      },
    ],
  });
}

export function recordAnchorResolutionStep(
  recorder: GenerationTraceRecorder,
  input: {
    requestedAnchors: any[];
    resolvedAnchors: any[];
  },
): TraceStepV5 {
  const { requestedAnchors, resolvedAnchors } = input;
  const hasUnresolved = resolvedAnchors.some((a) => a.status === 'unresolved');
  return recorder.record({
    name: 'anchor.geo_resolution',
    description: 'Resolución geográfica de anchors solicitados',
    component: 'AreaRouteAnchorResolverService',
    decision: {
      status: hasUnresolved ? 'WARN' : 'PASS',
      outcome: hasUnresolved ? 'PARTIALLY_RESOLVED' : 'ALL_RESOLVED',
    },
    input: { anchors: requestedAnchors },
    output: { anchors: resolvedAnchors },
    facts: {
      totalRequested: requestedAnchors?.length ?? 0,
      resolvedCount: resolvedAnchors.filter((a) => a.status === 'resolved')
        .length,
      unresolvedCount: resolvedAnchors.filter((a) => a.status === 'unresolved')
        .length,
    },
  });
}

export function recordCatalogSearchStep(
  recorder: GenerationTraceRecorder,
  input: {
    candidates: any[];
    radiusKm: number;
  },
): TraceStepV5 {
  const { candidates, radiusKm } = input;
  return recorder.record({
    name: 'catalog.search',
    description: candidates.length
      ? `${candidates.length} Experiences recuperadas del catálogo dentro del alcance (${radiusKm}km).`
      : `No se recuperaron actividades del catálogo en el alcance inicial (${radiusKm}km).`,
    component: 'ExperienceCatalog.findVerifiedWithin',
    decision: {
      status: candidates.length ? 'PASS' : 'WARN',
      outcome: candidates.length
        ? 'CATALOG_POOL_AVAILABLE'
        : 'CATALOG_POOL_EMPTY',
      reason: candidates.length
        ? 'Hay candidatos persistidos para evaluar.'
        : 'No hay candidatos persistidos para este alcance.',
    },
    input: { radiusKm },
    output: { candidateCount: candidates.length },
    rules: [
      {
        id: 'CATALOG-RETRIEVAL-001',
        name: 'Recuperar candidatos reales persistidos antes de adquirir nuevos',
        status: candidates.length ? 'PASS' : 'WARN',
        reason: candidates.length
          ? `El catálogo aportó ${candidates.length} candidato(s).`
          : 'El catálogo no aportó candidatos; la cobertura decidirá si adquirir nuevos.',
        facts: { candidateCount: candidates.length },
      },
    ],
    subjects: candidates.slice(0, 50).map((act) => ({
      subject: {
        kind: 'experience',
        id: act.id,
        label: act.canonicalName ?? act.name,
      },
      decision: { status: 'PASS', outcome: 'ELIGIBLE' },
    })),
  });
}

export function recordPreferenceCoverageStep(
  recorder: GenerationTraceRecorder,
  input: {
    coverage: PreferenceCoverageResult;
    context: {
      offeredCandidateCount: number;
      semanticRanking: {
        status: 'not_requested' | 'applied' | 'unavailable';
        eligibleCandidateCount: number;
        indexedCandidateCount: number;
        reason?: string;
      };
      providerHealth: {
        status: 'healthy' | 'degraded' | 'unknown';
        reason?: string;
      };
    };
  },
): TraceStepV5 {
  const { coverage, context } = input;
  const facetSummaries = coverage.facetResults.map((facetCandidates) => ({
    dimension: facetCandidates.facet.dimension,
    key: facetCandidates.facet.key,
    strongMatchCount: facetCandidates.strongMatches.length,
    weakMatchCount: facetCandidates.weakMatches.length,
    satisfied: facetCandidates.satisfied,
  }));
  const unsatisfied = facetSummaries.filter((f) => !f.satisfied);

  const rules: TraceRuleV5[] = [
    {
      id: 'PCOV-QUANTITY-001',
      name: 'Portafolio elegible global suficiente para días y ritmo solicitados',
      status:
        coverage.totalDistinctEligibleExperiences >= coverage.portfolioTarget
          ? 'PASS'
          : 'FAIL',
      reason: `${coverage.totalDistinctEligibleExperiences} Experience(s) elegible(s) frente a ${coverage.portfolioTarget} requerida(s).`,
      facts: {
        actual: coverage.totalDistinctEligibleExperiences,
        target: coverage.portfolioTarget,
      },
    },
    ...facetSummaries.map((f) => ({
      id: `PCOV-FACET-${f.dimension.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}-${f.key.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
      name: `Cobertura del facet solicitado: ${f.dimension}:${f.key}`,
      status: f.satisfied ? ('PASS' as const) : ('FAIL' as const),
      reason: `${f.strongMatchCount} coincidencia(s) fuerte(s), ${f.weakMatchCount} débil(es).`,
      facts: {
        strongMatches: f.strongMatchCount,
        weakMatches: f.weakMatchCount,
      },
    })),
  ];

  return recorder.record({
    name: 'coverage.analysis',
    description: coverage.sufficient
      ? `Portafolio suficiente: ${coverage.totalDistinctEligibleExperiences} Experience(s) elegible(s) frente a ${coverage.portfolioTarget} requerida(s); todos los facets satisfechos.`
      : unsatisfied.length > 0
        ? `Facets sin cobertura fuerte: ${unsatisfied.map((f) => `${f.dimension}:${f.key}`).join(', ')}.`
        : `Portafolio elegible global insuficiente: ${coverage.totalDistinctEligibleExperiences} frente a objetivo de ${coverage.portfolioTarget}.`,
    component: 'FacetRetrievalService',
    decision: {
      status: coverage.sufficient ? 'PASS' : 'WARN',
      outcome: coverage.sufficient ? 'SUFFICIENT' : 'NEEDS_ACQUISITION',
      reasonCodes: coverage.acquisitionDeficits.map((d) => d.reason),
    },
    input: {
      portfolioTarget: coverage.portfolioTarget,
      facets: facetSummaries.map((f) => `${f.dimension}:${f.key}`),
    },
    output: {
      sufficient: coverage.sufficient,
      totalDistinctEligibleExperiences:
        coverage.totalDistinctEligibleExperiences,
      deficitCount: coverage.acquisitionDeficits.length,
      deficits: coverage.acquisitionDeficits,
    },
    facts: {
      offeredCandidateCount: context.offeredCandidateCount,
      semanticRanking: context.semanticRanking,
      providerHealth: context.providerHealth,
      facetSummaries,
    },
    rules,
  });
}

export function recordDeficitRoutingStep(
  recorder: GenerationTraceRecorder,
  input: {
    areaRouteWalk: Array<{
      anchor: any;
      anchorMode: string;
      intentKey: string;
      deficit: any;
    }>;
    generic: any[];
    resolvedAnchors: any[];
    acquisitionDeficits: any[];
  },
): TraceStepV5 {
  const { areaRouteWalk, generic, resolvedAnchors, acquisitionDeficits } =
    input;
  return recorder.record({
    name: 'acquisition.routing',
    description: `Enrutamiento de déficits de adquisición: AREA_ROUTE_WALK=${areaRouteWalk.length}; GENERIC=${generic.length}.`,
    component: 'partitionDeficitsByStrategy',
    decision: { status: 'INFO', outcome: 'ROUTED' },
    input: {
      anchors: resolvedAnchors,
      acquisitionDeficits,
    },
    output: {
      areaRouteWalk: areaRouteWalk.map((routed) => ({
        anchor: routed.anchor,
        anchorMode: routed.anchorMode,
        intentKey: routed.intentKey,
        deficit: routed.deficit,
      })),
      generic,
    },
  });
}

export function recordAreaRouteWalkStep(
  recorder: GenerationTraceRecorder,
  input: {
    anchor: any;
    intentKey: string;
    deficit: any;
    result: AreaRouteWalkAcquisitionResult;
  },
): TraceStepV5 {
  const { anchor, intentKey, deficit, result } = input;
  const outputs = Object.fromEntries(
    Object.entries(result).filter(([key]) => key !== 'lifecycle'),
  );
  return recorder.record({
    name: 'acquisition.area_route_walk',
    description: `Resultado AREA_ROUTE_WALK: ${result.outcome}.`,
    component: 'AreaRouteWalkAcquisitionService',
    decision: {
      status: result.outcome === 'no_result' ? 'WARN' : 'PASS',
      outcome: result.outcome.toUpperCase(),
      reason:
        result.outcome === 'no_result' ? (result as any).reason : undefined,
    },
    input: { anchor, intentKey, deficit },
    output: outputs,
  });
}

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
      entityResolutionAudit: (
        resolution.entityResolution?.forensicAudit ??
        (resolution as any).forensicAudit ??
        []
      ).map((audit: any) => ({
        candidateTraceKey: audit.candidateTraceKey,
        candidateName: audit.candidateName,
        hints: audit.componentAudits.map((comp: any) => {
          const fact = audit.componentResolution?.components.find(
            (item: any) => item.hintKey === comp.hintKey,
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
      })),
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

export function recordAcquisitionLifecycle(
  recorder: GenerationTraceRecorder,
  input: {
    passNumber: number;
    strategy: 'generic' | 'area_route_walk';
    anchor?: any;
    plan: ExperienceAcquisitionPlan;
    execution: ExecuteAcquisitionPlanResult;
    resolution?: FinalExperienceResolutionResponse;
  },
): void {
  const { passNumber, strategy, anchor, plan, execution, resolution } = input;
  const passId = `acquisition-pass-${passNumber}-${strategy}`;

  // 1. Parent step: acquisition.pass
  recorder.record({
    id: passId,
    name: 'acquisition.pass',
    description: `Pase de adquisición #${passNumber} (${strategy})`,
    component: 'ExperienceAcquisitionService',
    decision: {
      status: 'PASS',
      outcome: `PASS_${passNumber}_EXECUTED`,
    },
    facts: {
      passNumber,
      strategy,
      ...(anchor ? { anchor } : {}),
      candidateCount: execution.candidates.length,
      observationCount: execution.observations.length,
    },
  });

  // 2. Child step: acquisition.plan
  recorder.record({
    parentId: passId,
    name: 'acquisition.plan',
    description: `Plan de adquisición (${plan.sourcePlans.length} fuentes configuradas)`,
    component: 'ExperienceAcquisitionPlannerService',
    input: {
      destination: plan.destination,
      deficits: plan.deficits,
    },
    output: {
      sourcePlans: plan.sourcePlans.map((sp: any) => ({
        provider: sp.provider,
        ...(sp.provider === 'google_places' || sp.provider === 'places'
          ? { places: (sp as any).places }
          : {}),
        ...(sp.provider === 'wikivoyage'
          ? { wikivoyage: (sp as any).wikivoyage }
          : {}),
        ...(sp.provider === 'web' ? { web: (sp as any).web } : {}),
      })),
    },
    facts: {
      sourceCount: plan.sourcePlans.length,
      providers: plan.sourcePlans.map((sp: any) => sp.provider),
    },
  });

  // 3. Child step: structured source plans
  for (const [provider, result] of Object.entries(
    execution.providerResults,
  ) as [
    string,
    (
      | {
          status: string;
          failureReason?: string;
          value?: any[];
          provenance?: Record<string, unknown>;
        }
      | undefined
    ),
  ][]) {
    if (!result) continue;
    recorder.record({
      parentId: passId,
      name: 'acquisition.structured_source',
      description: `Ejecución de fuente estructurada: ${provider}`,
      component: 'ExperienceAcquisitionService',
      decision: {
        status: result.status === 'failed' ? 'FAIL' : 'PASS',
        outcome: result.status.toUpperCase(),
        reason: result.failureReason,
      },
      facts: {
        provider,
        status: result.status,
        candidateCount: result.value?.length ?? 0,
        observations: (result.value ?? []).slice(0, 50).map((obs: any) => ({
          key: obs.evidenceKey,
          title: obs.title,
          url: obs.sourceUrl,
        })),
        provenance: result.provenance,
      },
    });
  }

  // 4. Structured corroboration if present
  if (execution.structuredAudit) {
    recorder.record({
      parentId: passId,
      name: 'acquisition.structured_corroboration',
      description: `Corroboración de candidatos estructurados (${execution.structuredAudit.proposalCount} propuestas)`,
      component: 'StructuredCandidateCorroborationService',
      decision: {
        status: 'PASS',
        outcome: `${execution.structuredAudit.proposalCount}_PROPOSALS_CORROBORATED`,
      },
      facts: execution.structuredAudit,
    });
  }

  // 5. Web discovery results
  for (const webResult of execution.webResults ?? []) {
    // 5a. acquisition.web_search
    recorder.record({
      parentId: passId,
      name: 'acquisition.web_search',
      description: `Búsqueda web con grounding: "${webResult.query}"`,
      component: 'ExperienceAcquisitionService',
      decision: {
        status: webResult.status === 'failed' ? 'FAIL' : 'PASS',
        outcome: webResult.status.toUpperCase(),
        reason: webResult.failureReason,
      },
      facts: {
        query: webResult.query,
        groundedProvider: webResult.groundedProvider,
        groundedModel: webResult.groundedModel,
        groundingStatus: webResult.groundingStatus,
        destinationCountryCode: webResult.destinationCountryCode,
        groundedProviderLocale: webResult.groundedProviderLocale,
        evidenceCount: webResult.evidenceKeys?.length ?? 0,
        evidenceKeys: webResult.evidenceKeys,
      },
    });

    // 5b. acquisition.source_retrieval (if content retrieval attempted)
    if (webResult.sourceContentRetrieval?.attempted) {
      recorder.record({
        parentId: passId,
        name: 'acquisition.source_retrieval',
        description: `Recuperación de contenido web (${webResult.sourceContentRetrieval.retrievedUrls?.length ?? 0} páginas obtenidas)`,
        component: 'WebSourceContentRetrievalService',
        decision: {
          status: webResult.sourceContentRetrieval.failedUrls?.length
            ? 'WARN'
            : 'PASS',
          outcome: 'RETRIEVED',
        },
        facts: webResult.sourceContentRetrieval,
      });
    }

    // 5c. acquisition.semantic_extraction
    recorder.record({
      parentId: passId,
      name: 'acquisition.semantic_extraction',
      description: `Extracción semántica de candidatos (${webResult.candidateCount} admitidos de ${webResult.extractedCandidateCount ?? webResult.candidateCount} extraídos)`,
      component: 'ExperienceDiscoveryExtractor',
      decision: {
        status: webResult.candidateCount > 0 ? 'PASS' : 'WARN',
        outcome:
          webResult.candidateCount > 0
            ? 'CANDIDATES_EXTRACTED'
            : 'NO_CANDIDATES',
      },
      facts: {
        extractorProvider: webResult.extractorProvider,
        extractorModel: webResult.extractorModel,
        extractedCandidateCount: webResult.extractedCandidateCount,
        candidateCount: webResult.candidateCount,
        validationErrors: webResult.validationErrors,
        rawOutput: webResult.extractorRawOutput,
        sourceSupportAudits: webResult.sourceSupportAudits,
      },
      subjects: webResult.candidateDecisions?.map((d: any) => ({
        subject: {
          kind: 'candidate',
          id: traceCandidateKey(d.candidate),
          label: d.candidate.name,
        },
        decision: {
          status: d.accepted ? ('PASS' as const) : ('FAIL' as const),
          outcome: d.accepted ? 'ACCEPTED' : 'REJECTED',
          reason: d.reason,
        },
      })),
    });
  }

  // 6. Materialization / resolution (if execution produced candidates and was materialized)
  if (resolution) {
    // 6a. resolution.entity
    recorder.record({
      parentId: passId,
      ...projectEntityResolutionStepInput(resolution, { strategy, passNumber }),
    });

    // 6b. geography.validation
    if (resolution.geographicValidation) {
      recorder.record({
        parentId: passId,
        ...projectGeographicValidationStepInput(resolution),
      });
    }

    // 6c. catalog.materialization
    const materializationStepInput =
      projectCatalogMaterializationStepInput(resolution);
    recorder.record({
      parentId: passId,
      ...materializationStepInput,
    });

    // 6d. classification.semantic (for each classified experience)
    if (resolution.classification?.length) {
      for (const item of resolution.classification) {
        const isDegraded = item.state === 'degraded';
        recorder.record({
          parentId: passId,
          name: 'classification.semantic',
          description: `Clasificación semántica de experiencia: ${item.experienceId} (${item.state})`,
          component: 'ExperienceClassificationService',
          decision: {
            status: isDegraded ? 'WARN' : 'PASS',
            outcome: item.state.toUpperCase(),
            reasonCodes: item.failure ? [item.failure.reason] : undefined,
          },
          subjects: [
            {
              subject: { kind: 'experience', id: item.experienceId },
              decision: {
                status: isDegraded ? 'WARN' : 'PASS',
                outcome: item.state.toUpperCase(),
                reasonCodes: item.failure ? [item.failure.reason] : undefined,
              },
            },
          ],
          facts: {
            experienceId: item.experienceId,
            state: item.state,
            provider: item.provider,
            model: item.model,
            promptVersion: item.promptVersion,
            themes: item.themes,
            intents: item.intents,
            traits: item.traits,
            reasoningEvidence: item.reasoningEvidence,
            failure: item.failure,
          },
        });
      }
    }
  }
}

export function recordCandidatePoolSelectionStep(
  recorder: GenerationTraceRecorder,
  input: {
    selection: {
      initialExperiences: any[];
      reservoirExperiences: any[];
      compositionResult: any;
      scoreBreakdownById: Map<string, CandidateScoreBreakdown>;
    };
    request: TourGenerationRequest;
    initialCatalogCount: number;
    postAcquisitionCatalogCount: number;
    eligibleCount: number;
    discoveryResolvedExperienceIds: Set<string>;
    newlyAcquiredExperienceIds: Set<string>;
    crawlProvider?: 'google' | 'geoapify';
  },
): TraceStepV5 {
  const {
    selection,
    request,
    initialCatalogCount,
    postAcquisitionCatalogCount,
    eligibleCount,
    discoveryResolvedExperienceIds,
    newlyAcquiredExperienceIds,
    crawlProvider,
  } = input;

  const allOffered = [
    ...selection.initialExperiences,
    ...selection.reservoirExperiences,
  ];
  const bySource = { catalog: 0, refill: 0, discovery: 0 };
  for (const exp of allOffered) {
    if (discoveryResolvedExperienceIds.has(exp.id)) {
      bySource.discovery++;
    } else if (newlyAcquiredExperienceIds.has(exp.id)) {
      bySource.refill++;
    } else {
      bySource.catalog++;
    }
  }

  const selectedSet = new Set(selection.initialExperiences.map((e) => e.id));
  const reservoirSet = new Set(selection.reservoirExperiences.map((e) => e.id));

  return recorder.record({
    name: 'candidate_pool.selection',
    description: `Ranking y selección de experiencias (${allOffered.length} ofrecidas: ${bySource.catalog} catálogo, ${bySource.refill} adquisición, ${bySource.discovery} discovery).`,
    component: 'CandidateSelectionService',
    decision: {
      status: 'PASS',
      outcome: 'EXPERIENCE_POOL_RANKED',
    },
    input: {
      initialCatalogCount,
      postAcquisitionCatalogCount,
      eligibleCount,
      requestedThemes: request.intent.interests,
      portfolioTarget: selection.compositionResult?.portfolioTarget,
    },
    output: {
      offeredCount: allOffered.length,
      selectedCount: selection.initialExperiences.length,
      reservoirCount: selection.reservoirExperiences.length,
    },
    facts: {
      initialCatalogCount,
      postAcquisitionCatalogCount,
      eligibleCount,
      bySource,
      portfolioTarget: selection.compositionResult?.portfolioTarget,
    },
    rules: [
      {
        id: 'EXPERIENCE-RANK-001',
        name: 'Ordenar Experiences por relevancia semántica y calidad',
        status: 'PASS',
        reason:
          'El ranking determinístico consume únicamente Experiences verificadas.',
        facts: { candidateCount: allOffered.length },
      },
    ],
    subjects: allOffered.map((exp: any) => {
      const isSelected = selectedSet.has(exp.id);
      const isReservoir = reservoirSet.has(exp.id);
      const scoreBreakdown = selection.scoreBreakdownById.get(exp.id);
      const traceSource = discoveryResolvedExperienceIds.has(exp.id)
        ? 'discovery'
        : newlyAcquiredExperienceIds.has(exp.id)
          ? crawlProvider === 'google'
            ? 'google_places'
            : 'geoapify'
          : 'db';
      return {
        subject: {
          kind: 'experience',
          id: exp.id,
          label: exp.canonicalName ?? exp.name,
        },
        decision: {
          status: isSelected ? ('PASS' as const) : ('INFO' as const),
          outcome: isSelected
            ? 'SELECTED'
            : isReservoir
              ? 'RESERVOIR'
              : 'OFFERED',
          reason: scoreBreakdown
            ? `Score total ${scoreBreakdown.totalScore.toFixed(3)}`
            : undefined,
        },
        facts: {
          source: traceSource,
          scoreBreakdown,
        },
      };
    }),
  });
}

export function recordSemanticRankingStep(
  recorder: GenerationTraceRecorder,
  input: {
    semanticRankingOutcome: any;
    candidateCount: number;
  },
): TraceStepV5 {
  const { semanticRankingOutcome, candidateCount } = input;
  const status = semanticRankingOutcome?.status ?? 'not_requested';
  return recorder.record({
    name: 'ranking.semantic',
    description:
      status === 'applied'
        ? `Ranking semántico aplicado sobre ${semanticRankingOutcome.eligibleCandidateCount ?? candidateCount} candidato(s) elegible(s).`
        : status === 'unavailable'
          ? `Ranking semántico no disponible: ${semanticRankingOutcome.reason || 'proveedor no disponible'}.`
          : 'Ranking semántico no solicitado para esta intención.',
    component: 'VectorStoreService + pgvector',
    decision: {
      status: status === 'unavailable' ? 'WARN' : 'PASS',
      outcome: status.toUpperCase(),
      reason: semanticRankingOutcome?.reason,
    },
    facts: {
      status,
      candidateCount,
      model: semanticRankingOutcome?.model,
      identity: semanticRankingOutcome?.identity,
      eligibleCandidateCount: semanticRankingOutcome?.eligibleCandidateCount,
      indexedCandidateCount: semanticRankingOutcome?.indexedCandidateCount,
    },
    rules: [
      {
        id: 'RANK-SEMANTIC-001',
        name: 'Usar similitud semántica solo cuando fue solicitada y está disponible',
        status:
          status === 'unavailable'
            ? 'WARN'
            : status === 'not_requested'
              ? 'SKIPPED'
              : 'PASS',
        reason:
          status === 'applied'
            ? 'Similitud semántica calculada y agregada al score.'
            : status === 'unavailable'
              ? 'El vector store o embedding provider no estuvo disponible.'
              : 'No se requirió similitud semántica.',
      },
    ],
  });
}

export function recordDailyPlanningStep(
  recorder: GenerationTraceRecorder,
  input: {
    planningSolution: DailyPlanningSolution;
  },
): TraceStepV5 {
  const { planningSolution } = input;
  const selectedCount = planningSolution.days.reduce(
    (sum, day) => sum + day.experiences.length,
    0,
  );
  return recorder.record({
    name: 'planning.daily',
    description: `Solver ${planningSolution.metadata.solver} planificó ${planningSolution.days.length} día(s): ${selectedCount} Experience(s) seleccionada(s), ${planningSolution.unselected.length} sin seleccionar.`,
    component: planningSolution.metadata.solver,
    decision: {
      status: selectedCount ? 'PASS' : 'FAIL',
      outcome: selectedCount ? 'DAILY_PLAN_BUILT' : 'PLANNING_FAILED',
      reason: selectedCount
        ? 'Itinerario factible construido con las restricciones de tiempo y ritmo.'
        : 'No se pudo construir un itinerario factible.',
    },
    input: {
      solver: planningSolution.metadata.solver,
      approximateTravel: planningSolution.metadata.approximateTravel,
      iterations: planningSolution.metadata.iterations ?? null,
    },
    output: {
      dayCount: planningSolution.days.length,
      selectedCount,
      unselectedCount: planningSolution.unselected.length,
      score: planningSolution.score,
    },
    facts: {
      solver: planningSolution.metadata.solver,
      approximateTravel: planningSolution.metadata.approximateTravel,
      iterations: planningSolution.metadata.iterations,
      score: planningSolution.score,
      days: planningSolution.days.map((d) => ({
        dayNumber: d.dayNumber,
        experienceCount: d.experiences.length,
        totalExperienceMinutes: d.totalExperienceMinutes,
        totalTravelMinutes: d.totalTravelMinutes,
        totalWalkingMinutes: d.totalWalkingMinutes,
        utilizationMinutes: d.utilizationMinutes,
      })),
      unselectedCount: planningSolution.unselected.length,
    },
    rules: [
      {
        id: 'PLAN-DAYS-001',
        name: 'Mantener exactamente los buckets de días solicitados por el planner',
        status: 'PASS',
        reason: `El solver devolvió ${planningSolution.days.length} bucket(s) de día.`,
        facts: { dayCount: planningSolution.days.length },
      },
      {
        id: 'PLAN-FEASIBILITY-001',
        name: 'No seleccionar candidatos que el solver haya marcado como no factibles',
        status: 'PASS',
        reason: `${planningSolution.unselected.length} candidato(s) quedaron fuera con reason codes explícitos.`,
        facts: { unselectedCount: planningSolution.unselected.length },
      },
      {
        id: 'PLAN-TRAVEL-001',
        name: 'Declarar si las estimaciones de traslado son aproximadas',
        status: planningSolution.metadata.approximateTravel ? 'WARN' : 'PASS',
        reason: planningSolution.metadata.approximateTravel
          ? 'Los tiempos/distancias usados por el solver son aproximados.'
          : 'El solver informa estimaciones de traslado no aproximadas.',
        facts: {
          approximateTravel: planningSolution.metadata.approximateTravel,
        },
      },
    ],
    subjects: [
      ...planningSolution.days.flatMap((day) =>
        day.experiences.map((experience, order) => ({
          subject: { kind: 'experience', id: experience.experienceId },
          decision: {
            status: 'PASS' as const,
            outcome: 'SELECTED',
            reason: `Asignada al día ${day.dayNumber} en posición ${order + 1}; pasó la factibilidad del solver.`,
            reasonCodes: ['FEASIBLE_AND_SELECTED'],
          },
          facts: {
            dayNumber: day.dayNumber,
            order: order + 1,
            startMinutes: experience.startMinutesFromMidnight,
            endMinutes: experience.endMinutesFromMidnight,
          },
        })),
      ),
      ...planningSolution.unselected.map((candidate) => ({
        subject: { kind: 'experience', id: candidate.experienceId },
        decision: {
          status: 'FAIL' as const,
          outcome: 'UNSELECTED',
          reason: candidate.reasons.join(', '),
          reasonCodes: candidate.reasons,
        },
        facts: {
          reasons: candidate.reasons,
          ...(candidate.walkingDiagnostics
            ? { walkingDiagnostics: candidate.walkingDiagnostics }
            : {}),
        },
      })),
    ],
  });
}

export function recordTourCompletenessStep(
  recorder: GenerationTraceRecorder,
  input: {
    completeness: TourCompletenessResult;
    retryAttempted: boolean;
  },
): TraceStepV5 {
  const { completeness, retryAttempted } = input;
  const reasonCodes = Array.from(
    new Set(completeness.issues.map((i) => i.code)),
  );
  return recorder.record({
    name: 'tour.completeness',
    description: completeness.complete
      ? 'El itinerario generado hace un uso razonable de los días solicitados.'
      : `Observaciones de completitud: ${completeness.issues.map((i) => i.code).join(', ')}.`,
    component: 'TourCompletenessValidator',
    decision: {
      status: completeness.complete ? 'PASS' : 'WARN',
      outcome: completeness.complete ? 'TOUR_COMPLETE' : 'TOUR_UNDERFILLED',
      reason: completeness.complete
        ? 'La política de completitud no detectó déficit accionable.'
        : 'Existen días que podrían estar mejor utilizados, o formatos pedidos sin cubrir.',
      reasonCodes,
    },
    input: { retryAttempted },
    output: {
      complete: completeness.complete,
      issueCount: completeness.issues.length,
      issues: completeness.issues,
    },
    facts: {
      ...completeness,
      retryAttempted,
    },
    rules: [
      {
        id: 'COMP-DAY-USAGE-001',
        name: 'Cada día debe tener un uso razonable cuando existen candidatos viables',
        status: completeness.complete ? 'PASS' : 'WARN',
        reason: completeness.complete
          ? 'No se detectaron días subutilizados con alternativas viables.'
          : completeness.issues.map((i) => i.message).join(' '),
      },
      ...completeness.issues.map((issue) => ({
        id: issue.code,
        name: issue.code,
        status: 'WARN' as const,
        reason: issue.message,
        facts: issue as unknown as TraceJsonValue,
      })),
    ],
  });
}

export function recordTourMaterializationStep(
  recorder: GenerationTraceRecorder,
  input: {
    tourId: string;
    materializedTourExperiences: any[];
  },
): TraceStepV5 {
  const { tourId, materializedTourExperiences } = input;
  return recorder.record({
    name: 'tour.materialization',
    description: `${materializedTourExperiences.length} TourExperience snapshot(s) persistidos desde Experiences verificadas.`,
    component: 'Prisma.TourExperience',
    decision: {
      status: 'PASS',
      outcome: 'TOUR_EXPERIENCES_PERSISTED',
    },
    facts: {
      tourId,
      materializedCount: materializedTourExperiences.length,
      experiences: materializedTourExperiences,
    },
    subjects: materializedTourExperiences.map((item) => ({
      subject: { kind: 'experience', id: item.experienceId },
      decision: { status: 'PASS', outcome: 'PERSISTED' },
      facts: item,
    })),
  });
}
