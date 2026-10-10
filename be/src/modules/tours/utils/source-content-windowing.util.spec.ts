import {
  SOURCE_EXCERPT_SEPARATOR,
  SourceContentRelevanceContext,
  windowSourceContentSequence,
} from './source-content-windowing.util';

const BUDGET = 6000;

/** Unrelated prose paragraphs, each distinct, long enough to exceed BUDGET. */
function fillerParagraphs(count: number, label: string): string {
  return Array.from(
    { length: count },
    (_, i) =>
      `${label} paragraph ${i}: the weather is generally sunny and the people are warm; prices went up over the past years and hotels are plentiful near the center of town.`,
  ).join('\n\n');
}

/**
 * Regression fixture shaped like the canonical RW4 COLD failure: a long
 * intro that alone exceeds the evidence budget, followed by the section the
 * grounded search snippet actually advertised ("sample itineraries").
 */
const ITINERARY_SECTION = [
  '## Sample Mendoza Winery Itineraries',
  '',
  'Here are two sample itineraries built from my own visits.',
  '',
  '### Uco Valley Itinerary',
  '',
  'Start the morning with a tasting at Alfa Crux, then continue to SuperUco for a biodynamic tour and lunch.',
  '',
  'Finish the day at Bodega Azul for a sunset tasting.',
  '',
  'If you still have energy, an optional extra tasting nearby is possible.',
].join('\n');

const LATE_SECTION_DOCUMENT = [
  '# The Best Wineries in Mendoza, A Wine Tasting Guide',
  '',
  fillerParagraphs(40, 'Intro'),
  '',
  '## Where to Stay',
  '',
  fillerParagraphs(10, 'Stay'),
  '',
  ITINERARY_SECTION,
  '',
  '## Final Thoughts',
  '',
  fillerParagraphs(10, 'Outro'),
].join('\n');

const LATE_SECTION_CONTEXT = {
  titles: ['The Best Wineries in Mendoza, A Wine Tasting Guide'],
  snippets: [
    'A local wine-lovers list of the best wineries in Mendoza and how to visit them, including first hand tips, sample itineraries, and the best ...',
  ],
  queries: ['Ciudad de Mendoza wine tasting wineries wine route'],
};

function excerpts(content: string): string[] {
  return content.split(SOURCE_EXCERPT_SEPARATOR);
}

/** Window 1 — the relevance-ranked fast path. */
function firstWindow(
  content: string,
  context: SourceContentRelevanceContext,
  maxChars: number,
) {
  return windowSourceContentSequence(content, context, maxChars)[0];
}

