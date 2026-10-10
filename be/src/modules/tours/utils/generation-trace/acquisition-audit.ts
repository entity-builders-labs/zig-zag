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
  WebExtractionAttemptAudit,
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
  projectComponentIdentityStepInputs,
  projectEntityResolutionStepInput,
  projectGeographicValidationStepInput,
} from './resolution-audit';
import {
  AcquisitionWorkUnit,
  workUnitGeographicGrant,
} from '../acquisition-strategy-selector.util';
import { WorkUnitGeographicGrant } from '../../interfaces/geographic-validation-authorization.interface';
import { projectAtomizedSourceUnitSteps } from './atomized-source-unit-audit';

export type AcquisitionWorkUnitStrategyLabel =
  | 'area_route_walk'
  | 'dedicated_intent'
  | 'generic'
  | 'planner_capacity';

export function workUnitStrategyLabel(
  unit: AcquisitionWorkUnit,
): AcquisitionWorkUnitStrategyLabel {
  switch (unit.kind) {
    case 'AREA_ROUTE_WALK':
      return 'area_route_walk';
    case 'DEDICATED_INTENT':
      return 'dedicated_intent';
    case 'GENERIC':
      return 'generic';
    case 'PLANNER_CAPACITY':
      return 'planner_capacity';
  }
}

/** Bounded trace projection of a work-unit geographic grant. */
export function projectWorkUnitGeographicGrant(grant: WorkUnitGeographicGrant):
  | { kind: 'NONE' }
  | {
      kind: 'OWNED_INTENT';
      intent: string;
      workUnit: string;
      ownedDeficit: string;
    } {
  return grant.kind === 'NONE'
    ? { kind: 'NONE' }
    : {
        kind: 'OWNED_INTENT',
        intent: grant.intent,
        workUnit: grant.workUnit,
        ownedDeficit: `intent:${grant.ownedDeficit.key}`,
      };
}

/** Trace projection of one acquisition work unit (deficits + grant). */
export function projectAcquisitionWorkUnit(unit: AcquisitionWorkUnit) {
  const geographicGrant = projectWorkUnitGeographicGrant(
    workUnitGeographicGrant(unit),
  );
  switch (unit.kind) {
    case 'AREA_ROUTE_WALK':
      return {
        kind: unit.kind,
        intentKey: unit.deficit.key,
        deficit: unit.deficit,
        anchor: unit.anchor,
        anchorMode: unit.anchorMode,
        geographicGrant,
      };
    case 'DEDICATED_INTENT':
      return {
        kind: unit.kind,
        intentKey: unit.deficit.key,
        deficit: unit.deficit,
        geographicGrant,
      };
    case 'GENERIC':
      return { kind: unit.kind, deficits: unit.deficits, geographicGrant };
    case 'PLANNER_CAPACITY':
      return { kind: unit.kind, deficit: unit.deficit, geographicGrant };
  }
}

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
    component: 'ExperienceCatalog.findVerifiedWithinForMatching',
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
    workUnits: AcquisitionWorkUnit[];
    resolvedAnchors: ResolvedAnchor[];
    acquisitionDeficits: AcquisitionDeficit[];
  },
): TraceStepV5 {
  const { workUnits, resolvedAnchors, acquisitionDeficits } = input;
  const count = (kind: AcquisitionWorkUnit['kind']) =>
    workUnits.filter((unit) => unit.kind === kind).length;
  return recorder.record({
    name: 'acquisition.routing',
    description: `Asignación de déficits a unidades de adquisición: AREA_ROUTE_WALK=${count('AREA_ROUTE_WALK')}; DEDICATED_INTENT=${count('DEDICATED_INTENT')}; GENERIC=${count('GENERIC')}.`,
    component: 'partitionDeficitsIntoWorkUnits',
    decision: { status: 'INFO', outcome: 'ROUTED' },
    input: {
      anchors: resolvedAnchors,
      acquisitionDeficits,
    },
    output: {
      workUnits: workUnits.map(projectAcquisitionWorkUnit),
    },
  });
}

