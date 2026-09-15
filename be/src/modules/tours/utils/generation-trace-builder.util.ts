import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import {
  PlacesCrawlProvenance,
  placesProviderLabel,
} from '@integrations/google-places/interfaces/places-api.interface';
import {
  GenerationTraceStep,
  TraceCandidate,
  TraceRuleEvaluation,
  TraceAcquisitionAudit,
  TraceAcquisitionCandidate,
  TraceAcquisitionSource,
  TraceComponentHint,
  TraceEvidenceReference,
  TraceResolvedGeoEntity,
  TraceResolvedExperienceCandidate,
  TraceResolutionPayload,
  TraceGeographicValidationPayload,
  TraceGeographicValidationResult,
  TraceMaterializationPayload,
  TraceAcquisitionContext,
} from '../interfaces/generation-trace.interface';
import {
  TourCompletenessIssue,
  TourCompletenessResult,
} from '../interfaces/tour-completeness.interface';
import {
  ExperienceResolutionResponse,
  FinalExperienceResolutionResponse,
} from '../interfaces/experience-resolution.interface';
import { TourGenerationRequest } from '../interfaces/tour-generation.interface';
import { DailyPlanningSolution } from '../interfaces/daily-planning.interface';
import { PreferenceCoverageResult } from '../interfaces/preference-spec.interface';
import { CandidateScoreBreakdown } from './candidate-ranking.util';
import { SourceObservation } from '../interfaces/experience-acquisition.interface';
import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';

/**
 * Trace projection only: geometry presence/type is useful audit context, but
 * coordinate arrays belong to the domain response and must never be persisted
 * in GenerationTrace.
 */
export function traceGeometrySummary(
  geometry: unknown,
): { present: boolean; type?: string } | undefined {
  if (geometry == null) return undefined;
  const type =
    typeof geometry === 'object' &&
    geometry !== null &&
    'type' in geometry &&
    typeof geometry.type === 'string'
      ? geometry.type
      : undefined;
  return { present: true, type };
}

function projectResolvedGeoEntity(entity: {
  hintKey: string;
  hintName: string;
  provider: string;
  externalId?: string;
  geoEntityId?: string;
  canonicalName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geometry?: unknown;
  role: 'area' | 'waypoint' | 'route' | 'venue';
  expectedType?: string;
  status: 'resolved' | 'unresolved';
  reason?: string;
  adminContext?: TraceResolvedGeoEntity['adminContext'];
}): TraceResolvedGeoEntity {
  return {
    hintKey: entity.hintKey,
    hintName: entity.hintName,
    provider: entity.provider,
    externalId: entity.externalId,
    geoEntityId: entity.geoEntityId,
    canonicalName: entity.canonicalName,
    latitude: entity.latitude,
    longitude: entity.longitude,
    geometry: traceGeometrySummary(entity.geometry),
    role: entity.role,
    expectedType: entity.expectedType,
    status: entity.status,
    reason: entity.reason,
    adminContext: entity.adminContext,
  };
}

function projectResolvedCandidate(entry: {
  candidate: ExperienceCandidate;
  status: 'accepted' | 'rejected';
  resolvedEntities: Parameters<typeof projectResolvedGeoEntity>[0][];
  rejectionReasons: string[];
  destinationAssociationVerified?: boolean;
  experienceId?: string;
  dedupeDecision?: 'SAME' | 'NEW' | 'AMBIGUOUS';
  dedupeCandidates?: string[];
}): TraceResolvedExperienceCandidate {
  return {
    candidate: entry.candidate,
    status: entry.status,
    resolvedEntities: entry.resolvedEntities.map(projectResolvedGeoEntity),
    rejectionReasons: [...entry.rejectionReasons],
    destinationAssociationVerified: entry.destinationAssociationVerified,
    experienceId: entry.experienceId,
    dedupeDecision: entry.dedupeDecision,
    dedupeCandidates: entry.dedupeCandidates
      ? [...entry.dedupeCandidates]
      : undefined,
  };
}

function projectResolutionPayload(
  result: ExperienceResolutionResponse,
): TraceResolutionPayload {
  const resolution = result.entityResolution ?? result;
  return {
    totalCandidates: resolution.totalCandidates,
    acceptedCount: resolution.acceptedCount,
    rejectedCount: resolution.rejectedCount,
    resolved: resolution.resolved.map(projectResolvedCandidate),
    entityResolution: result.entityResolution
      ? {
          totalCandidates: result.entityResolution.totalCandidates,
          acceptedCount: result.entityResolution.acceptedCount,
          rejectedCount: result.entityResolution.rejectedCount,
          resolved: result.entityResolution.resolved.map(
            projectResolvedCandidate,
          ),
        }
      : undefined,
  };
}

function projectGeographicValidationResult(entry: {
  proposalName: string;
  kind: string;
  status: string;
  accepted: boolean;
  strategy?: string;
  canonicalEntity?: Parameters<typeof projectResolvedGeoEntity>[0];
  anchors: Parameters<typeof projectResolvedGeoEntity>[0][];
  coherence?: TraceGeographicValidationResult['coherence'];
  groundedEvidenceKeys: string[];
  rejectionReasons: string[];
  decisionEntities?: TraceGeographicValidationResult['decisionEntities'];
  validatorVersion: number;
}): TraceGeographicValidationResult {
  return {
    proposalName: entry.proposalName,
    kind: entry.kind,
    status: entry.status,
    accepted: entry.accepted,
    strategy: entry.strategy,
    canonicalEntity: entry.canonicalEntity
      ? projectResolvedGeoEntity(entry.canonicalEntity)
      : undefined,
    anchors: entry.anchors.map(projectResolvedGeoEntity),
    coherence: entry.coherence,
    groundedEvidenceKeys: [...entry.groundedEvidenceKeys],
    rejectionReasons: [...entry.rejectionReasons],
    decisionEntities: entry.decisionEntities?.map((decision) => ({
      ...decision,
    })),
    validatorVersion: entry.validatorVersion,
  };
}

