import {
  GenerationTraceRecorder,
  TRACE_LIMITS,
} from './generation-trace-recorder.util';

describe('GenerationTraceRecorder', () => {
  it('records open-ended nested steps with monotonic sequence', () => {
    const recorder = new GenerationTraceRecorder();
    const parent = recorder.record({ name: 'acquisition.pass' });
    const child = recorder.record({
      parentId: parent.id,
      name: 'researcher.fetch_web_source',
      decision: {
        status: 'PASS',
        outcome: 'FETCHED',
        reasonCodes: ['GROUNDED'],
      },
      references: [
        { kind: 'source_url', id: 'https://example.test/a', label: 'A' },
      ],
      facts: { contentChars: 42 },
    });
    const trace = recorder.build({ result: { status: 'COMPLETED' } });
    expect(trace.version).toBe(5);
    expect(child.sequence).toBeGreaterThan(parent.sequence);
    expect(child.parentId).toBe(parent.id);
    expect(trace.steps[1].name).toBe('researcher.fetch_web_source');
  });

  it('redacts secrets and bounds untrusted payloads centrally', () => {
    const recorder = new GenerationTraceRecorder();
    const step = recorder.record({
      name: 'classification.semantic',
      facts: {
        authorization: 'Bearer secret',
        url: 'https://x.test?a=1&signature=private',
        signedUrl:
          'https://bucket.test/object?X-Amz-Credential=signed-credential',
        tokenText: 'token=secret',
      },
    });
    expect(JSON.stringify(step)).not.toContain('Bearer secret');
    expect(JSON.stringify(step)).not.toContain('signature=private');
    expect(JSON.stringify(step)).not.toContain('token=secret');
    expect(JSON.stringify(step)).not.toContain('signed-credential');
  });

  it('preserves benign keys like database and connection while redacting sensitive variants', () => {
    const recorder = new GenerationTraceRecorder();
    const step = recorder.record({
      name: 'database.check',
      facts: {
        database: 'postgres',
        connection: 'direct',
        databaseUrl: 'postgres://user:pass@localhost:5432/app',
        connectionString: 'Server=myServerAddress;Database=myDataBase;',
        db_url: 'postgres://secret@host/db',
      },
    });
    const facts = step.facts as Record<string, unknown>;
    expect(facts.database).toBe('postgres');
    expect(facts.connection).toBe('direct');
    expect(facts.databaseUrl).toBe('[REDACTED]');
    expect(facts.connectionString).toBe('[REDACTED]');
    expect(facts.db_url).toBe('[REDACTED]');
  });

  it('redacts secrets in every persisted v5 string boundary', () => {
    const recorder = new GenerationTraceRecorder();
    const step = recorder.record({
      name: 'Bearer name-secret',
      description: 'password=description-secret',
      component: 'postgres://user:connection-secret@db.test/app',
      decision: {
        status: 'WARN',
        outcome: 'token=outcome-secret',
        reason: 'Authorization: Bearer reason-secret',
        reasonCodes: ['cookie=code-secret'],
      },
      rules: [
        {
          id: 'api_key=rule-id-secret',
          name: 'secret=rule-name',
          status: 'WARN',
          reason: 'credentials=rule-secret',
          facts: { token: 'facts-secret' },
        },
      ],
      subjects: [
        {
          subject: {
            kind: 'authorization=subject-kind-secret',
            id: 'Bearer subject-id-secret',
            label: 'password=subject-label-secret',
            url: 'https://x.test/?access_token=subject-url-secret',
          },
          decision: { status: 'WARN', outcome: 'secret=subject-outcome' },
          references: [
            {
              kind: 'token=related-kind',
              id: 'cookie=related-id',
              url: 'redis://:related-secret@localhost:6379/0',
            },
          ],
        },
      ],
      references: [
        {
          kind: 'credential=reference-kind',
          id: 'Bearer reference-id-secret',
          label: 'secret=reference-label',
          url: 'https://x.test/?sig=reference-url-secret',
        },
      ],
      timing: { startedAt: 'token=started-at-secret' },
    });
    const trace = recorder.build({
      runtime: { buildCommit: 'Authorization: Bearer runtime-secret' },
      result: {
        status: 'FAILED',
        outcome: 'token=result-outcome',
        reason: 'mongodb://user:result-secret@db.test/app',
        reasonCodes: ['password=result-code'],
        facts: { credential: 'result-facts-secret' },
      },
    });
    const serialized = JSON.stringify({ step, trace });
    for (const secret of [
      'name-secret',
      'description-secret',
      'connection-secret',
      'outcome-secret',
      'reason-secret',
      'code-secret',
      'rule-secret',
      'subject-id-secret',
      'subject-url-secret',
      'related-secret',
      'reference-id-secret',
      'reference-url-secret',
      'started-at-secret',
      'runtime-secret',
      'result-secret',
      'result-code',
      'result-facts-secret',
    ])
      expect(serialized).not.toContain(secret);
  });

  it('enforces the hard step ceiling while preserving its decision', () => {
    const recorder = new GenerationTraceRecorder();
    const step = recorder.record({
      name: 'oversized.audit',
      decision: {
        status: 'WARN',
        outcome: 'DEGRADED',
        reason: 'useful reason',
      },
      description: 'd'.repeat(8_000),
      facts: { payload: 'f'.repeat(8_000) },
      input: { payload: 'i'.repeat(8_000) },
      output: { payload: 'o'.repeat(8_000) },
      subjects: Array.from({ length: 100 }, (_, index) => ({
        subject: {
          kind: 'candidate',
          id: `candidate-${index}`,
          label: 'l'.repeat(8_000),
        },
        facts: { payload: 's'.repeat(8_000) },
      })),
      rules: Array.from({ length: 100 }, (_, index) => ({
        id: `rule-${index}`,
        name: 'r'.repeat(8_000),
        status: 'WARN' as const,
        facts: { payload: 'r'.repeat(8_000) },
      })),
    });
    expect(JSON.stringify(step).length).toBeLessThanOrEqual(
      TRACE_LIMITS.maxStepPayloadChars,
    );
    expect(step.decision).toMatchObject({
      outcome: 'DEGRADED',
      reason: 'useful reason',
    });
    expect(step.facts).toMatchObject({
      truncated: true,
      reason: 'MAX_STEP_PAYLOAD_CHARS',
    });
  });

  it('rejects invalid parents and duplicate ids', () => {
    const recorder = new GenerationTraceRecorder();
    expect(() => recorder.record({ name: 'x', parentId: 'missing' })).toThrow(
      'parent',
    );
    recorder.record({ id: 'same', name: 'x' });
    expect(() => recorder.record({ id: 'same', name: 'y' })).toThrow(
      'Duplicate',
    );
  });
});
