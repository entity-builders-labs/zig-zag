/**
 * Identity of one piece of grounded evidence for de-duplication inside a
 * single provider response: the same snippet text from the same URL,
 * ignoring case and whitespace. Shared by every grounded-search adapter so
 * "duplicate evidence" means one thing regardless of provider.
 */
export function groundingEvidenceDedupeKey(
  snippet: string,
  url: string | undefined,
): string {
  const normalize = (value: string) =>
    value.replace(/\s+/g, ' ').trim().toLowerCase();
  return `${normalize(snippet)}\n${normalize(url ?? '')}`;
}
