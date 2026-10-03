import {
  GenerationTraceV5,
  TraceDecisionStatus,
  TraceJsonValue,
  TraceStepInput,
  TraceStepV5,
} from '../interfaces/generation-trace-v5.interface';

export type SerializableTraceStepInput = Omit<
  TraceStepInput,
  'input' | 'output' | 'facts' | 'rules' | 'subjects' | 'references' | 'timing'
> & {
  input?: unknown;
  output?: unknown;
  facts?: unknown;
  rules?: Array<{
    id?: string;
    name: string;
    status: TraceDecisionStatus;
    reason?: string;
    facts?: unknown;
  }>;
  subjects?: Array<{
    subject: { kind: string; id: string; label?: string; url?: string };
    decision?: TraceStepInput['decision'];
    facts?: unknown;
    references?: Array<{
      kind: string;
      id: string;
      label?: string;
      url?: string;
    }>;
  }>;
  references?: Array<{
    kind: string;
    id: string;
    label?: string;
    url?: string;
  }>;
  timing?: { startedAt?: string; durationMs?: number };
};

/** Safety ceiling for every persisted trace, regardless of producer. */
export const TRACE_LIMITS = {
  maxStringChars: 8_000,
  maxArrayItems: 100,
  maxObjectKeys: 100,
  maxDepth: 8,
  maxStepPayloadChars: 48_000,
} as const;

const SECRET_KEY =
  /authorization|api[-_ ]?key|cookie|token|password|secrets?|credentials?|dsn|connection[-_ ]?strings?|(?:db|database)[-_ ]?urls?/i;

/** Shared text safety primitive for every persisted trace projection. */
export function redactTraceText(value: string): string {
  return value
    .replace(
      /(authorization|api[-_ ]?key|token|cookie|password|secrets?|credentials?|dsn|connection[-_ ]?strings?|(?:db|database)[-_ ]?urls?)\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/gi,
      '$1:[REDACTED]',
    )
    .replace(
      /([?&](?:signature|sig|x-amz-signature|x-goog-signature|x-amz-credential|x-goog-credential|x-amz-security-token|access_token|token|api[-_ ]?key|credential|policy|key-pair-id)=)[^&#\s]+/gi,
      '$1[REDACTED]',
    )
    .replace(
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s'"<>]+/gi,
      '[REDACTED_CONNECTION_URL]',
    )
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]');
}

function sanitizeTraceText(
  value: string,
  maxChars: number = TRACE_LIMITS.maxStringChars,
): string {
  const redacted = redactTraceText(value);
  return redacted.length <= maxChars
    ? redacted
    : `${redacted.slice(0, maxChars)}… [truncated ${redacted.length} chars]`;
}

function sanitizeReference(reference: {
  kind: string;
  id: string;
  label?: string;
  url?: string;
}) {
  return {
    kind: sanitizeTraceText(reference.kind),
    id: sanitizeTraceText(reference.id),
    ...(reference.label === undefined
      ? {}
      : { label: sanitizeTraceText(reference.label) }),
    ...(reference.url === undefined
      ? {}
      : { url: sanitizeTraceText(reference.url) }),
  };
}

function sanitizeDecision(decision: TraceStepInput['decision']) {
  if (!decision) return undefined;
  return {
    status: validStatus(decision.status),
    outcome: sanitizeTraceText(decision.outcome),
    ...(decision.reason === undefined
      ? {}
      : { reason: sanitizeTraceText(decision.reason) }),
    ...(decision.reasonCodes === undefined
      ? {}
      : {
          reasonCodes: decision.reasonCodes.map((code) =>
            sanitizeTraceText(code),
          ),
        }),
  };
}

/** Converts only audit projections. Never use this in domain decision logic. */
export function sanitizeTraceValue(value: unknown, depth = 0): TraceJsonValue {
  if (value === null) return null;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    return sanitizeTraceText(value);
  }
  if (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint'
  )
    return String(value);
  if (depth >= TRACE_LIMITS.maxDepth)
    return { truncated: true, reason: 'MAX_DEPTH' };
  if (Array.isArray(value)) {
    const items = value
      .slice(0, TRACE_LIMITS.maxArrayItems)
      .map((item) => sanitizeTraceValue(item, depth + 1));
    if (value.length > items.length)
      items.push(
        sanitizeTraceValue(
          { truncated: true, originalItems: value.length },
          depth + 1,
        ),
      );
    return items;
  }
  if (typeof value === 'object') {
    const result: { [key: string]: TraceJsonValue } = {};
    const entries = Object.entries(value as object).slice(
      0,
      TRACE_LIMITS.maxObjectKeys,
    );
    for (const [key, item] of entries) {
      result[key] = SECRET_KEY.test(key)
        ? '[REDACTED]'
        : sanitizeTraceValue(item, depth + 1);
    }
    if (Object.keys(value as object).length > entries.length)
      result.truncated = true;
    return result;
  }
  return String(value);
}

