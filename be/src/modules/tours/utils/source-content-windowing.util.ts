/**
 * Canonical source-content windowing policy.
 *
 * A web source-content provider returns a page's FULL normalized text
 * (`WebSourceContentProvider`). The extractor, however, only receives a fixed
 * per-source evidence budget. This module is the single place that decides
 * WHICH source text fills that budget.
 *
 * Spending the budget on document position (`content.slice(0, maxChars)`)
 * discards the part of a long page that the grounded search result for that
 * exact source actually advertised (e.g. a snippet naming a section that
 * sits after more intro text than the whole budget). Instead:
 *
 *   full source text
 *   -> remove non-textual payload (embedded data URIs)
 *   -> split into coherent sections (Markdown headings when present) and
 *      bounded paragraph chunks (always, so unstructured text works too)
 *   -> rank chunks lexically against provider-neutral context already known
 *      for this source/request (its title, its grounded search snippet, the
 *      research query)
 *   -> window 1: greedily take the highest-ranked chunks that fit
 *      `maxChars` and emit them VERBATIM in ORIGINAL DOCUMENT ORDER
 *   -> windows 2..N: every chunk window 1 left out, in DOCUMENT ORDER,
 *      packed under the same `maxChars`
 *
 * Editorial units (RW4-EXTRACT-COMPLETENESS-1). A heading section is the
 * source's own boundary for one coherent piece of content — e.g. a whole
 * self-guided walk. The text is partitioned into units: the outermost
 * heading section (never the page's sole title heading) whose text fits
 * `unitMaxChars`; a section that does not fit is split into its own lead
 * text and child sections, recursively. A unit is NEVER split across
 * windows: window 1 is the most relevant unit, and a
 * continuation window carries each unit whole (alone when it exceeds
 * `maxChars`). Only text that fits no unit — a lead text or headless
 * document longer than `unitMaxChars` — is walked in `maxChars` runs, and
 * any window that cuts a unit reports `sectionComplete: false`, so a caller
 * can refuse to treat a prefix of an editorial unit as the whole of it.
 *
 * Ranking decides which source text is examined FIRST; it never decides
 * which source text gets its ONLY chance to be examined. The sequence is
 * finite and covers every chunk of the normalized text, so retrieved source
 * text always remains eventually examinable by a caller that walks it.
 *
 * Continuation windows are section-aware: a heading-delimited section that
 * fits the budget is emitted whole in one window (re-including any of its
 * chunks window 1 already examined), so a coherent source section can reach
 * one extraction intact even when ranking split it. A section larger than
 * the budget is walked in budget-sized runs of consecutive chunks that share
 * one boundary chunk. Continuation order is document order — never the
 * snippet-sensitive ranking — so where a section lands in the sequence after
 * window 1 does not depend on the volatile search snippet.
 *
 * This selects source text for examination only. It never interprets domain
 * truth, never rewrites/summarizes prose, carries no tourism vocabulary, and
 * applies no acceptance threshold: it is ordering under a fixed budget.
 *
 * Non-contiguous excerpts are joined with `SOURCE_EXCERPT_SEPARATOR`, a
 * structural marker that is NOT source text. The source-support gate
 * (`component-source-support.util.ts`) splits evidence text on it, so a
 * supportSpan can never be verified across an excerpt boundary or against the
 * marker itself.
 */

/**
 * Structural boundary between non-contiguous excerpts. Never source evidence.
 */
export const SOURCE_EXCERPT_SEPARATOR = '\n\n[…]\n\n';

/** Provider-neutral relevance context for ONE source within ONE request. */
export interface SourceContentRelevanceContext {
  /** Titles the grounded search reported for this exact source. */
  titles?: string[];
  /** Grounded search snippets for this exact source. */
  snippets?: string[];
  /** Research query / semantic query context of the acquisition request. */
  queries?: string[];
}

