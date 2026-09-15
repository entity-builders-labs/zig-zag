import { StructuredExperienceCandidateSynthesizerService } from '../../src/modules/tours/services/structured-experience-candidate-synthesizer.service';
import { StructuredCandidateCorroborationService } from '../../src/modules/tours/services/structured-candidate-corroboration.service';
import { evaluateExperiencePreferences } from '../../src/modules/tours/utils/experience-preference-evaluator.util';
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
      const merged = corroboration.corroborateAndMerge(
        [proposal],
        ['SINGLE_PLACE'],
      );
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

  // The former "CoverageAnalyzer disagrees with the preference evaluator"
  // case (two contradictory keyword-matching primitives) was removed here:
  // CoverageAnalyzer itself was deleted in the preference-first cutover
  // (M2) -- FacetRetrievalService/candidateMatchesPreferenceFacet is now
  // the ONE facet-truth primitive, so this specific contradiction no
  // longer exists to characterize.
});
