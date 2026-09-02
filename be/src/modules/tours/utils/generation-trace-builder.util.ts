import { ActivityKind } from '@prisma/client';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import {
  PlacesCrawlProvenance,
  placesProviderLabel,
} from '@integrations/google-places/interfaces/places-api.interface';
import {
  GenerationTraceStep,
  TraceCandidate,
  TraceRuleEvaluation,
} from '../interfaces/generation-trace.interface';
import {
  CoverageCandidate,
  CoverageReport,
} from '../interfaces/coverage-analysis.interface';
import { TourCompletenessResult } from '../interfaces/tour-completeness.interface';
import { ExperienceResolutionResponse } from '../interfaces/experience-resolution.interface';
import { TourGenerationRequest } from '../interfaces/tour-generation.interface';
import { DailyPlanningSolution } from '../interfaces/daily-planning.interface';
import { CandidateScoreBreakdown } from './candidate-ranking.util';
import { FormatAvailability } from './candidate-window-selection.util';
import { matchedThemesFor } from './theme-matching.util';
import { EXPERIENCE_FORMAT_ACTIVITY_KIND } from './experience-format-kind.util';

function activityDetail(act: any): string {
  const parts: string[] = [];
  const metadata =
    act.metadata &&
    typeof act.metadata === 'object' &&
    !Array.isArray(act.metadata)
      ? act.metadata
      : undefined;
  if (metadata?.providerPrimaryType)
    parts.push(`tipo proveedor ${metadata.providerPrimaryType}`);
  if (act.type) parts.push(`categoría ${act.type}`);
  if (act.rating != null) {
    parts.push(
      `rating ${act.rating}/5${act.ratingCount != null ? ` (${act.ratingCount} reviews)` : ''}`,
    );
  }
  if (act.priceLevel != null) parts.push(`precio ${act.priceLevel}/5`);
  const weekdayText = act.openingHours?.weekdayText;
  if (weekdayText?.length) parts.push(`horario: ${weekdayText[0]}`);
  return parts.length ? parts.join(' · ') : 'sin datos adicionales';
}

function rejectionReasonSummary(
  rejectedCountByReason: Record<string, number>,
): string {
  const reasons = Object.entries(rejectedCountByReason)
    .filter(
      ([reason, count]) => reason !== 'provider_request_failed' && count > 0,
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => `${reason}=${count}`);

  return reasons.length > 0
    ? ` Motivos registrados (un candidato puede tener más de uno): ${reasons.join('; ')}.`
    : '';
}

function rule(
  ruleId: string,
  label: string,
  result: TraceRuleEvaluation['result'],
  reason: string,
  actual?: unknown,
  expected?: unknown,
  inputs?: Record<string, unknown>,
): TraceRuleEvaluation {
  return { ruleId, rule: label, result, reason, actual, expected, inputs };
}

export function buildTourIntentStep(
  request: TourGenerationRequest,
): GenerationTraceStep {
  const hasAdditionalPreferences = Boolean(
    request.intent.additionalPreferences?.trim(),
  );
  const themes = request.intent.interests.length
    ? request.intent.interests.join(', ')
    : 'sin temas específicos';
  const accessibility = request.mobility.accessibilityNeeds.length
    ? ` Accesibilidad: ${request.mobility.accessibilityNeeds.join(', ')}.`
    : '';
  const additional = hasAdditionalPreferences
    ? ` Preferencias adicionales capturadas: "${request.intent.additionalPreferences}".`
    : ' Sin preferencias adicionales.';
  return {
    stage: 'tour_intent',
    label: 'Intención y movilidad solicitadas',
    component: 'TourGenerationRequest',
    status: 'INFO',
    summary:
      `Temas: ${themes}. ` +
      `Estilo: ${request.intent.explorationStyle}. Modos permitidos: ${request.mobility.allowedTransportationModes.join(', ')}. ` +
      `Esfuerzo peatonal capturado: ${request.mobility.maxWalkingDistancePerDayMeters / 1000}km por día y ` +
      `${request.mobility.maxContinuousWalkingDistanceMeters / 1000}km continuos; todavía no se aplica como restricción determinística hasta la etapa de factibilidad espacial. ` +
      `Ritmo: ${request.mobility.travelPace}.${accessibility}${additional}`,
    inputs: {
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
    },
    rules: [
      rule(
        'INTENT-CANONICAL-001',
        'Usar el wizard canónico como fuente de restricciones explícitas',
        'PASS',
        'La generación parte de TourGenerationRequest contractVersion=1.',
        request.contractVersion,
        1,
      ),
      rule(
        'INTENT-FREETEXT-001',
        'Conservar preferencias adicionales como intención suplementaria',
        hasAdditionalPreferences ? 'PASS' : 'SKIPPED',
        hasAdditionalPreferences
          ? 'Hay texto adicional disponible para búsqueda/ranking semántico.'
          : 'El usuario no ingresó preferencias adicionales.',
        request.intent.additionalPreferences ?? null,
      ),
    ],
    decision: {
      status: 'INFO',
      outcome: 'INTENT_ACCEPTED',
      reason:
        'La solicitud contiene el contrato canónico requerido por el motor.',
      reasonCodes: ['CANONICAL_REQUEST_AVAILABLE'],
      triggeredActions: ['RESOLVE_DESTINATION'],
    },
    outputs: {
      requestedThemes: request.intent.interests,
      requestedDays: request.days,
    },
  };
}

export function buildDbSearchStep(
  candidates: any[],
  radiusKm: number,
): GenerationTraceStep {
  return {
    stage: 'db_search',
    label: 'Recuperación inicial del catálogo',
    component: 'ActivitiesService.findAll',
    status: candidates.length ? 'PASS' : 'WARN',
    summary: candidates.length
      ? `${candidates.length} actividades recuperadas del catálogo dentro del alcance de búsqueda.`
      : 'No se recuperaron actividades del catálogo en el alcance inicial.',
    inputs: { radiusKm },
    rules: [
      rule(
        'CATALOG-RETRIEVAL-001',
        'Recuperar candidatos reales persistidos antes de adquirir nuevos',
        candidates.length ? 'PASS' : 'WARN',
        candidates.length
          ? `El catálogo aportó ${candidates.length} candidato(s).`
          : 'El catálogo no aportó candidatos; la cobertura decidirá si adquirir nuevos.',
        candidates.length,
      ),
    ],
    decision: {
      status: candidates.length ? 'PASS' : 'WARN',
      outcome: candidates.length
        ? 'CATALOG_POOL_AVAILABLE'
        : 'CATALOG_POOL_EMPTY',
      reason: candidates.length
        ? 'Hay candidatos persistidos para evaluar.'
        : 'No hay candidatos persistidos para este alcance.',
      triggeredActions: ['ANALYZE_COVERAGE'],
    },
    outputs: { candidateCount: candidates.length },
    candidates: candidates.map(
      (act): TraceCandidate => ({
        source: 'db',
        id: act.id,
        name: act.name,
        detail: activityDetail(act),
        offered: true,
        chosen: false,
      }),
    ),
    candidateDecisions: candidates.map((act) => ({
      id: act.id,
      name: act.name,
      source: 'db',
      status: 'ELIGIBLE' as const,
      reason:
        'Candidato real recuperado del catálogo para evaluación posterior.',
      reasonCodes: ['CATALOG_MATCH'],
    })),
  };
}