export type SourceContentSelectionStrategy =
  /** The payload-free source text fits the budget and is kept whole. */
  | 'WHOLE_DOCUMENT'
  /** Window 1: the whole editorial unit holding the top-ranked chunk. */
  | 'SECTION_UNIT'
  /** Window 1 when the top-ranked chunk is in no unit: the highest-ranked
   * chunks that fit `maxChars`, in document order. */
  | 'RELEVANCE_WINDOWS'
  /** Windows 2..N: chunks window 1 left out, in document order, with whole
   * sections kept together when they fit. */
  | 'DOCUMENT_ORDER_CONTINUATION';

export interface SourceContentExcerptRange {
  /** Offsets into the payload-free normalized text (not the raw content). */
  start: number;
  end: number;
  /** Distinct section headings the excerpt covers (heading paths flattened,
   * in document order). Empty when the source exposes no headings. */
  headings: string[];
}

export interface SourceContentWindowingAudit {
  selectionStrategy: SourceContentSelectionStrategy;
  /** Characters the provider returned. */
  originalContentChars: number;
  /** Non-textual payload characters (embedded data URIs) removed. */
  removedPayloadChars: number;
  /** Characters of source text after payload removal. */
  normalizedContentChars: number;
  /** Characters handed to extraction, including excerpt separators. */
  retainedContentChars: number;
  maxChars: number;
  /** Largest editorial unit kept whole, possibly above `maxChars`. */
  unitMaxChars: number;
  /** True when every editorial unit this window touches is in it whole. A
   * window that holds only part of a unit (a ranked excerpt, or one run of
   * text larger than `unitMaxChars`) is false: it may end mid-itinerary. */
  sectionComplete: boolean;
  /** True when some source TEXT (not just payload) is outside this window. */
  truncated: boolean;
  /** Candidate chunks the normalized text was split into. */
  chunkCount: number;
  selectedExcerpts: SourceContentExcerptRange[];
  /** 1-based position of this window in the source's window sequence. */
  windowOrdinal: number;
  /** Total windows in the source's (finite) window sequence. */
  windowCount: number;
  /** Chunks this window examines for the first time. */
  newChunkCount: number;
  /** Chunks re-included from an earlier window so that a coherent section
   * (or the boundary of an oversized one) reaches one extraction intact. */
  overlapChunkCount: number;
  /** Chunks no window up to and including this one has examined. Zero on
   * the last window: the sequence covers the whole normalized text. */
  unexaminedChunkCountAfter: number;
}

export interface SourceContentWindow {
  content: string;
  audit: SourceContentWindowingAudit;
}

// Embedded binary payload (images/fonts inlined as base64). Carries no
// readable source evidence; a Markdown image keeps its visible alt text.
const DATA_URI_PATTERN =
  /data:[a-z0-9.+/-]+(?:;[a-z0-9=.+-]+)*;base64,[a-z0-9+/=]+/gi;
const HEADING_LINE_PATTERN = /^(#{1,6})[ \t]+(\S.*?)[ \t]*#*[ \t]*$/gm;
const PARAGRAPH_BREAK_PATTERN = /\n[ \t]*\n/g;
const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;
// Terms found in a section's heading path describe the whole section, so
// they count double relative to terms found only in its body text.
const HEADING_TERM_WEIGHT = 2;
// Chunks are a fraction of the budget so several independent excerpts can
// compete for it, rather than one oversized block winning by size alone.
const CHUNKS_PER_BUDGET = 4;

interface Section {
  start: number;
  end: number;
  headings: string[];
}

interface Chunk {
  index: number;
  /** Index of the section this chunk belongs to (chunks never span two). */
  section: number;
  /** Index of the editorial unit this chunk belongs to. */
  unit: number;
  start: number;
  end: number;
  headings: string[];
}

function removePayload(content: string): string {
  return content.replace(DATA_URI_PATTERN, '');
}

/** Lowercase, accent-folded, crude plural-folded token. Language-generic. */
function normalizeToken(token: string): string {
  const t = token
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) {
    return t.slice(0, -1);
  }
  return t;
}

function terms(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    if (match[0].length < 3) continue;
    out.add(normalizeToken(match[0]));
  }
  return out;
}

