export interface GenerationFailureClassification {
  retryable: boolean;
  reasonCode:
    | 'HTTP_TRANSIENT'
    | 'NETWORK_TRANSIENT'
    | 'TIMEOUT'
    | 'RATE_LIMITED'
    | 'PROVIDER_TRANSIENT'
    | 'TERMINAL';
  message: string;
}

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'RATE_LIMITED',
]);

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as any).message);
  }
  return String(error ?? 'unknown generation error');
}

function nestedValues(error: any): { statuses: number[]; codes: string[] } {
  const candidates = [error, error?.cause, error?.originalError];
  const statuses = candidates
    .flatMap((candidate) => [
      candidate?.status,
      candidate?.statusCode,
      candidate?.response?.status,
    ])
    .map(Number)
    .filter(Number.isFinite);
  const codes = candidates
    .flatMap((candidate) => [candidate?.code, candidate?.response?.data?.code])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.toUpperCase());
  return { statuses, codes };
}

function traceContainsProviderFailure(metadata: any): boolean {
  const steps = metadata?.generationTrace?.steps;
  if (!Array.isArray(steps)) return false;
  return steps.some((step: any) => {
    if (step?.providerStatus === 'failed') return true;
    if (
      step?.grounding?.status === 'failed' ||
      step?.grounding?.status === 'unavailable'
    ) {
      return true;
    }
    if (
      step?.degradedReason &&
      /provider|timeout|rate|429|5\d\d/i.test(String(step.degradedReason))
    ) {
      return true;
    }
    const serialized = JSON.stringify({
      searchTrace: step?.searchTrace,
      extractionTrace: step?.extractionTrace,
      error: step?.error,
    });
    return /provider_error|rate.?limit|timeout|timed out|429|502|503|504|ECONNRESET|EAI_AGAIN/i.test(
      serialized,
    );
  });
}

/**
 * One central boundary for retry semantics. Domain/validation/planning errors
 * are terminal by default. Only recognizable transient infrastructure/provider
 * failures are retried; callers must never scatter string checks around the
 * generation pipeline.
 */
export function classifyGenerationFailure(
  error: unknown,
  latestTourMetadata?: unknown,
): GenerationFailureClassification {
  const message = errorMessage(error);

  // An explicit `retryable` flag set by the code that threw the error is
  // authoritative — it knows whether *this specific* failure was actually
  // provider-caused, unlike the whole-trace text scan below, which cannot
  // distinguish that from an unrelated earlier sub-step (e.g. a Groq 429
  // during preference interpretation) that already degraded gracefully and
  // has nothing to do with why generation ultimately failed.
  if (
    error &&
    typeof error === 'object' &&
    'retryable' in error &&
    typeof (error as any).retryable === 'boolean'
  ) {
    const retryable = (error as any).retryable as boolean;
    return {
      retryable,
      reasonCode: retryable ? 'PROVIDER_TRANSIENT' : 'TERMINAL',
      message,
    };
  }

  const { statuses, codes } = nestedValues(error as any);

  if (statuses.some((status) => status === 429)) {
    return { retryable: true, reasonCode: 'RATE_LIMITED', message };
  }
  if (statuses.some((status) => RETRYABLE_HTTP_STATUSES.has(status))) {
    return { retryable: true, reasonCode: 'HTTP_TRANSIENT', message };
  }
  if (codes.some((code) => RETRYABLE_CODES.has(code))) {
    return { retryable: true, reasonCode: 'NETWORK_TRANSIENT', message };
  }
  if (
    /\b429\b|rate.?limit|limit[oó] temporalmente|too many requests/i.test(
      message,
    )
  ) {
    return { retryable: true, reasonCode: 'RATE_LIMITED', message };
  }
  if (/timeout|timed out|tiempo de espera|ETIMEDOUT/i.test(message)) {
    return { retryable: true, reasonCode: 'TIMEOUT', message };
  }
  if (
    /ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|network (error|down)|socket hang up/i.test(
      message,
    )
  ) {
    return { retryable: true, reasonCode: 'NETWORK_TRANSIENT', message };
  }
  if (
    /\b(502|503|504)\b|temporarily unavailable|service unavailable/i.test(
      message,
    )
  ) {
    return { retryable: true, reasonCode: 'HTTP_TRANSIENT', message };
  }
  if (traceContainsProviderFailure(latestTourMetadata)) {
    return { retryable: true, reasonCode: 'PROVIDER_TRANSIENT', message };
  }

  return { retryable: false, reasonCode: 'TERMINAL', message };
}
