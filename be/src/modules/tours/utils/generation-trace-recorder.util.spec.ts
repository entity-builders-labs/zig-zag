import { GenerationTraceRecorder } from './generation-trace-recorder.util';

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
        tokenText: 'token=secret',
      },
    });
    expect(JSON.stringify(step)).not.toContain('Bearer secret');
    expect(JSON.stringify(step)).not.toContain('signature=private');
    expect(JSON.stringify(step)).not.toContain('token=secret');
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