export function buildPlacesCrawlStep(
  candidates: any[],
  provenance: PlacesCrawlProvenance,
  failed = false,
): GenerationTraceStep {
  const providerLabel = placesProviderLabel(provenance.provider);
  const rejectedCandidates = provenance.rejectedCandidates ?? [];
  const cacheLabel =
    provenance.cacheStatus === 'hit'
      ? 'cache hit'
      : provenance.cacheStatus === 'strict-miss'
        ? 'strict cache miss'
        : 'live provider call';
  const providerRequestFailures =
    provenance.rejectedCountByReason.provider_request_failed ?? 0;
  const rejectedCandidateCount =
    provenance.rejectedCount ??
    Object.entries(provenance.rejectedCountByReason).reduce(
      (sum, [reason, count]) =>
        reason === 'provider_request_failed' ? sum : sum + count,
      0,
    );
  const requestFailureSuffix = providerRequestFailures
    ? ` Además, ${providerRequestFailures} consulta(s) al proveedor fallaron.`
    : '';
  const rejectionReasons = rejectionReasonSummary(
    provenance.rejectedCountByReason,
  );
  const anchorSummary = provenance.anchors?.length
    ? ` Usó ${provenance.anchors.length} punto(s) de cobertura geográfica para distribuir las consultas; no implican relevancia turística ni selección para composites: ${provenance.anchors
        .map((anchor) => anchor.label)
        .join(', ')}.`
    : '';
  const validationSummary =
    provenance.validatedCount !== undefined
      ? ` Flujo de candidatos: semilla recibió ${provenance.seedReceivedCount ?? 0}; cobertura recibió ${provenance.coverageReceivedCount ?? provenance.receivedCount}; geografía de operación rechazó ${provenance.operationGeographyRejectedCount ?? 0}; la unión eliminó ${provenance.deduplicatedCount ?? 0} duplicado(s); identidad válida ${provenance.identityValidCount ?? provenance.validatedCount}; admisión aprobada ${provenance.admittedCount ?? provenance.validatedCount}; ${provenance.existingCount ?? provenance.rejectedCountByReason.existing_activity ?? 0} ya existía(n); persistió ${provenance.persistedCount ?? provenance.acceptedCount} nuevo(s) e indexó ${provenance.embeddedCount ?? 0} embedding(s).`
      : '';
  const embeddingFailureSummary =
    provenance.embeddingWriteStatus === 'failed' ||
    provenance.embeddingWriteStatus === 'unavailable'
      ? ` La indexación semántica quedó ${provenance.embeddingWriteStatus === 'failed' ? 'fallida' : 'no disponible'}: ${provenance.embeddingFailureReason || 'motivo no registrado'}.`
      : '';
  const providerCalls =
    provenance.providerCallCount !== undefined
      ? ` Ejecutó ${provenance.providerCallCount} consulta(s) acotadas.`
      : '';
  const operationSummary = provenance.operations?.length
    ? (() => {
        const succeededText = provenance.operations.filter(
          ({ providerOperation, status }) =>
            providerOperation === 'text' && status === 'succeeded',
        ).length;
        const succeededNearby = provenance.operations.filter(
          ({ providerOperation, status }) =>
            providerOperation === 'nearby' && status === 'succeeded',
        ).length;
        const skippedUnsupported = provenance.operations.filter(
          ({ status, unsupportedReason }) =>
            status === 'skipped' && unsupportedReason === 'provider_capability',
        ).length;
        const failedOperations = provenance.operations.filter(
          ({ status }) => status === 'failed',
        ).length;
        return ` Subflujo de adquisición: ${succeededText} ${providerLabel} Text Search de semilla turística; ${succeededNearby} Nearby Search de cobertura por tipos primarios; ${skippedUnsupported} omitida(s) por capacidad del proveedor; ${failedOperations} fallida(s).`;
      })()
    : '';
  return {
    stage: 'places_crawl',
    label: `Catalog refill · ${providerLabel}`,
    component: `${providerLabel}CatalogRefill`,
    status: failed ? 'FAIL' : 'PASS',
    summary: failed
      ? `${providerLabel} falló (${cacheLabel}). Solicitados: ${provenance.requestedCount}; recibidos: ${provenance.receivedCount}; no se afirmó cobertura nueva.`
      : `${providerLabel} (${cacheLabel}) recibió ${provenance.receivedCount} resultados brutos y persistió ${provenance.persistedCount ?? provenance.acceptedCount} actividad(es) nueva(s).${anchorSummary}${providerCalls}${operationSummary}${validationSummary}${embeddingFailureSummary}${rejectedCandidateCount ? ` Rechazos totales registrados: ${rejectedCandidateCount}.${rejectionReasons}` : ''}${requestFailureSuffix}`,
    inputs: {
      provider: provenance.provider,
      requestedCount: provenance.requestedCount,
      cacheStatus: provenance.cacheStatus,
      anchors: provenance.anchors?.map((a) => a.label) ?? [],
    },
    rules: [
      rule(
        'ACQ-PROVIDER-001',
        'La adquisición debe informar salud y resultados del proveedor',
        failed ? 'FAIL' : 'PASS',
        failed
          ? 'El proveedor falló durante el refill.'
          : 'El proveedor respondió y la admisión fue registrada.',
        failed ? 'failed' : 'success',
        'success',
      ),
      rule(
        'ACQ-IDENTITY-001',
        'Solo persistir candidatos admitidos con identidad verificable',
        failed ? 'WARN' : 'PASS',
        `${provenance.persistedCount ?? provenance.acceptedCount} persistido(s); ${rejectedCandidates.length} rechazo(s) detallado(s).`,
        provenance.persistedCount ?? provenance.acceptedCount,
      ),
    ],
    decision: {
      status: failed ? 'FAIL' : 'PASS',
      outcome: failed ? 'REFILL_FAILED' : 'REFILL_COMPLETED',
      reason: failed
        ? 'No se puede afirmar que el refill haya agregado cobertura.'
        : 'Los candidatos admitidos se incorporan al catálogo y se reevalúa cobertura.',
      reasonCodes: failed
        ? ['PROVIDER_REQUEST_FAILED']
        : ['REFILL_RESULTS_ADMITTED'],
      triggeredActions: failed
        ? ['DEGRADE_TO_EXISTING_POOL']
        : ['REQUERY_CATALOG', 'ANALYZE_COVERAGE'],
    },
    outputs: {
      receivedCount: provenance.receivedCount,
      persistedCount: provenance.persistedCount ?? provenance.acceptedCount,
      rejectedCount: rejectedCandidates.length,
    },
    placesProvenance: provenance,
    providerStatus: failed ? 'failed' : 'success',
    degradedReason: failed ? 'provider_request_failed' : undefined,
    candidates: [
      ...candidates.map(
        (act): TraceCandidate => ({
          source:
            provenance.provider === 'google' ? 'google_places' : 'geoapify',
          id: act.id,
          name: act.name,
          detail: activityDetail(act),
          offered: true,
          chosen: false,
        }),
      ),
      ...rejectedCandidates.map(
        (rejected): TraceCandidate => ({
          source:
            provenance.provider === 'google' ? 'google_places' : 'geoapify',
          id: rejected.id,
          name: rejected.name,
          detail: `rechazado: ${rejected.reasons.join(', ')}`,
          offered: false,
          chosen: false,
        }),
      ),
    ],
    candidateDecisions: [
      ...candidates.map((act) => ({
        id: act.id,
        name: act.name,
        source: provenance.provider,
        status: 'ELIGIBLE' as const,
        reason: 'Admitido por el flujo de catalog refill.',
        reasonCodes: ['ACQUISITION_ADMITTED'],
      })),
      ...rejectedCandidates.map((rejected) => ({
        id: rejected.id,
        name: rejected.name,
        source: provenance.provider,
        status: 'REJECTED' as const,
        reason: rejected.reasons.join(', '),
        reasonCodes: rejected.reasons,
      })),
    ],
  };
}

