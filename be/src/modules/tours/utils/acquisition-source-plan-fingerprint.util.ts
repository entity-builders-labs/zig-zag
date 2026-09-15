import {
  ExperienceAcquisitionPlan,
  SourcePlan,
} from '../interfaces/experience-acquisition-plan.interface';

export interface AcquisitionExecutionLedger {
  executedSourcePlanFingerprints: Set<string>;
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
  plan: ExperienceAcquisitionPlan,
  relevantAnchorNames: string[] = [],
  relevantDeficits: unknown[] = plan.deficits,
): string {
  return JSON.stringify(
    canonical({
      provider: (plan.sourcePlans as SourcePlan[]).map(
        (sourcePlan) => sourcePlan.provider,
      ),
      destination: plan.destination,
      sourcePlanPayload: plan.sourcePlans,
      evidenceRequirements: plan.evidenceRequirements,
      relevantAnchorNames,
      relevantDeficits,
    }),
  );
}
