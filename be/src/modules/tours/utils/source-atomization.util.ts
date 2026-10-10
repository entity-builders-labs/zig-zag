/**
 * Deterministic source atomization and editorial structure (exhaustive
 * source-atom labelling, milestone B; spike `atom-labelling.cjs`).
 *
 * Splitting uses neutral text structure only: lines, unescaped table pipes,
 * list/heading markers and sentence-final punctuation. Nothing here reads
 * meaning: no tourism, transport or place vocabulary is a rule. The output
 * is identical for identical input, atoms and separators partition the unit
 * exactly, and no text is lost to a token budget.
 */
import { createHash } from 'crypto';
import {
  EditorialStructure,
  NonEditorialBlock,
  SourceAtom,
  SourceAtomBlockKind,
  SourceAtomFragment,
  SourceAtomization,
  SourceCoverageProblem,
  SourceSeparator,
  SourceSeparatorKind,
} from '../interfaces/atomized-source-unit.interface';

export const ATOMIZER_VERSION = 'atomizer-v1';
export const EDITORIAL_STRUCTURE_VERSION = 'editorial-structure-v1';
export const DEFAULT_MAX_ATOM_CHARS = 600;
/** Consecutive link-only atoms that make a navigation block (A.1). */
export const DEFAULT_NAVIGATION_MIN_RUN = 3;

const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
const SENTENCE_FINAL = /[.!?…。！？]/u;
// Characters that may close a sentence after its final punctuation (quotes,
// brackets, emphasis markers). Structural, not lexical.
const SENTENCE_CLOSERS = /[\s"'”’»)\]*_]/u;

// ---------------------------------------------------------------------------
// Presentation: the text the model sees for one atom. Only URL targets are
// elided (a link/image target or a bare URL becomes "…"), so a model cannot
// spend its budget on them and a span cannot cite them. Every presented
// character maps back to an index in the atom text.
// ---------------------------------------------------------------------------
const URL_TARGET = /\]\(([^)\s]*)\)|https?:\/\/[^\s)\]|]+/gu;

export interface PresentedText {
  text: string;
  /** presented index -> index in the original text */
  map: number[];
}

export function presentAtomText(text: string): PresentedText {
  let out = '';
  const map: number[] = [];
  let i = 0;
  const pattern = new RegExp(URL_TARGET.source, URL_TARGET.flags);
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    const isLink = m[0].startsWith('](');
    const targetStart = isLink ? m.index + 2 : m.index;
    const targetEnd = isLink
      ? m.index + m[0].length - 1
      : m.index + m[0].length;
    for (; i < targetStart; i++) {
      out += text[i];
      map.push(i);
    }
    if (targetEnd > targetStart) {
      out += '…';
      map.push(targetStart);
    }
    i = targetEnd;
  }
  for (; i < text.length; i++) {
    out += text[i];
    map.push(i);
  }
  return { text: out, map };
}

// ---------------------------------------------------------------------------
// Atomization
// ---------------------------------------------------------------------------

function blockKind(line: string): SourceAtomBlockKind | 'TABLE_ROW' {
  if (/^\s{0,3}#{1,6}\s/u.test(line)) return 'HEADING';
  if (/^\s*([-*+•]|\d+[.)])\s+/u.test(line)) return 'LIST_ITEM';
  if (/^\s*\|/u.test(line)) return 'TABLE_ROW';
  return 'LINE';
}

type Range = [number, number];

// Ranges [start, end) of a line's blocks: table rows split into cells on
// unescaped pipes; every other line is one block.
function lineBlocks(
  text: string,
  start: number,
  end: number,
): { kind: SourceAtomBlockKind; blocks: Range[]; pipes: Range[] } {
  const kind = blockKind(text.slice(start, end));
  if (kind !== 'TABLE_ROW') return { kind, blocks: [[start, end]], pipes: [] };
  const blocks: Range[] = [];
  const pipes: Range[] = [];
  let cellStart = start;
  for (let i = start; i < end; i++) {
    if (text[i] === '|' && text[i - 1] !== '\\') {
      blocks.push([cellStart, i]);
      pipes.push([i, i + 1]);
      cellStart = i + 1;
    }
  }
  blocks.push([cellStart, end]);
  return { kind: 'TABLE_CELL', blocks, pipes };
}