function projectGeographicValidationPayload(
  result: FinalExperienceResolutionResponse,
): TraceGeographicValidationPayload {
  const validation = result.geographicValidation;
  return {
    results: validation.results.map(projectGeographicValidationResult),
    acceptedCount: validation.acceptedCount,
    rejectedCount: validation.rejectedCount,
    resolved: validation.resolved?.map(projectResolvedCandidate),
  };
}

function projectMaterializationPayload(
  result: ExperienceResolutionResponse,
): TraceMaterializationPayload | undefined {
  const materialization = result.materialization;
  return materialization
    ? { resolved: materialization.resolved.map(projectResolvedCandidate) }
    : undefined;
}

interface TraceFacetCandidate {
  id: string;
  name: string;
  source?: string | null;
  metadata?: unknown;
  matchedThemes?: string[];
}

function experienceDetail(act: any): string {
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

const TRACE_SNIPPET_LIMIT = 500;

function traceSnippet(value?: string): string | undefined {
  if (!value) return undefined;
  const redacted = value.replace(
    /(authorization|api[-_ ]?key|token|cookie)\s*[:=]\s*[^\s,;]+/gi,
    '$1:[REDACTED]',
  );
  return redacted.length > TRACE_SNIPPET_LIMIT
    ? `${redacted.slice(0, TRACE_SNIPPET_LIMIT)}…`
    : redacted;
}

/** Correlation key only: never an Experience identity or dedupe key. */
export function traceCandidateKey(candidate: ExperienceCandidate): string {
  const evidence = [...candidate.evidenceKeys].sort().join('|');
  const hints = (
    candidate.orderedByEvidence
      ? candidate.componentHints
      : [...candidate.componentHints].sort((left, right) =>
          `${left.key}:${left.name}`.localeCompare(
            `${right.key}:${right.name}`,
          ),
        )
  )
    .map((hint) => `${hint.key}:${hint.name}`)
    .join('|');
  return `${candidate.name.trim().toLocaleLowerCase()}:${evidence}:${hints}`;
}

function traceHint(
  hint: ExperienceCandidate['componentHints'][number],
  order?: number,
): TraceComponentHint {
  return {
    key: hint.key,
    name: hint.name,
    role: hint.role,
    required: hint.required,
    order,
    evidenceKeys: [...hint.evidenceKeys],
  };
}

function traceEvidence(item: {
  key?: string;
  evidenceKey?: string;
  source: string;
  title?: string;
  url?: string;
  snippet?: string;
  description?: string;
}): TraceEvidenceReference {
  return {
    evidenceKey:
      item.key ??
      item.evidenceKey ??
      `${item.source}:${item.title ?? 'untitled'}`,
    source: item.source,
    title: item.title,
    url: item.url,
    snippet: traceSnippet(item.snippet ?? item.description),
  };
}

function traceObservation(observation: SourceObservation) {
  return {
    evidenceKey: observation.evidenceKey,
    provider: observation.provider,
    title: observation.title,
    description: traceSnippet(observation.description),
    sourceUrl: observation.sourceUrl,
    evidenceType: observation.evidenceType,
    originationCapabilities: [...observation.originationCapabilities],
    externalId: observation.externalId,
    geo: observation.geo
      ? {
          latitude: observation.geo.latitude,
          longitude: observation.geo.longitude,
          geometry: traceGeometrySummary(observation.geo.geometry),
        }
      : undefined,
  };
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
    summary:
      `Temas: ${themes}. ` +
      `Estilo: ${request.intent.explorationStyle}. Modos: ${request.mobility.allowedTransportationModes.join(', ')}. ` +
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
    component: 'ExperienceCatalog.findVerifiedWithin',
    status: candidates.length ? 'PASS' : 'WARN',
    summary: candidates.length
      ? `${candidates.length} Experiences recuperadas del catálogo dentro del alcance de búsqueda.`
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
        detail: experienceDetail(act),
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
      ? ` Flujo de candidatos: semilla recibió ${provenance.seedReceivedCount ?? 0}; cobertura recibió ${provenance.coverageReceivedCount ?? provenance.receivedCount}; geografía de operación rechazó ${provenance.operationGeographyRejectedCount ?? 0}; la unión eliminó ${provenance.deduplicatedCount ?? 0} duplicado(s); identidad válida ${provenance.identityValidCount ?? provenance.validatedCount}; admisión aprobada ${provenance.admittedCount ?? provenance.validatedCount}; ${provenance.existingCount ?? provenance.rejectedCountByReason.existing_experience ?? 0} ya existía(n); persistió ${provenance.persistedCount ?? provenance.acceptedCount} nuevo(s) e indexó ${provenance.embeddedCount ?? 0} embedding(s).`
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
      : `${providerLabel} (${cacheLabel}) recibió ${provenance.receivedCount} resultados brutos y persistió ${provenance.persistedCount ?? provenance.acceptedCount} Experience(s) nueva(s).${anchorSummary}${providerCalls}${operationSummary}${validationSummary}${embeddingFailureSummary}${rejectedCandidateCount ? ` Rechazos totales registrados: ${rejectedCandidateCount}.${rejectionReasons}` : ''}${requestFailureSuffix}`,
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
          detail: experienceDetail(act),
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

/**
 * The one 'coverage_analysis' step builder for the live preference-first
 * path. Consumes `PreferenceCoverageResult` directly. Trace-presentation
 * context (offered-candidate count, semantic ranking, provider health) is
 * passed in separately by the caller, kept out of the canonical decision
 * result itself.
 */
export function buildPreferenceCoverageStep(
  result: PreferenceCoverageResult,
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
  },
): GenerationTraceStep {
  const { offeredCandidateCount, semanticRanking, providerHealth } = context;

  const facetSummaries = result.facetResults.map((facetCandidates) => ({
    dimension: facetCandidates.facet.dimension,
    key: facetCandidates.facet.key,
    strongMatchCount: facetCandidates.strongMatches.length,
    weakMatchCount: facetCandidates.weakMatches.length,
    satisfied: facetCandidates.satisfied,
  }));
  const unsatisfiedFacetSummaries = facetSummaries.filter(
    (facetSummary) => !facetSummary.satisfied,
  );
  const globalCapacityDeficit = result.acquisitionDeficits.find(
    (deficit) => deficit.origin === 'global_capacity',
  );

  const rules: TraceRuleEvaluation[] = [
    rule(
      'PCOV-QUANTITY-001',
      'Portafolio elegible global suficiente para días y ritmo solicitados',
      result.totalDistinctEligibleExperiences >= result.portfolioTarget
        ? 'PASS'
        : 'FAIL',
      `${result.totalDistinctEligibleExperiences} Experience(s) elegible(s) frente a ${result.portfolioTarget} requerida(s).`,
      result.totalDistinctEligibleExperiences,
      result.portfolioTarget,
    ),
    ...facetSummaries.map((facetSummary) =>
      rule(
        `PCOV-FACET-${facetSummary.dimension.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}-${facetSummary.key.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
        `Cobertura del facet solicitado: ${facetSummary.dimension}:${facetSummary.key}`,
        facetSummary.satisfied ? 'PASS' : 'FAIL',
        `${facetSummary.strongMatchCount} coincidencia(s) fuerte(s), ${facetSummary.weakMatchCount} débil(es).`,
        facetSummary.strongMatchCount,
        '>= 1',
      ),
    ),
  ];

  const decisionOutcome = result.sufficient
    ? 'none'
    : 'needs_additional_discovery';
  const summary = result.sufficient
    ? `Portafolio suficiente: ${result.totalDistinctEligibleExperiences} Experience(s) elegible(s) frente a ${result.portfolioTarget} requerida(s); todos los facets solicitados satisfechos.`
    : unsatisfiedFacetSummaries.length > 0
      ? `Facets sin cobertura fuerte: ${unsatisfiedFacetSummaries.map((facetSummary) => `${facetSummary.dimension}:${facetSummary.key}`).join(', ')}.`
      : `Todos los facets solicitados están satisfechos, pero el portafolio elegible global (${result.totalDistinctEligibleExperiences}) no alcanza el objetivo (${result.portfolioTarget}).`;

  return {
    stage: 'coverage_analysis',
    label: 'Cobertura de preferencias (facet-first)',
    component: 'FacetRetrievalService',
    status: result.sufficient
      ? 'PASS'
      : providerHealth.status === 'degraded'
        ? 'WARN'
        : 'FAIL',
    summary,
    inputs: {
      requestedFacetCount: result.facetResults.length,
      offeredCandidateCount,
      providerHealth,
    },
    rules,
    decision: {
      status: result.sufficient
        ? 'PASS'
        : providerHealth.status === 'degraded'
          ? 'WARN'
          : 'FAIL',
      outcome: decisionOutcome,
      reason: result.sufficient
        ? 'Todos los facets solicitados tienen cobertura fuerte y el portafolio elegible alcanza el objetivo.'
        : summary,
      reasonCodes: result.acquisitionDeficits.map((deficit) => deficit.origin),
      triggeredActions:
        decisionOutcome === 'none'
          ? ['BUILD_CANDIDATE_POOL']
          : ['RUN_ACQUISITION'],
    },
    outputs: {
      allFacetsSatisfied: result.allFacetsSatisfied,
      totalDistinctEligibleExperiences: result.totalDistinctEligibleExperiences,
      portfolioTarget: result.portfolioTarget,
      sufficient: result.sufficient,
      facetResults: facetSummaries,
      acquisitionDeficits: result.acquisitionDeficits,
      globalCapacityDeficit: globalCapacityDeficit ?? null,
    },
    semanticRanking: {
      status: semanticRanking.status,
      eligibleCandidateCount: semanticRanking.eligibleCandidateCount,
      indexedCandidateCount: semanticRanking.indexedCandidateCount,
      offeredCandidateCount,
      reason: semanticRanking.reason,
    },
    providerStatus: providerHealth.status === 'degraded' ? 'failed' : undefined,
    degradedReason:
      providerHealth.status === 'degraded' ? providerHealth.reason : undefined,
  };
}

export function buildDiscoveryStep(result: {
  candidates?: any[];
  provider: string;
  model?: string;
  groundingStatus: 'applied' | 'unavailable' | 'failed' | 'no_usable_evidence';
  groundingProvider?: string;
  groundingModel?: string;
  groundingEvidence?: any[];
  validationErrors?: string[];
  searchTrace?: any[];
  extractionTrace?: any[];
}): GenerationTraceStep {
  const candidates = result.candidates ?? [];
  const applied = result.groundingStatus === 'applied';
  return {
    stage: 'discovery',
    label: 'Grounded discovery',
    component: 'ExperienceDiscoveryService',
    status: applied ? 'PASS' : 'WARN',
    summary: `${candidates.length} Experience candidate(s) extraído(s) a partir de evidencia grounded.`,
    inputs: {
      provider: result.provider,
      groundingProvider: result.groundingProvider,
      groundingModel: result.groundingModel,
      evidenceCount: result.groundingEvidence?.length ?? 0,
      searchTrace: result.searchTrace ?? [],
      extractionTrace: result.extractionTrace ?? [],
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
        'Los candidates son conceptos; todavía no son identidad canónica',
        'PASS',
        'Los candidates quedan pendientes de entity resolution antes de entrar al catálogo.',
      ),
    ],
    decision: {
      status: applied ? 'PASS' : 'WARN',
      outcome: candidates.length
        ? 'CANDIDATES_READY_FOR_RESOLUTION'
        : 'NO_USABLE_CANDIDATES',
      reason: candidates.length
        ? 'Hay conceptos grounded para intentar resolver como entidades reales.'
        : 'Discovery no produjo candidates utilizables.',
      reasonCodes: result.validationErrors?.length
        ? ['CANDIDATES_VALIDATION_REJECTED']
        : ['GROUNDED_DISCOVERY_COMPLETED'],
      triggeredActions: candidates.length
        ? ['RESOLVE_ENTITIES']
        : ['CONTINUE_WITH_EXISTING_POOL'],
    },
    outputs: {
      candidateCount: candidates.length,
      validationErrors: result.validationErrors ?? [],
    },
    candidates: candidates.map((p) => ({
      source: 'discovery' as const,
      id: p.name,
      name: p.name,
      detail: `${p.themes?.join(', ') || 'sin themes'} · ${p.suggestedDurationMinutes ?? 'duración desconocida'} min · ${p.shortReason}`,
      offered: false,
      chosen: false,
    })),
    candidateDecisions: candidates.map((p) => ({
      id: p.name,
      name: p.name,
      source: 'discovery',
      status: 'ELIGIBLE' as const,
      reason:
        'Candidate grounded listo para resolución; aún no es una Experience verificada.',
      reasonCodes: ['CANDIDATE_PENDING_RESOLUTION'],
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

/**
 * One acquisition pass: the routed ExperienceAcquisitionPlan plus the
 * multi-source execution (structured providers + web discovery). Replaces the
 * old single-source "Places crawl" step — the Bitácora now names the real
 * sources that ran.
 */
export function buildAcquisitionStep(params: {
  passNumber: number;
  acquisitionContext?: TraceAcquisitionContext;
  plan: {
    sourcePlans: Array<{
      provider: string;
      wikivoyage?: { sections: string[] };
      osm?: { concepts: string[] };
      places?: { searchTypes: string[] };
      web?: {
        query: string;
        anchorNames?: string[];
        requestedThemes?: string[];
        requestedIntents?: string[];
        preferredTraits?: string[];
        semanticQuery?: string;
      };
    }>;
    deficits: Array<{
      dimension?: string;
      key?: string;
      reason: string;
      origin?: string;
    }>;
  };
  execution: {
    observations: unknown[];
    candidates: Array<Partial<ExperienceCandidate>>;
    evidence?: Array<{
      key?: string;
      source: string;
      title?: string;
      snippet?: string;
      url?: string;
    }>;
    providerResults: Record<
      string,
      { status?: string; failureReason?: string } | undefined
    >;
    webResults?: Array<{
      status: string;
      query: string;
      groundedProvider?: string;
      groundedModel?: string;
      groundingStatus?: string;
      evidenceKeys: string[];
      extractorProvider?: string;
      extractorModel?: string;
      validationErrors: string[];
      candidateCount: number;
      failureReason?: string;
    }>;
    structuredCandidateCount?: number;
    webCandidateCount?: number;
  };
}): GenerationTraceStep {
  const { passNumber, plan, execution, acquisitionContext } = params;
  const providers = plan.sourcePlans.map((s) => s.provider);
  const structuredEntries = Object.entries(execution.providerResults).map(
    ([provider, res]) => ({
      provider,
      status: res?.status ?? 'unknown',
      failureReason: res?.failureReason,
    }),
  );
  const failed = [
    ...structuredEntries
      .filter((e) => e.status === 'failed')
      .map((e) => e.provider),
    ...(execution.webResults ?? [])
      .filter((w) => w.status === 'failed')
      .map(() => 'web'),
  ];
  const anyAttempted =
    structuredEntries.length > 0 || (execution.webResults?.length ?? 0) > 0;
  const allFailed =
    anyAttempted &&
    structuredEntries.every((e) => e.status === 'failed') &&
    (execution.webResults ?? []).every((w) => w.status === 'failed');

  const observations = execution.observations as SourceObservation[];
  const evidence =
    (
      execution as typeof execution & {
        evidence?: Array<{
          key?: string;
          source: string;
          title?: string;
          snippet?: string;
          url?: string;
        }>;
      }
    ).evidence ?? [];
  const structuredEvidenceKeys = new Set(
    observations.map((item) => item.evidenceKey),
  );
  const webEvidenceKeys = new Set(
    evidence
      .filter((item) => !structuredEvidenceKeys.has(item.key ?? ''))
      .map((item) => item.key)
      .filter((key): key is string => Boolean(key)),
  );
  const auditSources: TraceAcquisitionSource[] = plan.sourcePlans.map(
    (sourcePlan) => {
      const result = execution.providerResults[sourcePlan.provider];
      const sourceObservations = observations.filter(
        (item) => item.provider === sourcePlan.provider,
      );
      const webResult =
        sourcePlan.provider === 'web'
          ? (execution.webResults ?? []).find(
              (item) => item.query === sourcePlan.web?.query,
            )
          : undefined;
      const configuration =
        sourcePlan.provider === 'wikivoyage'
          ? { sections: sourcePlan.wikivoyage?.sections }
          : sourcePlan.provider === 'osm'
            ? { concepts: sourcePlan.osm?.concepts }
            : sourcePlan.provider === 'google_places'
              ? { searchTypes: sourcePlan.places?.searchTypes }
              : {
                  query: sourcePlan.web?.query,
                  anchorNames: sourcePlan.web?.anchorNames,
                  requestedThemes: sourcePlan.web?.requestedThemes,
                  requestedIntents: sourcePlan.web?.requestedIntents,
                  preferredTraits: sourcePlan.web?.preferredTraits,
                  semanticQuery: sourcePlan.web?.semanticQuery,
                };
      return {
        provider: sourcePlan.provider,
        configuration,
        status: (result?.status ??
          webResult?.status ??
          'unknown') as TraceAcquisitionSource['status'],
        failureReason: result?.failureReason ?? webResult?.failureReason,
        observationCount: sourceObservations.length,
        observations: sourceObservations.map(traceObservation),
        web:
          sourcePlan.provider === 'web' && sourcePlan.web
            ? {
                ...sourcePlan.web,
                groundedProvider: webResult?.groundedProvider,
                groundedModel: webResult?.groundedModel,
                groundingStatus: webResult?.groundingStatus,
                evidence: evidence
                  .filter((item) =>
                    (webResult?.evidenceKeys ?? []).includes(item.key ?? ''),
                  )
                  .map(traceEvidence),
                extractor: webResult
                  ? {
                      provider: webResult.extractorProvider,
                      model: webResult.extractorModel,
                      inputEvidenceKeys: webResult.evidenceKeys,
                      validationErrors: webResult.validationErrors,
                      candidateCount: webResult.candidateCount,
                    }
                  : undefined,
              }
            : undefined,
      };
    },
  );
  const auditCandidates: TraceAcquisitionCandidate[] = execution.candidates
    .filter(
      (candidate): candidate is ExperienceCandidate =>
        typeof candidate.name === 'string' &&
        Array.isArray(candidate.themes) &&
        Array.isArray(candidate.traits) &&
        Array.isArray(candidate.componentHints) &&
        Array.isArray(candidate.evidenceKeys),
    )
    .map((candidate) => {
      const hasStructuredEvidence = candidate.evidenceKeys.some((key) =>
        structuredEvidenceKeys.has(key),
      );
      const hasWebEvidence = candidate.evidenceKeys.some((key) =>
        webEvidenceKeys.has(key),
      );
      const origin: 'structured' | 'web' | 'mixed' =
        hasStructuredEvidence && hasWebEvidence
          ? 'mixed'
          : hasStructuredEvidence
            ? 'structured'
            : 'web';
      return {
        traceKey: traceCandidateKey(candidate),
        name: candidate.name,
        origin,
        providers: [
          ...new Set(
            candidate.evidenceKeys.flatMap((key) => [
              ...observations
                .filter((item) => item.evidenceKey === key)
                .map((item) => item.provider),
              ...evidence
                .filter((item) => item.key === key)
                .map((item) => item.source),
            ]),
          ),
        ],
        themes: [...candidate.themes],
        intents: [...(candidate.intents ?? [])],
        evidenceKeys: [...candidate.evidenceKeys],
        suggestedDurationMinutes: candidate.suggestedDurationMinutes,
        orderedByEvidence: candidate.orderedByEvidence,
        componentHints: candidate.componentHints.map((hint, index) =>
          traceHint(hint, candidate.orderedByEvidence ? index + 1 : undefined),
        ),
      };
    });
  const acquisition: TraceAcquisitionAudit = {
    passNumber,
    acquisitionContext,
    deficits: plan.deficits.map((deficit) => ({
      origin: deficit.origin,
      dimension: deficit.dimension,
      key: deficit.key,
      reason: deficit.reason,
    })),
    sourcePlans: auditSources,
    evidence: evidence.map(traceEvidence),
    candidates: auditCandidates,
  };

  return {
    stage: 'discovery',
    label: `Adquisición multi-fuente (pase ${passNumber})`,
    component: 'ExperienceAcquisitionService',
    status: allFailed ? 'FAIL' : failed.length > 0 ? 'WARN' : 'PASS',
    summary: `Pase ${passNumber}: fuentes [${providers.join(', ') || 'ninguna'}] → ${execution.observations.length} observación(es) estructurada(s) + ${execution.candidates.length} candidate(s) (web: ${execution.webCandidateCount ?? 0}).`,
    inputs: {
      passNumber,
      routedProviders: providers,
      deficits: plan.deficits.map((d) => ({
        dimension: d.dimension,
        key: d.key,
        reason: d.reason,
        origin: d.origin,
      })),
    },
    acquisitionContext,
    outputs: {
      observationCount: execution.observations.length,
      structuredCandidateCount: execution.structuredCandidateCount ?? 0,
      webCandidateCount: execution.webCandidateCount ?? 0,
      candidateCount: execution.candidates.length,
      structuredProviders: structuredEntries,
      webResults: (execution.webResults ?? []).map((w) => ({
        status: w.status,
        query: w.query,
        groundedProvider: w.groundedProvider,
        groundedModel: w.groundedModel,
        groundingStatus: w.groundingStatus,
        evidenceCount: w.evidenceKeys.length,
        extractorProvider: w.extractorProvider,
        extractorModel: w.extractorModel,
        validationErrors: w.validationErrors,
        candidateCount: w.candidateCount,
        failureReason: w.failureReason,
      })),
    },
    acquisition,
    rules: [
      rule(
        'ACQ-ROUTING-001',
        'Los deficits se enrutan a fuentes por la tabla de capacidad, no por reglas ad hoc',
        providers.length > 0 ? 'PASS' : 'SKIPPED',
        providers.length > 0
          ? `Fuentes enrutadas: ${providers.join(', ')}.`
          : 'No hubo deficit enrutable.',
      ),
      rule(
        'ACQ-ISOLATION-001',
        'Una fuente que falla no aborta la adquisición',
        allFailed ? 'FAIL' : failed.length > 0 ? 'WARN' : 'PASS',
        failed.length > 0
          ? `Fuentes con fallo aisladas: ${failed.join(', ')}.`
          : 'Todas las fuentes atendidas respondieron.',
      ),
      rule(
        'ACQ-CANDIDATE-001',
        'Estructurados y web convergen en el boundary ExperienceCandidate antes del resolver',
        'PASS',
        'Los candidates quedan pendientes de entity resolution / validación geográfica.',
      ),
    ],
    providerStatus: allFailed ? 'failed' : 'success',
    degradedReason:
      failed.length > 0 ? `providers_failed_${failed.join('_')}` : undefined,
  };
}

export function buildEntityResolutionStep(
  result: ExperienceResolutionResponse,
  acquisitionContext?: TraceAcquisitionContext,
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
      `${entry.candidate.name}: ${entry.rejectionReasons.join(', ') || 'sin motivo registrado'}`,
  );
  const entityResolutionAudit = resolution.resolved.map((entry) => ({
    candidateTraceKey: traceCandidateKey(entry.candidate),
    candidateName: entry.candidate.name,
    hints: entry.candidate.componentHints.map((hint) => {
      const entity = entry.resolvedEntities.find(
        (item) => item.hintKey === hint.key,
      );
      return {
        ...traceHint(hint),
        status: entity?.status ?? 'unresolved',
        resolvedGeoEntity:
          entity?.status === 'resolved'
            ? {
                geoEntityId: entity.geoEntityId,
                canonicalName: entity.canonicalName,
                provider: entity.provider,
                externalId: entity.externalId,
                latitude: entity.latitude,
                longitude: entity.longitude,
                geometry: traceGeometrySummary(entity.geometry),
              }
            : undefined,
        reason: entity?.reason,
      };
    }),
    accepted: entry.status === 'accepted',
    rejectionReasons: [...entry.rejectionReasons],
  }));

  return {
    stage: 'entity_resolution',
    acquisitionContext,
    label: 'Resolución de entidades reales',
    component: 'ExperienceProposalResolverService',
    status: accepted.length ? 'PASS' : rejected.length ? 'WARN' : 'INFO',
    summary:
      `Entity resolution procesó ${resolution.totalCandidates} candidato(s): ` +
      `${accepted.length} quedaron con entidades concretas suficientes para continuar y ` +
      `${rejected.length} no pudieron resolverse. Se obtuvieron ${resolvedEntityCount} entidad(es) ` +
      `provider-backed, ${coordinateCount} con coordenadas. Esta etapa no decide coherencia ` +
      `geográfica ni persiste la composite.` +
      (rejectedSummaries.length
        ? ` Rechazadas: ${rejectedSummaries.join('; ')}.`
        : ''),
    inputs: { totalCandidates: resolution.totalCandidates },
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
                  `${entry.candidate.name}: ${entry.rejectionReasons.join(', ') || 'sin motivo'}`,
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
      candidateCount: resolution.totalCandidates,
      resolutionReadyCount: accepted.length,
      rejectedCount: rejected.length,
      resolvedEntityCount,
      entitiesWithCoordinates: coordinateCount,
    },
    candidateDecisions: resolution.resolved.map((entry) => ({
      id: entry.candidate.name,
      name: entry.candidate.name,
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
    resolution: projectResolutionPayload(result),
    entityResolutionAudit,
  };
}

export function buildGeographicValidationStep(
  result: FinalExperienceResolutionResponse,
  acquisitionContext?: TraceAcquisitionContext,
): GenerationTraceStep {
  const validation = result.geographicValidation;
  const accepted = validation.results.filter((entry) => entry.accepted);
  const rejected = validation.results.filter((entry) => !entry.accepted);
  const radiusValues = validation.results
    .map((entry) => entry.coherence?.radiusMeters)
    .filter((value): value is number => Number.isFinite(value));
  const maxRadiusMeters = radiusValues.length
    ? Math.max(...radiusValues)
    : null;
  const geographicValidationAudit = validation.results.map((entry, index) => {
    // validateBatch() creates results with resolution.resolved.map(), so the
    // result/resolved positional relationship is the canonical correlation
    // contract. Names remain display-only and are never used as identity.
    const resolvedCandidate = validation.resolved?.[index];
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
      scope: result.validationScope
        ? {
            kind: result.validationScope.kind,
            anchorName:
              'anchorName' in result.validationScope
                ? result.validationScope.anchorName
                : undefined,
            geoEntityId:
              'geoEntityId' in result.validationScope
                ? result.validationScope.geoEntityId
                : undefined,
          }
        : undefined,
      groundedEvidenceKeys: [...entry.groundedEvidenceKeys],
      rejectionReasons: [...entry.rejectionReasons],
      components: (resolvedCandidate?.resolvedEntities ?? []).map((entity) => ({
        hintName: entity.hintName,
        hintKey: entity.hintKey,
        role: entity.role,
        resolvedGeoEntityId: entity.geoEntityId,
        relation:
          decisionEntities.get(entity.hintKey ?? entity.geoEntityId)
            ?.relation ?? 'evaluated',
      })),
    };
  });

  return {
    stage: 'geographic_validation',
    acquisitionContext,
    label: 'Validación geográfica independiente',
    component: 'CompositeGeographicValidationService',
    status: accepted.length ? (rejected.length ? 'WARN' : 'PASS') : 'WARN',
    summary: `Validación geográfica: ${accepted.length} propuesta(s) verificadas y ${rejected.length} descartadas por coherencia espacial o falta de entidad real.`,
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
        ? ['MATERIALIZE_VERIFIED_EXPERIENCES']
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
    geographicValidation: projectGeographicValidationPayload(result),
    geographicValidationAudit,
  };
}

export function buildCatalogMaterializationStep(
  result: ExperienceResolutionResponse,
  acquisitionContext?: TraceAcquisitionContext,
): GenerationTraceStep {
  const materialization = result.materialization;
  const finalResolved = materialization?.resolved ?? result.resolved;
  const materialized = finalResolved.filter(
    (entry) => entry.status === 'accepted' && entry.experienceId,
  );
  const rejected = finalResolved.filter((entry) => !entry.experienceId);
  const persistedExperienceIds = materialized.map(
    (entry) => entry.experienceId as string,
  );
  const materializationAudit = finalResolved.map((entry) => ({
    candidateTraceKey: traceCandidateKey(entry.candidate),
    candidateName: entry.candidate.name,
    accepted: entry.status === 'accepted' && Boolean(entry.experienceId),
    rejectionReasons: [...entry.rejectionReasons],
    experienceId: entry.experienceId,
    canonicalName: entry.experienceId ? entry.candidate.name : undefined,
    persistedComponentCount: entry.experienceId
      ? entry.resolvedEntities.filter(
          (entity) => entity.status === 'resolved' && entity.geoEntityId,
        ).length
      : undefined,
  }));

  return {
    stage: 'catalog_materialization',
    acquisitionContext,
    label: 'Materialización en catálogo',
    component: 'ExperienceCatalogService',
    status: materialized.length ? (rejected.length ? 'WARN' : 'PASS') : 'WARN',
    summary:
      `${materialized.length} propuesta(s) geográficamente verificadas quedaron materializadas ` +
      `como Experiences verificadas; ${rejected.length} no produjeron Experience persistida. ` +
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
        'ExperienceCatalogService consume el resultado del validador geográfico.',
      ),
      rule(
        'MAT-CANONICAL-001',
        'Exponer solo IDs canónicos persistidos al re-query/ranking',
        materialized.length ? 'PASS' : 'WARN',
        `${persistedExperienceIds.length} Experience id(s) quedaron disponibles para re-query.`,
        persistedExperienceIds.length,
      ),
    ],
    decision: {
      status: materialized.length
        ? rejected.length
          ? 'WARN'
          : 'PASS'
        : 'WARN',
      outcome: materialized.length
        ? 'VERIFIED_EXPERIENCES_MATERIALIZED'
        : 'NO_EXPERIENCES_MATERIALIZED',
      reason: materialized.length
        ? 'Las Experiences persistidas pueden reingresar al pool canónico del mismo pedido.'
        : 'No hubo propuesta verificada que pudiera materializarse.',
      reasonCodes: rejected.flatMap((entry) => entry.rejectionReasons),
      triggeredActions: materialized.length
        ? ['REQUERY_CANONICAL_CATALOG']
        : ['CONTINUE_WITH_EXISTING_POOL'],
    },
    outputs: {
      materializedCount: materialized.length,
      rejectedCount: rejected.length,
      persistedExperienceIds,
    },
    candidateDecisions: finalResolved.map((entry) => ({
      id: entry.experienceId ?? entry.candidate.name,
      name: entry.candidate.name,
      source: 'discovery',
      status: entry.experienceId
        ? ('ELIGIBLE' as const)
        : ('REJECTED' as const),
      reason: entry.experienceId
        ? 'Experience verificada materializada y lista para re-query.'
        : entry.rejectionReasons.join(', '),
      reasonCodes: entry.experienceId
        ? ['EXPERIENCE_MATERIALIZED']
        : entry.rejectionReasons,
    })),
    providerStatus: materialized.length ? 'success' : 'failed',
    degradedReason: materialized.length
      ? undefined
      : 'no_experiences_materialized',
    materialization: projectMaterializationPayload(result),
    materializationAudit,
    classificationAudit: result.classification,
  };
}

export function buildCandidatePoolStep(params: {
  initialCatalogCount: number;
  postAcquisitionCatalogCount: number;
  eligibleCount: number;
  offeredCandidates: Array<
    TraceFacetCandidate & {
      traceSource: 'db' | 'google_places' | 'geoapify' | 'discovery';
      scoreBreakdown: CandidateScoreBreakdown;
    }
  >;
  requestedThemes: string[];
}): GenerationTraceStep {
  const bySource = { catalog: 0, refill: 0, discovery: 0 };

  const candidates: TraceCandidate[] = params.offeredCandidates.map((c) => {
    const bucket =
      c.traceSource === 'db'
        ? 'catalog'
        : c.traceSource === 'discovery'
          ? 'discovery'
          : 'refill';
    bySource[bucket] += 1;
    const themes = c.matchedThemes ?? [];
    return {
      source: c.traceSource,
      id: c.id,
      name: c.name,
      detail:
        `score total ${c.scoreBreakdown.totalScore.toFixed(3)} ` +
        `(semántica ${c.scoreBreakdown.semanticSimilarity ?? 'n/d'}, ` +
        `preferencias ${(c.scoreBreakdown.preferenceBonus ?? 0).toFixed(3)}, ` +
        `calidad ${c.scoreBreakdown.qualityBonus.toFixed(3)}, ` +
        `proximidad ${c.scoreBreakdown.proximityBonus.toFixed(3)}, ` +
        `diversidad ${c.scoreBreakdown.diversityBonus.toFixed(3)})`,
      offered: true,
      chosen: false,
      scoreBreakdown: c.scoreBreakdown,
      coverageContribution: { themes },
    };
  });

  return {
    stage: 'candidate_pool',
    label: 'Composición de portfolio canónico',
    component: 'ExperienceCompositionService',
    status: 'PASS',
    summary:
      `Portfolio inicial ofrecido al planificador: ${candidates.length} candidato(s) reales ` +
      `de ${params.eligibleCount} elegibles (${bySource.catalog} del catálogo, ` +
      `${bySource.refill} de refill, ${bySource.discovery} recién resueltos ` +
      `por discovery). Cada uno conserva su ID canónico de Experience; el modelo no ` +
      `puede crear entidades.`,
    inputs: {
      initialCatalogCount: params.initialCatalogCount,
      postAcquisitionCatalogCount: params.postAcquisitionCatalogCount,
      eligibleCount: params.eligibleCount,
      requestedThemes: params.requestedThemes,
    },
    rules: [
      rule(
        'RANK-WINDOW-001',
        'Acotar el pool sin perder identidad canónica',
        'PASS',
        `${candidates.length} candidato(s) quedaron en la ventana; todos conservan Experience id real.`,
        candidates.length,
      ),
      rule(
        'RANK-DIVERSITY-001',
        'Mantener diversidad semántica y geográfica en la ventana',
        'PASS',
        'La ventana se construyó con ranking Experience-native.',
        candidates.length,
      ),
    ],
    decision: {
      status: 'PASS',
      outcome: 'PLANNING_WINDOW_BUILT',
      reason:
        'La ventana quedó ordenada por señales reales de relevancia y cobertura semántica.',
      reasonCodes: [],
      triggeredActions: ['RUN_DAILY_PLANNING'],
    },
    outputs: {
      offeredCandidateCount: candidates.length,
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
      bySource,
    },
  };
}

/** V2 candidate-pool trace: Experience-native ranking with no format/kind gate. */
export function buildExperienceCandidatePoolStep(params: {
  initialCatalogCount: number;
  postAcquisitionCatalogCount: number;
  eligibleCount: number;
  offeredCandidates: Array<
    TraceFacetCandidate & {
      traceSource: 'db' | 'google_places' | 'geoapify' | 'discovery';
      scoreBreakdown: CandidateScoreBreakdown;
    }
  >;
  requestedThemes: string[];
}): GenerationTraceStep {
  const bySource = { catalog: 0, refill: 0, discovery: 0 };
  const candidates: TraceCandidate[] = params.offeredCandidates.map((c) => {
    const bucket =
      c.traceSource === 'db'
        ? 'catalog'
        : c.traceSource === 'discovery'
          ? 'discovery'
          : 'refill';
    bySource[bucket] += 1;
    return {
      source: c.traceSource,
      id: c.id,
      name: c.name,
      detail: `score total ${c.scoreBreakdown.totalScore.toFixed(3)}`,
      offered: true,
      chosen: false,
      scoreBreakdown: c.scoreBreakdown,
      coverageContribution: {
        themes: c.matchedThemes ?? [],
      },
    };
  });
  return {
    stage: 'candidate_pool',
    label: 'Ranking de Experiences',
    component: 'ExperienceRankingEngine',
    status: 'PASS',
    summary: `Se evaluaron ${params.eligibleCount} experiencias elegibles y se ofrecieron ${candidates.length} candidatas (${bySource.catalog} catálogo, ${bySource.refill} adquisición, ${bySource.discovery} discovery).`,
    inputs: {
      initialCatalogCount: params.initialCatalogCount,
      postAcquisitionCatalogCount: params.postAcquisitionCatalogCount,
      eligibleCount: params.eligibleCount,
      requestedThemes: params.requestedThemes,
    },
    rules: [
      rule(
        'EXPERIENCE-RANK-001',
        'Ordenar Experiences por relevancia semántica y calidad',
        'PASS',
        'El ranking determinístico consume únicamente Experiences verificadas.',
        candidates.length,
      ),
    ],
    decision: {
      status: 'PASS',
      outcome: 'EXPERIENCE_POOL_RANKED',
      reason:
        'El pool quedó limitado por capacidad, sin imponer formatos legacy.',
      reasonCodes: [],
      triggeredActions: ['RUN_DAILY_PLANNING'],
    },
    outputs: { offeredCandidateCount: candidates.length, bySource },
    candidates,
    candidateDecisions: params.offeredCandidates.map((c) => ({
      id: c.id,
      name: c.name,
      source: c.traceSource,
      status: 'RANKED' as const,
      reason: 'Entró al pool V2 por relevancia.',
      reasonCodes: ['INSIDE_EXPERIENCE_POOL'],
      scoreBreakdown: c.scoreBreakdown,
    })),
    candidatePool: {
      initialCatalogCount: params.initialCatalogCount,
      postAcquisitionCatalogCount: params.postAcquisitionCatalogCount,
      eligibleCount: params.eligibleCount,
      llmWindowCount: candidates.length,
      bySource,
    },
  };
}

export function buildDailyPlanningStep(
  solution: DailyPlanningSolution,
): GenerationTraceStep {
  const selectedCount = solution.days.reduce(
    (sum, day) => sum + day.experiences.length,
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
    day.experiences.map((experience, order) => ({
      id: experience.experienceId,
      name: experience.experienceId,
      status: 'SELECTED' as const,
      reason: `Asignada al día ${day.dayNumber} en posición ${order + 1}; pasó la factibilidad del solver.`,
      reasonCodes: ['FEASIBLE_AND_SELECTED'],
      dayNumber: day.dayNumber,
      order: order + 1,
    })),
  );
  const unselected = solution.unselected.map((candidate) => ({
    id: candidate.experienceId,
    name: candidate.experienceId,
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
      `${selectedCount} Experience(s) seleccionada(s), ${solution.unselected.length} sin seleccionar ` +
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
        : 'NO_FEASIBLE_EXPERIENCES_SELECTED',
      reason: selectedCount
        ? 'El solver produjo una asignación determinística y físicamente evaluable.'
        : 'Ningún candidato pudo ser seleccionado.',
      reasonCodes: selectedCount
        ? ['PLANNING_COMPLETED']
        : ['NO_EXPERIENCES_SELECTED'],
      triggeredActions: ['VALIDATE_COMPLETENESS', 'VALIDATE_FORMAT_COVERAGE'],
    },
    outputs: {
      selectedCount,
      unselectedCount: solution.unselected.length,
      score: solution.score,
      residualCapacity: solution.metadata.residualCapacity,
      days: solution.days.map((day) => ({
        dayNumber: day.dayNumber,
        experienceCount: day.experiences.length,
        totalExperienceMinutes: day.totalExperienceMinutes,
        totalTravelMinutes: day.totalTravelMinutes,
        totalWalkingMinutes: day.totalWalkingMinutes,
        utilizationMinutes: day.utilizationMinutes,
      })),
    },
    candidateDecisions: [...selected, ...unselected],
    providerStatus: selectedCount === 0 ? 'failed' : undefined,
    degradedReason: selectedCount === 0 ? 'no_experiences_selected' : undefined,
    dailyPlanning: {
      solver: solution.metadata.solver,
      dayCount: solution.days.length,
      selectedCount,
      unselectedCount: solution.unselected.length,
      approximateTravel: solution.metadata.approximateTravel,
      iterations: solution.metadata.iterations,
      residualCapacity: solution.metadata.residualCapacity,
      score: solution.score,
      routing: solution.metadata.routing,
      days: solution.days.map((day) => ({
        dayNumber: day.dayNumber,
        experienceCount: day.experiences.length,
        totalExperienceMinutes: day.totalExperienceMinutes,
        totalTravelMinutes: day.totalTravelMinutes,
        totalWalkingMinutes: day.totalWalkingMinutes,
        utilizationMinutes: day.utilizationMinutes,
      })),
    },
  };
}

function describeCompletenessIssue(issue: TourCompletenessIssue): string {
  if (issue.code === 'UNMET_REQUESTED_FORMAT') {
    return `Formato pedido sin cubrir: "${issue.requestedIntent}".`;
  }
  return (
    `Día ${issue.dayNumber}: ${issue.selectedExperienceCount} experience(s), ` +
    `~${issue.selectedExperienceHours}h, ${issue.viableUnusedCandidateCount} ` +
    `candidato(s) viable(s) sin usar (ritmo "${issue.travelPace}").`
  );
}

export function buildTourCompletenessStep(
  result: TourCompletenessResult,
  retryAttempted: boolean,
): GenerationTraceStep {
  const summary = result.complete
    ? 'El itinerario generado hace un uso razonable de los días solicitados.' +
      (retryAttempted ? ' (tras un reintento por completitud)' : '')
    : result.issues.map(describeCompletenessIssue).join(' ') +
      (retryAttempted
        ? ' Se reintentó la generación una vez y el resultado siguió incompleto.'
        : '');
  const reasonCodes = Array.from(
    new Set(result.issues.map((issue) => issue.code)),
  );
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
          : result.issues.map(describeCompletenessIssue).join(' '),
      ),
    ],
    decision: {
      status: result.complete ? 'PASS' : 'WARN',
      outcome: result.complete ? 'TOUR_COMPLETE' : 'TOUR_UNDERFILLED',
      reason: result.complete
        ? 'La política de completitud no detectó déficit accionable.'
        : 'Existen días que podrían estar mejor utilizados, o formatos pedidos sin cubrir, según la política actual.',
      reasonCodes,
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
  pickedExperienceIds: string[];
  candidatesByStage: TraceCandidate[][];
}): GenerationTraceStep {
  const pickedSet = new Set(params.pickedExperienceIds);
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
    inputs: { pickedExperienceIds: params.pickedExperienceIds },
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
        'No persistir la misma Experience más de una vez en el mismo resultado',
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
