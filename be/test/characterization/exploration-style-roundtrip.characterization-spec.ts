import { candidateMatchesPreferenceFacet } from '../../src/modules/tours/utils/preference-facet-matching.util';
import { semanticFacts } from '../../src/modules/tours/utils/experience-match-facts.util';
import { SemanticTarget } from '../../src/modules/tours/preferences/preference-assertion.interface';
import { StructuredExperienceCandidateSynthesizerService } from '../../src/modules/tours/services/structured-experience-candidate-synthesizer.service';
import {
  structuredLandmarkAObservation,
  structuredPlaceBObservation,
  syntheticDimensionedExperience,
} from './support/observations';

/**
 * TEST 2 — EXPLORATION-STYLE / OPEN-TRAIT MATCHER SEMANTICS (unit level)
 *
 * Since task 25.4, `explorationStyle` is a composition-local tilt and never a
 * facet, and the open `trait` dimension has no shared typed identity, so
 * neither is matched by string equality. The former pins of
 * `exploration_style` / `trait:<key>` facet matching and of the deleted
 * lexical preference evaluator's `positiveRatio` dilution characterized a
 * discarded contract and were removed.
 *
 * Pinned here:
 *  - `exploration_style` and `trait` facets never match, even against
 *    persisted relational traits or explicit dimensioned evidence;
 *  - the structured synthesizer emits no dimensioned evidence at all, so no
 *    typed `tourism_intensity` / `local_character` fact can discriminate a
 *    structured-acquired Experience (the exploration tilt has no producer).
 */

// Accepts non-target dimensions so the matcher's rejection is observable.
const facet = (dimension: string, key: string): SemanticTarget =>
  ({ dimension, key }) as SemanticTarget;

describe('CHAR-2 exploration-style / open-trait matcher semantics', () => {
  it('a relational trait carried as dimension:"general" satisfies neither exploration_style nor trait:<key>', () => {
    // Shape produced by projectVerifiedExperienceRow from a TraitDefinition
    // whose dimension is hardcoded 'general' (see resolveOrCreateTraitDefinitions).
    const experienceAsPersisted = {
      canonicalName: 'Structured Landmark A',
      description: 'A structured landmark.',
      themes: ['history'],
      traits: ['iconic'],
      intents: [] as string[],
      dimensionedTraits: [{ dimension: 'general', key: 'iconic' }],
      metadata: {
        themes: ['history'],
        traits: ['iconic'],
        dimensionedTraits: [{ dimension: 'general', key: 'iconic' }],
      },
    };

    expect(
      candidateMatchesPreferenceFacet(
        semanticFacts(experienceAsPersisted),
        facet('exploration_style', 'iconic'),
      ),
    ).toBe(false);
    expect(
      candidateMatchesPreferenceFacet(
        semanticFacts(experienceAsPersisted),
        facet('trait', 'iconic'),
      ),
    ).toBe(false);
  });

  it('explicit dimensioned evidence matches its typed dimension only, never an exploration_style facet (SYNTHETIC controlled fixture)', () => {
    // syntheticDimensionedExperience is hand-authored, NOT provider-derived.
    // The catalog projection lifts persisted metadata.dimensionedTraits to
    // the row before the adapter; the matcher itself never reads metadata.
    const persisted = syntheticDimensionedExperience(
      'tourism_intensity',
      'iconic',
    ) as { metadata: { dimensionedTraits: unknown[] } };
    const dimensioned = {
      dimensionedTraits: persisted.metadata.dimensionedTraits,
    };
    expect(
      candidateMatchesPreferenceFacet(
        semanticFacts(dimensioned),
        facet('tourism_intensity', 'iconic'),
      ),
    ).toBe(true);
    expect(
      candidateMatchesPreferenceFacet(
        semanticFacts(dimensioned),
        facet('exploration_style', 'iconic'),
      ),
    ).toBe(false);
  });

  it('the structured synthesizer emits NO dimensioned evidence for a raw OSM place, so no typed tourism_intensity / local_character key can match it', () => {
    const synth = new StructuredExperienceCandidateSynthesizerService();
    for (const obs of [
      structuredLandmarkAObservation(),
      structuredPlaceBObservation(),
    ]) {
      const [proposal] = synth.synthesizeProposals([obs]);
      const c: any = proposal.candidate;
      expect(c.traits).toEqual([]);
      expect(c.dimensionedTraits ?? []).toEqual([]);
      expect((c.metadata as any)?.dimensionedTraits ?? []).toEqual([]);
      const hydrated = {
        canonicalName: c.name,
        description: c.description,
        themes: c.themes,
        traits: c.traits,
        intents: c.intents,
        metadata: { themes: c.themes, traits: c.traits, intents: c.intents },
      };
      for (const target of [
        facet('tourism_intensity', 'iconic'),
        facet('tourism_intensity', 'local'),
        facet('local_character', 'authentic'),
      ]) {
        expect(
          candidateMatchesPreferenceFacet(semanticFacts(hydrated), target),
        ).toBe(false);
      }
    }
  });
});
