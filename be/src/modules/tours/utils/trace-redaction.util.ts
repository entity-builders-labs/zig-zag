const SENSITIVE_KEY =
  /(authorization|api[-_]?key|token|cookie|password|secret|credential|bearer)/i;
const SENSITIVE_VALUE =
  /bearer\s+[a-z0-9._~+/=-]+|(?:api[-_]?key|token|secret|password)\s*[:=]\s*[^\s,;&]+/gi;
const REDACTED = '[REDACTED]';

/** Returns a JSON-safe trace payload with credentials removed recursively. */
export function redactTracePayload<T>(value: T): T {
  return redact(value, new WeakSet<object>()) as T;
}

function redact(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return value.replace(SENSITIVE_VALUE, REDACTED);
  }
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    const output = value.map((entry) => redact(entry, seen));
    seen.delete(value);
    return output;
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(entry, seen);
  }
  seen.delete(value);
  return output;
}