export function recordAreaRouteWalkStep(
  recorder: GenerationTraceRecorder,
  input: {
    anchor: ResolvedAnchor;
    deficit: AcquisitionDeficit & { key: string };
    result: AreaRouteWalkAcquisitionResult;
  },
): TraceStepV5 {
  const { anchor, deficit, result } = input;
  const intentKey = deficit.key;
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
    /** The ONE work unit that produced this execution. */
    workUnit: AcquisitionWorkUnit;
    geographicGrant: WorkUnitGeographicGrant;
    plan: ExperienceAcquisitionPlan;
    execution: ExecuteAcquisitionPlanResult;
    resolution?: FinalExperienceResolutionResponse;
  },
): void {
  const { passNumber, workUnit, geographicGrant, plan, execution, resolution } =
    input;
  const strategy = workUnitStrategyLabel(workUnit);
  const anchor =
    workUnit.kind === 'AREA_ROUTE_WALK' ? workUnit.anchor : undefined;
  const slugSource =
    anchor?.rawName ??
    (workUnit.kind === 'DEDICATED_INTENT' ? workUnit.deficit.key : undefined);
  const anchorSlug = slugSource
    ? `-${slugSource
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')}`
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
      workUnit: projectAcquisitionWorkUnit(workUnit),
      geographicGrant: projectWorkUnitGeographicGrant(geographicGrant),
      ...(anchor ? { anchor } : {}),
      ...projectWebPlanFacts(plan),
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
    // A web result fails as a whole, but the trace attributes the failure to
    // the stage that raised it (`failedStage`). A failed result without a
    // recorded stage stays attributed to the search step, as before.
    const failedStage =
      webResult.status === 'failed' ? webResult.failedStage : undefined;
    const searchFailed =
      webResult.status === 'failed' &&
      (failedStage === undefined || failedStage === 'SEARCH');

    // 5a. acquisition.web_search
    recorder.record({
      parentId: passId,
      name: 'acquisition.web_search',
      description: `Búsqueda web con grounding: "${webResult.query}"`,
      component: 'ExperienceAcquisitionService',
      decision: searchFailed
        ? {
            status: 'FAIL',
            outcome: 'FAILED',
            reason: webResult.failureReason,
          }
        : webResult.status === 'failed'
          ? { status: 'PASS', outcome: 'SUCCESS' }
          : {
              status: 'PASS',
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
        ...(webResult.groundedEvidence
          ? { groundedEvidence: webResult.groundedEvidence }
          : {}),
      },
    });

    // 5b. acquisition.deep_source_selection (if deep source selection was performed)
    if (failedStage === 'SOURCE_SELECTION') {
      recorder.record({
        parentId: passId,
        name: 'acquisition.deep_source_selection',
        description: 'Selección de fuentes web para contenido profundo (falló)',
        component: 'ExperienceAcquisitionService',
        decision: {
          status: 'FAIL',
          outcome: 'FAILED',
          reason: webResult.failureReason,
        },
        facts: { failedStage, failureReason: webResult.failureReason },
      });
    } else if (webResult.deepSourceSelection) {
      const selection = webResult.deepSourceSelection;
      const hasSelected = selection.selectedUrls.length > 0;
      recorder.record({
        parentId: passId,
        name: 'acquisition.deep_source_selection',
        description: `Selección de fuentes web para contenido profundo (${selection.selectedUrls.length} de ${selection.evidenceCount} candidatas seleccionadas)`,
        component: 'ExperienceAcquisitionService',
        input: {
          evidenceCount: selection.evidenceCount,
          ...(selection.anchorNames
            ? { anchorNames: selection.anchorNames }
            : {}),
          selectionLimit: selection.selectionLimit,
        },
        decision: {
          status: hasSelected ? 'PASS' : 'WARN',
          outcome: hasSelected ? 'SOURCES_SELECTED' : 'NO_ELIGIBLE_SOURCES',
          reason: hasSelected
            ? `${selection.selectedUrls.length} fuentes seleccionadas para recuperación profunda.`
            : 'No hay fuentes editoriales elegibles para recuperación profunda.',
        },
        facts: {
          evidenceCount: selection.evidenceCount,
          anchorNames: selection.anchorNames,
          selectionLimit: selection.selectionLimit,
          selectedUrls: selection.selectedUrls,
        },
        subjects: selection.items.map((item) => ({
          subject: {
            kind: 'grounded_evidence',
            id: item.evidenceKey,
            ...(item.title ? { label: item.title } : {}),
            ...(item.url ? { url: item.url } : {}),
          },
          decision: {
            status: item.selected
              ? ('PASS' as const)
              : item.editorialEligible
                ? ('INFO' as const)
                : ('FAIL' as const),
            outcome: item.decisionReason,
          },
          facts: {
            evidenceKey: item.evidenceKey,
            ...(item.title ? { title: item.title } : {}),
            ...(item.url ? { url: item.url } : {}),
            ...(item.snippet !== undefined ? { snippet: item.snippet } : {}),
            originalRank: item.originalRank,
            editorialEligible: item.editorialEligible,
            tourContentScore: item.tourContentScore,
            citedCandidateBonus: item.citedCandidateBonus,
            finalScore: item.finalScore,
            ...(item.rankedPosition !== undefined
              ? { rankedPosition: item.rankedPosition }
              : {}),
            selected: item.selected,
            decisionReason: item.decisionReason,
          },
        })),
      });
    }

    // 5c. acquisition.source_retrieval (if content retrieval attempted)
    if (failedStage === 'SOURCE_FETCH') {
      recorder.record({
        parentId: passId,
        name: 'acquisition.source_retrieval',
        description: 'Recuperación de contenido web (falló)',
        component: 'WebSourceContentRetrievalService',
        decision: {
          status: 'FAIL',
          outcome: 'FAILED',
          reason: webResult.failureReason,
        },
        facts: {
          failedStage,
          failureReason: webResult.failureReason,
          requestedUrls: webResult.deepSourceSelection?.selectedUrls ?? [],
        },
      });
    } else if (webResult.sourceContentRetrieval?.attempted) {
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

    // 5c'. acquisition.deep_source_window — one step per progressive
    // deep-source attempt, carrying the exact window text it examined.
    for (const attempt of webResult.extractionAttempts) {
      if (!attempt.sourceWindow) continue;
      const { sourceUrl, windowing, content } = attempt.sourceWindow;
      recorder.record({
        parentId: passId,
        name: 'acquisition.deep_source_window',
        description: `${attempt.inputKind === 'atomized_source_unit' ? 'Extracción atomizada' : 'Extracción'} sobre ventana ${windowing.windowOrdinal}/${windowing.windowCount} de ${sourceUrl}`,
        component: 'ExperienceDiscoveryExtractor',
        decision: {
          status:
            attempt.status === 'failed' ||
            attempt.scanDecision === 'STOP_EXTRACTION_FAILED'
              ? 'FAIL'
              : attempt.scanDecision === 'STOP_REQUIREMENT_SATISFIED'
                ? 'PASS'
                : attempt.scanDecision === 'STOP_SOURCES_EXHAUSTED' ||
                    attempt.scanDecision === 'CONTINUE_SOURCE_UNIT_INCOMPLETE'
                  ? 'WARN'
                  : 'INFO',
          outcome: attempt.scanDecision ?? 'FAILED',
        },
        facts: {
          ...projectExtractionAttempt(attempt),
          sourceUrl,
          windowing,
          content,
        },
      });
      if (attempt.atomizedUnit) {
        for (const stepInput of projectAtomizedSourceUnitSteps(
          attempt.atomizedUnit,
        )) {
          recorder.record({ parentId: passId, ...stepInput });
        }
      }
    }

    // 5c. acquisition.semantic_extraction
    recorder.record({
      parentId: passId,
      name: 'acquisition.semantic_extraction',
      description: `Extracción semántica de candidatos (${webResult.candidateCount} admitidos de ${webResult.extractedCandidateCount ?? webResult.candidateCount} extraídos)`,
      component: 'ExperienceDiscoveryExtractor',
      decision:
        failedStage === 'EXTRACTION'
          ? {
              status: 'FAIL',
              outcome: 'FAILED',
              reason: webResult.failureReason,
            }
          : {
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
        // Every attempt in execution order; the fields above are the final
        // attempt only. Deep-source window attempts are summarized here and
        // detailed in their own `acquisition.deep_source_window` steps, so a
        // long progressive scan cannot overflow this step's payload.
        extractionAttempts: webResult.extractionAttempts.map((attempt) =>
          attempt.sourceWindow
            ? summarizeDeepExtractionAttempt(attempt)
            : projectExtractionAttempt(attempt),
        ),
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

    // 6a'. resolution.component_identity -- one bounded step per
    // multi-component candidate (the full resolution.entity payload can
    // exceed the trace step limit and be truncated).
    for (const stepInput of projectComponentIdentityStepInputs(resolution, {
      strategy,
      passNumber,
      workUnitKind: workUnit.kind,
    })) {
      recorder.record({ parentId: passId, ...stepInput });
    }

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

/**
 * Trace projection of one extraction attempt. Candidate decisions are reduced
 * to their identity and admission outcome; the full candidates of the final
 * attempt remain on the step's `subjects`.
 */
function summarizeDeepExtractionAttempt(attempt: WebExtractionAttemptAudit) {
  return {
    inputKind: attempt.inputKind,
    status: attempt.status,
    ...(attempt.sourceWindow
      ? {
          sourceUrl: attempt.sourceWindow.sourceUrl,
          windowOrdinal: attempt.sourceWindow.windowing.windowOrdinal,
          windowCount: attempt.sourceWindow.windowing.windowCount,
          retainedContentChars:
            attempt.sourceWindow.windowing.retainedContentChars,
        }
      : {}),
    extractedCandidateCount: attempt.extractedCandidateCount,
    admittedCandidateCount: attempt.admittedCandidateCount,
    validationErrorCount: attempt.validationErrors.length,
    scanDecision: attempt.scanDecision,
    failureReason: attempt.failureReason,
  };
}

function projectExtractionAttempt(attempt: WebExtractionAttemptAudit) {
  return {
    inputKind: attempt.inputKind,
    status: attempt.status,
    extractorProvider: attempt.extractorProvider,
    extractorModel: attempt.extractorModel,
    rawOutput: attempt.rawOutput,
    validationErrors: attempt.validationErrors,
    extractedCandidateCount: attempt.extractedCandidateCount,
    admittedCandidateCount: attempt.admittedCandidateCount,
    candidateDecisions: attempt.candidateDecisions.map((d) => ({
      candidateKey: traceCandidateKey(d.candidate),
      name: d.candidate.name,
      componentHintCount: d.candidate.componentHints.length,
      accepted: d.accepted,
      reason: d.reason,
      candidateShapeMatches: d.candidateShapeMatches,
    })),
    sourceSupportAudits: attempt.sourceSupportAudits,
    failureReason: attempt.failureReason,
  };
}

/** The web query / requested intents / anchor names this unit searched with. */
function projectWebPlanFacts(plan: ExperienceAcquisitionPlan) {
  const web = plan.sourcePlans.find(
    (sourcePlan): sourcePlan is Extract<SourcePlan, { provider: 'web' }> =>
      sourcePlan.provider === 'web',
  )?.web;
  return {
    evidenceRequirements: plan.evidenceRequirements,
    ...(web
      ? {
          webQuery: web.query,
          requestedIntents: web.requestedIntents ?? [],
          requestedThemes: web.requestedThemes ?? [],
          anchorNames: web.anchorNames ?? [],
        }
      : {}),
  };
}
