import { traceCandidateKey } from './experience-candidate-correlation.util';
import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';

describe('traceCandidateKey', () => {
  const candidate = (
    orderedByEvidence: boolean,
    hints: Array<{ key: string; name: string }>,
  ): ExperienceCandidate => ({
    name: ' El Ateneo Grand Splendid  ',
    themes: ['culture'],
    traits: ['historic'],
    shortReason: 'Historical bookstore',
    evidenceKeys: ['ev-2', 'ev-1'],
    componentHints: hints.map((h) => ({
      key: h.key,
      name: h.name,
      role: 'venue' as const,
      expectedKind: 'PLACE' as const,
      evidenceKeys: ['ev-1'],
    })),
    orderedByEvidence,
  });

  it('computes deterministic key regardless of evidence key input order', () => {
    const first = candidate(false, [
      { key: 'b', name: 'Stage' },
      { key: 'a', name: 'Bookstore' },
    ]);
    const second = {
      ...first,
      evidenceKeys: ['ev-1', 'ev-2'],
    };
    expect(traceCandidateKey(first)).toBe(traceCandidateKey(second));
  });

  it('preserves hint order when orderedByEvidence is true', () => {
    const unordered = candidate(false, [
      { key: 'b', name: 'Stage' },
      { key: 'a', name: 'Bookstore' },
    ]);
    const ordered = candidate(true, [
      { key: 'b', name: 'Stage' },
      { key: 'a', name: 'Bookstore' },
    ]);
    expect(traceCandidateKey(unordered)).toBe(
      'el ateneo grand splendid:ev-1|ev-2:a:Bookstore|b:Stage',
    );
    expect(traceCandidateKey(ordered)).toBe(
      'el ateneo grand splendid:ev-1|ev-2:b:Stage|a:Bookstore',
    );
  });
});