function validStatus(value: unknown): TraceDecisionStatus {
  return value === 'PASS' ||
    value === 'FAIL' ||
    value === 'WARN' ||
    value === 'INFO' ||
    value === 'SKIPPED'
    ? value
    : 'INFO';
}

export interface TraceRecorderCheckpoint {
  readonly stepCount: number;
  readonly nextSequence: number;
  readonly recordedIds: ReadonlyMap<string, string>;
}

export class GenerationTraceRecorder {
  private readonly steps: TraceStepV5[] = [];
  private readonly recordedIds = new Map<string, string>();
  private nextSequence = 1;

  checkpoint(): TraceRecorderCheckpoint {
    return {
      stepCount: this.steps.length,
      nextSequence: this.nextSequence,
      recordedIds: new Map(this.recordedIds),
    };
  }

  rollback(checkpoint: TraceRecorderCheckpoint): void {
    if (
      !checkpoint ||
      typeof checkpoint.stepCount !== 'number' ||
      typeof checkpoint.nextSequence !== 'number' ||
      !checkpoint.recordedIds
    ) {
      throw new Error('Invalid trace recorder checkpoint');
    }
    if (checkpoint.stepCount > this.steps.length) {
      throw new Error('Checkpoint step count cannot exceed current step count');
    }
    this.steps.length = checkpoint.stepCount;
    this.nextSequence = checkpoint.nextSequence;
    this.recordedIds.clear();
    if (checkpoint.recordedIds instanceof Map) {
      for (const [key, value] of checkpoint.recordedIds) {
        this.recordedIds.set(key, value);
      }
    } else if (Symbol.iterator in Object(checkpoint.recordedIds)) {
      for (const [key, value] of checkpoint.recordedIds as Iterable<
        [string, string]
      >) {
        this.recordedIds.set(key, value);
      }
    }
  }

  hasStep(id: string): boolean {
    const sanitized = sanitizeTraceText(id);
    return this.steps.some((step) => step.id === sanitized);
  }

  record(input: SerializableTraceStepInput): TraceStepV5 {
    if (!input.name.trim()) throw new Error('Trace step name is required');
    const parentId = input.parentId
      ? (this.recordedIds.get(input.parentId) ??
        sanitizeTraceText(input.parentId))
      : undefined;
    if (parentId && !this.steps.some((step) => step.id === parentId)) {
      throw new Error(`Trace parent ${input.parentId} has not been recorded`);
    }
    const rawId = input.id ?? `trace-step-${this.nextSequence}`;
    const id = sanitizeTraceText(rawId);
    if (this.steps.some((step) => step.id === id))
      throw new Error(`Duplicate trace step id ${id}`);
    const step: TraceStepV5 = {
      id,
      ...(parentId ? { parentId } : {}),
      sequence: this.nextSequence++,
      name: sanitizeTraceText(input.name),
      ...(input.description === undefined
        ? {}
        : { description: sanitizeTraceText(input.description) }),
      ...(input.component === undefined
        ? {}
        : { component: sanitizeTraceText(input.component) }),
      input:
        input.input === undefined ? undefined : sanitizeTraceValue(input.input),
      output:
        input.output === undefined
          ? undefined
          : sanitizeTraceValue(input.output),
      facts:
        input.facts === undefined ? undefined : sanitizeTraceValue(input.facts),
      rules: input.rules?.map((rule) => ({
        ...(rule.id === undefined ? {} : { id: sanitizeTraceText(rule.id) }),
        name: sanitizeTraceText(rule.name),
        status: validStatus(rule.status),
        ...(rule.reason === undefined
          ? {}
          : { reason: sanitizeTraceText(rule.reason) }),
        facts:
          rule.facts === undefined ? undefined : sanitizeTraceValue(rule.facts),
      })),
      subjects: input.subjects?.map((subject) => ({
        subject: sanitizeReference(subject.subject),
        decision: sanitizeDecision(subject.decision),
        facts:
          subject.facts === undefined
            ? undefined
            : sanitizeTraceValue(subject.facts),
        references: subject.references?.map(sanitizeReference),
      })),
      decision: sanitizeDecision(input.decision),
      references: input.references?.map(sanitizeReference),
      timing: input.timing && {
        ...(input.timing.startedAt === undefined
          ? {}
          : { startedAt: sanitizeTraceText(input.timing.startedAt) }),
        ...(input.timing.durationMs === undefined
          ? {}
          : { durationMs: input.timing.durationMs }),
      },
    };
    this.enforceStepPayloadLimit(step);
    this.steps.push(step);
    this.recordedIds.set(rawId, id);
    return step;
  }