// Sentence boundaries inside [start, end): after sentence-final punctuation
// (plus closers) followed by whitespace. A terminator directly after a token
// with three or fewer letters/digits is not a boundary (abbreviation guard,
// by token length only). Merging is always safe: it can only make an atom
// coarser, never lose text.
function sentenceRanges(text: string, start: number, end: number): Range[] {
  const ranges: Range[] = [];
  let s = start;
  for (let i = start; i < end; i++) {
    if (!SENTENCE_FINAL.test(text[i])) continue;
    let j = i + 1;
    while (j < end && SENTENCE_CLOSERS.test(text[j]) && !/\s/u.test(text[j]))
      j++;
    if (j >= end || !/\s/u.test(text[j])) continue;
    let k = i - 1;
    while (k >= s && /[*_"'“‘«(\[]/u.test(text[k])) k--;
    let tokenChars = 0;
    while (k >= s && !/\s/u.test(text[k])) {
      if (LETTER_OR_NUMBER.test(text[k])) tokenChars++;
      k--;
    }
    if (tokenChars <= 3) continue;
    ranges.push([s, j]);
    s = j;
    i = j - 1;
  }
  ranges.push([s, end]);
  return ranges;
}

// Bounded split of an over-long piece at whitespace, keeping every character.
function boundedRanges(
  text: string,
  start: number,
  end: number,
  maxChars: number,
): Range[] {
  const ranges: Range[] = [];
  let s = start;
  while (end - s > maxChars) {
    let cut = s + maxChars;
    while (cut > s + Math.floor(maxChars / 2) && !/\s/u.test(text[cut])) cut--;
    if (!/\s/u.test(text[cut])) cut = s + maxChars;
    ranges.push([s, cut]);
    s = cut;
  }
  ranges.push([s, end]);
  return ranges;
}

function trimRange(text: string, start: number, end: number): Range {
  let a = start;
  let b = end;
  while (a < b && /\s/u.test(text[a])) a++;
  while (b > a && /\s/u.test(text[b - 1])) b--;
  return [a, b];
}

/**
 * Deterministic atomization of one editorial unit. Atoms and separators
 * partition `[0, text.length)` exactly. A separator is whitespace, a
 * newline, a table pipe, or a piece whose presented text contains no letter
 * or number (pure markup such as `| --- |`, `**`, or an image whose only
 * content is its URL target).
 */
export function atomizeSourceUnit(
  text: string,
  { maxAtomChars = DEFAULT_MAX_ATOM_CHARS }: { maxAtomChars?: number } = {},
): SourceAtomization {
  const pieces: Array<{
    start: number;
    end: number;
    blockKind: SourceAtomBlockKind;
    blockOrdinal: number;
    fragment?: SourceAtomFragment;
  }> = [];
  const separators: SourceSeparator[] = [];
  const sep = (start: number, end: number, kind: SourceSeparatorKind) => {
    if (end > start) separators.push({ start, end, kind });
  };
  let blockOrdinal = 0;
  let lineStart = 0;
  while (lineStart <= text.length) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = text.length;
    const { kind, blocks, pipes } = lineBlocks(text, lineStart, lineEnd);
    for (const [ps, pe] of pipes) sep(ps, pe, 'TABLE_PIPE');
    for (const [bs, be] of blocks) {
      blockOrdinal++;
      for (const [ss, se] of sentenceRanges(text, bs, be)) {
        const [ts, te] = trimRange(text, ss, se);
        sep(ss, ts, 'WHITESPACE');
        sep(te, se, 'WHITESPACE');
        if (te <= ts) continue;
        if (!LETTER_OR_NUMBER.test(presentAtomText(text.slice(ts, te)).text)) {
          sep(ts, te, 'MARKUP');
          continue;
        }
        const parts = boundedRanges(text, ts, te, maxAtomChars);
        parts.forEach(([fs, fe], index) => {
          const [a, b] = trimRange(text, fs, fe);
          sep(fs, a, 'WHITESPACE');
          sep(b, fe, 'WHITESPACE');
          if (b <= a) return;
          pieces.push({
            start: a,
            end: b,
            blockKind: kind,
            blockOrdinal,
            ...(parts.length > 1
              ? {
                  fragment: {
                    index: index + 1,
                    count: parts.length,
                    groupStart: ts,
                    groupEnd: te,
                  },
                }
              : {}),
          });
        });
      }
    }
    if (lineEnd < text.length) sep(lineEnd, lineEnd + 1, 'NEWLINE');
    lineStart = lineEnd + 1;
  }
  const width = Math.max(3, String(pieces.length).length);
  const atoms: SourceAtom[] = pieces.map((p, i) => ({
    atomId: `a-${String(i + 1).padStart(width, '0')}`,
    ordinal: i + 1,
    sourceStart: p.start,
    sourceEnd: p.end,
    text: text.slice(p.start, p.end),
    blockKind: p.blockKind,
    blockOrdinal: p.blockOrdinal,
    ...(p.fragment ? { fragment: p.fragment } : {}),
  }));
  separators.sort((a, b) => a.start - b.start);
  return {
    version: ATOMIZER_VERSION,
    maxAtomChars,
    unitLength: text.length,
    unitSha256: createHash('sha256').update(text).digest('hex'),
    atoms,
    separators,
  };
}

/** Atoms + separators must partition the unit exactly. */
export function checkAtomCoverage(
  text: string,
  atomization: SourceAtomization,
): { ok: boolean; problems: SourceCoverageProblem[] } {
  const ranges = [
    ...atomization.atoms.map((a) => ({
      start: a.sourceStart,
      end: a.sourceEnd,
      kind: 'ATOM' as const,
      text: a.text,
    })),
    ...atomization.separators.map((s) => ({
      ...s,
      text: undefined as string | undefined,
    })),
  ].sort((a, b) => a.start - b.start || a.end - b.end);
  const problems: SourceCoverageProblem[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor)
      problems.push({ code: 'GAP', start: cursor, end: r.start });
    if (r.start < cursor)
      problems.push({ code: 'OVERLAP', start: r.start, end: cursor });
    if (r.kind === 'ATOM' && text.slice(r.start, r.end) !== r.text)
      problems.push({ code: 'ATOM_TEXT_MISMATCH', start: r.start, end: r.end });
    if (
      r.kind !== 'ATOM' &&
      LETTER_OR_NUMBER.test(presentAtomText(text.slice(r.start, r.end)).text)
    )
      problems.push({
        code: 'SEPARATOR_HAS_CONTENT',
        start: r.start,
        end: r.end,
      });
    cursor = Math.max(cursor, r.end);
  }
  if (cursor !== text.length)
    problems.push({ code: 'GAP', start: cursor, end: text.length });
  const ids = atomization.atoms.map((a) => a.atomId);
  if (new Set(ids).size !== ids.length)
    problems.push({ code: 'DUPLICATE_ATOM_ID' });
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Editorial structure (A.1 source-noise boundary). Reads only markdown link
// structure, never words.
//
// Source content arrives as markdown (Tavily extract, Cloudflare
// browser-rendering), so no DOM role survives. The structural evidence that
// does survive is link density: site navigation, share bars, tag clouds and
// related-post lists are runs of blocks whose ONLY readable content is link
// (or image) anchor text. A run of at least `minRun` consecutive link-only
// atoms is a navigation block. Its atoms stay atoms (same IDs, offsets and
// text) and are accounted for exactly once by a structural label; they are
// never presented to the model and never carry membership. A single
// link-only atom ("Read more about X") stays editorial.
//
// Known limit: an itinerary written only as three or more consecutive bare
// links, with no prose, is marked non-editorial. It stays visible in the
// trace (`nonEditorialBlocks`), never silent.
// ---------------------------------------------------------------------------

// A markdown link or image `[anchor](target)`; the anchor may hold one
// nested image (`[![alt](img)label](url)`).
const LINK_CONSTRUCT = /!?\[(?:[^[\]]|\[[^\]]*\])*\]\([^)]*\)/gu;

