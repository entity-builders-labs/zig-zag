import { PrismaService } from 'src/core/database/prisma.service';
import { ExperienceCatalogService } from 'src/modules/tours/services/experience-catalog.service';
import { StructuredExperienceCandidateSynthesizerService } from 'src/modules/tours/services/structured-experience-candidate-synthesizer.service';
import { StructuredCandidateCorroborationService } from 'src/modules/tours/services/structured-candidate-corroboration.service';
import { evaluateExperiencePreferences } from 'src/modules/tours/utils/experience-preference-evaluator.util';
import { candidateMatchesPreferenceFacet } from 'src/modules/tours/utils/preference-facet-matching.util';
import {
  getGuardedCharacterizationPrisma,
  resetCharacterizationDb,
  closeDb,
} from './support/db';
import {
  osmHistoricMonumentObservation,
  placesHistoricalLandmarkObservation,
} from './support/observations';
import { SourceObservation } from 'src/modules/tours/interfaces/experience-acquisition.interface';

/**
 * DB-BACKED ROUND-TRIPS for CHAR-1 / CHAR-2 / CHAR-6.
 *
 * The pure specs prove what synthesis / the matcher / the normalizer do in
 * isolation. This file proves the same facts SURVIVE a real
 * synthesize -> corroborate -> persist (real Prisma transaction) -> hydrate
 * (`findVerifiedByIds` / `projectVerifiedExperienceRow`) round-trip.
 *
 * Only the hint -> GeoEntity resolution (external Places/OSM geocoding) is
 * skipped: the GeoEntity is created directly from the observation's own
 * coordinates, exactly the row a resolver would have produced. The persist
 * call mirrors `ExperienceProposalResolverService.resolve` verbatim:
 *   resolveOrCreateTraitDefinitions(candidate.traits)
 *   persistVerifiedExperience({ metadata: { themes, traits, intents,
 *     source: 'grounded_experience_discovery' }, traitDefinitionIds, ... })
 * — note it passes NO qualityScore.
 */

const synth = new StructuredExperienceCandidateSynthesizerService();
const corroboration = new StructuredCandidateCorroborationService();

