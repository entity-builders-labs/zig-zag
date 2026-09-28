import { GenerationTraceRecorder } from '../generation-trace-recorder.util';
import {
  TraceRuleV5,
  TraceStepV5,
} from '../../interfaces/generation-trace-v5.interface';
import {
  PreferenceCoverageResult,
  ResolvedAnchor,
} from '../../interfaces/preference-spec.interface';
import {
  ExecuteAcquisitionPlanResult,
  WebCandidateAdmissionDecision,
} from '../../services/experience-acquisition.service';
import {
  ExperienceAcquisitionPlan,
  SourcePlan,
  AcquisitionDeficit,
} from '../../interfaces/experience-acquisition-plan.interface';
import { FinalExperienceResolutionResponse } from '../../interfaces/experience-resolution.interface';
import { AreaRouteWalkAcquisitionResult } from '../../services/area-route-walk-acquisition.service';
import { SourceObservation } from '../../interfaces/experience-acquisition.interface';
import { traceCandidateKey } from '../experience-candidate-correlation.util';
import {
  projectCatalogMaterializationStepInput,
  projectEntityResolutionStepInput,
  projectGeographicValidationStepInput,
} from './resolution-audit';

export function recordCatalogSearchStep(
  recorder: GenerationTraceRecorder,
  input: {
    candidates: Array<{ id: string; canonicalName?: string; name?: string }>;
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
      facetResults: facetSummaries,
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
      anchor: ResolvedAnchor;
      anchorMode: string;
      intentKey: string;
      deficit: AcquisitionDeficit;
    }>;
    generic: AcquisitionDeficit[];
    resolvedAnchors: ResolvedAnchor[];
    acquisitionDeficits: AcquisitionDeficit[];
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
    anchor: ResolvedAnchor;
    intentKey: string;
    deficit: AcquisitionDeficit;
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
      reason: result.outcome === 'no_result' ? result.reason : undefined,
    },
    input: { anchor, intentKey, deficit },
    output: outputs,
  });
}

export function recordAcquisitionLifecycle(
  recorder: GenerationTraceRecorder,
  input: {
    passNumber: number;
    strategy: 'generic' | 'area_route_walk' | 'planner_capacity';
    anchor?: ResolvedAnchor;
    plan: ExperienceAcquisitionPlan;
    execution: ExecuteAcquisitionPlanResult;
    resolution?: FinalExperienceResolutionResponse;
  },
): void {
  const { passNumber, strategy, anchor, plan, execution, resolution } = input;
  const anchorSlug = anchor?.rawName
    ? `-${anchor.rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`
    : '';
  let passId = `acquisition-pass-${passNumber}-${strategy}${anchorSlug}`;
  if (recorder.hasStep(passId)) {
    let suffix = 2;
    while (recorder.hasStep(`${passId}-${suffix}`)) {
      suffix++;
    }
    passId = `${passId}-${suffix}`;
  }

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
    input: {
      deficits: plan.deficits,
      destination: plan.destination,
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
      sourcePlans: plan.sourcePlans.map((sp: SourcePlan) => ({
        provider: sp.provider,
        ...(sp.provider === 'google_places' ? { places: sp.places } : {}),
        ...(sp.provider === 'wikivoyage' ? { wikivoyage: sp.wikivoyage } : {}),
        ...(sp.provider === 'web' ? { web: sp.web } : {}),
      })),
    },
    facts: {
      sourceCount: plan.sourcePlans.length,
      providers: plan.sourcePlans.map((sp: SourcePlan) => sp.provider),
    },
  });

  // 3. Child step: structured source plans
  for (const [provider, result] of Object.entries(execution.providerResults)) {
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
        observations: (result.value ?? [])
          .slice(0, 50)
          .map((obs: SourceObservation) => ({
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
      subjects: webResult.candidateDecisions?.map(
        (d: WebCandidateAdmissionDecision) => ({
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
        }),
      ),
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
