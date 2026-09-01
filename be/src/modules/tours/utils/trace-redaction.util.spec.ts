import { redactTracePayload } from './trace-redaction.util';

describe('redactTracePayload', () => {
  it('redacts sensitive keys recursively while preserving useful trace data', () => {
    const result = redactTracePayload({
      provider: 'tavily',
      query: 'things to do',
      headers: { Authorization: 'Bearer abc123', Accept: 'json' },
      config: { apiKey: 'secret-key', timeoutMs: 1000 },
      nested: [{ token: 'xyz', snippet: 'safe evidence' }],
    });

    expect(result).toEqual({
      provider: 'tavily',
      query: 'things to do',
      headers: { Authorization: '[REDACTED]', Accept: 'json' },
      config: { apiKey: '[REDACTED]', timeoutMs: 1000 },
      nested: [{ token: '[REDACTED]', snippet: 'safe evidence' }],
    });
  });

  it('redacts credentials embedded in free-form strings and cycles', () => {
    const payload: Record<string, unknown> = {
      error: 'Authorization: Bearer abc123 api_key=hidden',
    };
    payload.self = payload;

    expect(redactTracePayload(payload)).toEqual({
      error: 'Authorization: [REDACTED] [REDACTED]',
      self: '[Circular]',
    });
  });
});
