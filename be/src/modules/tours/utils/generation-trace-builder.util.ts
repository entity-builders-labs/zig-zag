import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import {
  GenerationTraceStep,
  TraceCandidate,
} from '../interfaces/generation-trace.interface';
import { CoverageReport } from '../interfaces/coverage-analysis.interface';
import { TourCompletenessResult } from '../interfaces/tour-completeness.interface';
import { TourFormatCoverageResult } from '../interfaces/tour-format-coverage.interface';
import { ProposalResolutionResponse } from '../interfaces/proposal-resolution.interface';
import {
  PlacesCrawlProvenance,
  placesProviderLabel,
} from '@integrations/google-places/interfaces/places-api.interface';
import { TourGenerationRequest } from '../interfaces/tour-generation.interface';

// Loosely typed on purpose — mirrors the rest of this file's candidates
// (ActivityWithDistance from ActivitiesService.findAll, whose Prisma Json
// `openingHours` field doesn't structurally match a narrow interface).
function activityDetail(act: any): string {
  const parts: string[] = [];
  const metadata =
    act.metadata &&
    typeof act.metadata === 'object' &&
    !Array.isArray(act.metadata)
      ? act.metadata
      : undefined;
  const providerPrimaryType = metadata?.providerPrimaryType;
  if (
    typeof providerPrimaryType === 'string' &&
    providerPrimaryType.trim().length > 0
  ) {
    parts.push(`tipo proveedor ${providerPrimaryType}`);
  }
  if (typeof act.type === 'string' && act.type.trim().length > 0) {
    parts.push(`categoría ${act.type}`);
  }
  if (act.rating != null) {
    const reviews =
      act.ratingCount != null ? ` (${act.ratingCount} reviews)` : '';
    parts.push(`rating ${act.rating}/5${reviews}`);
  }
  if (act.priceLevel != null) parts.push(`precio ${act.priceLevel}/5`);
  const weekdayText = act.openingHours?.weekdayText;
  if (weekdayText?.length) parts.push(`horario: ${weekdayText[0]}`);
  return parts.length > 0 ? parts.join(' · ') : 'sin datos adicionales';
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

export function buildTourIntentStep(
  request: TourGenerationRequest,
): GenerationTraceStep {
  const themes =
    request.intent.interests.length > 0
      ? request.intent.interests.join(', ')
      : 'sin temas específicos';
  const accessibility =
    request.mobility.accessibilityNeeds.length > 0
      ? ` Accesibilidad: ${request.mobility.accessibilityNeeds.join(', ')}.`
      : '';
  const additional = request.intent.additionalPreferences
    ? ` Preferencias adicionales capturadas: "${request.intent.additionalPreferences}".`
    : ' Sin preferencias adicionales.';

  return {
    stage: 'tour_intent',
    label: 'Intención y movilidad solicitadas',
    summary:
      `Temas: ${themes}. Formatos: ${request.intent.experienceFormats.join(', ')}. ` +
      `Estilo: ${request.intent.explorationStyle}. Modos permitidos: ${request.mobility.allowedTransportationModes.join(', ')}. ` +
      `Esfuerzo peatonal capturado: ${request.mobility.maxWalkingDistancePerDayMeters / 1000}km por día y ` +
      `${request.mobility.maxContinuousWalkingDistanceMeters / 1000}km continuos; todavía no se aplica como restricción determinística hasta la etapa de factibilidad espacial. ` +
      `Ritmo: ${request.mobility.travelPace}.${accessibility}${additional}`,
  };
}

export function buildDbSearchStep(
  candidates: any[],
  radiusKm: number,
): GenerationTraceStep {
  return {
    stage: 'db_search',
    label: 'Búsqueda por proximidad en la base de datos',
    summary:
      candidates.length > 0
        ? `${candidates.length} actividades encontradas en un radio de ${radiusKm}km.`
        : `Sin actividades existentes en un radio de ${radiusKm}km.`,
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
  };
}

export function buildPlacesCrawlStep(
  candidates: any[],
  provenance: PlacesCrawlProvenance,
  failed = false,
): GenerationTraceStep {
  const providerLabel = placesProviderLabel(provenance.provider);
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
    summary: failed
      ? `${providerLabel} falló (${cacheLabel}). Solicitados: ${provenance.requestedCount}; recibidos: ${provenance.receivedCount}; no se afirmó cobertura nueva.`
      : `${providerLabel} (${cacheLabel}) recibió ${provenance.receivedCount} resultados brutos y persistió ${provenance.persistedCount ?? provenance.acceptedCount} actividad(es) nueva(s).${anchorSummary}${providerCalls}${operationSummary}${validationSummary}${embeddingFailureSummary}${rejectedCandidateCount ? ` Rechazos totales registrados: ${rejectedCandidateCount}.${rejectionReasons}` : ''}${requestFailureSuffix}`,
    placesProvenance: provenance,
    // Every real place the crawl touched, admitted or not — "why did X
    // disappear" must be answerable from the bitácora alone, not just an
    // aggregate rejection count.
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
      ...(provenance.rejectedCandidates ?? []).map(
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
    summary:
      resolution.scale === 'area'
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
    providerStatus:
      resolution.scale === 'point' &&
      resolution.degradationReason === 'provider_failed'
        ? 'failed'
        : undefined,
    degradedReason:
      resolution.scale === 'point' && resolution.degradationReason
        ? degradationMessages[resolution.degradationReason]
        : undefined,
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
    label: 'Embeddings (pgvector)',
    summary,
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
  const deficitsSummary =
    report.deficits.length > 0
      ? report.deficits.map((deficit) => deficit.message).join(' ')
      : 'Sin déficits bloqueantes.';
  const decisionSummary = report.decision.deployableInPr6
    ? `Decisión ejecutable en PR 6: ${report.decision.action}.`
    : `Decisión diferida a PR 7: ${report.decision.action}.`;

  return {
    stage: 'coverage_analysis',
    label: 'Cobertura y calidad del pool candidato',
    summary:
      `Analizados ${report.analyzedCandidateCount} candidatos; elegibles ${report.eligibleCandidateCount}; ofrecidos al LLM ${report.offeredCandidateCount}; requeridos ${report.requiredCandidateCount}. ` +
      `Estado ${report.status}. ${decisionSummary} ${deficitsSummary}`,
    providerStatus: report.status === 'degraded' ? 'failed' : undefined,
    degradedReason:
      report.status === 'degraded' ? report.providerHealth.reason : undefined,
    coverageReport: report,
  };
}

export function buildDiscoveryStep(
  result: import('../interfaces/activity-discovery.interface').DiscoveryResponse,
): GenerationTraceStep {
  return {
    stage: 'discovery',
    label: 'Descubrimiento fundamentado (PR 7)',
    summary:
      `Se descubrieron ${result.proposals.length} propuestas fundamentadas usando ${result.provider}.` +
      (result.validationErrors?.length
        ? ` ${result.validationErrors.length} propuesta(s) inválida(s) descartada(s).`
        : ''),
    candidates: result.proposals.map((p) => ({
      source: 'discovery' as const,
      id: p.name,
      name: p.name,
      detail: `${p.kind} · ${p.themes.join(', ')} · ${p.suggestedDurationMinutes} min · ${p.shortReason}`,
      offered: false,
      chosen: false,
    })),
    providerStatus: result.groundingStatus === 'applied' ? 'success' : 'failed',
    degradedReason:
      result.groundingStatus !== 'applied'
        ? `grounding_${result.groundingStatus}`
        : result.validationErrors?.length
          ? result.validationErrors.join('; ')
          : undefined,
    grounding: {
      status: result.groundingStatus,
      provider: result.groundingProvider,
      model: result.groundingModel,
      evidenceCount: result.groundingEvidence?.length ?? 0,
    },
  };
}

export function buildEntityResolutionStep(
  result: ProposalResolutionResponse,
): GenerationTraceStep {
  const rejected = result.resolved.filter((r) => r.status !== 'accepted');
  const rejectedSummaries = rejected.map(
    (r) =>
      `${r.proposal.name}: ${r.rejectionReasons.join(', ') || 'sin motivo registrado'}`,
  );

  const summary =
    `Se resolvieron ${result.acceptedCount} de ${result.totalProposals} ` +
    `propuesta(s) fundamentada(s) como Activities reales y persistidas — ` +
    `disponibles para futuras generaciones de este destino, no para el ` +
    `itinerario actual (esa integración es PR 9).` +
    (rejectedSummaries.length
      ? ` Rechazadas: ${rejectedSummaries.join('; ')}.`
      : '');

  return {
    stage: 'entity_resolution',
    label: 'Resolución de entidades (PR 8)',
    summary,
    providerStatus: result.acceptedCount > 0 ? 'success' : 'failed',
    degradedReason:
      result.acceptedCount === 0 ? 'no_proposals_resolved' : undefined,
    resolution: result,
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
    summary,
    providerStatus: result.complete ? 'success' : 'failed',
    degradedReason: result.complete ? undefined : 'underfilled_day',
    tourCompleteness: { ...result, retryAttempted },
  };
}

export function buildTourFormatCoverageStep(
  result: TourFormatCoverageResult,
  retryAttempted: boolean,
): GenerationTraceStep {
  const summary = result.valid
    ? 'El itinerario respetó los formatos de experiencia solicitados que tenían candidatos disponibles.' +
      (retryAttempted ? ' (tras un reintento por cobertura de formato)' : '')
    : result.issues
        .map(
          (issue) =>
            `Formato "${issue.requestedFormat}": ${issue.availableCandidateCount} ` +
            `candidato(s) viable(s) disponible(s), 0 seleccionado(s).`,
        )
        .join(' ') +
      (retryAttempted
        ? ' Se reintentó la generación una vez y el resultado siguió sin incluir el formato.'
        : '');

  return {
    stage: 'tour_format_coverage',
    label: 'Cobertura de formato de experiencia solicitado',
    summary,
    providerStatus: result.valid ? 'success' : 'failed',
    degradedReason: result.valid ? undefined : 'requested_format_missing',
    tourFormatCoverage: { ...result, retryAttempted },
  };
}

export function buildLlmGenerationStep(
  reasoning?: string,
): GenerationTraceStep {
  return {
    stage: 'llm_generation',
    label: 'Explicación no verificada del itinerario generado por IA',
    summary:
      (reasoning
        ? `Afirmaciones declaradas por el modelo; no constituyen verificación de transporte, horarios ni factibilidad: ${reasoning}`
        : undefined) ||
      'El modelo no devolvió un campo de razonamiento para esta generación.',
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
  return {
    stage: 'verification',
    label: 'Verificación anti-alucinación',
    summary:
      `${params.hallucinatedCount} pick(s) descartados por no matchear un candidato real, ` +
      `${params.duplicateCount} descartados por duplicados.`,
    candidates: chosen,
  };
}