describe('CHAR-DB catalog round-trips', () => {
  let prisma: PrismaService;
  let catalog: ExperienceCatalogService;

  beforeAll(async () => {
    prisma = await getGuardedCharacterizationPrisma();
    catalog = new ExperienceCatalogService(prisma, {} as any);
  });

  afterAll(async () => {
    await resetCharacterizationDb(prisma);
    await closeDb();
  });

  beforeEach(async () => {
    await resetCharacterizationDb(prisma);
  });

  /** Mirrors ExperienceProposalResolverService.resolve for one observation,
   *  faking only the hint -> GeoEntity geocoding. Returns the persisted id. */
  async function persistFromObservation(obs: SourceObservation): Promise<{
    id: string;
    candidateThemes: string[];
    candidateTraits: string[];
  }> {
    const [proposal] = synth.synthesizeProposals([obs]);
    const merged = corroboration.corroborateAndMerge(
      [proposal],
      ['GENERAL_TOURISM_EXPERIENCE'],
    );
    const candidate = merged.candidates[0];

    const geo = await prisma.geoEntity.create({
      data: {
        name: obs.title,
        kind: 'PLACE',
        latitude: obs.geo?.latitude ?? null,
        longitude: obs.geo?.longitude ?? null,
      },
    });

    const traitDefinitionIds = await catalog.resolveOrCreateTraitDefinitions(
      candidate.traits,
    );
    const experience = await catalog.persistVerifiedExperience({
      canonicalName: candidate.name,
      description: candidate.description,
      durationMinutes: 90,
      metadata: {
        themes: candidate.themes,
        traits: candidate.traits,
        intents: candidate.intents ?? [],
        source: 'grounded_experience_discovery',
      },
      traitDefinitionIds,
      components: [{ geoEntityId: geo.id, role: 'venue', required: true }],
      evidence: [{ source: obs.provider }],
    });

    return {
      id: (experience as any).id,
      candidateThemes: candidate.themes,
      candidateTraits: candidate.traits,
    };
  }

  // ── CHAR-1 DB — structured evidence -> semantic preservation ──
  describe('CHAR-1 DB — structured evidence semantics after real persist + hydrate', () => {
    it('an OSM historic monument still has themes=[] traits=[] intents=[] after persist -> findVerifiedByIds, and scores 0 for theme:history', async () => {
      const { id, candidateThemes } = await persistFromObservation(
        osmHistoricMonumentObservation(),
      );
      expect(candidateThemes).toEqual([]); // synthesis already blank

      const [hydrated] = await catalog.findVerifiedByIds([id]);
      // eslint-disable-next-line no-console
      console.info(
        '[CHAR-1 DB] hydrated facets =>',
        JSON.stringify({
          themes: hydrated.themes,
          traits: hydrated.traits,
          intents: hydrated.intents,
          dimensionedTraits: hydrated.dimensionedTraits,
        }),
      );
      expect(hydrated.themes).toEqual([]);
      expect(hydrated.traits).toEqual([]);
      expect(hydrated.intents).toEqual([]);

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
      expect(evaluation.facetMatches[0].matched).toBe(false);
      expect(evaluation.score).toBe(0);
    });
  });

  // ── CHAR-2 DB — trait dimension is flattened to 'general' ──
  describe('CHAR-2 DB — trait persistence flattens dimension to general', () => {
    it('resolveOrCreateTraitDefinitions(["iconic"]) writes TraitDefinition.dimension="general"; the hydrated row fails exploration_style:iconic but passes trait:iconic', async () => {
      // Build a candidate that DOES carry a trait (unlike the synthesizer's []),
      // exactly as discovery/extraction would, then run the real persist path.
      const geo = await prisma.geoEntity.create({
        data: {
          name: 'Structured Landmark A',
          kind: 'PLACE',
          latitude: -32.9476,
          longitude: -60.6285,
        },
      });
      const traitDefinitionIds = await catalog.resolveOrCreateTraitDefinitions([
        'iconic',
      ]);

      const defs = await prisma.traitDefinition.findMany({
        where: { id: { in: traitDefinitionIds } },
      });
      // eslint-disable-next-line no-console
      console.info(
        '[CHAR-2 DB] TraitDefinition =>',
        JSON.stringify(defs.map((d) => ({ dim: d.dimension, key: d.key }))),
      );
      expect(defs).toHaveLength(1);
      expect(defs[0].dimension).toBe('general');
      expect(defs[0].key).toBe('iconic');

      const experience = await catalog.persistVerifiedExperience({
        canonicalName: 'Structured Landmark A',
        description: 'A structured landmark.',
        durationMinutes: 90,
        metadata: {
          themes: [],
          traits: ['iconic'],
          intents: [],
          source: 'grounded_experience_discovery',
        },
        traitDefinitionIds,
        components: [{ geoEntityId: geo.id, role: 'venue', required: true }],
        evidence: [{ source: 'osm' }],
      });

      const [hydrated] = await catalog.findVerifiedByIds([
        (experience as any).id,
      ]);
      // eslint-disable-next-line no-console
      console.info(
        '[CHAR-2 DB] hydrated dimensionedTraits =>',
        JSON.stringify(hydrated.dimensionedTraits),
      );
      expect(hydrated.dimensionedTraits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ dimension: 'general', key: 'iconic' }),
        ]),
      );
      expect(
        hydrated.dimensionedTraits.some(
          (t: any) => t.dimension === 'tourism_intensity',
        ),
      ).toBe(false);

      expect(
        candidateMatchesPreferenceFacet(hydrated, {
          dimension: 'exploration_style',
          key: 'iconic',
          importance: 1,
          confidence: 1,
          source: 'wizard',
        }),
      ).toBe(false);
      expect(
        candidateMatchesPreferenceFacet(hydrated, {
          dimension: 'trait',
          key: 'iconic',
          importance: 1,
          confidence: 1,
          source: 'wizard',
        }),
      ).toBe(true);
    });

    it.failing(
      'DEFECT: a trait whose key names a structured dimension value should be resolvable by that dimension after persist+hydrate',
      async () => {
        // The only "dimension" a free trait can currently carry is 'general'.
        // A trait "iconic" therefore can never be matched as
        // tourism_intensity:iconic, even though that is the dimension the
        // token belongs to in the vocabulary.
        const geo = await prisma.geoEntity.create({
          data: { name: 'X', kind: 'PLACE', latitude: -32.9, longitude: -60.6 },
        });
        const traitDefinitionIds =
          await catalog.resolveOrCreateTraitDefinitions(['iconic']);
        const experience = await catalog.persistVerifiedExperience({
          canonicalName: 'X',
          durationMinutes: 90,
          metadata: { themes: [], traits: ['iconic'], intents: [] },
          traitDefinitionIds,
          components: [{ geoEntityId: geo.id, role: 'venue', required: true }],
        });
        const [hydrated] = await catalog.findVerifiedByIds([
          (experience as any).id,
        ]);
        expect(
          candidateMatchesPreferenceFacet(hydrated, {
            dimension: 'tourism_intensity',
            key: 'iconic',
            importance: 1,
            confidence: 1,
            source: 'wizard',
          }),
        ).toBe(true);
      },
    );
  });

  // ── CHAR-6 DB — Places rating dropped; qualityScore stays null ──
  describe('CHAR-6 DB — quality signal after real persist', () => {
    it('a Google Places observation with rating 4.7 persists with Experience.qualityScore === null', async () => {
      const obs = placesHistoricalLandmarkObservation();
      expect((obs.metadata as any).rating).toBe(4.7);

      const { id } = await persistFromObservation(obs);
      const row = await prisma.experience.findUnique({ where: { id } });
      // eslint-disable-next-line no-console
      console.info('[CHAR-6 DB] persisted qualityScore =>', row?.qualityScore);
      expect(row?.qualityScore).toBeNull();

      const [hydrated] = await catalog.findVerifiedByIds([id]);
      expect(hydrated.qualityScore).toBeNull();
    });

    it('OPEN DESIGN: structured acquisition currently does not map Places rating into Experience.qualityScore', async () => {
      const { id } = await persistFromObservation(
        placesHistoricalLandmarkObservation(),
      );
      const row = await prisma.experience.findUnique({ where: { id } });
      expect(row?.qualityScore).toBeNull();
    });
  });
});