  build(
    input: Omit<
      GenerationTraceV5,
      'version' | 'steps' | 'canonicalRequest' | 'result'
    > & {
      canonicalRequest?: unknown;
      result?: Omit<NonNullable<GenerationTraceV5['result']>, 'facts'> & {
        facts?: unknown;
      };
    },
  ): GenerationTraceV5 {
    return {
      version: 5,
      ...input,
      runtime: input.runtime && {
        ...(input.runtime.buildCommit === undefined
          ? {}
          : { buildCommit: sanitizeTraceText(input.runtime.buildCommit) }),
        ...(input.runtime.buildTimestamp === undefined
          ? {}
          : {
              buildTimestamp: sanitizeTraceText(input.runtime.buildTimestamp),
            }),
      },
      canonicalRequest:
        input.canonicalRequest === undefined
          ? undefined
          : sanitizeTraceValue(input.canonicalRequest),
      result: input.result && {
        status: input.result.status,
        ...(input.result.outcome === undefined
          ? {}
          : { outcome: sanitizeTraceText(input.result.outcome) }),
        ...(input.result.reason === undefined
          ? {}
          : { reason: sanitizeTraceText(input.result.reason) }),
        ...(input.result.reasonCodes === undefined
          ? {}
          : {
              reasonCodes: input.result.reasonCodes.map((code) =>
                sanitizeTraceText(code),
              ),
            }),
        facts:
          input.result.facts === undefined
            ? undefined
            : sanitizeTraceValue(input.result.facts),
      },
      steps: [...this.steps],
    };
  }

  private enforceStepPayloadLimit(step: TraceStepV5): void {
    const originalChars = JSON.stringify(step).length;
    if (originalChars <= TRACE_LIMITS.maxStepPayloadChars) return;

    const marker = {
      truncated: true,
      reason: 'MAX_STEP_PAYLOAD_CHARS',
      originalChars,
    };
    // Keep decision and provenance identities first; audit payloads are the bulk data.
    step.input = marker;
    step.output = marker;
    step.facts = marker;
    step.rules = step.rules?.map((rule) => ({ ...rule, facts: marker }));
    step.subjects = step.subjects?.map((subject) => ({
      ...subject,
      facts: marker,
    }));

    while (
      JSON.stringify(step).length > TRACE_LIMITS.maxStepPayloadChars &&
      ((step.subjects?.length ?? 0) > 0 ||
        (step.rules?.length ?? 0) > 0 ||
        (step.references?.length ?? 0) > 0)
    ) {
      if ((step.subjects?.length ?? 0) > 0) step.subjects!.pop();
      else if ((step.rules?.length ?? 0) > 0) step.rules!.pop();
      else step.references!.pop();
    }

    if (JSON.stringify(step).length <= TRACE_LIMITS.maxStepPayloadChars) return;
    // Last resort for pathological scalar fields: retain structural correlation,
    // names and the decision, but bound their presentation text deterministically.
    step.name = sanitizeTraceText(step.name, 512);
    if (step.description)
      step.description = sanitizeTraceText(step.description, 512);
    if (step.component) step.component = sanitizeTraceText(step.component, 512);
    if (step.decision) {
      step.decision.outcome = sanitizeTraceText(step.decision.outcome, 512);
      if (step.decision.reason)
        step.decision.reason = sanitizeTraceText(step.decision.reason, 2_048);
      step.decision.reasonCodes = step.decision.reasonCodes
        ?.slice(0, 20)
        .map((code) => sanitizeTraceText(code, 256));
    }
  }
}
