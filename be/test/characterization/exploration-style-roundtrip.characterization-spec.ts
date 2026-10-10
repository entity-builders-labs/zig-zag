import { candidateMatchesPreferenceFacet } from '../../src/modules/tours/utils/preference-facet-matching.util';
import { evaluateExperiencePreferences } from '../../src/modules/tours/utils/experience-preference-evaluator.util';
import { StructuredExperienceCandidateSynthesizerService } from '../../src/modules/tours/services/structured-experience-candidate-synthesizer.service';
import {
  structuredLandmarkAObservation,
  structuredPlaceBObservation,
  syntheticDimensionedExperience,
} from './support/observations';

/**
 * TEST 2 — EXPLORATION-STYLE MATCHER SEMANTICS (unit level)
 *
 * This file pins the MATCHER behavior with hand-built inputs. The real
 * persistence/hydration round-trip (does `resolveOrCreateTraitDefinitions`
 * actually flatten a trait's dimension, and does the flattened row fail the
 * `exploration_style` matcher after real persist+hydrate?) is in
 * `exploration-style-roundtrip.db.characterization-spec.ts`.
 *
 * Pinned here:
 *  - `candidateMatchesPreferenceFacet` matches an `exploration_style` facet
 *    ONLY against explicit dimensioned evidence for `tourism_intensity` /
 *    `local_character` (`hasExplicitDimensionedEvidence`) — never themes,
 *    name, description, or a relational trait string;
 *  - a relational trait carried as `{dimension:'general', key:'iconic'}` (the
 *    shape `projectVerifiedExperienceRow` builds from a `TraitDefinition`)
 *    does NOT satisfy `exploration_style:iconic`, though it DOES satisfy a
 *    plain `trait:iconic` facet;
 *  - the structured synthesizer emits no dimensioned evidence at all, so
 *    `explorationStyle` cannot discriminate any structured-acquired
 *    Experience; it only DILUTES `positiveRatio` (its facet weight is always
 *    in the denominator whether or not it can ever match).
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

describe('CHAR-2 exploration-style matcher semantics', () => {
  it('a relational-trait key carried as dimension:"general" does NOT satisfy exploration_style, but DOES satisfy trait:<key>', () => {
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
        experienceAsPersisted,
        wizardFacet('exploration_style', 'iconic'),
      ),
    ).toBe(false);
    expect(
      candidateMatchesPreferenceFacet(
        experienceAsPersisted,
        wizardFacet('trait', 'iconic'),
      ),
    ).toBe(true);
  });

  it('exploration_style matches ONLY explicit dimensioned evidence (SYNTHETIC controlled fixture)', () => {
    // syntheticDimensionedExperience is hand-authored, NOT provider-derived.
    expect(
      candidateMatchesPreferenceFacet(
        syntheticDimensionedExperience('tourism_intensity', 'iconic'),
        wizardFacet('exploration_style', 'iconic'),
      ),
    ).toBe(true);

    const authenticLocalCharacter = {
      canonicalName: 'Synthetic Dimensioned Experience',
      themes: [] as string[],
      traits: [] as string[],
      intents: [] as string[],
      metadata: { dimensions: { local_character: 'authentic' } },
    };
    expect(
      candidateMatchesPreferenceFacet(
        authenticLocalCharacter,
        wizardFacet('exploration_style', 'local_deep_dive'),
      ),
    ).toBe(true);
  });

  it('the structured synthesizer emits NO dimensioned evidence for a raw OSM place, so no exploration_style key can match it', () => {
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

  it('CHARACTERIZATION: exploration_style only DILUTES positiveRatio — iconic and local_deep_dive dilute a facet-only catalog identically (no directional signal)', () => {
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

  it('CHARACTERIZATION: a synthesized structured candidate scores identically under iconic and local_deep_dive', () => {
    const synth = new StructuredExperienceCandidateSynthesizerService();
    const candidate = synth.synthesizeProposals([
      structuredLandmarkAObservation(),
    ])[0].candidate as any;
    const hydrated = {
      canonicalName: candidate.name,
      description: candidate.description,
      themes: candidate.themes,
      traits: candidate.traits,
      intents: candidate.intents,
      metadata: {
        themes: candidate.themes,
        traits: candidate.traits,
        intents: candidate.intents,
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
    // Current behavior: identical (both 0). Whether explorationStyle SHOULD be
    // able to discriminate structured-acquired Experiences is an OPEN DESIGN
    // question (it needs an acquisition-side producer of dimensioned evidence).
    expect(iconic.score).toBe(local.score);
  });
});
