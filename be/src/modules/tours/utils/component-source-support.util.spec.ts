import { verifyTextualComponentSourceSupport } from './component-source-support.util';

describe('verifyTextualComponentSourceSupport', () => {
  it('accepts a supportSpan found only in the cited evidence record title, not its snippet', () => {
    const result = verifyTextualComponentSourceSupport(
      'Plaza Dorrego Antiques Fair',
      ['ev-1'],
      new Map([
        [
          'ev-1',
          {
            title: 'Plaza Dorrego Antiques Fair',
            text: 'A Sunday market in San Telmo.',
          },
        ],
      ]),
    );
    expect(result).toEqual({ supported: true });
  });

  it('accepts a supportSpan found only in the cited evidence record snippet, not its title', () => {
    const result = verifyTextualComponentSourceSupport(
      'Plaza Dorrego hosts a Sunday antiques fair',
      ['ev-1'],
      new Map([
        [
          'ev-1',
          {
            title: 'San Telmo Market Guide',
            text: 'Plaza Dorrego hosts a Sunday antiques fair.',
          },
        ],
      ]),
    );
    expect(result).toEqual({ supported: true });
  });

  it('rejects a supportSpan that is real text (title or snippet) but only from a DIFFERENT, uncited evidence record', () => {
    const result = verifyTextualComponentSourceSupport(
      'Lezama Park anchors the southern end',
      ['ev-1'],
      new Map([
        [
          'ev-1',
          {
            title: 'Calle Defensa',
            text: 'A cobblestone street in San Telmo.',
          },
        ],
        [
          'ev-2',
          {
            title: 'Lezama Park',
            text: 'Lezama Park anchors the southern end of the walk.',
          },
        ],
      ]),
    );
    expect(result).toEqual({
      supported: false,
      reason: 'SPAN_NOT_FOUND_IN_CITED_EVIDENCE',
    });
  });

  it('rejects a missing supportSpan', () => {
    const result = verifyTextualComponentSourceSupport(
      undefined,
      ['ev-1'],
      new Map([
        ['ev-1', { title: 'Plaza', text: 'The Plaza is the main square.' }],
      ]),
    );
    expect(result).toEqual({ supported: false, reason: 'NO_SUPPORT_SPAN' });
  });

  it('rejects when the cited evidence key has neither title nor snippet text', () => {
    const result = verifyTextualComponentSourceSupport(
      'Plaza',
      ['ev-1'],
      new Map([['ev-1', { text: '' }]]),
    );
    expect(result).toEqual({
      supported: false,
      reason: 'MISSING_EVIDENCE_TEXT',
    });
  });
});
