import { verifyTextualComponentSourceSupport } from './component-source-support.util';
import { SOURCE_EXCERPT_SEPARATOR } from './source-content-windowing.util';

describe('verifyTextualComponentSourceSupport', () => {
  it('accepts a supportSpan found only in the cited evidence record title, not its snippet (DECLARED_KEY_VERIFIED)', () => {
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
      declaredEvidenceKeys: ['ev-1'],
      verifiedEvidenceKeys: ['ev-1'],
      attributionStatus: 'DECLARED_KEY_VERIFIED',
    });
  });

  it('accepts a supportSpan found only in the cited evidence record snippet, not its title (DECLARED_KEY_VERIFIED)', () => {
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
      declaredEvidenceKeys: ['ev-1'],
      verifiedEvidenceKeys: ['ev-1'],
      attributionStatus: 'DECLARED_KEY_VERIFIED',
    });
  });

  it('re-attributes when declared key misses but exactly one other active evidence item contains exact span (REATTRIBUTED_UNIQUE_EXACT_SPAN)', () => {
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
      supported: true,
      verifiedSupportSpan: 'Lezama Park anchors the southern end',
      declaredEvidenceKeys: ['ev-1'],
      verifiedEvidenceKeys: ['ev-2'],
      attributionStatus: 'REATTRIBUTED_UNIQUE_EXACT_SPAN',
    });
  });

  it('rejects a supportSpan that exists in zero active evidence items (NO_SUPPORTING_EVIDENCE)', () => {
    const result = verifyTextualComponentSourceSupport(
      'Non-existent park in the neighborhood',
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
      declaredEvidenceKeys: ['ev-1'],
      verifiedEvidenceKeys: [],
      attributionStatus: 'NO_SUPPORTING_EVIDENCE',
    });
  });

  it('fails closed as ambiguous when supportSpan exists in two active evidence items (AMBIGUOUS_SUPPORTING_EVIDENCE)', () => {
    const result = verifyTextualComponentSourceSupport(
      'Historic colonial architecture',
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
            title: 'San Telmo Guide',
            text: 'Admire the historic colonial architecture throughout the area.',
          },
        ],
        [
          'ev-3',
          {
            title: 'Montserrat Walk',
            text: 'Features historic colonial architecture from the 18th century.',
          },
        ],
      ]),
    );
    expect(result).toEqual({
      supported: false,
      reason: 'AMBIGUOUS_SUPPORTING_EVIDENCE',
      declaredEvidenceKeys: ['ev-1'],
      verifiedEvidenceKeys: [],
      attributionStatus: 'AMBIGUOUS_SUPPORTING_EVIDENCE',
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
    expect(result).toEqual({
      supported: false,
      reason: 'NO_SUPPORT_SPAN',
      declaredEvidenceKeys: ['ev-1'],
      verifiedEvidenceKeys: [],
      attributionStatus: 'NO_SUPPORTING_EVIDENCE',
    });
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
      declaredEvidenceKeys: ['ev-1'],
      verifiedEvidenceKeys: [],
      attributionStatus: 'NO_SUPPORTING_EVIDENCE',
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

  it('re-attributes support spans across markdown and whitespace formatting in uncited active evidence item', () => {
    const result = verifyTextualComponentSourceSupport(
      'Caminito street and its historic tin tenements',
      ['ev-1'],
      new Map([
        [
          'ev-1',
          {
            title: 'Other Place',
            text: 'Unrelated snippet text.',
          },
        ],
        [
          'ev-2',
          {
            text: '* **Identity and color:** We will explore the famous **Caminito street and its historic tin tenements** , painted with those vibrant colors.',
          },
        ],
      ]),
    );
    expect(result).toMatchObject({
      supported: true,
      declaredEvidenceKeys: ['ev-1'],
      verifiedEvidenceKeys: ['ev-2'],
      attributionStatus: 'REATTRIBUTED_UNIQUE_EXACT_SPAN',
    });
    if (result.supported) {
      expect(result.verifiedSupportSpan).toContain('Caminito street');
    }
  });

  it('verifies support spans across inline markdown links in rich source content (canonical live regression)', () => {
    const result = verifyTextualComponentSourceSupport(
      'Casa Tano is an urban winery run from an old chassis and paint shop',
      ['ev-1'],
      new Map([
        [
          'ev-1',
          {
            text: '[Casa Tano](https://www.instagram.com/casa_tano/?hl=es) is an urban winery run from an old chassis and paint shop that used to belong to the family of one of the partners.',
          },
        ],
      ]),
    );
    expect(result).toEqual({
      supported: true,
      verifiedSupportSpan:
        '[Casa Tano](https://www.instagram.com/casa_tano/?hl=es) is an urban winery run from an old chassis and paint shop',
      declaredEvidenceKeys: ['ev-1'],
      verifiedEvidenceKeys: ['ev-1'],
      attributionStatus: 'DECLARED_KEY_VERIFIED',
    });
  });

  it('verifies exact match between markdown inline link and plain support span', () => {
    const result = verifyTextualComponentSourceSupport(
      'Casa Tano is an urban winery',
      ['ev-1'],
      new Map([
        [
          'ev-1',
          {
            text: '[Casa Tano](https://example.com) is an urban winery',
          },
        ],
      ]),
    );
    expect(result).toMatchObject({
      supported: true,
      attributionStatus: 'DECLARED_KEY_VERIFIED',
      verifiedEvidenceKeys: ['ev-1'],
    });
  });

  it('fails closed when factual continuation differs from markdown link source', () => {
    const result = verifyTextualComponentSourceSupport(
      'Casa Tano is a hotel',
      ['ev-1'],
      new Map([
        [
          'ev-1',
          {
            text: '[Casa Tano](https://example.com) is an urban winery',
          },
        ],
      ]),
    );
    expect(result).toMatchObject({
      supported: false,
      reason: 'SPAN_NOT_FOUND_IN_CITED_EVIDENCE',
      attributionStatus: 'NO_SUPPORTING_EVIDENCE',
    });
  });

  it('re-attributes when declared key misses but exactly one active evidence item contains markdown inline link', () => {
    const result = verifyTextualComponentSourceSupport(
      'Casa Tano is an urban winery',
      ['ev-1'],
      new Map([
        [
          'ev-1',
          {
            title: 'Unrelated title',
            text: 'Unrelated snippet text.',
          },
        ],
        [
          'ev-2',
          {
            text: '[Casa Tano](https://example.com) is an urban winery',
          },
        ],
      ]),
    );
    expect(result).toMatchObject({
      supported: true,
      declaredEvidenceKeys: ['ev-1'],
      verifiedEvidenceKeys: ['ev-2'],
      attributionStatus: 'REATTRIBUTED_UNIQUE_EXACT_SPAN',
      verifiedSupportSpan:
        '[Casa Tano](https://example.com) is an urban winery',
    });
  });

  it('fails closed as ambiguous when two active evidence items contain the same markdown-normalized span', () => {
    const result = verifyTextualComponentSourceSupport(
      'Casa Tano is an urban winery',
      ['ev-1'],
      new Map([
        [
          'ev-1',
          {
            text: 'Other winery entirely.',
          },
        ],
        [
          'ev-2',
          {
            text: '[Casa Tano](https://example.com) is an urban winery',
          },
        ],
        [
          'ev-3',
          {
            text: '[Casa Tano](https://other-guide.com) is an urban winery',
          },
        ],
      ]),
    );
    expect(result).toMatchObject({
      supported: false,
      reason: 'AMBIGUOUS_SUPPORTING_EVIDENCE',
      declaredEvidenceKeys: ['ev-1'],
      verifiedEvidenceKeys: [],
      attributionStatus: 'AMBIGUOUS_SUPPORTING_EVIDENCE',
    });
  });

  describe('windowed source content (non-contiguous excerpts)', () => {
    const windowed = new Map([
      [
        'ev-1',
        {
          title: 'A guide',
          text: [
            'Start at Alfa Crux for a tasting.',
            'Finish at Bodega Azul at sunset.',
          ].join(SOURCE_EXCERPT_SEPARATOR),
        },
      ],
    ]);

    it('verifies a span that lies inside one retained excerpt', () => {
      const result = verifyTextualComponentSourceSupport(
        'Finish at Bodega Azul',
        ['ev-1'],
        windowed,
      );
      expect(result).toMatchObject({
        supported: true,
        verifiedSupportSpan: 'Finish at Bodega Azul',
        attributionStatus: 'DECLARED_KEY_VERIFIED',
      });
    });

    it('rejects a span that bridges two excerpts across the structural separator', () => {
      const result = verifyTextualComponentSourceSupport(
        'for a tasting. […] Finish at Bodega Azul',
        ['ev-1'],
        windowed,
      );
      expect(result).toMatchObject({
        supported: false,
        reason: 'SPAN_NOT_FOUND_IN_CITED_EVIDENCE',
      });
    });

    it('rejects a span with markdown links that bridges two excerpts across the structural separator', () => {
      const windowedWithLinks = new Map([
        [
          'ev-1',
          {
            title: 'A guide',
            text: [
              'Start at [Alfa Crux](https://alfacrux.com) for a tasting.',
              'Finish at [Bodega Azul](https://bodegaazul.com) at sunset.',
            ].join(SOURCE_EXCERPT_SEPARATOR),
          },
        ],
      ]);
      const result = verifyTextualComponentSourceSupport(
        'for a tasting. Finish at Bodega Azul',
        ['ev-1'],
        windowedWithLinks,
      );
      expect(result).toMatchObject({
        supported: false,
        reason: 'SPAN_NOT_FOUND_IN_CITED_EVIDENCE',
      });
    });

    it('never accepts the separator marker itself as source evidence', () => {
      const result = verifyTextualComponentSourceSupport(
        '[…]',
        ['ev-1'],
        windowed,
      );
      expect(result.supported).toBe(false);
    });
  });
});
