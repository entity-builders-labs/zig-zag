import {
  SOURCE_EXCERPT_SEPARATOR,
  windowSourceContent,
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

describe('windowSourceContent', () => {
  it('keeps a relevant late section that a raw prefix would discard', () => {
    expect(LATE_SECTION_DOCUMENT.indexOf('Alfa Crux')).toBeGreaterThan(BUDGET);

    const window = windowSourceContent(
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
    const window = windowSourceContent(
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

    const window = windowSourceContent(
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

    const window = windowSourceContent(
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

    const window = windowSourceContent(
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

    const window = windowSourceContent(
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
    const window = windowSourceContent(document, {}, BUDGET);
    expect(window.content).toBe(document);
    expect(window.audit).toMatchObject({
      selectionStrategy: 'WHOLE_DOCUMENT',
      truncated: false,
      retainedContentChars: document.length,
    });
  });

  it('is deterministic', () => {
    const a = windowSourceContent(
      LATE_SECTION_DOCUMENT,
      LATE_SECTION_CONTEXT,
      BUDGET,
    );
    const b = windowSourceContent(
      LATE_SECTION_DOCUMENT,
      LATE_SECTION_CONTEXT,
      BUDGET,
    );
    expect(b).toEqual(a);
  });
});
