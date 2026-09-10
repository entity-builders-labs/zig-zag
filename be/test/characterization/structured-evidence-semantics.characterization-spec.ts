import { StructuredExperienceCandidateSynthesizerService } from '../../src/modules/tours/services/structured-experience-candidate-synthesizer.service';
import { StructuredCandidateCorroborationService } from '../../src/modules/tours/services/structured-candidate-corroboration.service';
import { evaluateExperiencePreferences } from '../../src/modules/tours/utils/experience-preference-evaluator.util';
import { CoverageAnalyzer } from '../../src/modules/tours/services/coverage-analyzer.service';
import {
  osmArtMuseumObservation,
  osmHistoricMonumentObservation,
  placesHistoricalLandmarkObservation,
} from './support/observations';

/**
 * TEST 1 — STRUCTURED EVIDENCE -> SEMANTIC PRESERVATION
 *
 * Does objective structured-provider evidence (OSM tags, Google Places types)
 * survive into the persisted Experience semantics (themes/traits/intents)?
 *
 * Characterization: current behavior is that it does NOT — the synthesizer is
 * "strictly mechanical" and hardcodes empty facet arrays; corroboration can
 * only union what already exists; the resolver persists verbatim. This file
 * pins the synthesis/corroboration boundary. The persist -> hydrate ->
 * evaluate consequence is pinned in
 * `structured-evidence-semantics.db.characterization-spec.ts`.
 */
describe('CHAR-1 structured evidence -> semantic preservation', () => {
  const synth = new StructuredExperienceCandidateSynthesizerService();
  const corroboration = new StructuredCandidateCorroborationService();

  const cases = [
    { name: 'OSM historic monument', obs: osmHistoricMonumentObservation() },
    { name: 'OSM art museum', obs: osmArtMuseumObservation() },
    {
      name: 'Google Places historical_landmark',
      obs: placesHistoricalLandmarkObservation(),
    },
  ];

  for (const { name, obs } of cases) {
    it(`synthesizer discards the objective semantics of: ${name}`, () => {
      const [proposal] = synth.synthesizeProposals([obs]);

      // The raw evidence carries an unambiguous factual classification...
      const tags =
        (obs.metadata as any)?.osmTags ?? (obs.metadata as any) ?? {};
      const factualSignal = JSON.stringify(tags);
      expect(factualSignal).toMatch(/historic|museum|historical_landmark/i);

      // ...but the synthesized candidate is semantically blank.
      expect(proposal.candidate.themes).toEqual([]);
      expect(proposal.candidate.traits).toEqual([]);
      expect(proposal.candidate.intents).toEqual([]);

      // Corroboration of a single structured proposal cannot recover it
      // (it unions facets, and the union of [] is []).
      const merged = corroboration.corroborateAndMerge([proposal]);
      expect(merged.candidates).toHaveLength(1);
      expect(merged.candidates[0].themes).toEqual([]);
      expect(merged.candidates[0].traits).toEqual([]);
      expect(merged.candidates[0].intents).toEqual([]);
    });
  }

  it('a facet-less monument scores preferenceScore 0 for a "history" request even though it is objectively historical', () => {
    const [proposal] = synth.synthesizeProposals([
      osmHistoricMonumentObservation(),
    ]);
    // Shape it like a hydrated catalog Experience.
    const hydrated = {
      canonicalName: proposal.candidate.name,
      description: proposal.candidate.description,
      themes: proposal.candidate.themes,
      traits: proposal.candidate.traits,
      intents: proposal.candidate.intents,
      metadata: {
        themes: proposal.candidate.themes,
        traits: proposal.candidate.traits,
        intents: proposal.candidate.intents,
        source: 'grounded_experience_discovery',
      },
    };

    const evaluation = evaluateExperiencePreferences(hydrated, {
      preferredFacets: [
        {
          dimension: 'theme',
          key: 'history',
          importance: 1,
          confidence: 1,
          source: 'wizard',
        },
      ],
      excludedThemes: [],
      excludedTraits: [],
      hardExclusions: [],
      softConstraints: [],
      ambiguities: [],
      dietaryPreferences: [],
      accessibilityPreferences: [],
      budgetPreferences: [],
      groupPreferences: [],
      positiveSemanticQuery: '',
      notes: [],
    } as any);

    // DEFECT: an objectively historical monument is invisible to the
    // preference signal.
    expect(evaluation.facetMatches[0].matched).toBe(false);
    expect(evaluation.score).toBe(0);
  });

  it('CoverageAnalyzer DOES count the same facet-less monument as "history" (keyword/name/JSON scan) — the two layers disagree', () => {
    const analyzer = new CoverageAnalyzer();
    const report = analyzer.analyze({
      candidates: [
        {
          id: 'mon-1',
          name: 'Monumento Histórico',
          description: 'A historic monument recorded in OpenStreetMap.',
          source: 'osm',
          themes: [],
          traits: [],
          intents: [],
          metadata: { themes: [], traits: [], intents: [] },
        } as any,
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

    const historyCoverage = report.requestedThemeCoverage.find(
      (c) => c.theme === 'history',
    );
    // Coverage says covered (name contains "histór"); the preference
    // evaluator (test above) says NOT covered. Two incompatible truths.
    expect(historyCoverage?.strongMatchCount).toBeGreaterThanOrEqual(1);
  });
});
