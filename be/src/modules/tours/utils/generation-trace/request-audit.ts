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
import { UnenforceableHardConstraint } from '../hard-constraint-enforceability.util';
import { PreferencePolarityConflict } from '../../preferences/preference-assertion.interface';

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
        : preferenceInterpretation.trace.status === 'failed'
          ? 'La extracción semántica falló: el texto libre quedó sin resolver y solo se aplican las selecciones estructuradas.'
          : 'Filtros estructurados aplicados.',
    component: 'PreferenceInterpreterService',
    decision: {
      status:
        preferenceInterpretation.trace.status === 'applied'
          ? 'PASS'
          : preferenceInterpretation.trace.status === 'failed'
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
        id: 'INTENT-POLARITY-001',
        name: 'No adivinar la polaridad de un objetivo afirmado con ambas',
        status: preferenceSpec.polarityConflicts.some((c) => c.blocking)
          ? 'FAIL'
          : preferenceSpec.polarityConflicts.length
            ? 'WARN'
            : 'PASS',
        reason: preferenceSpec.polarityConflicts.some((c) => c.blocking)
          ? 'Un objetivo se afirmó como INCLUDE y EXCLUDE con una restricción dura: la generación se detiene (AMBIGUOUS_HARD_CONSTRAINT).'
          : preferenceSpec.polarityConflicts.length
            ? 'Objetivos afirmados como INCLUDE y EXCLUDE: ninguno participa (PREFERENCE_POLARITY_CONFLICT).'
            : 'Ningún objetivo se afirmó con polaridades opuestas.',
        facts: {
          conflicts: preferenceSpec.polarityConflicts.map((conflict) => ({
            target: conflict.target,
            reason: conflict.reason,
            blocking: conflict.blocking,
            includeConstraint: conflict.include.constraint,
            excludeConstraint: conflict.exclude.constraint,
            includeProvenance: conflict.include.provenance,
            includeEvidence: conflict.include.evidence,
            excludeProvenance: conflict.exclude.provenance,
            excludeEvidence: conflict.exclude.evidence,
          })),
        },
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
      assertions: preferenceSpec.assertions,
      polarityConflicts: preferenceSpec.polarityConflicts,
      unresolvedConcepts: preferenceSpec.unresolvedConcepts,
      facetSchemaVersion: preferenceSpec.facetSchemaVersion,
    },
  });
}

/** Records why a request with unguaranteeable hard constraints stops. */
export function recordHardConstraintEnforceabilityStep(
  recorder: GenerationTraceRecorder,
  input: {
    constraints: UnenforceableHardConstraint[];
    destination: string;
  },
): TraceStepV5 {
  return recorder.record({
    name: 'preference.hard_constraints',
    description: `${input.constraints.length} restricción(es) dura(s) no se pueden garantizar con el conocimiento actual.`,
    component: 'HardConstraintEnforceability',
    decision: {
      status: 'FAIL',
      outcome: 'HARD_EXCLUSION_UNENFORCEABLE',
      reasonCodes: [
        ...new Set(
          input.constraints.map((constraint) => constraint.missingKnowledge),
        ),
      ],
    },
    facts: {
      destination: input.destination,
      constraints: input.constraints.map((constraint) => ({
        target: constraint.target
          ? `${constraint.target.dimension}:${constraint.target.key}`
          : null,
        unresolvedLabel: constraint.unresolvedLabel,
        polarity: constraint.polarity,
        missingKnowledge: constraint.missingKnowledge,
        reason: constraint.reason,
      })),
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

/** Records why a request with contradictory hard intent stops. */
export function recordAmbiguousHardConstraintStep(
  recorder: GenerationTraceRecorder,
  input: {
    conflicts: PreferencePolarityConflict[];
    destination: string;
  },
): TraceStepV5 {
  return recorder.record({
    name: 'preference.hard_constraints',
    description: `${input.conflicts.length} objetivo(s) con intención dura contradictoria (INCLUDE y EXCLUDE).`,
    component: 'HardConstraintEnforceability',
    decision: {
      status: 'FAIL',
      outcome: 'AMBIGUOUS_HARD_CONSTRAINT',
      reasonCodes: ['PREFERENCE_POLARITY_CONFLICT'],
    },
    facts: {
      destination: input.destination,
      conflicts: input.conflicts.map((conflict) => ({
        target: `${conflict.target.dimension}:${conflict.target.key}`,
        include: {
          constraint: conflict.include.constraint,
          provenance: conflict.include.provenance,
          evidence: conflict.include.evidence,
        },
        exclude: {
          constraint: conflict.exclude.constraint,
          provenance: conflict.exclude.provenance,
          evidence: conflict.exclude.evidence,
        },
        reason: conflict.reason,
      })),
    },
  });
}
