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

/**
 * The material acquisition semantics of a resolved anchor: exactly the
 * facts that change what a source plan acquires (which anchor, which
 * canonical entity, which geometry/boundary scopes it). Explicit allow-list
 * so audit/trace-only fields -- `candidateFacts`, and the unresolved
 * anchor's diagnostic `unresolvedReason` -- can never alter a fingerprint
 * and therefore never alter a DUPLICATE_SOURCE_PLAN_EXECUTION decision.
 */
export function materialAnchorProjection(anchor: ResolvedAnchor) {
  if (anchor.status === 'unresolved') {
    return {
      status: anchor.status,
      rawName: anchor.rawName,
      usage: anchor.usage,
      priority: anchor.priority,
    };
  }
  return {
    status: anchor.status,
    rawName: anchor.rawName,
    usage: anchor.usage,
    priority: anchor.priority,
    kind: anchor.kind,
    canonicalName: anchor.canonicalName,
    provider: anchor.provider,
    externalId: anchor.externalId,
    geoEntityId: anchor.geoEntityId,
    geometry: anchor.geometry,
    osmBoundary: anchor.osmBoundary
      ? {
          osmType: anchor.osmBoundary.osmType,
          osmId: anchor.osmBoundary.osmId,
        }
      : undefined,
  };
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
      relevantAnchors: context.relevantAnchors.map(materialAnchorProjection),
    }),
  );
}
