import { candidateMatchesPreferenceFacet } from '../../src/modules/tours/utils/preference-facet-matching.util';
import { evaluateExperiencePreferences } from '../../src/modules/tours/utils/experience-preference-evaluator.util';
import { StructuredExperienceCandidateSynthesizerService } from '../../src/modules/tours/services/structured-experience-candidate-synthesizer.service';
import {
  osmIconicPlaceObservation,
  osmHiddenLocalPlaceObservation,
} from './support/observations';

/**
 * TEST 2 — EXPLORATION-STYLE ROUND-TRIP
 *
 * `explorationStyle` (iconic / local_deep_dive) becomes one `exploration_style`
 * PreferenceFacet. `candidateMatchesPreferenceFacet` matches it ONLY against
 * explicit dimensioned evidence for `tourism_intensity` / `local_character`
 * (`hasExplicitDimensionedEvidence`) — never themes, name, description, or a
 * relational trait string.
 *
 * Characterization goals:
 *  - the ONLY persisted shape that can satisfy `exploration_style` is
 *    `metadata.dimensionedTraits: [{dimension:'tourism_intensity', key:...}]`
 *    (or `metadata.preferenceFacets` / `metadata.dimensions`);
 *  - the structured acquisition pipeline never produces that shape
 *    (`resolveOrCreateTraitDefinitions` flattens every trait to
 *    `dimension:'general'`; the synthesizer emits `traits: []`);
 *  - therefore `explorationStyle` produces ZERO directional ranking difference
 *    for a structured-acquired catalog, and instead only DILUTES `positiveRatio`
 *    (its weight is always in the denominator whether or not it can ever match).
 */

const wizardFacet = (dimension: string, key: string) => ({
  dimension,
  key,
  importance: 1,
  confidence: 1,
  source: 'wizard' as const,
});

