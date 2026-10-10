/// <reference lib="es2022.intl" />
/**
 * Script-aware literal matching of names inside source text (RW4 source
 * locality recovery, amendment §19.1).
 *
 * The question answered is narrow: does this source text literally contain
 * this name as whole words? There is no fuzzy, alias, translation or
 * transliteration matching, so a name written in another script never
 * matches ("Tokyo" never matches "東京").
 *
 * Folding:
 *  - NFKD compatibility forms (full-width Latin, half-width kana) are
 *    unified, then recomposed with NFC.
 *  - Diacritics are removed from Latin letters only ("Luján" = "Lujan").
 *    Marks of other scripts are kept, because they distinguish words there
 *    (Japanese dakuten: "ガ" is not "カ"; Cyrillic "й" is not "и").
 *  - Case is folded and every character that is not a letter, a number or
 *    a combining mark becomes a word break.
 *
 * Word boundaries are the folded text's spaces plus the Unicode word
 * boundaries ICU reports (`Intl.Segmenter`). That is what makes scripts
 * written without spaces (Japanese, Chinese, Thai) work: "青山カフェ" is
 * found in "青山カフェは東京都渋谷区にあります", but "山カフェ" is not, because
 * it starts in the middle of the word "青山". A name glued to a suffix the
 * segmenter keeps in the same word (a Korean particle: "강남구에") is not
 * found. That fails closed: the fact is missing, never invented.
 */

const LATIN_LETTER_WITH_DIACRITICS = /(\p{Script=Latin})[̀-ͯ]+/gu;
const NOT_WORD_CHARACTER = /[^\p{L}\p{N}\p{M}]+/gu;
const HAS_WORD_CHARACTER = /[\p{L}\p{N}]/u;
const WORD_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'word' });

export function foldLiteralText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(LATIN_LETTER_WITH_DIACRITICS, '$1')
    .normalize('NFC')
    .toLowerCase()
    .replace(NOT_WORD_CHARACTER, ' ')
    .trim();
}

function wordBoundaries(folded: string): Set<number> {
  const boundaries = new Set<number>([0, folded.length]);
  for (const { index, segment } of WORD_SEGMENTER.segment(folded)) {
    boundaries.add(index);
    boundaries.add(index + segment.length);
  }
  return boundaries;
}

/** A whole-word occurrence, in the coordinates of `foldLiteralText(text)`. */
export interface LiteralOccurrence {
  start: number;
  end: number;
}

/** Every whole-word occurrence of `name` in `text`, after folding both. */
export function literalOccurrences(
  text: string,
  name: string,
): LiteralOccurrence[] {
  const needle = foldLiteralText(name);
  if (!HAS_WORD_CHARACTER.test(needle)) return [];
  const haystack = foldLiteralText(text);
  const boundaries = wordBoundaries(haystack);
  const occurrences: LiteralOccurrence[] = [];
  for (
    let start = haystack.indexOf(needle);
    start !== -1;
    start = haystack.indexOf(needle, start + 1)
  ) {
    const end = start + needle.length;
    if (boundaries.has(start) && boundaries.has(end)) {
      occurrences.push({ start, end });
    }
  }
  return occurrences;
}

export function textNamesLiterally(text: string, name: string): boolean {
  return literalOccurrences(text, name).length > 0;
}

/** Whether two names are the same literal name after folding. */
export function sameLiteralName(left: string, right: string): boolean {
  const folded = foldLiteralText(left);
  return HAS_WORD_CHARACTER.test(folded) && folded === foldLiteralText(right);
}

export function occurrencesOverlap(
  left: LiteralOccurrence,
  right: LiteralOccurrence,
): boolean {
  return left.start < right.end && right.start < left.end;
}

const MARKDOWN_IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const MARKDOWN_LINK = /\[([^\]]+)\]\([^)]*\)/g;
const MARKDOWN_EMPHASIS = /[*_~`#]+/g;
const STATEMENT_BREAK = /(?<=[.!?])\s+|(?<=[。！？｡؟।])\s*|\n+/;

/**
 * The visible statements of a source text: its sentences, list entries,
 * headings and captions, in source order and with Markdown reduced to its
 * visible text.
 *
 * An image's alternative text is its own statement, separate from the
 * caption written after it, because the two are different statements even
 * when Markdown puts them on one line. A caption is a statement like any
 * other: it is attributed to a component only by naming it.
 */
export function sourceStatements(text: string): string[] {
  return text
    .replace(MARKDOWN_IMAGE, '\n$1\n')
    .replace(MARKDOWN_LINK, '$1')
    .replace(MARKDOWN_EMPHASIS, ' ')
    .split(STATEMENT_BREAK)
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter((statement) => HAS_WORD_CHARACTER.test(statement));
}
