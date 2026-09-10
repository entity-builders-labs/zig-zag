import { CoverageAnalyzer } from '../../src/modules/tours/services/coverage-analyzer.service';
import {
  evaluateExperiencePreferences,
  PreferenceEvaluation,
} from '../../src/modules/tours/utils/experience-preference-evaluator.util';
import { candidateMatchesPreferenceFacet } from '../../src/modules/tours/utils/preference-facet-matching.util';

/**
 * TEST 3 — COVERAGE vs RANKING CONSISTENCY
 *
 * `CoverageAnalyzer` (keyword expansion + name + JSON.stringify(metadata) scan)
 * and the preference evaluator (`candidateMatchesPreferenceFacet`: exact
 * normalized match on themes[] only) use contradictory definitions of "does
 * this Experience satisfy theme X". This test enumerates the contradictions.
 *
 * The suite separates a definite normalization invariant from the still-open
 * question of whether coverage and final preference ranking intentionally use
 * different evidence thresholds.
 */
const emptyIntent = (): any => ({
  preferredFacets: [] as any[],
  excludedThemes: [] as string[],
  excludedTraits: [] as string[],
  hardExclusions: [] as string[],
  softConstraints: [] as string[],
  ambiguities: [] as string[],
  dietaryPreferences: [] as string[],
  accessibilityPreferences: [] as string[],
  budgetPreferences: [] as string[],
  groupPreferences: [] as string[],
  positiveSemanticQuery: '',
  notes: [] as string[],
});

const historyFacet = {
  dimension: 'theme',
  key: 'history',
  importance: 1,
  confidence: 1,
  source: 'wizard' as const,
};

interface Cand {
  id: string;
  canonicalName: string;
  description: string;
  themes: string[];
  /** Observed CURRENT behavior (characterization, not aspiration). */
  expected: { coverage: boolean; facetMatch: boolean; score: number };
}

const candidates: Cand[] = [
  {
    id: 'a',
    // "Histórico" (accented ó) does NOT substring-match the ASCII "historic"
    // keyword, so CoverageAnalyzer does NOT count this Spanish-named museum.
    canonicalName: 'Museo Histórico Provincial',
    description: 'Provincial history museum.',
    themes: [],
    expected: { coverage: false, facetMatch: false, score: 0 },
  },
  {
    id: 'b',
    // "Monumento" DOES substring-match the "monument" keyword -> coverage true,
    // but themes[] is empty -> the preference evaluator says NOT history.
    canonicalName: 'Monumento Nacional',
    description: 'A national monument.',
    themes: [],
    expected: { coverage: true, facetMatch: false, score: 0 },
  },
  {
    id: 'c',
    canonicalName: 'Experiencia Histórica',
    description: 'A curated history experience.',
    themes: ['history'],
    expected: { coverage: true, facetMatch: true, score: 1 },
  },
  {
    id: 'd',
    canonicalName: 'Feria de Diseño Contemporáneo',
    description: 'A contemporary design fair.',
    themes: [],
    expected: { coverage: false, facetMatch: false, score: 0 },
  },
];

function coverageSaysHistory(c: Cand): boolean {
  const report = new CoverageAnalyzer().analyze({
    candidates: [
      {
        id: c.id,
        name: c.canonicalName,
        description: c.description,
        source: 'db',
        themes: c.themes,
        traits: [],
        intents: [],
        metadata: { themes: c.themes, traits: [], intents: [] },
      },
    ],
    requestedThemes: ['history'],
    requestedTraits: [],
    requestedIntents: [],
    days: 1,
    travelPace: 'moderate',
    explorationStyle: 'balanced',
    semanticCoverage: {
      status: 'not_requested',
      eligibleCandidateCount: 1,
      indexedCandidateCount: 0,
    },
    offeredCandidateCount: 1,
  } as any);
  const cov = report.requestedThemeCoverage.find((t) => t.theme === 'history');
  return (cov?.strongMatchCount ?? 0) >= 1;
}

function preferenceSaysHistory(c: Cand): {
  facetMatch: boolean;
  evaluation: PreferenceEvaluation;
} {
  const hydrated = {
    canonicalName: c.canonicalName,
    description: c.description,
    themes: c.themes,
    traits: [] as string[],
    intents: [] as string[],
    metadata: {
      themes: c.themes,
      traits: [] as string[],
      intents: [] as string[],
    },
  };
  return {
    facetMatch: candidateMatchesPreferenceFacet(hydrated, historyFacet),
    evaluation: evaluateExperiencePreferences(hydrated, {
      ...emptyIntent(),
      preferredFacets: [historyFacet],
    } as any),
  };
}

describe('CHAR-3 coverage vs ranking — do they agree on "history"?', () => {
  const table: Array<{ id: string; coverage: boolean; preference: boolean }> =
    [];

  for (const c of candidates) {
    it(`${c.id} "${c.canonicalName}" (themes=${JSON.stringify(c.themes)})`, () => {
      const coverage = coverageSaysHistory(c);
      const { facetMatch, evaluation } = preferenceSaysHistory(c);
      table.push({ id: c.id, coverage, preference: facetMatch });
      // eslint-disable-next-line no-console
      console.info(
        `[CHAR-3] ${c.id} coverage=${coverage} preferenceFacet=${facetMatch} score=${evaluation.score}`,
      );
      // Characterization: pin the exact observed behavior per candidate.
      expect(coverage).toBe(c.expected.coverage);
      expect(facetMatch).toBe(c.expected.facetMatch);
      expect(evaluation.score).toBe(c.expected.score);
    });
  }

  it('CHARACTERIZATION: coverage and the preference evaluator disagree on "Monumento Nacional"', () => {
    const b = candidates.find((c) => c.id === 'b')!;
    expect(coverageSaysHistory(b)).toBe(true);
    expect(preferenceSaysHistory(b).facetMatch).toBe(false);
  });

  it('CHARACTERIZATION: coverage keyword matching is accent-naive — a Spanish "Histórico" name is invisible to CoverageAnalyzer', () => {
    const accented = candidates.find((c) => c.id === 'a')!;
    const ascii: Cand = {
      ...accented,
      canonicalName: 'Historic Provincial Museum',
    };
    // Same semantic place, only the accent differs -> different coverage verdict.
    expect(coverageSaysHistory(accented)).toBe(false);
    expect(coverageSaysHistory(ascii)).toBe(true);
  });

  it.failing(
    'INVARIANT: equivalent normalized textual evidence must not change coverage solely because of accents/diacritics',
    () => {
      const accented = candidates.find((c) => c.id === 'a')!;
      const ascii: Cand = {
        ...accented,
        canonicalName: 'Historic Provincial Museum',
      };
      expect(coverageSaysHistory(accented)).toBe(coverageSaysHistory(ascii));
    },
  );

  it('OPEN DESIGN: coverage and preference ranking may use different evidence rules', () => {
    const b = candidates.find((c) => c.id === 'b')!;
    expect(coverageSaysHistory(b)).toBe(true);
    expect(preferenceSaysHistory(b).facetMatch).toBe(false);
  });
});
