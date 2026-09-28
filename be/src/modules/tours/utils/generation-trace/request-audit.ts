import { GenerationTraceRecorder } from '../generation-trace-recorder.util';
import { TraceStepV5 } from '../../interfaces/generation-trace-v5.interface';
import { TourGenerationRequest } from '../../interfaces/tour-generation.interface';
import {
  PreferenceSpec,
  InterpretedAnchor,
  ResolvedAnchor,
} from '../../interfaces/preference-spec.interface';
import {
  NormalizedPreferenceIntent,
  PreferenceInterpretationTrace,
} from '../../interfaces/preference-interpretation.interface';
import { DestinationResolution } from '../../services/destination-resolution.service';

export function recordPreferenceInterpretationStep(
  recorder: GenerationTraceRecorder,
  input: {
    preferenceInterpretation: {
      intent: NormalizedPreferenceIntent;
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
    resolution: DestinationResolution;
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
    requestedAnchors: InterpretedAnchor[];
    resolvedAnchors: ResolvedAnchor[];
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
