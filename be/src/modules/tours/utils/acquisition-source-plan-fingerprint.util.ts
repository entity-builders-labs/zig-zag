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
  planOrSourcePlan: ExperienceAcquisitionPlan | SourcePlan,
  canonicalDestination?: string,
  relevantAnchorNames: string[] = [],
  relevantDeficits: unknown[] = [],
): string {
  const isPlan = 'sourcePlans' in planOrSourcePlan;
  const plan = isPlan ? planOrSourcePlan : undefined;
  const sourcePlan = isPlan ? undefined : planOrSourcePlan;
  return JSON.stringify(
    canonical({
      provider:
        sourcePlan?.provider ?? plan?.sourcePlans.map((item) => item.provider),
      destination: canonicalDestination ?? plan?.destination.destinationName,
      sourcePlanPayload: sourcePlan ?? plan?.sourcePlans,
      evidenceRequirements: plan?.evidenceRequirements,
      relevantAnchorNames,
      relevantDeficits,
    }),
  );
}
