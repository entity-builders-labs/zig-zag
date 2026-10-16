/**
 * Formatting normalization only (case, accents, punctuation to spaces): it
 * compares the same characters, never words to other words.
 */
function normalizeSurface(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * True when `span` occurs in `text` on token boundaries ("arte" is in "quiero
 * arte moderno", not in "el martes"). Used to check that evidence an
 * extractor quotes is really present in the traveller's text.
 */
export function containsTokenBoundedSpan(text: string, span: string): boolean {
  const haystack = normalizeSurface(text);
  const needle = normalizeSurface(span);
  return needle.length > 0 && ` ${haystack} `.includes(` ${needle} `);
}
