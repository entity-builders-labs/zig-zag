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
    expect(result).toEqual({
      supported: true,
      verifiedSupportSpan: 'Plaza Dorrego Antiques Fair',
    });
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
    expect(result).toEqual({
      supported: true,
      verifiedSupportSpan: 'Plaza Dorrego hosts a Sunday antiques fair',
    });
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

  it('verifies support spans across inline markdown formatting in rich source content', () => {
    const result = verifyTextualComponentSourceSupport(
      'We will explore the famous Caminito street and its historic tin tenements',
      ['ev-1'],
      new Map([
        [
          'ev-1',
          {
            text: '* **Identity and color:** We will explore the famous **Caminito street and its historic tin tenements** , painted with those vibrant colors.',
          },
        ],
      ]),
    );
    expect(result.supported).toBe(true);
    if (result.supported) {
      expect(result.verifiedSupportSpan).toContain('Caminito street');
    }
  });

  it('verifies support spans when markdown delimiter directly touches words without whitespace', () => {
    const result = verifyTextualComponentSourceSupport(
      'We will walk the famous little street Caminito',
      ['ev-1'],
      new Map([
        [
          'ev-1',
          {
            text: 'We will walk the**famous little street Caminito**, full of the colorful collective houses',
          },
        ],
      ]),
    );
    expect(result.supported).toBe(true);
    if (result.supported) {
      expect(result.verifiedSupportSpan).toBe(
        'We will walk the**famous little street Caminito',
      );
    }
  });

  it('verifies support spans when markdown delimiter directly touches punctuation like bold followed by colon', () => {
    const result = verifyTextualComponentSourceSupport(
      'Featured wineries: López (1898), Trapiche, Familia Zuccardi, Norton, Rutini, Tempus Alba',
      ['ev-1'],
      new Map([
        [
          'ev-1',
          {
            text: '* **Featured wineries**: López (1898), Trapiche, Familia Zuccardi, Norton, Rutini, Tempus Alba',
          },
        ],
      ]),
    );
    expect(result.supported).toBe(true);
  });
});
