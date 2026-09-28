import {
  GenerationTraceV5,
  TraceDecisionStatus,
  TraceJsonValue,
  TraceStepInput,
  TraceStepV5,
} from '../interfaces/generation-trace-v5.interface';
import { GenerationTraceStep as LegacyGenerationTraceStep } from '../interfaces/generation-trace.interface';

type SerializableTraceStepInput = Omit<
  TraceStepInput,
  'input' | 'output' | 'facts' | 'rules' | 'subjects'
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
    references?: TraceStepInput['references'];
  }>;
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
  /authorization|api[-_ ]?key|cookie|token|password|secret|credential/i;

function redactText(value: string): string {
  return value
    .replace(
      /(authorization|api[-_ ]?key|token|cookie|password)\s*[:=]\s*[^\s,;]+/gi,
      '$1:[REDACTED]',
    )
    .replace(
      /([?&](?:signature|sig|x-amz-signature|x-goog-signature|access_token)=)[^&#\s]+/gi,
      '$1[REDACTED]',
    );
}

/** Converts only audit projections. Never use this in domain decision logic. */
export function sanitizeTraceValue(value: unknown, depth = 0): TraceJsonValue {
  if (value === null) return null;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    const redacted = redactText(value);
    return redacted.length <= TRACE_LIMITS.maxStringChars
      ? redacted
      : `${redacted.slice(0, TRACE_LIMITS.maxStringChars)}… [truncated ${redacted.length} chars]`;
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

export class GenerationTraceRecorder {
  private readonly steps: TraceStepV5[] = [];
  private nextSequence = 1;

  record(input: SerializableTraceStepInput): TraceStepV5 {
    if (!input.name.trim()) throw new Error('Trace step name is required');
    if (
      input.parentId &&
      !this.steps.some((step) => step.id === input.parentId)
    ) {
      throw new Error(`Trace parent ${input.parentId} has not been recorded`);
    }
    const id = input.id ?? `trace-step-${this.nextSequence}`;
    if (this.steps.some((step) => step.id === id))
      throw new Error(`Duplicate trace step id ${id}`);
    const step: TraceStepV5 = {
      ...input,
      id,
      sequence: this.nextSequence++,
      input:
        input.input === undefined ? undefined : sanitizeTraceValue(input.input),
      output:
        input.output === undefined
          ? undefined
          : sanitizeTraceValue(input.output),
      facts:
        input.facts === undefined ? undefined : sanitizeTraceValue(input.facts),
      rules: input.rules?.map((rule) => ({
        ...rule,
        status: validStatus(rule.status),
        facts:
          rule.facts === undefined ? undefined : sanitizeTraceValue(rule.facts),
      })),
      subjects: input.subjects?.map((subject) => ({
        ...subject,
        facts:
          subject.facts === undefined
            ? undefined
            : sanitizeTraceValue(subject.facts),
      })),
    };
    const serialized = JSON.stringify(step);
    if (serialized.length > TRACE_LIMITS.maxStepPayloadChars) {
      step.facts = {
        truncated: true,
        reason: 'MAX_STEP_PAYLOAD_CHARS',
        originalChars: serialized.length,
      };
      delete step.input;
      delete step.output;
    }
    this.steps.push(step);
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
      canonicalRequest:
        input.canonicalRequest === undefined
          ? undefined
          : sanitizeTraceValue(input.canonicalRequest),
      result: input.result && {
        ...input.result,
        facts:
          input.result.facts === undefined
            ? undefined
            : sanitizeTraceValue(input.result.facts),
      },
      steps: [...this.steps],
    };
  }

  /**
   * Temporary cutover projection for existing producers. It is intentionally
   * mechanical: it neither evaluates policy nor infers reasons. New producers
   * call record() directly with their typed local audit projection.
   */
  recordLegacyProjection(
    step: LegacyGenerationTraceStep,
    parentId?: string,
  ): TraceStepV5 {
    const candidates: Array<{
      id: string;
      name: string;
      status: string;
      reason?: string;
      reasonCodes?: string[];
      scoreBreakdown?: unknown;
    }> =
      step.candidateDecisions?.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        status: candidate.status,
        reason: candidate.reason,
        reasonCodes: candidate.reasonCodes,
        scoreBreakdown: candidate.scoreBreakdown,
      })) ??
      step.candidates?.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        status: candidate.chosen
          ? 'SELECTED'
          : candidate.offered
            ? 'ELIGIBLE'
            : 'REJECTED',
        reason: candidate.detail,
      })) ??
      [];
    const {
      stage,
      label,
      summary,
      inputs,
      outputs,
      rules,
      decision,
      timing,
      candidateDecisions,
      candidates: ignoredCandidates,
      component,
      status,
      ...facts
    } = step;
    void candidateDecisions;
    void ignoredCandidates;
    return this.record({
      parentId,
      name: String(stage).replace(/_/g, '.'),
      description: `${label}. ${summary}`,
      component,
      input: inputs,
      output: outputs,
      decision: decision
        ? {
            status: validStatus(decision.status),
            outcome: decision.outcome,
            reason: decision.reason,
            reasonCodes: decision.reasonCodes,
          }
        : status
          ? {
              status: validStatus(status),
              outcome: String(status),
              reason: summary,
            }
          : undefined,
      rules: rules?.map((rule) => ({
        id: rule.ruleId,
        name: rule.rule,
        status: validStatus(rule.result),
        reason: rule.reason,
        facts: {
          inputs: rule.inputs,
          expected: rule.expected,
          actual: rule.actual,
        },
      })),
      subjects: candidates.map((candidate) => ({
        subject: { kind: 'candidate', id: candidate.id, label: candidate.name },
        decision: {
          status: candidate.status === 'REJECTED' ? 'FAIL' : 'PASS',
          outcome: candidate.status,
          reason: candidate.reason,
          reasonCodes: candidate.reasonCodes,
        },
        facts: candidate.scoreBreakdown,
      })),
      facts,
      timing,
    });
  }
}
