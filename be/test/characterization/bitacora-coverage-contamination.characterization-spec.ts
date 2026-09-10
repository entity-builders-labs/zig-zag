import { buildExperienceCandidatePoolStep } from '../../src/modules/tours/utils/generation-trace-builder.util';
import { matchedThemesFor } from '../../src/modules/tours/utils/theme-matching.util';

/**
 * TEST 4 — BITÁCORA MUST NOT SELF-CONTAMINATE COVERAGE
 *
 * `ExperienceGenerationService.buildCandidatePoolTraceStep` builds each offered
 * candidate's trace `metadata` as:
 *
 *   { ...experience.metadata, preferenceEvaluation, hardExclusionRelaxed }
 *
 * `buildExperienceCandidatePoolStep` then computes `coverageContribution.themes`
 * via `matchedThemesFor` -> `matchesThemeKeywords`, which scans
 * `JSON.stringify(candidate.metadata)`. Because `preferenceEvaluation`
 * (which we inject) contains the requested theme NAMES as facet keys — even
 * with `matched: false` — the trace claims the candidate covers themes it
 * explicitly failed to match.
 *
 * INVARIANT: `coverageContribution.themes` must not contain a theme solely
 * because the theme's name appears inside diagnostic metadata we injected.
 */

/** Reproduces buildCandidatePoolTraceStep's per-candidate metadata shape. */
function offeredCandidateWithInjectedEvaluation() {
  const preferenceEvaluation = {
    score: 0,
    positiveMatches: [] as string[],
    negativeMatches: [] as string[],
    exclusionMatches: [] as string[],
    reasons: [] as string[],
    facetMatches: [
      { dimension: 'theme', key: 'history', matched: false },
      { dimension: 'theme', key: 'culture', matched: false },
      { dimension: 'theme', key: 'architecture', matched: false },
    ],
  };
  const experienceMetadata = {
    themes: [] as string[],
    traits: [] as string[],
    intents: [] as string[],
  };
  return {
    id: 'unrelated-1',
    name: 'Completely Unrelated Candidate',
    metadata: {
      ...experienceMetadata,
      preferenceEvaluation,
      hardExclusionRelaxed: false,
    },
    traceSource: 'db' as const,
    scoreBreakdown: {
      semanticSimilarity: 0.1,
      preferenceScore: 0,
      preferenceBonus: 0,
      qualityBonus: 0,
      proximityBonus: 0,
      diversityBonus: 0,
      totalScore: 0.1,
    },
  };
}

describe('CHAR-4 bitácora coverage self-contamination', () => {
  it('CHARACTERIZATION: matchedThemesFor returns the injected theme names for an unrelated, unmatched candidate', () => {
    const candidate = offeredCandidateWithInjectedEvaluation();
    const themes = matchedThemesFor(candidate as any, [
      'history',
      'culture',
      'architecture',
    ]);
    // eslint-disable-next-line no-console
    console.info('[CHAR-4] matchedThemesFor =>', JSON.stringify(themes));
    // Current (buggy) behavior: the JSON.stringify scan finds "history" /
    // "culture" / "architecture" inside the injected facetMatches keys.
    expect(themes).toEqual(
      expect.arrayContaining(['history', 'culture', 'architecture']),
    );
  });

  it('CHARACTERIZATION: the full candidate_pool step reports coverageContribution.themes it never matched', () => {
    const step = buildExperienceCandidatePoolStep({
      initialCatalogCount: 1,
      postAcquisitionCatalogCount: 1,
      eligibleCount: 1,
      offeredCandidates: [offeredCandidateWithInjectedEvaluation()] as any,
      requestedThemes: ['history', 'culture', 'architecture'],
    });
    const traceCandidate = (step as any).candidates[0];
    // eslint-disable-next-line no-console
    console.info(
      '[CHAR-4] coverageContribution =>',
      JSON.stringify(traceCandidate.coverageContribution),
    );
    expect(traceCandidate.coverageContribution.themes.length).toBeGreaterThan(
      0,
    );
  });

  it.failing(
    'INVARIANT: a candidate whose preferenceEvaluation says every requested theme matched=false must have coverageContribution.themes = []',
    () => {
      const step = buildExperienceCandidatePoolStep({
        initialCatalogCount: 1,
        postAcquisitionCatalogCount: 1,
        eligibleCount: 1,
        offeredCandidates: [offeredCandidateWithInjectedEvaluation()] as any,
        requestedThemes: ['history', 'culture', 'architecture'],
      });
      expect((step as any).candidates[0].coverageContribution.themes).toEqual(
        [],
      );
    },
  );
});