export function buildDestinationResolutionStep(
  destinationText: string | undefined,
  resolution:
    | {
        scale: 'point';
        attemptedQueries?: string[];
        degradationReason?: string;
        pointReason?: string;
        settlementResult?: { displayName: string };
      }
    | {
        scale: 'area';
        boundary: OsmCandidate;
        attemptedQueries?: string[];
        selectedResult?: { displayName: string };
        settlementResult?: { displayName: string };
      },
): GenerationTraceStep {
  const area = resolution.scale === 'area';
  const providerFailed =
    !area && resolution.degradationReason === 'provider_failed';
  const attempted = resolution.attemptedQueries?.length
    ? ` Intentos: ${resolution.attemptedQueries.join(' → ')}.`
    : '';
  const degradationMessages: Record<string, string> = {
    missing_destination: 'No se recibió un destino textual.',
    no_area_candidate:
      'Nominatim no devolvió una ciudad/pueblo con límite utilizable.',
    candidate_mismatched_coordinates:
      'Los candidatos de ciudad encontrados no coincidían con las coordenadas seleccionadas.',
    boundary_unavailable:
      'Se identificó la ciudad, pero no se pudo obtener su límite OSM.',
    provider_failed: 'La resolución del destino falló y continuó degradada.',
  };
  return {
    stage: 'destination_resolution',
    label: 'Resolución del destino',
    component: 'DestinationResolutionService',
    status: providerFailed ? 'WARN' : 'PASS',
    summary: area
      ? resolution.settlementResult
        ? `"${destinationText}" se identificó como ${resolution.settlementResult.displayName} y se validó con el límite administrativo contenedor ${resolution.boundary.name}. Se usa ese límite real en vez de un único punto+radio.${attempted}`
        : `"${destinationText}" resolvió a un límite real de ciudad: ${resolution.boundary.name}. Se usa ese límite real para acotar la recuperación y adquisición de candidatos en vez de un único punto+radio.${attempted}`
      : resolution.pointReason === 'specific_point_hint'
        ? destinationText
          ? `"${destinationText}" fue seleccionado como un lugar o dirección específica — se conserva como destino puntual y no se amplía a la ciudad contenedora.`
          : 'Se usa la ubicación puntual seleccionada y no se amplía a una ciudad contenedora.'
        : destinationText
          ? `"${destinationText}" no resolvió a un límite de ciudad/pueblo real — se usa el punto+radio de siempre. ${degradationMessages[resolution.degradationReason || ''] || 'Motivo no registrado.'}${attempted}`
          : 'No se especificó un destino de texto — se usa el punto+radio de siempre.',
    inputs: {
      destinationText: destinationText ?? null,
      attemptedQueries: resolution.attemptedQueries ?? [],
    },
    rules: [
      rule(
        'DEST-SCALE-001',
        'Determinar si el destino puede usar boundary real o debe degradar a punto',
        area ? 'PASS' : providerFailed ? 'WARN' : 'PASS',
        area
          ? 'Se obtuvo boundary administrativo utilizable.'
          : `Se usa punto. Motivo: ${resolution.pointReason ?? resolution.degradationReason ?? 'point_destination'}.`,
        area ? 'area' : 'point',
      ),
    ],
    decision: {
      status: providerFailed ? 'WARN' : 'PASS',
      outcome: area ? 'USE_ADMINISTRATIVE_BOUNDARY' : 'USE_POINT_RADIUS',
      reason: area
        ? 'El boundary real es más preciso que un radio artificial para recuperación local.'
        : `No se aplicará boundary de área; razón registrada: ${resolution.pointReason ?? resolution.degradationReason ?? 'point_destination'}.`,
      reasonCodes: [
        area
          ? 'AREA_BOUNDARY_RESOLVED'
          : (resolution.degradationReason ??
            resolution.pointReason ??
            'POINT_DESTINATION'),
      ],
      triggeredActions: ['RETRIEVE_CATALOG'],
    },
    outputs: {
      scale: resolution.scale,
      boundaryName: area ? resolution.boundary.name : null,
    },
    providerStatus: providerFailed ? 'failed' : undefined,
    degradedReason: !area ? resolution.degradationReason : undefined,
  };
}

export function buildEmbeddingsStep(
  result: {
    status: 'not_requested' | 'applied' | 'unavailable';
    eligibleCandidateCount: number;
    indexedCandidateCount: number;
    identity?: {
      provider: string;
      model: string;
      dimensions: number;
      documentVersion: number;
    };
    reason?: string;
  },
  offeredCount: number,
): GenerationTraceStep {
  const measuredRatio = result.eligibleCandidateCount
    ? result.indexedCandidateCount / result.eligibleCandidateCount
    : 0;
  let summary: string;
  if (result.status === 'applied') {
    const missingCount =
      result.eligibleCandidateCount - result.indexedCandidateCount;
    summary =
      `Ranking semántico solicitado y aplicado sobre ${result.eligibleCandidateCount} candidato(s) elegible(s) del destino: ` +
      `${result.indexedCandidateCount} tenían un vector compatible con el índice activo y se ofrecieron ${offeredCount} al selector.` +
      (missingCount > 0
        ? ` ${missingCount} candidato(s) sin embedding compatible se conservaron explícitamente detrás del grupo medido y se ordenaron por calidad y proximidad.`
        : ' Todos los candidatos elegibles tenían embedding compatible.');
  } else if (result.status === 'unavailable') {
    summary =
      `Ranking semántico solicitado pero no aplicado sobre ${result.eligibleCandidateCount} candidato(s) elegible(s). ` +
      `Se ofrecieron ${offeredCount} usando calidad y proximidad. Motivo: ${result.reason || 'proveedor o índice semántico no disponible'}.`;
  } else {
    summary =
      `No se solicitó ranking semántico porque la intención no contenía intereses ni preferencias semánticas adicionales. ` +
      `${result.indexedCandidateCount} de ${result.eligibleCandidateCount} candidato(s) elegible(s) tenían embedding compatible; ` +
      `se ofrecieron ${offeredCount} por calidad y proximidad.`;
  }
  return {
    stage: 'embeddings',
    label: 'Ranking semántico',
    component: 'VectorStoreService + pgvector',
    status: result.status === 'unavailable' ? 'WARN' : 'PASS',
    summary,
    inputs: {
      eligibleCandidateCount: result.eligibleCandidateCount,
      provider: result.identity?.provider ?? null,
      model: result.identity?.model ?? null,
    },
    rules: [
      rule(
        'RANK-SEMANTIC-001',
        'Usar similitud semántica solo cuando fue solicitada y está disponible',
        result.status === 'unavailable'
          ? 'WARN'
          : result.status === 'not_requested'
            ? 'SKIPPED'
            : 'PASS',
        result.status === 'applied'
          ? 'La similitud se incorporó al ranking.'
          : result.status === 'not_requested'
            ? 'No había intención semántica que medir.'
            : (result.reason ?? 'Proveedor o índice semántico no disponible.'),
        result.status,
      ),
      rule(
        'RANK-UNKNOWN-001',
        'Un candidato sin embedding no equivale a score semántico cero',
        'PASS',
        'La ausencia de embedding se conserva como señal no medida; otras señales pueden mantener el candidato.',
      ),
    ],
    decision: {
      status: result.status === 'unavailable' ? 'WARN' : 'PASS',
      outcome:
        result.status === 'applied'
          ? 'SEMANTIC_SIGNAL_APPLIED'
          : 'SEMANTIC_SIGNAL_NOT_APPLIED',
      reason:
        result.reason ??
        (result.status === 'applied'
          ? 'Índice semántico compatible disponible.'
          : 'No era requerido.'),
      reasonCodes: [result.status.toUpperCase()],
      triggeredActions: ['BUILD_RANKED_WINDOW'],
    },
    outputs: {
      indexedCandidateCount: result.indexedCandidateCount,
      measuredRatio,
      offeredCandidateCount: offeredCount,
    },
    providerStatus: result.status === 'unavailable' ? 'failed' : undefined,
    degradedReason: result.status === 'unavailable' ? result.reason : undefined,
    semanticRanking: {
      status: result.status,
      eligibleCandidateCount: result.eligibleCandidateCount,
      indexedCandidateCount: result.indexedCandidateCount,
      offeredCandidateCount: offeredCount,
      provider: result.identity?.provider,
      model: result.identity?.model,
      dimensions: result.identity?.dimensions,
      documentVersion: result.identity?.documentVersion,
      reason: result.reason,
    },
  };
}

