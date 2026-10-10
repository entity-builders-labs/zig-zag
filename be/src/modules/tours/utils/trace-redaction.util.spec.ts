import { redactTracePayload } from './trace-redaction.util';

describe('redactTracePayload', () => {
  it('removes Polygon and MultiPolygon coordinate arrays at every nesting level', () => {
    const trace = redactTracePayload({
      steps: [
        {
          inputs: {
            boundary: {
              type: 'Polygon',
              coordinates: [[[1, 2]]],
            },
          },
          outputs: [
            {
              geometry: {
                type: 'MultiPolygon',
                coordinates: [[[[3, 4]]]],
              },
            },
          ],
        },
      ],
    });

    const serialized = JSON.stringify(trace);
    expect(serialized).not.toContain('coordinates');
    expect((trace as any).steps[0].inputs.boundary).toEqual({
      type: 'Polygon',
    });
    expect((trace as any).steps[0].outputs[0].geometry).toEqual({
      type: 'MultiPolygon',
    });
  });

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

  it('redacts auth, API keys, tokens, DSNs, cookies and nested secrets without deleting audit evidence', () => {
    const result = redactTracePayload({
      query: 'Mendoza wine route vegan',
      evidence: [{ key: 'ev-1', source: 'official tourism board' }],
      authorization: 'Bearer top-secret',
      api_key: 'gemini-secret',
      accessToken: 'oauth-secret',
      cookie: 'session=secret-cookie',
      databaseDsn: 'postgresql://user:pass@db.example/zigzag',
      nested: {
        clientSecret: 'nested-secret',
        headers: {
          Cookie: 'sid=123',
          Accept: 'application/json',
        },
      },
    }) as any;

    expect(result.query).toBe('Mendoza wine route vegan');
    expect(result.evidence).toEqual([
      { key: 'ev-1', source: 'official tourism board' },
    ]);
    expect(result.authorization).toBe('[REDACTED]');
    expect(result.api_key).toBe('[REDACTED]');
    expect(result.accessToken).toBe('[REDACTED]');
    expect(result.cookie).toBe('[REDACTED]');
    expect(result.nested.clientSecret).toBe('[REDACTED]');
    expect(result.nested.headers.Cookie).toBe('[REDACTED]');
    expect(result.nested.headers.Accept).toBe('application/json');

    // DSNs are credentials even when the property name is not literally
    // "password". This assertion prevents Bitácora from leaking connection
    // strings through arbitrary provider/config objects.
    expect(result.databaseDsn).toBe('[REDACTED]');
  });
});
