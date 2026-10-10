/** Client representation of the generic persisted Generation Trace v5. */
export type TraceJsonValue =
  | string
  | number
  | boolean
  | null
  | TraceJsonValue[]
  | { [key: string]: TraceJsonValue };
export type TraceDecisionStatus = "PASS" | "FAIL" | "WARN" | "INFO" | "SKIPPED";
export interface TraceDecision {
  status: TraceDecisionStatus;
  outcome: string;
  reason?: string;
  reasonCodes?: string[];
}
export interface TraceReference {
  kind: string;
  id: string;
  label?: string;
  url?: string;
}
export interface TraceRule {
  id?: string;
  name: string;
  status: TraceDecisionStatus;
  reason?: string;
  facts?: TraceJsonValue;
}
export interface TraceSubject {
  subject: TraceReference;
  decision?: TraceDecision;
  facts?: TraceJsonValue;
  references?: TraceReference[];
}
export interface GenerationTraceStep {
  id: string;
  parentId?: string;
  sequence: number;
  name: string;
  description?: string;
  component?: string;
  input?: TraceJsonValue;
  output?: TraceJsonValue;
  decision?: TraceDecision;
  rules?: TraceRule[];
  subjects?: TraceSubject[];
  facts?: TraceJsonValue;
  references?: TraceReference[];
  timing?: { startedAt?: string; durationMs?: number };
}
export interface GenerationTrace {
  version: 5;
  runtime?: { buildCommit?: string; buildTimestamp?: string };
  canonicalRequest?: TraceJsonValue;
  result?: {
    status: "COMPLETED" | "FAILED";
    outcome?: string;
    reason?: string;
    reasonCodes?: string[];
    facts?: TraceJsonValue;
  };
  steps: GenerationTraceStep[];
}

/** Boundary guard: the native Bitácora deliberately supports v5 only. */
export function isGenerationTraceV5(value: unknown): value is GenerationTrace {
  if (!value || typeof value !== "object") return false;
  const trace = value as { version?: unknown; steps?: unknown };
  return (
    trace.version === 5 &&
    Array.isArray(trace.steps) &&
    trace.steps.every(
      (step) =>
        !!step &&
        typeof step === "object" &&
        typeof (step as { id?: unknown }).id === "string" &&
        typeof (step as { sequence?: unknown }).sequence === "number" &&
        typeof (step as { name?: unknown }).name === "string",
    )
  );
}
