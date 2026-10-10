import * as fs from 'fs';
import * as path from 'path';
import {
  verifyComponentSourceAssertions,
  verifyLocalityAssertion,
} from './component-source-assertions.util';

/**
 * The REAL SolSalute window the COLD #11 extractor saw (captured from the
 * generation trace). Assertions are admitted only from a component's own
 * evidence, stated in one sentence with the component.
 */
const WINDOW = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../fixtures/rw4-solsalute-deep-source-window.json'),
    'utf8',
  ),
) as { content: string };
const EVIDENCE = new Map([
  ['ev-1', { key: 'ev-1', text: WINDOW.content }],
  ['ev-2', { key: 'ev-2', text: 'Ojo de Agua is a hamlet in Cordoba.' }],
]);
const CAPTION = 'Wine and lunch at Ojo de Agua in Lujan de Cuyo';

describe('component source assertions (real SolSalute window)', () => {
  it('admits the component-specific caption as Ojo de Agua locality, with its evidence key and literal span', () => {
    const result = verifyLocalityAssertion(
      { locality: 'Lujan de Cuyo', supportSpan: CAPTION },
      'Ojo de Agua',
      ['ev-1'],
      EVIDENCE,
    );
    expect(result.localityAssertion).toEqual({
      locality: 'Lujan de Cuyo',
      evidenceKey: 'ev-1',
      supportSpan: CAPTION,
    });
    expect(result.audit).toEqual({
      assertion: 'LOCALITY',
      status: 'ACCEPTED',
      proposedLocality: 'Lujan de Cuyo',
    });
  });

  it('rejects the itinerary heading: no sentence names Ojo de Agua together with the locality', () => {
    const result = verifyLocalityAssertion(
      {
        locality: 'Lujan de Cuyo',
        supportSpan:
          'This is my ideal day in Lujan de Cuyo, and it’s tried and tested because this is how we spent a day here this year.',
      },
      'Ojo de Agua',
      ['ev-1'],
      EVIDENCE,
    );
    expect(result.localityAssertion).toBeUndefined();
    expect(result.audit).toMatchObject({
      status: 'REJECTED',
      reason: 'NOT_STATED_IN_ONE_SENTENCE_WITH_COMPONENT',
    });
  });

  it('never leaks one component’s locality to another (the Ojo de Agua caption does not name A16)', () => {
    const result = verifyLocalityAssertion(
      { locality: 'Lujan de Cuyo', supportSpan: CAPTION },
      'A16',
      ['ev-1'],
      EVIDENCE,
    );
    expect(result.localityAssertion).toBeUndefined();
  });

  it('rejects a span found only in evidence the component does not cite (no re-attribution)', () => {
    const result = verifyLocalityAssertion(
      {
        locality: 'Cordoba',
        supportSpan: 'Ojo de Agua is a hamlet in Cordoba.',
      },
      'Ojo de Agua',
      ['ev-1'],
      EVIDENCE,
    );
    expect(result.localityAssertion).toBeUndefined();
    expect(result.audit).toMatchObject({
      status: 'REJECTED',
      reason: 'SPAN_NOT_IN_COMPONENT_EVIDENCE',
    });
  });

  it('admits "winery lunch" as an ESTABLISHMENT only from the sentence naming Ojo de Agua', () => {
    const span =
      '3. [Ojo de Agua](https://ojodeagua.ch/) – 1:30 pm for a winery lunch';
    expect(
      verifyComponentSourceAssertions(
        {
          physicalKindAssertion: {
            kind: 'ESTABLISHMENT',
            term: 'winery lunch',
            supportSpan: span,
          },
        },
        'Ojo de Agua',
        ['ev-1'],
        EVIDENCE,
      ).physicalKindAssertion,
    ).toEqual({
      kind: 'ESTABLISHMENT',
      term: 'winery lunch',
      evidenceKey: 'ev-1',
      supportSpan: span,
    });
    expect(
      verifyComponentSourceAssertions(
        {
          physicalKindAssertion: {
            kind: 'ESTABLISHMENT',
            term: 'hotel',
            supportSpan: span,
          },
        },
        'Ojo de Agua',
        ['ev-1'],
        EVIDENCE,
      ).physicalKindAssertion,
    ).toBeUndefined();
  });

  it('rejects a kind term that is only part of the component’s own name (real Gemini replay: "Bodega" in "Bodega Azul")', () => {
    const result = verifyComponentSourceAssertions(
      {
        physicalKindAssertion: {
          kind: 'ESTABLISHMENT',
          term: 'Bodega',
          supportSpan:
            '[Bodega Azul](https://bodegalaazul.com/) – 2:30 pm for lunch – You’ll spend the remaining hours of your afternoon hours here, so sit back and enjoy the meal.',
        },
      },
      'Bodega Azul',
      ['ev-1'],
      EVIDENCE,
    );
    expect(result.physicalKindAssertion).toBeUndefined();
    expect(result.audits).toContainEqual({
      assertion: 'PHYSICAL_KIND',
      status: 'REJECTED',
      reason: 'NOT_STATED_IN_ONE_SENTENCE_WITH_COMPONENT',
    });
  });

  it('rejects a malformed kind', () => {
    expect(
      verifyComponentSourceAssertions(
        {
          physicalKindAssertion: {
            kind: 'WINERY',
            term: 'winery',
            supportSpan: 'winery',
          },
        },
        'Ojo de Agua',
        ['ev-1'],
        EVIDENCE,
      ).audits,
    ).toContainEqual({
      assertion: 'PHYSICAL_KIND',
      status: 'REJECTED',
      reason: 'MALFORMED',
    });
  });

  it.each([
    ['Ojo de Agua', 'https://ojodeagua.ch/'],
    ['Alfa Crux', 'https://www.agostinowinegroup.com/alfa-crux-wines'],
    ['SuperUco', 'https://superuco.com/'],
    ['Bodega Azul', 'https://bodegalaazul.com/'],
    ['A16', 'http://a16sa.com/en/'],
  ])(
    'keeps the Markdown link whose text is "%s" as provenance only',
    (name, url) => {
      expect(
        verifyComponentSourceAssertions({}, name, ['ev-1'], EVIDENCE)
          .sourceLink,
      ).toEqual({ url, evidenceKey: 'ev-1', linkText: name });
    },
  );

  it('claims no locality for Alfa Crux or SuperUco: the window never places them in one', () => {
    for (const name of ['Alfa Crux', 'SuperUco']) {
      const result = verifyLocalityAssertion(
        {
          locality: 'Valle de Uco',
          supportSpan:
            'If I were to plan a wine tasting in Valle de Uco Itinerary for a friend, this is the day I’d schedule for them.',
        },
        name,
        ['ev-1'],
        EVIDENCE,
      );
      expect(result.localityAssertion).toBeUndefined();
    }
  });

  it('rejects a locality that is only part of the component’s own name ("Azul" in "Bodega Azul")', () => {
    const result = verifyLocalityAssertion(
      {
        locality: 'Azul',
        supportSpan:
          'Bodega Azul – 2:30 pm for lunch – You’ll spend the remaining hours of your afternoon hours here, so sit back and enjoy the meal.',
      },
      'Bodega Azul',
      ['ev-1'],
      EVIDENCE,
    );
    expect(result.localityAssertion).toBeUndefined();
    expect(result.audit.reason).toBe(
      'NOT_STATED_IN_ONE_SENTENCE_WITH_COMPONENT',
    );
  });
});