function splitSections(text: string): Section[] {
  const sections: Section[] = [];
  const stack: Array<{ level: number; title: string }> = [];
  let start = 0;
  let headings: string[] = [];
  for (const match of text.matchAll(HEADING_LINE_PATTERN)) {
    const at = match.index ?? 0;
    if (at > start) sections.push({ start, end: at, headings });
    const level = match[1].length;
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    stack.push({ level, title: match[2] });
    headings = stack.map((h) => h.title);
    start = at;
  }
  if (text.length > start) sections.push({ start, end: text.length, headings });
  return sections;
}

/** Splits [start,end) into ranges of at most `maxLen`, preferring newlines,
 * then whitespace, as cut points. Ranges are contiguous and cover the input. */
function hardSplit(
  text: string,
  start: number,
  end: number,
  maxLen: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let from = start;
  while (end - from > maxLen) {
    const window = text.slice(from, from + maxLen);
    let cut = window.lastIndexOf('\n');
    if (cut <= 0) cut = window.search(/\s\S*$/);
    const to = cut > 0 ? from + cut + 1 : from + maxLen;
    out.push([from, to]);
    from = to;
  }
  if (end > from) out.push([from, end]);
  return out;
}

function splitChunks(
  text: string,
  sections: Section[],
  maxLen: number,
): Chunk[] {
  const chunks: Chunk[] = [];
  sections.forEach((section, sectionIndex) => {
    const paragraphs: Array<[number, number]> = [];
    let from = section.start;
    const body = text.slice(section.start, section.end);
    for (const brk of body.matchAll(PARAGRAPH_BREAK_PATTERN)) {
      const to = section.start + (brk.index ?? 0) + brk[0].length;
      paragraphs.push(...hardSplit(text, from, to, maxLen));
      from = to;
    }
    if (section.end > from) {
      paragraphs.push(...hardSplit(text, from, section.end, maxLen));
    }
    // Pack consecutive paragraphs of the same section up to maxLen.
    let packStart = -1;
    let packEnd = -1;
    const flush = () => {
      if (packStart >= 0 && text.slice(packStart, packEnd).trim()) {
        chunks.push({
          index: chunks.length,
          section: sectionIndex,
          unit: -1,
          start: packStart,
          end: packEnd,
          headings: section.headings,
        });
      }
      packStart = -1;
    };
    for (const [pStart, pEnd] of paragraphs) {
      if (packStart >= 0 && pEnd - packStart > maxLen) flush();
      if (packStart < 0) packStart = pStart;
      packEnd = pEnd;
    }
    flush();
  });
  return chunks;
}

/** A contiguous [start,end) range of the text: either one editorial unit
 * (`complete`, kept whole) or text that fits no unit (walked in runs). */
interface Unit {
  start: number;
  end: number;
  complete: boolean;
}

interface HeadingNode {
  start: number;
  end: number;
  level: number;
  children: HeadingNode[];
}

/**
 * Partitions the text into editorial units (see the file header). Headings
 * form a tree by level; a node whose whole subtree fits `unitMaxChars` is
 * one unit. The sole heading at the document's shallowest level is its
 * title and never a unit by itself, so a page title does not swallow the
 * page; its lead text and children are partitioned instead.
 */
