import {
  AcquisitionDeficit,
  SourcePlan,
} from '../interfaces/experience-acquisition-plan.interface';
import { AcquisitionEvidenceRequirement } from '../interfaces/acquisition-evidence-requirement.interface';
import { ResolvedAnchor } from '../interfaces/preference-spec.interface';

export interface AcquisitionExecutionLedger {
  executedSourcePlanFingerprints: Set<string>;
}

export interface SourcePlanFingerprintContext {
  destination: unknown;
  evidenceRequirements: AcquisitionEvidenceRequirement[];
  relevantDeficits: AcquisitionDeficit[];
  relevantAnchors: ResolvedAnchor[];
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(canonical)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return typeof value === 'string' ? value.trim() : value;
}

export function acquisitionSourcePlanFingerprint(
  sourcePlan: SourcePlan,
  context: SourcePlanFingerprintContext,
): string {
  return JSON.stringify(
    canonical({
      provider: sourcePlan.provider,
      destination: context.destination,
      sourcePlanPayload: sourcePlan,
      evidenceRequirements: context.evidenceRequirements,
      relevantDeficits: context.relevantDeficits,
      relevantAnchors: context.relevantAnchors,
    }),
  );
}
