import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import {
  GenerationTraceStep,
  TraceCandidate,
} from '../interfaces/generation-trace.interface';
import {
  PlacesCrawlProvenance,
  placesProviderLabel,
} from '@integrations/google-places/interfaces/places-api.interface';

// Loosely typed on purpose — mirrors the rest of this file's candidates
// (ActivityWithDistance from ActivitiesService.findAll, whose Prisma Json
// `openingHours` field doesn't structurally match a narrow interface).
function activityDetail(act: any): string {
  const parts: string[] = [];
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
  const anchorSummary = provenance.anchors?.length
    ? ` Usó ${provenance.anchors.length} punto(s) de cobertura geográfica para distribuir las consultas; no implican relevancia turística ni selección para composites: ${provenance.anchors
        .map((anchor) => anchor.label)
        .join(', ')}.`
    : '';
  const validationSummary =
    provenance.validatedCount !== undefined
      ? ` Flujo de candidatos: semilla recibió ${provenance.seedReceivedCount ?? 0}; cobertura recibió ${provenance.coverageReceivedCount ?? provenance.receivedCount}; geografía de operación rechazó ${provenance.operationGeographyRejectedCount ?? 0}; la unión eliminó ${provenance.deduplicatedCount ?? 0} duplicado(s); identidad válida ${provenance.identityValidCount ?? provenance.validatedCount}; admisión aprobada ${provenance.admittedCount ?? provenance.validatedCount}; ${provenance.existingCount ?? provenance.rejectedCountByReason.existing_activity ?? 0} ya existía(n); persistió ${provenance.persistedCount ?? provenance.acceptedCount} nuevo(s) e indexó ${provenance.embeddedCount ?? 0} embedding(s).`
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
      : `${providerLabel} (${cacheLabel}) recibió ${provenance.receivedCount} resultados brutos y persistió ${provenance.persistedCount ?? provenance.acceptedCount} actividad(es) nueva(s).${anchorSummary}${providerCalls}${operationSummary}${validationSummary}${rejectedCandidateCount ? ` Rechazos totales registrados: ${rejectedCandidateCount}; consultar motivos para distinguir geografía, validación, duplicados y existentes.` : ''}${requestFailureSuffix}`,
    placesProvenance: provenance,
    candidates: candidates.map(
      (act): TraceCandidate => ({
        source: provenance.provider === 'google' ? 'google_places' : 'geoapify',
        id: act.id,
        name: act.name,
        detail: activityDetail(act),
        offered: true,
        chosen: false,
      }),
    ),
  };
}

export function buildDestinationResolutionStep(
  destinationText: string | undefined,
  resolution:
    | {
        scale: 'point';
        attemptedQueries?: string[];
        degradationReason?: string;
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
          : `"${destinationText}" resolvió a un límite real de ciudad: ${resolution.boundary.name}. Se exploran sus barrios reales en vez de un único punto+radio.${attempted}`
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
  offeredCount: number,
  indexedCount: number,
  interestsRequested: boolean,
): GenerationTraceStep {
  let summary: string;
  if (indexedCount === 0) {
    summary = interestsRequested
      ? `0 de ${offeredCount} candidatos ofrecidos tienen embedding indexado en pgvector. ` +
        'No hubo señal semántica disponible para aplicar a esta selección; el orden se degradó a rating y proximidad.'
      : `0 de ${offeredCount} candidatos ofrecidos tienen embedding indexado en pgvector. ` +
        'Esta generación tampoco tenía intereses declarados, por lo que se ordenó por rating y proximidad.';
  } else if (interestsRequested) {
    summary =
      `${indexedCount} de ${offeredCount} candidatos ofrecidos tienen embedding indexado en pgvector ` +
      'y estaban disponibles para el ranking solicitado por intereses. La disponibilidad por sí sola no prueba que el proveedor de la query embedding haya respondido.';
  } else {
    summary =
      `${indexedCount} de ${offeredCount} candidatos ofrecidos tienen embedding indexado en pgvector, ` +
      'pero no se solicitó ranking semántico porque esta generación no tenía intereses declarados; se ordenó por rating y proximidad.';
  }

  return {
    stage: 'embeddings',
    label: 'Embeddings (pgvector)',
    summary,
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