describe('windowSourceContentSequence — window 1', () => {
  it('keeps a relevant late section that a raw prefix would discard', () => {
    expect(LATE_SECTION_DOCUMENT.indexOf('Alfa Crux')).toBeGreaterThan(BUDGET);

    const window = firstWindow(
      LATE_SECTION_DOCUMENT,
      LATE_SECTION_CONTEXT,
      BUDGET,
    );

    expect(window.content.length).toBeLessThanOrEqual(BUDGET);
    expect(window.content).toContain('### Uco Valley Itinerary');
    // Exact source wording is preserved, never paraphrased.
    expect(window.content).toContain(
      'Start the morning with a tasting at Alfa Crux, then continue to SuperUco for a biodynamic tour and lunch.',
    );
    expect(window.content).toContain(
      'Finish the day at Bodega Azul for a sunset tasting.',
    );
    // The advertised section is an editorial unit: window 1 carries it whole.
    expect(window.audit).toMatchObject({
      selectionStrategy: 'SECTION_UNIT',
      sectionComplete: true,
      originalContentChars: LATE_SECTION_DOCUMENT.length,
      retainedContentChars: window.content.length,
      maxChars: BUDGET,
      truncated: true,
    });
    expect(
      window.audit.selectedExcerpts.some((e) =>
        e.headings.includes('Sample Mendoza Winery Itineraries'),
      ),
    ).toBe(true);
  });

  it('emits every excerpt verbatim from the normalized source', () => {
    const window = firstWindow(
      LATE_SECTION_DOCUMENT,
      LATE_SECTION_CONTEXT,
      BUDGET,
    );
    for (const excerpt of excerpts(window.content)) {
      expect(LATE_SECTION_DOCUMENT).toContain(excerpt);
    }
    for (const range of window.audit.selectedExcerpts) {
      expect(range.end).toBeGreaterThan(range.start);
    }
  });

  it('does not let embedded image/data payload consume the text budget', () => {
    const payload = `![logo](data:image/png;base64,${'iVBORw0KGgo'.repeat(900)}=)`;
    const document = [
      '# Guide',
      '',
      payload,
      '',
      payload,
      '',
      'This guide lists sample itineraries across the valley.',
      '',
      '## Day one',
      '',
      'Visit the old mill, then the river museum.',
    ].join('\n');
    expect(document.length).toBeGreaterThan(BUDGET * 3);

    const window = firstWindow(
      document,
      { snippets: ['sample itineraries across the valley'] },
      BUDGET,
    );

    expect(window.content).not.toContain('base64');
    expect(window.content).toContain(
      'This guide lists sample itineraries across the valley.',
    );
    expect(window.content).toContain(
      'Visit the old mill, then the river museum.',
    );
    // Visible alt text survives; only the non-textual payload is removed.
    expect(window.content).toContain('![logo]');
    expect(window.audit.normalizedContentChars).toBeLessThan(BUDGET);
    expect(window.audit.selectionStrategy).toBe('WHOLE_DOCUMENT');
    // No source TEXT was dropped -- only non-textual payload was removed.
    expect(window.audit.truncated).toBe(false);
    expect(window.audit.removedPayloadChars).toBeGreaterThan(BUDGET * 2);
  });

  it('falls back to bounded chunks for a long document without headings', () => {
    const relevant =
      'The recommended loop links the lighthouse, the fish market and the old customs house in one morning.';
    const document = [
      fillerParagraphs(60, 'Plain'),
      relevant,
      fillerParagraphs(20, 'Tail'),
    ].join('\n\n');
    expect(document.indexOf(relevant)).toBeGreaterThan(BUDGET);

    const window = firstWindow(
      document,
      { snippets: ['a recommended loop past the lighthouse and fish market'] },
      BUDGET,
    );

    expect(window.content.length).toBeLessThanOrEqual(BUDGET);
    expect(window.content).toContain(relevant);
    expect(window.audit.selectionStrategy).toBe('RELEVANCE_WINDOWS');
  });

  it('chunks a single unbroken block of plain text instead of keeping only its prefix', () => {
    const words = Array.from({ length: 3000 }, (_, i) => `filler${i % 50}`);
    words.splice(2500, 0, 'the', 'hidden', 'lighthouse', 'loop');
    const document = words.join(' ');
    expect(document.indexOf('hidden lighthouse loop')).toBeGreaterThan(
      BUDGET / 2,
    );

    const window = firstWindow(
      document,
      { snippets: ['hidden lighthouse loop'] },
      BUDGET / 2,
    );

    expect(window.content.length).toBeLessThanOrEqual(BUDGET / 2);
    expect(window.content).toContain('the hidden lighthouse loop');
    for (const excerpt of excerpts(window.content)) {
      expect(document).toContain(excerpt);
    }
  });

  it('emits relevance-fallback excerpts in original document order, not score order', () => {
    // Headless text longer than one unit fits no editorial unit, so window 1
    // falls back to the relevance-ranked selection.
    const document = [
      'The lighthouse opens at dawn.',
      '',
      fillerParagraphs(40, 'Middle'),
      '',
      'The lighthouse and the fish market and the customs house form the loop.',
    ].join('\n');

    const window = firstWindow(
      document,
      { snippets: ['lighthouse fish market customs house loop'] },
      BUDGET,
    );

    expect(window.audit.selectionStrategy).toBe('RELEVANCE_WINDOWS');
    expect(window.audit.sectionComplete).toBe(false);
    const alpha = window.content.indexOf('The lighthouse opens at dawn.');
    const omega = window.content.indexOf(
      'The lighthouse and the fish market and the customs house form the loop.',
    );
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(omega).toBeGreaterThan(alpha);
    const starts = window.audit.selectedExcerpts.map((e) => e.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('returns a short document whole, without separators', () => {
    const document = '# Short\n\nOne paragraph only.';
    const window = firstWindow(document, {}, BUDGET);
    expect(window.content).toBe(document);
    expect(window.audit).toMatchObject({
      selectionStrategy: 'WHOLE_DOCUMENT',
      truncated: false,
      retainedContentChars: document.length,
    });
  });

  it('is deterministic', () => {
    const a = firstWindow(LATE_SECTION_DOCUMENT, LATE_SECTION_CONTEXT, BUDGET);
    const b = firstWindow(LATE_SECTION_DOCUMENT, LATE_SECTION_CONTEXT, BUDGET);
    expect(b).toEqual(a);
  });
});

/** A paragraph of ~1000 chars carrying `marker`, distinct per `label`. */
function longParagraph(label: string, marker: string): string {
  return `${marker} ${Array.from(
    { length: 8 },
    (_, i) =>
      `${label} sentence ${i} describes ordinary local scenery and transport options in plain words.`,
  ).join(' ')}`;
}

describe('windowSourceContentSequence — progressive windows', () => {
  const STABLE_CONTEXT = {
    titles: ['The Best Wineries in Mendoza, A Wine Tasting Guide'],
    queries: ['Ciudad de Mendoza wine tasting wineries wine route'],
  };

  it('keeps window 1 the ranked fast path and covers every chunk exactly once beyond overlap', () => {
    const windows = windowSourceContentSequence(
      LATE_SECTION_DOCUMENT,
      LATE_SECTION_CONTEXT,
      BUDGET,
    );

    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0].audit.selectionStrategy).toBe('SECTION_UNIT');
    expect(windows[0].content).toContain('Alfa Crux');
    for (const [i, w] of windows.entries()) {
      expect(w.audit.windowOrdinal).toBe(i + 1);
      expect(w.audit.windowCount).toBe(windows.length);
      expect(w.content.length).toBeLessThanOrEqual(BUDGET);
      expect(w.audit.retainedContentChars).toBe(w.content.length);
      // Every window makes progress through previously unseen text.
      expect(w.audit.newChunkCount).toBeGreaterThan(0);
      if (i > 0) {
        expect(w.audit.selectionStrategy).toBe('DOCUMENT_ORDER_CONTINUATION');
      }
    }
    const chunkCount = windows[0].audit.chunkCount;
    expect(windows.reduce((n, w) => n + w.audit.newChunkCount, 0)).toBe(
      chunkCount,
    );
    expect(windows[windows.length - 1].audit.unexaminedChunkCountAfter).toBe(0);
  });

  it('eventually exposes every paragraph of the source, verbatim', () => {
    const windows = windowSourceContentSequence(
      LATE_SECTION_DOCUMENT,
      STABLE_CONTEXT,
      BUDGET,
    );
    const examined = windows.map((w) => w.content).join('\n');
    for (const paragraph of LATE_SECTION_DOCUMENT.split(/\n\s*\n/)) {
      expect(examined).toContain(paragraph.trim());
    }
    for (const w of windows) {
      for (const excerpt of excerpts(w.content)) {
        expect(LATE_SECTION_DOCUMENT).toContain(excerpt);
      }
    }
  });

  it('makes a section ranking missed examinable regardless of the snippet', () => {
    const itineraryOrdinal = (context: SourceContentRelevanceContext) =>
      windowSourceContentSequence(LATE_SECTION_DOCUMENT, context, BUDGET).find(
        (w) =>
          excerpts(w.content).some(
            (e) =>
              e.includes('Alfa Crux') &&
              e.includes('SuperUco') &&
              e.includes('Bodega Azul'),
          ),
      )?.audit.windowOrdinal;

    // Ranked into window 1 when the snippet advertises it…
    expect(itineraryOrdinal(LATE_SECTION_CONTEXT)).toBe(1);
    // …and still reached, intact in one excerpt, when it does not.
    const withoutSnippet = itineraryOrdinal(STABLE_CONTEXT);
    expect(withoutSnippet).toBeGreaterThan(1);
    expect(
      itineraryOrdinal({
        ...STABLE_CONTEXT,
        snippets: ['how to visit Maipu, Lujan de Cuyo and the Uco Valley'],
      }),
    ).toBeDefined();
  });

  it('keeps a coherent section whole in window 1 instead of the ranked half', () => {
    const document = [
      '# Guide',
      '',
      fillerParagraphs(40, 'Intro'),
      '',
      '## Route',
      '',
      longParagraph('Route-head', 'ROUTE-START zebra quokka itinerary'),
      '',
      longParagraph('Route-tail', 'ROUTE-END'),
      '',
      '## Outro',
      '',
      fillerParagraphs(10, 'Outro'),
    ].join('\n');
    const windows = windowSourceContentSequence(
      document,
      { snippets: ['zebra quokka'] },
      BUDGET,
    );

    // Ranking only finds the head of the section; the unit reaches window 1
    // whole, as ONE contiguous excerpt, tail included.
    expect(windows[0].audit.selectionStrategy).toBe('SECTION_UNIT');
    expect(windows[0].audit.sectionComplete).toBe(true);
    expect(
      excerpts(windows[0].content).some(
        (e) => e.includes('ROUTE-START') && e.includes('ROUTE-END'),
      ),
    ).toBe(true);
  });

  it('walks an oversized unstructured section with one shared boundary chunk and terminates', () => {
    const document = fillerParagraphs(120, 'Plain');
    const windows = windowSourceContentSequence(document, {}, BUDGET);

    expect(windows.length).toBeGreaterThan(2);
    expect(windows[windows.length - 1].audit.unexaminedChunkCountAfter).toBe(0);
    for (const w of windows) {
      expect(w.content.length).toBeLessThanOrEqual(BUDGET);
      expect(w.audit.newChunkCount).toBeGreaterThan(0);
    }
    // Runs after the first continuation share exactly one boundary chunk.
    expect(windows.slice(2).every((w) => w.audit.overlapChunkCount === 1)).toBe(
      true,
    );
    const examined = windows.map((w) => w.content).join('\n');
    for (let i = 0; i < 120; i++) {
      expect(examined).toContain(`Plain paragraph ${i}:`);
    }
  });

  it('returns a single window for a document that fits the budget', () => {
    const windows = windowSourceContentSequence('short text', {}, BUDGET);
    expect(windows).toHaveLength(1);
    expect(windows[0].audit).toMatchObject({
      selectionStrategy: 'WHOLE_DOCUMENT',
      windowOrdinal: 1,
      windowCount: 1,
      unexaminedChunkCountAfter: 0,
    });
  });

  it('is deterministic', () => {
    const a = windowSourceContentSequence(
      LATE_SECTION_DOCUMENT,
      STABLE_CONTEXT,
      BUDGET,
    );
    const b = windowSourceContentSequence(
      LATE_SECTION_DOCUMENT,
      STABLE_CONTEXT,
      BUDGET,
    );
    expect(b).toEqual(a);
  });
});

/**
 * RW4-EXTRACT-COMPLETENESS-1 regression A. Shaped like the real failure: a
 * page-title heading, a short summary, ONE itinerary section longer than the
 * per-window budget whose last stops sit beyond it, then unrelated blog
 * chrome. The previous policy cut that section into budget-sized runs, and
 * the extractor turned the first run into a "complete" 7-stop walk.
 */
describe('windowSourceContentSequence — editorial units (RW4-EXTRACT-COMPLETENESS-1)', () => {
  const UNIT_BUDGET = 24000;
  const STOPS = [
    'Alpha Square',
    'Bravo Palace',
    'Charlie Cathedral',
    'Delta Market',
    'Echo Plaza',
    'Foxtrot Park',
    'Golf Museum',
    'Hotel Quay',
    'India Stadium',
  ];
  const ITINERARY = [
    '## Walking tour – Day 1',
    '',
    ...STOPS.flatMap((stop, i) => [
      `Next, walk to ${stop} and take your time there.`,
      '',
      longParagraph(`Leg-${i}`, `Leg ${i} notes:`),
      '',
      longParagraph(`Leg-${i}-more`, `More on leg ${i}:`),
      '',
    ]),
  ].join('\n');
  const PAGE = [
    '[Home](https://example.test/) [Blog](https://example.test/blog)',
    '',
    '# Day 1 self guided walking tour',
    '',
    'Start: Alpha Square / End: India Stadium. A full day on foot.',
    '',
    ITINERARY,
    '#### Related Posts',
    '',
    fillerParagraphs(6, 'Related'),
    '',
    '### Write A Comment',
    '',
    fillerParagraphs(6, 'Comment'),
  ].join('\n');
  // Like the real search snippets, the context describes the walk's
  // content, not the page's one-line summary.
  const CONTEXT = {
    titles: ['Day 1 self guided walking tour'],
    snippets: [
      'Walk to the palace and the cathedral, then the market, the park and the museum.',
    ],
    queries: ['self-guided walk historic places'],
  };

  function windowsHolding(
    windows: ReturnType<typeof windowSourceContentSequence>,
    text: string,
  ) {
    return windows.filter((w) => w.content.includes(text));
  }

  it('fixture: the itinerary is longer than one window and its last stops lie beyond it', () => {
    expect(ITINERARY.length).toBeGreaterThan(BUDGET);
    expect(ITINERARY.length).toBeLessThan(UNIT_BUDGET);
    expect(ITINERARY.indexOf(STOPS[8])).toBeGreaterThan(BUDGET);
  });

  it('hands the whole itinerary to ONE extraction, every stop in source order', () => {
    const windows = windowSourceContentSequence(
      PAGE,
      CONTEXT,
      BUDGET,
      UNIT_BUDGET,
    );
    const first = windows[0];

    expect(first.audit).toMatchObject({
      selectionStrategy: 'SECTION_UNIT',
      sectionComplete: true,
      unitMaxChars: UNIT_BUDGET,
    });
    expect(first.content.length).toBeGreaterThan(BUDGET);
    expect(first.content.length).toBeLessThanOrEqual(UNIT_BUDGET);
    const [only] = excerpts(first.content);
    expect(excerpts(first.content)).toHaveLength(1);
    const positions = STOPS.map((stop) => only.indexOf(stop));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('never presents a prefix of an editorial unit as complete', () => {
    // Every window of every budget combination: a window that holds the
    // first stop but not the last can never report sectionComplete.
    for (const unitBudget of [BUDGET, UNIT_BUDGET]) {
      for (const context of [
        CONTEXT,
        {},
        { snippets: ['Related paragraph'] },
      ]) {
        const windows = windowSourceContentSequence(
          PAGE,
          context,
          BUDGET,
          unitBudget,
        );
        for (const w of windowsHolding(windows, STOPS[0])) {
          if (!w.content.includes(STOPS[8])) {
            expect(w.audit.sectionComplete).toBe(false);
          }
        }
      }
    }
  });

  it('marks every window of an itinerary longer than the unit budget incomplete', () => {
    const windows = windowSourceContentSequence(PAGE, CONTEXT, BUDGET, BUDGET);
    const holding = windowsHolding(windows, 'Leg 4 notes:');
    expect(holding.length).toBeGreaterThan(0);
    for (const w of holding) expect(w.audit.sectionComplete).toBe(false);
  });

  it('keeps the unit whole in a continuation window when ranking points elsewhere', () => {
    const windows = windowSourceContentSequence(
      PAGE,
      { snippets: ['Related paragraph weather sunny hotels plentiful'] },
      BUDGET,
      UNIT_BUDGET,
    );
    const whole = windows.find((w) =>
      excerpts(w.content).some(
        (e) => e.includes(STOPS[0]) && e.includes(STOPS[8]),
      ),
    );
    expect(whole).toBeDefined();
    expect(whole!.audit.sectionComplete).toBe(true);
    expect(windows[windows.length - 1].audit.unexaminedChunkCountAfter).toBe(0);
  });

  it('does not let the page title heading swallow the whole page as one unit', () => {
    const windows = windowSourceContentSequence(
      PAGE,
      CONTEXT,
      BUDGET,
      10 * PAGE.length,
    );
    expect(windows[0].audit.selectionStrategy).toBe('SECTION_UNIT');
    expect(windows[0].content).toContain(STOPS[8]);
    // The title's own lead text and the site navigation stay outside the
    // unit. (A deeper heading the page nests under the itinerary heading,
    // like this fixture's "#### Related Posts", belongs to that unit.)
    expect(windows[0].content).not.toContain('Start: Alpha Square / End');
    expect(windows[0].content).not.toContain('[Home](https://example.test/)');
  });

  it('a short summary unit ranked first still leaves the itinerary whole for a later window', () => {
    const windows = windowSourceContentSequence(
      PAGE,
      {
        snippets: [
          'Start: Alpha Square / End: India Stadium. A full day on foot.',
        ],
      },
      BUDGET,
      UNIT_BUDGET,
    );
    expect(windows[0].content).toContain('Start: Alpha Square / End');
    const whole = windows.find((w) =>
      excerpts(w.content).some(
        (e) => e.includes(`walk to ${STOPS[0]}`) && e.includes(STOPS[8]),
      ),
    );
    expect(whole?.audit.sectionComplete).toBe(true);
  });
});
