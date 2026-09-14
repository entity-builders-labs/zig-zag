/**
 * Minimal candidate shape the candidate_pool trace step needs in order to
 * tag each offered candidate with the requested themes it actually matches
 * — based only on its name/source/metadata, never on a CoverageAnalyzer-
 * era candidate contract (that engine no longer exists).
 */
export interface ThemeMatchCandidate {
  id: string;
  name: string;
  source?: string | null;
  metadata?: unknown;
  /** Canonical facet evaluation supplied by the caller; trace rendering does
   * not infer factual coverage from names or metadata. */
  matchedThemes?: string[];
}
export const THEME_KEYWORDS: Record<string, readonly string[]> = {
  history: ['history', 'historic', 'historical', 'monument', 'museum'],
  art: ['art', 'gallery', 'museum', 'art_museum', 'art_gallery'],
  culture: ['culture', 'cultural', 'museum', 'theater', 'heritage'],
  architecture: ['architecture', 'architect', 'building', 'church'],
  beach: ['beach', 'playa', 'coast', 'shore'],
  food: ['food', 'restaurant', 'cafe', 'market', 'bakery'],
  nightlife: ['nightlife', 'bar', 'club', 'night_club'],
};

export function matchesThemeKeywords(
  candidate: ThemeMatchCandidate,
  keywords: readonly string[],
): boolean {
  const metadataText =
    candidate.metadata && typeof candidate.metadata === 'object'
      ? JSON.stringify(candidate.metadata).toLowerCase()
      : '';
  const haystack = [candidate.name, candidate.source, metadataText]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

/** Requested themes this candidate actually matches, via the same keyword
 * logic above — the one canonical source for a candidate_pool trace's
 * per-candidate coverageContribution. */
export function matchedThemesFor(
  candidate: ThemeMatchCandidate,
  requestedThemes: string[],
): string[] {
  return requestedThemes.filter((theme) => {
    const normalizedTheme = theme.trim().toLowerCase();
    const keywords = THEME_KEYWORDS[normalizedTheme] ?? [normalizedTheme];
    return matchesThemeKeywords(candidate, keywords);
  });
}