export function buildCoverageAnalysisStep(
  report: CoverageReport,
): GenerationTraceStep {
  const blocking = report.deficits.filter((d) => d.severity === 'blocking');
  const warnings = report.deficits.filter((d) => d.severity === 'warning');
  const sufficient = report.status === 'sufficient';
  const deficitsSummary = report.deficits.length
    ? report.deficits.map((deficit) => deficit.message).join(' ')
    : 'Sin déficits bloqueantes.';
  const decisionSummary = report.decision.requiresAdditionalDiscovery
    ? `Se detectaron faltantes que requieren una búsqueda adicional: ${report.decision.action}.`
    : `Decisión de adquisición: ${report.decision.action}.`;

  const rules: TraceRuleEvaluation[] = [
    rule(
      'COV-QUANTITY-001',
      'Cantidad utilizable suficiente para días y ritmo solicitados',
      report.usableCandidateCount >= report.requiredCandidateCount
        ? 'PASS'
        : 'FAIL',
      `${report.usableCandidateCount} utilizable(s) frente a ${report.requiredCandidateCount} requerido(s).`,
      report.usableCandidateCount,
      report.requiredCandidateCount,
    ),
    rule(
      'COV-SEMANTIC-001',
      'Cobertura semántica disponible cuando existe intención semántica',
      report.semanticCoverage.status === 'unavailable'
        ? 'FAIL'
        : report.semanticCoverage.status === 'not_requested'
          ? 'SKIPPED'
          : report.semanticCoverage.indexedCandidateCount > 0
            ? 'PASS'
            : 'FAIL',
      report.semanticCoverage.reason ??
        `${report.semanticCoverage.indexedCandidateCount}/${report.semanticCoverage.eligibleCandidateCount} candidato(s) indexado(s).`,
      report.semanticCoverage.indexedCandidateCount,
      report.semanticCoverage.status === 'not_requested' ? undefined : '> 0',
    ),
    ...report.requestedThemeCoverage.map((theme) =>
      rule(
        `COV-THEME-${theme.theme.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
        `Cobertura del tema solicitado: ${theme.theme}`,
        theme.matchedCandidateCount > 0 ? 'PASS' : 'FAIL',
        `${theme.matchedCandidateCount} candidato(s) coincidente(s), ${theme.strongMatchCount} fuerte(s).`,
        theme.matchedCandidateCount,
        '> 0',
      ),
    ),
  ];

  for (const deficit of report.deficits.filter(
    (d) => d.reason === 'missing_requested_experience_format',
  )) {
    rules.push(
      rule(
        `COV-FORMAT-${(deficit.experienceFormat ?? 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
        `Disponibilidad del formato solicitado: ${deficit.experienceFormat ?? 'unknown'}`,
        'FAIL',
        deficit.message,
        deficit.actualCount,
        deficit.expectedCount,
      ),
    );
  }

  return {
    stage: 'coverage_analysis',
    label: 'Cobertura multidimensional del pool',
    component: 'CoverageAnalyzer',
    status: sufficient
      ? 'PASS'
      : report.status === 'degraded'
        ? 'WARN'
        : 'FAIL',
    summary:
      `Analizados ${report.analyzedCandidateCount} candidatos; elegibles ${report.eligibleCandidateCount}; ofrecidos al LLM ${report.offeredCandidateCount}; requeridos ${report.requiredCandidateCount}. ` +
      `Estado ${report.status}. ${decisionSummary} ${deficitsSummary}`,
    inputs: {
      analyzedCandidateCount: report.analyzedCandidateCount,
      eligibleCandidateCount: report.eligibleCandidateCount,
      offeredCandidateCount: report.offeredCandidateCount,
      requiredCandidateCount: report.requiredCandidateCount,
      providerHealth: report.providerHealth,
    },
    rules,
    decision: {
      status: sufficient
        ? 'PASS'
        : report.status === 'degraded'
          ? 'WARN'
          : 'FAIL',
      outcome: report.decision.action,
      reason: sufficient
        ? 'No hay déficit bloqueante que justifique adquisición adicional.'
        : blocking.map((d) => d.message).join(' ') ||
          'La cobertura no alcanza el umbral requerido.',
      reasonCodes: report.deficits.map((d) => d.reason),
      triggeredActions:
        report.decision.action === 'none'
          ? ['BUILD_CANDIDATE_POOL']
          : report.decision.action === 'needs_additional_discovery' ||
              report.decision.action === 'needs_destination_discovery'
            ? ['RUN_GROUNDED_DISCOVERY']
            : report.decision.action === 'places_text_search' ||
                report.decision.action === 'places_nearby_search'
              ? ['RUN_CATALOG_REFILL']
              : ['DEGRADE_OR_FAIL'],
    },
    outputs: {
      status: report.status,
      blockingDeficits: blocking,
      warningDeficits: warnings,
      acquisitionDecision: report.decision,
    },
    providerStatus: report.status === 'degraded' ? 'failed' : undefined,
    degradedReason:
      report.status === 'degraded' ? report.providerHealth.reason : undefined,
    coverageReport: report,
  };
}

export function buildDiscoveryStep(
  result: import('../interfaces/activity-discovery.interface').DiscoveryResponse,
): GenerationTraceStep {
  const applied = result.groundingStatus === 'applied';
  return {
    stage: 'discovery',
    label: 'Grounded discovery',
    component: 'ActivityDiscoveryService',
    status: applied ? 'PASS' : 'WARN',
    summary: `${result.proposals.length} propuesta(s) extraída(s) a partir de evidencia grounded.`,
    inputs: {
      provider: result.provider,
      groundingProvider: result.groundingProvider,
      groundingModel: result.groundingModel,
      evidenceCount: result.groundingEvidence?.length ?? 0,
    },
    rules: [
      rule(
        'DISC-GROUNDED-001',
        'Discovery debe estar respaldado por evidencia del proveedor de búsqueda',
        applied ? 'PASS' : 'FAIL',
        applied
          ? 'La búsqueda devolvió evidencia grounded utilizable.'
          : `Grounding status: ${result.groundingStatus}.`,
        result.groundingStatus,
        'applied',
      ),
      rule(
        'DISC-PROPOSAL-001',
        'Las propuestas son conceptos; todavía no son identidad canónica',
        'PASS',
        'Las propuestas quedan pendientes de entity resolution antes de entrar al catálogo.',
      ),
    ],
    decision: {
      status: applied ? 'PASS' : 'WARN',
      outcome: result.proposals.length
        ? 'PROPOSALS_READY_FOR_RESOLUTION'
        : 'NO_USABLE_PROPOSALS',
      reason: result.proposals.length
        ? 'Hay conceptos grounded para intentar resolver como entidades reales.'
        : 'Discovery no produjo propuestas utilizables.',
      reasonCodes: result.validationErrors?.length
        ? ['PROPOSALS_VALIDATION_REJECTED']
        : ['GROUNDED_DISCOVERY_COMPLETED'],
      triggeredActions: result.proposals.length
        ? ['RESOLVE_ENTITIES']
        : ['CONTINUE_WITH_EXISTING_POOL'],
    },
    outputs: {
      proposalCount: result.proposals.length,
      validationErrors: result.validationErrors ?? [],
    },
    candidates: result.proposals.map((p) => ({
      source: 'discovery' as const,
      id: p.name,
      name: p.name,
      detail: `${p.kind} · ${p.themes.join(', ')} · ${p.suggestedDurationMinutes} min · ${p.shortReason}`,
      offered: false,
      chosen: false,
    })),
    candidateDecisions: result.proposals.map((p) => ({
      id: p.name,
      name: p.name,
      source: 'discovery',
      status: 'ELIGIBLE' as const,
      reason:
        'Concepto grounded listo para entity resolution; aún no es Activity canónica.',
      reasonCodes: ['PROPOSAL_PENDING_RESOLUTION'],
    })),
    providerStatus: applied ? 'success' : 'failed',
    degradedReason: applied ? undefined : `grounding_${result.groundingStatus}`,
    grounding: {
      status: result.groundingStatus,
      provider: result.groundingProvider,
      model: result.groundingModel,
      evidenceCount: result.groundingEvidence?.length ?? 0,
    },
  };
}

export function buildEntityResolutionStep(
  result: ExperienceResolutionResponse,
): GenerationTraceStep {
  const resolution = result.entityResolution ?? result;
  const accepted = resolution.resolved.filter(
    (entry) => entry.status === 'accepted',
  );
  const rejected = resolution.resolved.filter(
    (entry) => entry.status !== 'accepted',
  );
  const resolvedEntityCount = resolution.resolved.reduce(
    (sum, entry) =>
      sum +
      entry.resolvedEntities.filter((entity) => entity.status === 'resolved')
        .length,
    0,
  );
  const coordinateCount = resolution.resolved.reduce(
    (sum, entry) =>
      sum +
      entry.resolvedEntities.filter(
        (entity) =>
          entity.status === 'resolved' &&
          Number.isFinite(entity.latitude) &&
          Number.isFinite(entity.longitude),
      ).length,
    0,
  );
  const rejectedSummaries = rejected.map(
    (entry) =>
      `${entry.proposal.name}: ${entry.rejectionReasons.join(', ') || 'sin motivo registrado'}`,
  );

  return {
    stage: 'entity_resolution',
    label: 'Resolución de entidades reales',
    component: 'ActivityProposalResolutionService',
    status: accepted.length ? 'PASS' : rejected.length ? 'WARN' : 'INFO',
    summary:
      `Entity resolution procesó ${resolution.totalProposals} propuesta(s): ` +
      `${accepted.length} quedaron con entidades concretas suficientes para continuar y ` +
      `${rejected.length} no pudieron resolverse. Se obtuvieron ${resolvedEntityCount} entidad(es) ` +
      `provider-backed, ${coordinateCount} con coordenadas. Esta etapa no decide coherencia ` +
      `geográfica ni persiste la composite.` +
      (rejectedSummaries.length
        ? ` Rechazadas: ${rejectedSummaries.join('; ')}.`
        : ''),
    inputs: { totalProposals: resolution.totalProposals },
    rules: [
      rule(
        'RES-IDENTITY-001',
        'Resolver hints contra identidades geográficas independientes del LLM',
        accepted.length ? 'PASS' : 'WARN',
        `${resolvedEntityCount} entidad(es) reales resueltas; ${coordinateCount} con coordenadas.`,
        resolvedEntityCount,
      ),
      rule(
        'RES-SEPARATION-001',
        'No decidir coherencia geográfica ni persistencia durante entity resolution',
        'PASS',
        'La salida queda pendiente del GeographicValidationService.',
      ),
      rule(
        'RES-REJECTION-001',
        'Toda propuesta no resoluble debe conservar razones explícitas',
        rejected.every((entry) => entry.rejectionReasons.length > 0)
          ? 'PASS'
          : 'WARN',
        rejected.length
          ? rejected
              .map(
                (entry) =>
                  `${entry.proposal.name}: ${entry.rejectionReasons.join(', ') || 'sin motivo'}`,
              )
              .join('; ')
          : 'No hubo rechazos de resolución.',
      ),
    ],
    decision: {
      status: accepted.length ? 'PASS' : 'WARN',
      outcome: accepted.length
        ? 'ENTITIES_READY_FOR_GEOGRAPHIC_VALIDATION'
        : 'NO_PROPOSALS_RESOLVED',
      reason: accepted.length
        ? 'Hay entidades reales resueltas; todavía falta validar existencia/coherencia de la actividad compuesta.'
        : 'Ninguna propuesta produjo suficientes entidades reales para continuar.',
      reasonCodes: rejected.flatMap((entry) => entry.rejectionReasons),
      triggeredActions: accepted.length
        ? ['VALIDATE_GEOGRAPHIC_COHERENCE']
        : ['CONTINUE_WITH_EXISTING_POOL'],
    },
    outputs: {
      proposalCount: resolution.totalProposals,
      resolutionReadyCount: accepted.length,
      rejectedCount: rejected.length,
      resolvedEntityCount,
      entitiesWithCoordinates: coordinateCount,
    },
    candidateDecisions: resolution.resolved.map((entry) => ({
      id: entry.proposal.name,
      name: entry.proposal.name,
      source: 'discovery',
      status:
        entry.status === 'accepted'
          ? ('ELIGIBLE' as const)
          : ('REJECTED' as const),
      reason:
        entry.status === 'accepted'
          ? `${entry.resolvedEntities.filter((entity) => entity.status === 'resolved').length} entidad(es) provider-backed resueltas; pendiente validación geográfica.`
          : entry.rejectionReasons.join(', '),
      reasonCodes:
        entry.status === 'accepted'
          ? ['ENTITY_RESOLUTION_READY']
          : entry.rejectionReasons,
    })),
    providerStatus: accepted.length ? 'success' : 'failed',
    degradedReason: accepted.length ? undefined : 'no_proposals_resolved',
    resolution,
  };
}

export function buildGeographicValidationStep(
  result: ExperienceResolutionResponse,
): GenerationTraceStep {
  const validation = result.geographicValidation;
  if (!validation) {
    return {
      stage: 'geographic_validation',
      label: 'Validación geográfica',
      component: 'CompositeGeographicValidationService',
      status: 'INFO',
      summary:
        'No hay resultado de validación geográfica adjunto a esta respuesta legacy.',
      rules: [
        rule(
          'GEO-AVAILABLE-001',
          'Registrar el resultado determinístico de validación geográfica',
          'SKIPPED',
          'La respuesta no contiene GeographicValidationBatchResult.',
        ),
      ],
      decision: {
        status: 'INFO',
        outcome: 'GEOGRAPHIC_VALIDATION_NOT_RECORDED',
        reason: 'Trace legacy sin resultado geográfico separado.',
        triggeredActions: ['CONTINUE'],
      },
    };
  }

  const accepted = validation.results.filter((entry) => entry.accepted);
  const rejected = validation.results.filter((entry) => !entry.accepted);
  const radiusValues = validation.results
    .map((entry) => entry.coherence?.radiusMeters)
    .filter((value): value is number => Number.isFinite(value));
  const maxRadiusMeters = radiusValues.length
    ? Math.max(...radiusValues)
    : null;

  return {
    stage: 'geographic_validation',
    label: 'Validación geográfica independiente',
    component: 'CompositeGeographicValidationService',
    status: accepted.length ? (rejected.length ? 'WARN' : 'PASS') : 'WARN',
    summary:
      `Validación geográfica determinística: ${accepted.length} propuesta(s) GEO_VERIFIED y ` +
      `${rejected.length} rechazada(s). La decisión usa entidades ya resueltas, coordenadas, ` +
      `boundary/destino y coherencia espacial; no usa al LLM como autoridad.`,
    inputs: {
      proposalCount: validation.results.length,
      validatorVersions: Array.from(
        new Set(validation.results.map((entry) => entry.validatorVersion)),
      ),
    },
    rules: [
      rule(
        'GEO-INDEPENDENT-001',
        'Grounded text por sí solo no prueba existencia geográfica',
        'PASS',
        'La aceptación requiere entidades resueltas independientemente del LLM.',
      ),
      rule(
        'GEO-COMPONENTS-001',
        'Las composites pueden validarse por componentes reales sin exact-name global',
        'PASS',
        'ROUTE/EXPERIENCE/WALK pueden usar anchors/componentes según su estrategia.',
      ),
      rule(
        'GEO-RESULT-001',
        'Conservar razones machine-readable para cada rechazo',
        rejected.every((entry) => entry.rejectionReasons.length > 0)
          ? 'PASS'
          : 'WARN',
        rejected.length
          ? rejected
              .map(
                (entry) =>
                  `${entry.proposalName}: ${entry.rejectionReasons.join(', ') || 'sin motivo'}`,
              )
              .join('; ')
          : 'No hubo rechazos geográficos.',
      ),
    ],
    decision: {
      status: accepted.length ? (rejected.length ? 'WARN' : 'PASS') : 'WARN',
      outcome: accepted.length
        ? 'GEO_VERIFIED_PROPOSALS_READY'
        : 'NO_GEO_VERIFIED_PROPOSALS',
      reason: accepted.length
        ? 'Solo las propuestas GEO_VERIFIED pueden avanzar a materialización.'
        : 'Ninguna propuesta alcanzó verificación geográfica.',
      reasonCodes: rejected.flatMap((entry) => entry.rejectionReasons),
      triggeredActions: accepted.length
        ? ['MATERIALIZE_VERIFIED_ACTIVITIES']
        : ['CONTINUE_WITH_EXISTING_POOL'],
    },
    outputs: {
      geoVerifiedCount: accepted.length,
      rejectedCount: rejected.length,
      maxComputedRadiusMeters: maxRadiusMeters,
      results: validation.results.map((entry) => ({
        proposalName: entry.proposalName,
        kind: entry.kind,
        status: entry.status,
        strategy: entry.strategy ?? null,
        anchorCount: entry.anchors.length,
        canonicalEntity: entry.canonicalEntity
          ? {
              provider: entry.canonicalEntity.provider,
              externalId: entry.canonicalEntity.externalId,
              name:
                entry.canonicalEntity.canonicalName ??
                entry.canonicalEntity.hintName,
            }
          : null,
        coherence: entry.coherence ?? null,
        rejectionReasons: entry.rejectionReasons,
      })),
    },
    candidateDecisions: validation.results.map((entry) => ({
      id: entry.proposalName,
      name: entry.proposalName,
      source: 'discovery',
      status: entry.accepted ? ('ELIGIBLE' as const) : ('REJECTED' as const),
      reason: entry.accepted
        ? `GEO_VERIFIED mediante ${entry.strategy ?? 'deterministic_validation'} con ${entry.anchors.length} anchor(s).`
        : entry.rejectionReasons.join(', '),
      reasonCodes: entry.accepted ? ['GEO_VERIFIED'] : entry.rejectionReasons,
    })),
    providerStatus: accepted.length ? 'success' : 'failed',
    degradedReason: accepted.length ? undefined : 'no_geo_verified_proposals',
    geographicValidation: validation,
  };
}

export function buildCatalogMaterializationStep(
  result: ExperienceResolutionResponse,
): GenerationTraceStep {
  const materialization = result.materialization;
  const finalResolved = materialization?.resolved ?? result.resolved;
  const materialized = finalResolved.filter(
    (entry) => entry.status === 'accepted' && entry.persistedActivityId,
  );
  const rejected = finalResolved.filter((entry) => !entry.persistedActivityId);
  const persistedActivityIds = materialized.map(
    (entry) => entry.persistedActivityId as string,
  );

  return {
    stage: 'catalog_materialization',
    label: 'Materialización en catálogo',
    component: 'ActivityProposalMaterializationService',
    status: materialized.length ? (rejected.length ? 'WARN' : 'PASS') : 'WARN',
    summary:
      `${materialized.length} propuesta(s) geográficamente verificadas quedaron materializadas ` +
      `como Activities canónicas; ${rejected.length} no produjeron Activity persistida. ` +
      `La persistencia ocurre después de geographic_validation, nunca durante entity_resolution.`,
    inputs: {
      geoVerifiedCount:
        result.geographicValidation?.acceptedCount ?? materialized.length,
    },
    rules: [
      rule(
        'MAT-GEO-GATE-001',
        'Persistir composites solo después de GEO_VERIFIED',
        'PASS',
        'ActivityProposalMaterializationService consume el resultado del validador geográfico.',
      ),
      rule(
        'MAT-CANONICAL-001',
        'Exponer solo IDs canónicos persistidos al re-query/ranking',
        materialized.length ? 'PASS' : 'WARN',
        `${persistedActivityIds.length} Activity id(s) quedaron disponibles para re-query.`,
        persistedActivityIds.length,
      ),
    ],
    decision: {
      status: materialized.length
        ? rejected.length
          ? 'WARN'
          : 'PASS'
        : 'WARN',
      outcome: materialized.length
        ? 'CANONICAL_ACTIVITIES_MATERIALIZED'
        : 'NO_ACTIVITIES_MATERIALIZED',
      reason: materialized.length
        ? 'Las Activities persistidas pueden reingresar al pool canónico del mismo pedido.'
        : 'No hubo propuesta verificada que pudiera materializarse.',
      reasonCodes: rejected.flatMap((entry) => entry.rejectionReasons),
      triggeredActions: materialized.length
        ? ['REQUERY_CANONICAL_CATALOG']
        : ['CONTINUE_WITH_EXISTING_POOL'],
    },
    outputs: {
      materializedCount: materialized.length,
      rejectedCount: rejected.length,
      persistedActivityIds,
    },
    candidateDecisions: finalResolved.map((entry) => ({
      id: entry.persistedActivityId ?? entry.proposal.name,
      name: entry.proposal.name,
      source: 'discovery',
      status: entry.persistedActivityId
        ? ('ELIGIBLE' as const)
        : ('REJECTED' as const),
      reason: entry.persistedActivityId
        ? 'Activity canónica materializada y lista para re-query.'
        : entry.rejectionReasons.join(', '),
      reasonCodes: entry.persistedActivityId
        ? ['ACTIVITY_MATERIALIZED']
        : entry.rejectionReasons,
    })),
    providerStatus: materialized.length ? 'success' : 'failed',
    degradedReason: materialized.length
      ? undefined
      : 'no_activities_materialized',
    materialization,
  };
}

export function buildCandidatePoolStep(params: {
  initialCatalogCount: number;
  postAcquisitionCatalogCount: number;
  eligibleCount: number;
  offeredCandidates: Array<
    CoverageCandidate & {
      traceSource: 'db' | 'google_places' | 'geoapify' | 'discovery';
      scoreBreakdown: CandidateScoreBreakdown;
    }
  >;
  requestedThemes: string[];
  formatAvailability: FormatAvailability[];
  droppedForFamilyCapCount: number;
}): GenerationTraceStep {
  const bySource = { catalog: 0, refill: 0, discovery: 0 };
  const byKind: Partial<Record<ActivityKind, number>> = {};
  const experienceFormatByKind = new Map<ActivityKind, string>(
    Object.entries(EXPERIENCE_FORMAT_ACTIVITY_KIND).map(([format, kind]) => [
      kind as ActivityKind,
      format,
    ]),
  );

  const candidates: TraceCandidate[] = params.offeredCandidates.map((c) => {
    const bucket =
      c.traceSource === 'db'
        ? 'catalog'
        : c.traceSource === 'discovery'
          ? 'discovery'
          : 'refill';
    bySource[bucket] += 1;
    if (c.kind) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
    const themes = matchedThemesFor(c, params.requestedThemes);
    const experienceFormat = c.kind
      ? experienceFormatByKind.get(c.kind)
      : undefined;
    return {
      source: c.traceSource,
      id: c.id,
      name: c.name,
      detail:
        `score total ${c.scoreBreakdown.totalScore.toFixed(3)} ` +
        `(semántica ${c.scoreBreakdown.semanticSimilarity ?? 'n/d'}, ` +
        `calidad ${c.scoreBreakdown.qualityBonus.toFixed(3)}, ` +
        `proximidad ${c.scoreBreakdown.proximityBonus.toFixed(3)}, ` +
        `diversidad ${c.scoreBreakdown.diversityBonus.toFixed(3)})`,
      offered: true,
      chosen: false,
      scoreBreakdown: c.scoreBreakdown,
      coverageContribution: { themes, experienceFormat },
    };
  });

  const formatRules = params.formatAvailability.map((f) =>
    rule(
      `RANK-FORMAT-${f.format.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
      `Reservar representación del formato solicitado ${f.format} cuando existe en el pool`,
      f.fullPoolCount === 0
        ? 'SKIPPED'
        : f.llmWindowCount > 0
          ? 'PASS'
          : 'FAIL',
      f.fullPoolCount === 0
        ? 'No había candidato real de ese formato en el pool completo.'
        : `${f.llmWindowCount}/${f.fullPoolCount} llegó/llegaron a la ventana.`,
      f.llmWindowCount,
      f.fullPoolCount === 0 ? undefined : '> 0',
    ),
  );
  const formatSummary = params.formatAvailability
    .map(
      (format) =>
        `"${format.format}": ${format.fullPoolCount} en el pool completo, ${format.llmWindowCount} en la ventana ofrecida`,
    )
    .join('; ');

  return {
    stage: 'candidate_pool',
    label: 'Ranking y ventana canónica',
    component: 'CandidateRankingEngine + selectBoundedWindow',
    status: formatRules.some((r) => r.result === 'FAIL') ? 'FAIL' : 'PASS',
    summary:
      `Ventana ofrecida al selector: ${candidates.length} candidato(s) reales ` +
      `de ${params.eligibleCount} elegibles (${bySource.catalog} del catálogo, ` +
      `${bySource.refill} de refill, ${bySource.discovery} recién resueltos ` +
      `por discovery). Cada uno conserva su ID de Activity real; el modelo no ` +
      `puede crear entidades.` +
      (formatSummary ? ` Formatos solicitados: ${formatSummary}.` : '') +
      (params.droppedForFamilyCapCount > 0
        ? ` ${params.droppedForFamilyCapCount} variante(s) adicional(es) de una misma familia quedaron fuera de la ventana.`
        : ''),
    inputs: {
      initialCatalogCount: params.initialCatalogCount,
      postAcquisitionCatalogCount: params.postAcquisitionCatalogCount,
      eligibleCount: params.eligibleCount,
      requestedThemes: params.requestedThemes,
      requestedFormatAvailability: params.formatAvailability,
    },
    rules: [
      rule(
        'RANK-WINDOW-001',
        'Acotar el pool sin perder identidad canónica',
        'PASS',
        `${candidates.length} candidato(s) quedaron en la ventana; todos conservan Activity id real.`,
        candidates.length,
      ),
      rule(
        'RANK-FAMILY-001',
        'Limitar redundancia de variantes de una misma familia en la ventana',
        params.droppedForFamilyCapCount ? 'WARN' : 'PASS',
        params.droppedForFamilyCapCount
          ? `${params.droppedForFamilyCapCount} variante(s) redundante(s) quedaron fuera.`
          : 'No fue necesario descartar variantes por family cap.',
        params.droppedForFamilyCapCount,
      ),
      ...formatRules,
    ],
    decision: {
      status: formatRules.some((r) => r.result === 'FAIL') ? 'FAIL' : 'PASS',
      outcome: 'PLANNING_WINDOW_BUILT',
      reason:
        'La ventana quedó ordenada por señales reales de relevancia y cobertura de formato.',
      reasonCodes: formatRules
        .filter((r) => r.result === 'FAIL')
        .map((r) => r.ruleId),
      triggeredActions: ['RUN_DAILY_PLANNING'],
    },
    outputs: {
      offeredCandidateCount: candidates.length,
      byKind,
      bySource,
    },
    candidates,
    candidateDecisions: params.offeredCandidates.map((c) => ({
      id: c.id,
      name: c.name,
      source: c.traceSource,
      status: 'RANKED' as const,
      reason: 'Entró a la ventana acotada que consume el planner.',
      reasonCodes: ['INSIDE_PLANNING_WINDOW'],
      scoreBreakdown: c.scoreBreakdown,
    })),
    candidatePool: {
      initialCatalogCount: params.initialCatalogCount,
      postAcquisitionCatalogCount: params.postAcquisitionCatalogCount,
      eligibleCount: params.eligibleCount,
      llmWindowCount: candidates.length,
      byKind,
      bySource,
      requestedFormatAvailability: params.formatAvailability,
      droppedForFamilyCapCount: params.droppedForFamilyCapCount,
    },
  };
}

export function buildDailyPlanningStep(
  solution: DailyPlanningSolution,
): GenerationTraceStep {
  const selectedCount = solution.days.reduce(
    (sum, day) => sum + day.activities.length,
    0,
  );
  const iterationsSummary =
    solution.metadata.iterations !== undefined
      ? ` con ${solution.metadata.iterations} iteración(es) de mejora local`
      : '';
  const travelSummary = solution.metadata.approximateTravel
    ? ' Las estimaciones de traslado usadas son aproximadas.'
    : ' Las estimaciones de traslado usadas son reales.';
  const selected = solution.days.flatMap((day) =>
    day.activities.map((activity, order) => ({
      id: activity.activityId,
      name: activity.activityId,
      status: 'SELECTED' as const,
      reason: `Asignada al día ${day.dayNumber} en posición ${order + 1}; pasó la factibilidad del solver.`,
      reasonCodes: ['FEASIBLE_AND_SELECTED'],
      dayNumber: day.dayNumber,
      order: order + 1,
    })),
  );
  const unselected = solution.unselected.map((candidate) => ({
    id: candidate.activityId,
    name: candidate.activityId,
    status: 'UNSELECTED' as const,
    reason: candidate.reasons.join(', '),
    reasonCodes: candidate.reasons,
  }));

  return {
    stage: 'daily_planning',
    label: 'Planificación diaria determinística',
    component: solution.metadata.solver,
    status: selectedCount ? 'PASS' : 'FAIL',
    summary:
      `Solver ${solution.metadata.solver} planificó ${solution.days.length} día(s)${iterationsSummary}: ` +
      `${selectedCount} actividad(es) seleccionada(s), ${solution.unselected.length} sin seleccionar ` +
      `(score total ${solution.score}).${travelSummary}`,
    inputs: {
      solver: solution.metadata.solver,
      approximateTravel: solution.metadata.approximateTravel,
      iterations: solution.metadata.iterations ?? null,
    },
    rules: [
      rule(
        'PLAN-DAYS-001',
        'Mantener exactamente los buckets de días solicitados por el planner',
        'PASS',
        `El solver devolvió ${solution.days.length} bucket(s) de día.`,
        solution.days.length,
      ),
      rule(
        'PLAN-FEASIBILITY-001',
        'No seleccionar candidatos que el solver haya marcado como no factibles',
        'PASS',
        `${solution.unselected.length} candidato(s) quedaron fuera con reason codes explícitos.`,
      ),
      rule(
        'PLAN-TRAVEL-001',
        'Declarar si las estimaciones de traslado son aproximadas',
        solution.metadata.approximateTravel ? 'WARN' : 'PASS',
        solution.metadata.approximateTravel
          ? 'Los tiempos/distancias usados por el solver son aproximados.'
          : 'El solver informa estimaciones de traslado no aproximadas.',
        solution.metadata.approximateTravel,
      ),
    ],
    decision: {
      status: selectedCount ? 'PASS' : 'FAIL',
      outcome: selectedCount
        ? 'DAILY_PLAN_BUILT'
        : 'NO_FEASIBLE_ACTIVITIES_SELECTED',
      reason: selectedCount
        ? 'El solver produjo una asignación determinística y físicamente evaluable.'
        : 'Ningún candidato pudo ser seleccionado.',
      reasonCodes: selectedCount
        ? ['PLANNING_COMPLETED']
        : ['NO_ACTIVITIES_SELECTED'],
      triggeredActions: ['VALIDATE_COMPLETENESS', 'VALIDATE_FORMAT_COVERAGE'],
    },
    outputs: {
      selectedCount,
      unselectedCount: solution.unselected.length,
      score: solution.score,
      days: solution.days.map((day) => ({
        dayNumber: day.dayNumber,
        activityCount: day.activities.length,
        totalActivityMinutes: day.totalActivityMinutes,
        totalTravelMinutes: day.totalTravelMinutes,
        totalWalkingMinutes: day.totalWalkingMinutes,
        utilizationMinutes: day.utilizationMinutes,
      })),
    },
    candidateDecisions: [...selected, ...unselected],
    providerStatus: selectedCount === 0 ? 'failed' : undefined,
    degradedReason: selectedCount === 0 ? 'no_activities_selected' : undefined,
    dailyPlanning: {
      solver: solution.metadata.solver,
      dayCount: solution.days.length,
      selectedCount,
      unselectedCount: solution.unselected.length,
      approximateTravel: solution.metadata.approximateTravel,
      iterations: solution.metadata.iterations,
      score: solution.score,
      days: solution.days.map((day) => ({
        dayNumber: day.dayNumber,
        activityCount: day.activities.length,
        totalActivityMinutes: day.totalActivityMinutes,
        totalTravelMinutes: day.totalTravelMinutes,
        totalWalkingMinutes: day.totalWalkingMinutes,
        utilizationMinutes: day.utilizationMinutes,
      })),
    },
  };
}

export function buildTourCompletenessStep(
  result: TourCompletenessResult,
  retryAttempted: boolean,
): GenerationTraceStep {
  const summary = result.complete
    ? 'El itinerario generado hace un uso razonable de los días solicitados.' +
      (retryAttempted ? ' (tras un reintento por completitud)' : '')
    : result.issues
        .map(
          (issue) =>
            `Día ${issue.dayNumber}: ${issue.selectedActivityCount} actividad(es), ` +
            `~${issue.selectedActivityHours}h, ${issue.viableUnusedCandidateCount} ` +
            `candidato(s) viable(s) sin usar (ritmo "${issue.travelPace}").`,
        )
        .join(' ') +
      (retryAttempted
        ? ' Se reintentó la generación una vez y el resultado siguió incompleto.'
        : '');
  return {
    stage: 'tour_completeness',
    label: 'Completitud del itinerario',
    component: 'TourCompletenessValidator',
    status: result.complete ? 'PASS' : 'WARN',
    summary,
    inputs: { retryAttempted },
    rules: [
      rule(
        'COMP-DAY-USAGE-001',
        'Cada día debe tener un uso razonable cuando existen candidatos viables',
        result.complete ? 'PASS' : 'WARN',
        result.complete
          ? 'No se detectaron días subutilizados con alternativas viables.'
          : result.issues
              .map(
                (i) =>
                  `Día ${i.dayNumber}: ${i.selectedActivityCount} seleccionada(s), ${i.viableUnusedCandidateCount} viable(s) sin usar.`,
              )
              .join(' '),
      ),
    ],
    decision: {
      status: result.complete ? 'PASS' : 'WARN',
      outcome: result.complete ? 'TOUR_COMPLETE' : 'TOUR_UNDERFILLED',
      reason: result.complete
        ? 'La política de completitud no detectó déficit accionable.'
        : 'Existen días que podrían estar mejor utilizados según la política actual.',
      reasonCodes: result.complete ? [] : ['UNDERFILLED_DAY'],
      triggeredActions:
        !result.complete && !retryAttempted ? ['RETRY_ONCE'] : ['CONTINUE'],
    },
    outputs: { complete: result.complete, issues: result.issues },
    providerStatus: result.complete ? 'success' : 'failed',
    degradedReason: result.complete ? undefined : 'underfilled_day',
    tourCompleteness: { ...result, retryAttempted },
  };
}

export function buildLlmGenerationStep(
  reasoning?: string,
): GenerationTraceStep {
  return {
    stage: 'llm_generation',
    label: 'Explicación no verificada del itinerario generado por IA',
    component: 'LLM narrative layer',
    status: 'INFO',
    summary:
      (reasoning
        ? `Afirmaciones declaradas por el modelo; no constituyen verificación de transporte, horarios ni factibilidad: ${reasoning}`
        : undefined) ||
      'El modelo no devolvió un campo de razonamiento para esta generación.',
    inputs: { reasoningAvailable: Boolean(reasoning) },
    rules: [
      rule(
        'LLM-AUTHORITY-001',
        'El LLM no puede tener autoridad estructural sobre el plan final',
        'PASS',
        'La selección y planificación final pertenecen al pipeline determinístico.',
      ),
    ],
    decision: {
      status: 'INFO',
      outcome: reasoning ? 'NARRATIVE_AVAILABLE' : 'NO_NARRATIVE',
      reason: reasoning ?? 'No se generó razonamiento/narrativa.',
      triggeredActions: ['CONTINUE'],
    },
  };
}

export function buildVerificationStep(params: {
  hallucinatedCount: number;
  duplicateCount: number;
  pickedActivityIds: string[];
  candidatesByStage: TraceCandidate[][];
}): GenerationTraceStep {
  const pickedSet = new Set(params.pickedActivityIds);
  const chosen: TraceCandidate[] = [];
  for (const list of params.candidatesByStage) {
    for (const c of list) {
      if (pickedSet.has(c.id)) chosen.push({ ...c, chosen: true });
    }
  }
  const valid = params.hallucinatedCount === 0 && params.duplicateCount === 0;
  return {
    stage: 'verification',
    label: 'Verificación de identidad y unicidad',
    component: 'AntiHallucinationVerifier',
    status: valid ? 'PASS' : 'WARN',
    summary: `${params.hallucinatedCount} pick(s) no canónicos y ${params.duplicateCount} duplicado(s) detectados.`,
    inputs: { pickedActivityIds: params.pickedActivityIds },
    rules: [
      rule(
        'VERIFY-CANONICAL-001',
        'Todo pick final debe corresponder a un candidato canónico',
        params.hallucinatedCount === 0 ? 'PASS' : 'FAIL',
        params.hallucinatedCount === 0
          ? 'Todos los picks corresponden a identidades conocidas.'
          : `${params.hallucinatedCount} pick(s) fueron descartados por no corresponder a identidad canónica.`,
        params.hallucinatedCount,
        0,
      ),
      rule(
        'VERIFY-UNIQUE-001',
        'No persistir la misma Activity más de una vez en el mismo resultado',
        params.duplicateCount === 0 ? 'PASS' : 'FAIL',
        `${params.duplicateCount} duplicado(s) detectado(s).`,
        params.duplicateCount,
        0,
      ),
    ],
    decision: {
      status: valid ? 'PASS' : 'WARN',
      outcome: valid ? 'VERIFICATION_PASSED' : 'INVALID_PICKS_REMOVED',
      reason: valid
        ? 'El resultado final conserva identidad y unicidad.'
        : 'Los picks inválidos fueron removidos antes de persistir.',
      reasonCodes: [
        ...(params.hallucinatedCount ? ['NON_CANONICAL_PICK'] : []),
        ...(params.duplicateCount ? ['DUPLICATE_PICK'] : []),
      ],
      triggeredActions: ['PERSIST_VERIFIED_TOUR'],
    },
    outputs: { verifiedPickCount: chosen.length },
    candidates: chosen,
    candidateDecisions: chosen.map((c) => ({
      id: c.id,
      name: c.name,
      source: c.source,
      status: 'SELECTED' as const,
      reason: 'Pick verificado contra el conjunto de candidatos canónicos.',
      reasonCodes: ['CANONICAL_PICK_VERIFIED'],
      scoreBreakdown: c.scoreBreakdown,
    })),
  };
}