function partitionUnits(text: string, unitMaxChars: number): Unit[] {
  const headings: HeadingNode[] = [];
  for (const match of text.matchAll(HEADING_LINE_PATTERN)) {
    headings.push({
      start: match.index ?? 0,
      end: text.length,
      level: match[1].length,
      children: [],
    });
  }
  const root: HeadingNode = {
    start: 0,
    end: text.length,
    level: 0,
    children: [],
  };
  const stack: HeadingNode[] = [root];
  for (const node of headings) {
    while (stack.length > 1 && stack[stack.length - 1].level >= node.level) {
      stack.pop()!.end = node.start;
    }
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  const minLevel = Math.min(...headings.map((h) => h.level));
  const atMin = headings.filter((h) => h.level === minLevel);
  const title = atMin.length === 1 ? atMin[0] : undefined;

  const units: Unit[] = [];
  const pushRange = (start: number, end: number) => {
    if (end <= start || !text.slice(start, end).trim()) return;
    units.push({ start, end, complete: end - start <= unitMaxChars });
  };
  const visit = (node: HeadingNode) => {
    if (
      node !== root &&
      node !== title &&
      node.end - node.start <= unitMaxChars
    ) {
      units.push({ start: node.start, end: node.end, complete: true });
      return;
    }
    pushRange(node.start, node.children[0]?.start ?? node.end);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return units;
}

function relevanceTerms(context: SourceContentRelevanceContext): Set<string> {
  return terms(
    [
      ...(context.titles ?? []),
      ...(context.snippets ?? []),
      ...(context.queries ?? []),
    ].join(' '),
  );
}

/** Scores ranges of the text (chunks, or whole units) against the query
 * terms: distinct-term presence weighted by inverse document frequency over
 * the same set of ranges. */
function scoreRanges(
  text: string,
  ranges: Array<{ start: number; end: number; headings: string[] }>,
  queryTerms: Set<string>,
): number[] {
  const chunks = ranges;
  const bodyTerms = chunks.map((c) => terms(text.slice(c.start, c.end)));
  const headingTerms = chunks.map((c) => terms(c.headings.join(' ')));
  // Inverse document frequency over this document's own chunks: a term that
  // appears everywhere (the destination name, function words) cannot
  // distinguish one chunk from another and so contributes almost nothing.
  const df = new Map<string, number>();
  for (let i = 0; i < chunks.length; i++) {
    for (const term of new Set([...bodyTerms[i], ...headingTerms[i]])) {
      if (queryTerms.has(term)) df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  const n = chunks.length;
  return chunks.map((_, i) => {
    let score = 0;
    for (const term of queryTerms) {
      const docFreq = df.get(term);
      if (!docFreq) continue;
      const idf = Math.log(1 + n / docFreq);
      if (headingTerms[i].has(term)) score += HEADING_TERM_WEIGHT * idf;
      else if (bodyTerms[i].has(term)) score += idf;
    }
    return score;
  });
}

/** Characters `chunks` occupy once emitted: their trimmed text plus one
 * separator between each pair — an upper bound, since adjacent chunks are
 * merged into one excerpt without a separator. */
function chunkSetCost(text: string, chunks: Chunk[]): number {
  return chunks.reduce(
    (sum, chunk, i) =>
      sum +
      text.slice(chunk.start, chunk.end).trim().length +
      (i > 0 ? SOURCE_EXCERPT_SEPARATOR.length : 0),
    0,
  );
}

/** Emits `chunks` verbatim in document order, merging adjacent chunks into
 * one excerpt and joining non-adjacent excerpts with the separator. */
function assembleWindow(
  text: string,
  chunks: Chunk[],
): { content: string; excerpts: SourceContentExcerptRange[] } {
  const ordered = [...chunks].sort((a, b) => a.index - b.index);
  const excerpts: SourceContentExcerptRange[] = [];
  ordered.forEach((chunk, i) => {
    const last = excerpts[excerpts.length - 1];
    if (last && ordered[i - 1].index === chunk.index - 1) {
      last.end = chunk.end;
      for (const h of chunk.headings) {
        if (!last.headings.includes(h)) last.headings.push(h);
      }
    } else {
      excerpts.push({
        start: chunk.start,
        end: chunk.end,
        headings: [...chunk.headings],
      });
    }
  });
  // Report trimmed offsets so each range is exactly the emitted text.
  for (const excerpt of excerpts) {
    const raw = text.slice(excerpt.start, excerpt.end);
    excerpt.start += raw.length - raw.trimStart().length;
    excerpt.end -= raw.length - raw.trimEnd().length;
  }
  const content = excerpts
    .map((e) => text.slice(e.start, e.end))
    .join(SOURCE_EXCERPT_SEPARATOR);
  return { content, excerpts };
}

/** Window 1: highest score first (ties keep document order) while the
 * budget holds. */
function selectRankedChunks(
  text: string,
  chunks: Chunk[],
  scores: number[],
  maxChars: number,
): Chunk[] {
  const ranked = [...chunks].sort(
    (a, b) => scores[b.index] - scores[a.index] || a.index - b.index,
  );
  const selected: Chunk[] = [];
  for (const chunk of ranked) {
    if (chunkSetCost(text, [...selected, chunk]) > maxChars) continue;
    selected.push(chunk);
  }
  return selected.sort((a, b) => a.index - b.index);
}

/**
 * Windows 2..N over every chunk `examined` does not contain, in document
 * order. Each complete editorial unit with an unexamined chunk becomes one
 * segment, whole (re-including chunks window 1 already examined). Text that
 * fits no unit becomes budget-sized runs of consecutive chunks, consecutive
 * runs sharing one boundary chunk. Whole units are packed into windows in
 * document order without splitting one; a unit larger than `maxChars` (up
 * to `unitMaxChars`) and every run of oversized text is a window of its own.
 */
function continuationWindows(
  text: string,
  chunks: Chunk[],
  units: Unit[],
  examined: ReadonlySet<number>,
  maxChars: number,
): Chunk[][] {
  const byUnit = new Map<number, Chunk[]>();
  for (const chunk of chunks) {
    const list = byUnit.get(chunk.unit) ?? [];
    list.push(chunk);
    byUnit.set(chunk.unit, list);
  }

  // `whole` segments may share a window; a run of oversized text is always
  // a window of its own, so a whole unit never shares a window with a cut.
  const segments: Array<{ chunks: Chunk[]; whole: boolean }> = [];
  for (const [unitIndex, unitChunks] of byUnit) {
    if (unitChunks.every((c) => examined.has(c.index))) continue;
    if (units[unitIndex].complete) {
      segments.push({ chunks: unitChunks, whole: true });
      continue;
    }
    let from = 0;
    while (from < unitChunks.length) {
      // A single chunk always fits: chunks are a fraction of the budget.
      let to = from + 1;
      while (
        to < unitChunks.length &&
        chunkSetCost(text, unitChunks.slice(from, to + 1)) <= maxChars
      ) {
        to++;
      }
      const run = unitChunks.slice(from, to);
      if (run.some((c) => !examined.has(c.index))) {
        segments.push({ chunks: run, whole: false });
      }
      if (to >= unitChunks.length) break;
      // Share the run's last chunk with the next run when that still makes
      // progress, so text spanning the cut reaches one window intact.
      from = to - 1 > from ? to - 1 : to;
    }
  }

  const windows: Chunk[][] = [];
  let current: Chunk[] = [];
  for (const { chunks: segment, whole } of segments) {
    if (!whole || chunkSetCost(text, segment) > maxChars) {
      if (current.length) windows.push(current);
      windows.push(segment);
      current = [];
      continue;
    }
    const merged = [
      ...current,
      ...segment.filter((c) => !current.some((k) => k.index === c.index)),
    ];
    if (current.length && chunkSetCost(text, merged) > maxChars) {
      windows.push(current);
      current = [...segment];
    } else {
      current = merged;
    }
  }
  if (current.length) windows.push(current);
  return windows;
}

/** True when every unit `windowChunks` touches is complete and wholly in it. */
function coversWholeUnits(
  chunks: Chunk[],
  units: Unit[],
  windowChunks: Chunk[],
): boolean {
  const inWindow = new Set(windowChunks.map((c) => c.index));
  const touched = new Set(windowChunks.map((c) => c.unit));
  return [...touched].every(
    (unit) =>
      units[unit].complete &&
      chunks.filter((c) => c.unit === unit).every((c) => inWindow.has(c.index)),
  );
}

/**
 * The finite, deterministic sequence of source windows for ONE retrieved
 * source. Window 1 is the most relevant editorial unit (or, when that text
 * fits no unit, the relevance-ranked selection); windows
 * 2..N cover everything else in document order. A window stays within
 * `maxChars` unless it carries one whole unit, which stays within
 * `unitMaxChars`. Together they examine every chunk of the normalized
 * source text at least once. Identical input always yields an identical
 * sequence.
 */
export function windowSourceContentSequence(
  rawContent: string,
  context: SourceContentRelevanceContext,
  maxChars: number,
  unitMaxChars: number = maxChars,
): SourceContentWindow[] {
  const text = removePayload(rawContent);
  const base = {
    originalContentChars: rawContent.length,
    removedPayloadChars: rawContent.length - text.length,
    normalizedContentChars: text.length,
    maxChars,
    unitMaxChars,
  };

  if (text.length <= maxChars) {
    return [
      {
        content: text,
        audit: {
          ...base,
          selectionStrategy: 'WHOLE_DOCUMENT',
          retainedContentChars: text.length,
          truncated: false,
          sectionComplete: true,
          chunkCount: 1,
          selectedExcerpts: [{ start: 0, end: text.length, headings: [] }],
          windowOrdinal: 1,
          windowCount: 1,
          newChunkCount: 1,
          overlapChunkCount: 0,
          unexaminedChunkCountAfter: 0,
        },
      },
    ];
  }

  const sections = splitSections(text);
  const chunkMax = Math.max(1, Math.floor(maxChars / CHUNKS_PER_BUDGET));
  const chunks = splitChunks(text, sections, chunkMax);
  const units = partitionUnits(text, unitMaxChars);
  for (const chunk of chunks) {
    chunk.unit = units.findIndex(
      (u) => chunk.start >= u.start && chunk.start < u.end,
    );
  }
  const queryTerms = relevanceTerms(context);
  const scores = scoreRanges(text, chunks, queryTerms);

  // Window 1: the most relevant unit, scored as one range (distinct query
  // terms, IDF over units; ties keep document order), whole. Scoring the
  // unit itself, rather than its single best chunk or the sum of its
  // chunks, neither lets a one-line title summary outrank the section that
  // holds the content nor lets sheer length win. The relevance selection is
  // used only when that unit is text that fits no unit.
  const unitScores = scoreRanges(
    text,
    units.map((u) => ({
      start: u.start,
      end: u.end,
      headings: [
        ...new Set(
          sections
            .filter((sec) => sec.start >= u.start && sec.start < u.end)
            .flatMap((sec) => sec.headings),
        ),
      ],
    })),
    queryTerms,
  );
  const best = unitScores.reduce(
    (bestIndex, score, i) => (score > unitScores[bestIndex] ? i : bestIndex),
    0,
  );
  const unitWindow = units[best].complete;
  // A window never mixes a whole unit with part of another: the relevance
  // fallback ranks only within the oversized text it falls back for, so
  // every other unit stays unexamined and reaches a continuation window
  // whole.
  const first = unitWindow
    ? chunks.filter((c) => c.unit === best)
    : selectRankedChunks(
        text,
        chunks.filter((c) => c.unit === best),
        scores,
        maxChars,
      );
  const plan: Array<{
    strategy: SourceContentSelectionStrategy;
    chunks: Chunk[];
  }> = [
    {
      strategy: unitWindow ? 'SECTION_UNIT' : 'RELEVANCE_WINDOWS',
      chunks: first,
    },
  ];
  const firstExamined = new Set(first.map((c) => c.index));
  for (const window of continuationWindows(
    text,
    chunks,
    units,
    firstExamined,
    maxChars,
  )) {
    plan.push({ strategy: 'DOCUMENT_ORDER_CONTINUATION', chunks: window });
  }

  const examined = new Set<number>();
  return plan.map(({ strategy, chunks: windowChunks }, i) => {
    const newChunkCount = windowChunks.filter(
      (c) => !examined.has(c.index),
    ).length;
    for (const c of windowChunks) examined.add(c.index);
    const { content, excerpts } = assembleWindow(text, windowChunks);
    return {
      content,
      audit: {
        ...base,
        selectionStrategy: strategy,
        retainedContentChars: content.length,
        truncated: true,
        sectionComplete: coversWholeUnits(chunks, units, windowChunks),
        chunkCount: chunks.length,
        selectedExcerpts: excerpts,
        windowOrdinal: i + 1,
        windowCount: plan.length,
        newChunkCount,
        overlapChunkCount: windowChunks.length - newChunkCount,
        unexaminedChunkCountAfter: chunks.length - examined.size,
      },
    };
  });
}
