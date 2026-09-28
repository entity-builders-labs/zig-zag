/**
 * The persisted Generation Trace envelope.  This is deliberately a
 * serialization contract: domain services keep their own typed results and
 * project a bounded audit view into JsonValue when they record a step.
 */
export type TraceJsonPrimitive = string | number | boolean | null;
export type TraceJsonValue =
  | TraceJsonPrimitive
  | TraceJsonValue[]
  | { [key: string]: TraceJsonValue };

export type TraceDecisionStatus = 'PASS' | 'FAIL' | 'WARN' | 'INFO' | 'SKIPPED';

export interface TraceDecisionV5 {
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

export interface TraceRuleV5 {
  id?: string;
  name: string;
  status: TraceDecisionStatus;
  reason?: string;
  facts?: TraceJsonValue;
}

export interface TraceSubject {
  subject: TraceReference;
  decision?: TraceDecisionV5;
  facts?: TraceJsonValue;
  references?: TraceReference[];
}

export interface TraceTimingV5 {
  startedAt?: string;
  durationMs?: number;
}

export interface TraceStepV5 {
  id: string;
  parentId?: string;
  sequence: number;
  name: string;
  description?: string;
  component?: string;
  input?: TraceJsonValue;
  output?: TraceJsonValue;
  decision?: TraceDecisionV5;
  rules?: TraceRuleV5[];
  subjects?: TraceSubject[];
  facts?: TraceJsonValue;
  references?: TraceReference[];
  timing?: TraceTimingV5;
}

export interface GenerationTraceV5 {
  version: 5;
  runtime?: { buildCommit?: string; buildTimestamp?: string };
  canonicalRequest?: TraceJsonValue;
  result?: {
    status: 'COMPLETED' | 'FAILED';
    outcome?: string;
    reason?: string;
    reasonCodes?: string[];
    facts?: TraceJsonValue;
  };
  steps: TraceStepV5[];
}

export type TraceStepInput = Omit<TraceStepV5, 'id' | 'sequence'> & {
  id?: string;
  sequence?: never;
};
