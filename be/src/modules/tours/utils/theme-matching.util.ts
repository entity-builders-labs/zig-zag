import { CoverageCandidate } from '../interfaces/coverage-analysis.interface';

// Extracted from CoverageAnalyzer so PR 9's candidate_pool trace can tag
// each offered candidate with the requested themes it actually matches
// without forking a second copy — same "centralized, never diverges"
// principle already applied to EXPERIENCE_FORMAT_ACTIVITY_KIND
// (experience-format-kind.util.ts).
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
  candidate: CoverageCandidate,
  keywords: readonly string[],
): boolean {
  const metadataText =
    candidate.metadata && typeof candidate.metadata === 'object'
      ? JSON.stringify(candidate.metadata).toLowerCase()
      : '';
  const haystack = [
    candidate.name,
    candidate.type,
    candidate.knownActivityTypeName,
    candidate.source,
    metadataText,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

/** Requested themes this candidate actually matches, using the same keyword
 * logic CoverageAnalyzer uses for its per-theme summary — so a candidate_pool
 * trace's per-candidate coverageContribution can never diverge from what
 * CoverageAnalyzer itself counted. */
export function matchedThemesFor(
  candidate: CoverageCandidate,
  requestedThemes: string[],
): string[] {
  return requestedThemes.filter((theme) => {
    const normalizedTheme = theme.trim().toLowerCase();
    const keywords = THEME_KEYWORDS[normalizedTheme] ?? [normalizedTheme];
    return matchesThemeKeywords(candidate, keywords);
  });
}
