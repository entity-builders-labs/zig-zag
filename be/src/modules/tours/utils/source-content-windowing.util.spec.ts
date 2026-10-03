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
    expect(window.audit).toMatchObject({
      selectionStrategy: 'RELEVANCE_WINDOWS',
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

  it('emits selected excerpts in original document order, not score order', () => {
    const document = [
      '## Alpha',
      '',
      'The lighthouse opens at dawn.',
      '',
      '## Filler',
      '',
      fillerParagraphs(40, 'Middle'),
      '',
      '## Omega',
      '',
      'The lighthouse and the fish market and the customs house form the loop.',
    ].join('\n');

    const window = firstWindow(
      document,
      { snippets: ['lighthouse fish market customs house loop'] },
      BUDGET,
    );

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
    expect(windows[0].audit.selectionStrategy).toBe('RELEVANCE_WINDOWS');
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

  it('keeps a coherent section whole in one later window when ranking split it', () => {
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

    // Ranking keeps only the matching half of the section in window 1.
    expect(windows[0].content).toContain('ROUTE-START');
    expect(windows[0].content).not.toContain('ROUTE-END');
    // A later window re-includes the examined half so the whole section
    // reaches one extraction as ONE contiguous excerpt.
    const whole = windows
      .slice(1)
      .find((w) =>
        excerpts(w.content).some(
          (e) => e.includes('ROUTE-START') && e.includes('ROUTE-END'),
        ),
      );
    expect(whole).toBeDefined();
    expect(whole!.audit.overlapChunkCount).toBeGreaterThan(0);
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