describe('component source assertions (synthetic, Unicode)', () => {
  const JAPANESE = new Map([
    [
      'ev-1',
      {
        text: '青山カフェは東京都渋谷区にあります。銀座カフェは中央区にあります。',
      },
    ],
  ]);

  it('admits a Japanese-script locality stated with a Japanese-script name', () => {
    const result = verifyLocalityAssertion(
      {
        locality: '渋谷区',
        supportSpan: '青山カフェは東京都渋谷区にあります。',
      },
      '青山カフェ',
      ['ev-1'],
      JAPANESE,
    );
    expect(result.localityAssertion).toEqual({
      locality: '渋谷区',
      evidenceKey: 'ev-1',
      supportSpan: '青山カフェは東京都渋谷区にあります。',
    });
  });

  it('keeps Japanese statements apart: the next statement’s locality is not this component’s', () => {
    const result = verifyLocalityAssertion(
      {
        locality: '中央区',
        supportSpan:
          '青山カフェは東京都渋谷区にあります。銀座カフェは中央区にあります。',
      },
      '青山カフェ',
      ['ev-1'],
      JAPANESE,
    );
    expect(result.localityAssertion).toBeUndefined();
  });

  it('never matches a name inside another word ("山カフェ" is not "青山カフェ")', () => {
    const result = verifyLocalityAssertion(
      {
        locality: '渋谷区',
        supportSpan: '青山カフェは東京都渋谷区にあります。',
      },
      '山カフェ',
      ['ev-1'],
      JAPANESE,
    );
    expect(result.localityAssertion).toBeUndefined();
  });

  it('never matches across scripts: "Tokyo" is not stated by "東京"', () => {
    const result = verifyLocalityAssertion(
      {
        locality: 'Tokyo',
        supportSpan: '青山カフェは東京都渋谷区にあります。',
      },
      '青山カフェ',
      ['ev-1'],
      JAPANESE,
    );
    expect(result.localityAssertion).toBeUndefined();
  });

  it('does not attach another mixed-script name’s link ("Café 渋谷" is not "Café 青山")', () => {
    const evidence = new Map([
      ['ev-1', { text: 'Start at [Café 渋谷](https://shibuya.example/).' }],
    ]);
    expect(
      verifyComponentSourceAssertions({}, 'Café 青山', ['ev-1'], evidence)
        .sourceLink,
    ).toBeUndefined();
  });
});