/** True when every letter/number of the atom lies inside link/image constructs. */
export function isLinkOnlyAtomText(text: string): boolean {
  let found = false;
  const rest = text
    .replace(/^\s*([-*+•]|\d+[.)])\s+/u, '')
    .replace(/^\s{0,3}#{1,6}\s/u, '')
    .replace(new RegExp(LINK_CONSTRUCT.source, LINK_CONSTRUCT.flags), () => {
      found = true;
      return '';
    });
  return found && !LETTER_OR_NUMBER.test(rest);
}

/** Marks navigation blocks; IDs, ordinals, offsets and text are unchanged. */
export function markEditorialStructure(
  atoms: SourceAtom[],
  { minRun = DEFAULT_NAVIGATION_MIN_RUN }: { minRun?: number } = {},
): EditorialStructure {
  const runs: SourceAtom[][] = [];
  let run: SourceAtom[] = [];
  for (const a of atoms) {
    if (isLinkOnlyAtomText(a.text)) {
      run.push(a);
    } else {
      if (run.length) runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  const blocks: NonEditorialBlock[] = runs
    .filter((r) => r.length >= minRun)
    .map((r, i) => ({
      blockId: `nav-${i + 1}`,
      reason: 'NAVIGATION_BLOCK',
      firstAtomId: r[0].atomId,
      lastAtomId: r[r.length - 1].atomId,
      atomCount: r.length,
      sourceStart: r[0].sourceStart,
      sourceEnd: r[r.length - 1].sourceEnd,
    }));
  const blockOf = new Map<string, NonEditorialBlock>();
  for (const b of blocks) {
    for (const a of atoms) {
      if (a.sourceStart >= b.sourceStart && a.sourceEnd <= b.sourceEnd)
        blockOf.set(a.atomId, b);
    }
  }
  return {
    version: EDITORIAL_STRUCTURE_VERSION,
    minRun,
    atoms: atoms.map((a) => {
      const b = blockOf.get(a.atomId);
      return b
        ? {
            ...a,
            editorial: false,
            nonEditorial: { reason: b.reason, blockId: b.blockId },
          }
        : { ...a, editorial: true };
    }),
    blocks,
  };
}

// ---------------------------------------------------------------------------
// Span location. The atom contract's own containment rule: case, accents,
// emphasis/escape/quote characters and whitespace runs are ignored, and a
// match maps back to source offsets. It answers "where in this atom is this
// span", not "is this the same place" (identity stays with the resolver).
// ---------------------------------------------------------------------------
const FOLD_DROP = /[*_`\\"'“”‘’«»]/u;

function foldWithMap(s: string): PresentedText {
  let out = '';
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (FOLD_DROP.test(c)) continue;
    if (/\s/u.test(c)) {
      if (out.length && out[out.length - 1] !== ' ') {
        out += ' ';
        map.push(i);
      }
      continue;
    }
    for (const f of c
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()) {
      out += f;
      map.push(i);
    }
  }
  while (out.endsWith(' ')) {
    out = out.slice(0, -1);
    map.pop();
  }
  return { text: out, map };
}

/** Case/accent/markup-insensitive comparison form used by the atom contract. */
export function foldAtomText(s: string | undefined | null): string {
  return foldWithMap(String(s ?? '')).text;
}

/** Source range of `span` inside `atom`, or null when it is not contained. */
export function locateSpanInAtom(
  atom: Pick<SourceAtom, 'text' | 'sourceStart'>,
  span: string,
): { sourceStart: number; sourceEnd: number } | null {
  const needle = foldAtomText(span);
  if (!needle) return null;
  const shown = presentAtomText(atom.text);
  const folded = foldWithMap(shown.text);
  const at = folded.text.indexOf(needle);
  if (at === -1) return null;
  const firstShown = folded.map[at];
  const lastShown = folded.map[at + needle.length - 1];
  return {
    sourceStart: atom.sourceStart + shown.map[firstShown],
    sourceEnd: atom.sourceStart + shown.map[lastShown] + 1,
  };
}

/**
 * The visible text of a heading atom: its marker, link targets and emphasis
 * removed, whitespace collapsed. Presentation only; used for a source-derived
 * candidate name.
 */
export function visibleHeadingText(text: string): string {
  return text
    .replace(/^\s{0,3}#{1,6}\s+/u, '')
    .replace(/\s+#+\s*$/u, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/[*_`]+/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}