const baseIntent = (): any => ({
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

describe('CHAR-2 exploration-style round-trip', () => {
  it('a relational-trait "iconic" (dimension:"general" — what resolveOrCreateTraitDefinitions writes) does NOT satisfy exploration_style:iconic', () => {
    const experienceAsPersisted = {
      canonicalName: 'Iconic City Landmark',
      description: 'A nationally iconic landmark.',
      themes: ['history'],
      traits: ['iconic'],
      intents: [] as string[],
      // projectVerifiedExperienceRow builds this from
      // experience.traits.map(t => ({dimension: t.traitDefinition.dimension, ...}))
      // and every relational TraitDefinition dimension is hardcoded 'general'.
      dimensionedTraits: [{ dimension: 'general', key: 'iconic' }],
      metadata: {
        themes: ['history'],
        traits: ['iconic'],
        dimensionedTraits: [{ dimension: 'general', key: 'iconic' }],
      },
    };

    expect(
      candidateMatchesPreferenceFacet(
        experienceAsPersisted,
        wizardFacet('exploration_style', 'iconic'),
      ),
    ).toBe(false);
    // ...even though the plain trait dimension DOES match a `trait` facet:
    expect(
      candidateMatchesPreferenceFacet(
        experienceAsPersisted,
        wizardFacet('trait', 'iconic'),
      ),
    ).toBe(true);
  });

  it('the ONLY persisted shape that satisfies exploration_style:iconic is an explicit tourism_intensity dimensioned entry', () => {
    const withExplicitDimension = {
      canonicalName: 'Iconic City Landmark',
      themes: ['history'],
      traits: [] as string[],
      intents: [] as string[],
      metadata: {
        dimensionedTraits: [{ dimension: 'tourism_intensity', key: 'iconic' }],
      },
    };
    expect(
      candidateMatchesPreferenceFacet(
        withExplicitDimension,
        wizardFacet('exploration_style', 'iconic'),
      ),
    ).toBe(true);

    // local_deep_dive reads the other end + local_character:authentic
    const hiddenLocal = {
      canonicalName: 'Neighbourhood Passage',
      themes: [] as string[],
      traits: [] as string[],
      intents: [] as string[],
      metadata: {
        dimensions: { local_character: 'authentic' },
      },
    };
    expect(
      candidateMatchesPreferenceFacet(
        hiddenLocal,
        wizardFacet('exploration_style', 'local_deep_dive'),
      ),
    ).toBe(true);
  });

  it('the structured synthesizer emits NO dimensioned evidence for an objectively iconic OR hidden-local OSM place', () => {
    const synth = new StructuredExperienceCandidateSynthesizerService();
    for (const obs of [
      osmIconicPlaceObservation(),
      osmHiddenLocalPlaceObservation(),
    ]) {
      const [proposal] = synth.synthesizeProposals([obs]);
      const c: any = proposal.candidate;
      expect(c.traits).toEqual([]);
      expect(c.dimensionedTraits ?? []).toEqual([]);
      expect((c.metadata as any)?.dimensionedTraits ?? []).toEqual([]);
      // ...so neither exploration_style key can match the synthesized candidate.
      const hydrated = {
        canonicalName: c.name,
        description: c.description,
        themes: c.themes,
        traits: c.traits,
        intents: c.intents,
        metadata: { themes: c.themes, traits: c.traits, intents: c.intents },
      };
      expect(
        candidateMatchesPreferenceFacet(
          hydrated,
          wizardFacet('exploration_style', 'iconic'),
        ),
      ).toBe(false);
      expect(
        candidateMatchesPreferenceFacet(
          hydrated,
          wizardFacet('exploration_style', 'local_deep_dive'),
        ),
      ).toBe(false);
    }
  });

  it('exploration_style only DILUTES positiveRatio — iconic and local_deep_dive dilute a structured catalog identically (no directional signal)', () => {
    // A catalog Experience that perfectly matches the 3 real wizard facets.
    const perfectHistoryWalk = {
      canonicalName: 'Historic Architecture Walk',
      description: 'A walking tour of historic architecture.',
      themes: ['history', 'architecture'],
      traits: [] as string[],
      intents: ['walk'],
      metadata: {
        themes: ['history', 'architecture'],
        traits: [] as string[],
        intents: ['walk'],
      },
    };

    const realFacets = [
      wizardFacet('theme', 'history'),
      wizardFacet('theme', 'architecture'),
      wizardFacet('intent', 'walk'),
    ];

    const withoutStyle = evaluateExperiencePreferences(perfectHistoryWalk, {
      ...baseIntent(),
      preferredFacets: realFacets,
    });
    const withIconic = evaluateExperiencePreferences(perfectHistoryWalk, {
      ...baseIntent(),
      preferredFacets: [
        ...realFacets,
        wizardFacet('exploration_style', 'iconic'),
      ],
    });
    const withLocalDeepDive = evaluateExperiencePreferences(
      perfectHistoryWalk,
      {
        ...baseIntent(),
        preferredFacets: [
          ...realFacets,
          wizardFacet('exploration_style', 'local_deep_dive'),
        ],
      },
    );

    // eslint-disable-next-line no-console
    console.info(
      `[CHAR-2] score without style=${withoutStyle.score} iconic=${withIconic.score} local_deep_dive=${withLocalDeepDive.score}`,
    );

    expect(withoutStyle.score).toBe(1);
    // 3 matched / 4 possible — the exploration_style weight is dead denominator.
    expect(withIconic.score).toBeCloseTo(0.75, 5);
    // iconic and local_deep_dive are indistinguishable for this catalog.
    expect(withLocalDeepDive.score).toBe(withIconic.score);
  });

  it.failing(
    'INVARIANT: choosing explorationStyle:iconic vs local_deep_dive must be able to change the preference score of at least one structured-acquired Experience',
    () => {
      const synth = new StructuredExperienceCandidateSynthesizerService();
      const iconicPlace = synth.synthesizeProposals([
        osmIconicPlaceObservation(),
      ])[0].candidate as any;
      const hydrated = {
        canonicalName: iconicPlace.name,
        description: iconicPlace.description,
        themes: iconicPlace.themes,
        traits: iconicPlace.traits,
        intents: iconicPlace.intents,
        metadata: {
          themes: iconicPlace.themes,
          traits: iconicPlace.traits,
          intents: iconicPlace.intents,
        },
      };
      const iconic = evaluateExperiencePreferences(hydrated, {
        ...baseIntent(),
        preferredFacets: [wizardFacet('exploration_style', 'iconic')],
      });
      const local = evaluateExperiencePreferences(hydrated, {
        ...baseIntent(),
        preferredFacets: [wizardFacet('exploration_style', 'local_deep_dive')],
      });
      expect(iconic.score).not.toBe(local.score);
    },
  );
});
