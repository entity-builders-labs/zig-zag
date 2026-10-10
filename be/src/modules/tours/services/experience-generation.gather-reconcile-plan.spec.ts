import { ExperienceGenerationService } from './experience-generation.service';
import { ExperienceCompositionService } from './experience-composition.service';
import { GeographicScope } from '../interfaces/experience-resolution.interface';
import { PreferenceSpec } from '../interfaces/preference-spec.interface';
import { TourGenerationRequest } from '../interfaces/tour-generation.interface';
import { buildPreferenceSpec } from '../utils/preference-spec-builder.util';

/**
 * Characterization of the GATHER → FREEZE → PLAN seams of one generation:
 *  - the catalog snapshot is a fresh read through the canonical catalog
 *    boundary, in canonical order (discovery order never decides the
 *    candidate universe);
 *  - a plan derives every planner input from ONE selection (nothing from an
 *    earlier, pre-gather selection survives into it).
 * The end-to-end ordering (provisional plan → refill → fresh final
 * snapshot → final plan) is proven against real Postgres in
 * test/integration/tour-generation/gather-reconcile-plan.integration-spec.ts.
 */
describe('ExperienceGenerationService gather → freeze → plan seams', () => {
  const CENTER = { latitude: -34.6037, longitude: -58.3816 };
  const destination: GeographicScope = {
    kind: 'POINT_RADIUS',
    latitude: CENTER.latitude,
    longitude: CENTER.longitude,
    radiusMeters: 5_000,
  };
  const window = { ...CENTER, radiusMeters: 5_000 };

  /** A catalog projection row sharing `geoId` when given (overlap). */
  const row = (id: string, geoId = `geo-${id}`, offset = 0.001) => ({
    id,
    name: `Experience ${id}`,
    canonicalName: `Experience ${id}`,
    qualityScore: 4.5,
    themes: ['history'],
    intents: ['visit'],
    traits: [] as string[],
    dimensionedTraits: [] as unknown[],
    durationMinutes: 60,
    duration: 1,
    latitude: CENTER.latitude + offset,
    longitude: CENTER.longitude + offset,
    metadata: {},
    components: [
      {
        geoEntityId: geoId,
        resolutionState: 'RESOLVED',
        sourcePosition: 0,
        geoEntity: {
          id: geoId,
          kind: 'PLACE',
          name: `Place ${geoId}`,
          latitude: CENTER.latitude + offset,
          longitude: CENTER.longitude + offset,
        },
      },
    ],
    compositionCompleteness: 'COMPLETE' as const,
  });

  // The production PreferenceSpec builder over a minimal canonical request.
  const preferenceSpec: PreferenceSpec = buildPreferenceSpec(
    {
      contractVersion: 1,
      destination: { label: 'Buenos Aires', ...CENTER },
      days: 1,
      intent: { interests: ['history'], intents: ['visit'] },
      mobility: {
        allowedTransportationModes: ['walking'],
        travelPace: 'moderate',
      },
      startDates: [],
    } as unknown as TourGenerationRequest,
    {
      preferredFacets: [],
      anchoredPlaces: [],
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
    },
  );

  let catalog: {
    findVerifiedWithinForMatching: jest.Mock;
    findVerifiedByIds: jest.Mock;
  };
  let normalizer: { normalizeExperiences: jest.Mock };
  let solver: { solve: jest.Mock };
  let service: ExperienceGenerationService;

  beforeEach(() => {
    catalog = {
      findVerifiedWithinForMatching: jest.fn(),
      findVerifiedByIds: jest.fn(),
    };
    normalizer = {
      normalizeExperiences: jest.fn(async (experiences: any[]) =>
        experiences.map((experience) => ({
          experienceId: experience.id,
          source: experience,
        })),
      ),
    };
    // Schedules every candidate and saturates the day (no residual).
    solver = {
      solve: jest.fn(async (input: any) => ({
        days: [
          {
            dayNumber: 1,
            utilizationMinutes: 660,
            experiences: input.candidates.map((candidate: any) => ({
              experienceId: candidate.experienceId,
              startMinutesFromMidnight: 540,
              endMinutesFromMidnight: 600,
            })),
          },
        ],
        unselected: [] as unknown[],
        score: input.candidates.length,
        metadata: { solver: 'test' },
      })),
    };
    service = Object.assign(
      Object.create(ExperienceGenerationService.prototype),
      {
        experienceCatalog: catalog,
        // The real composition policy.
        // No index: every candidate is an explicit semantic unknown.
        experienceComposition: new ExperienceCompositionService({
          getSimilarityScores: jest.fn(async (ids: string[]) => ({
            status: 'applied',
            scores: new Map(),
            requestedCandidateCount: ids.length,
            indexedCandidateCount: 0,
          })),
        } as any),
        planningCandidateNormalizer: normalizer,
        dailyPlanningSolver: solver,
        dailyPlanningPolicy: {
          window: {
            startMinutesFromMidnight: 540,
            endMinutesFromMidnight: 1200,
          },
          scoring: {
            semanticWeight: 1,
            qualityWeight: 0.5,
            dayBalanceWeight: 0.25,
          },
          backfill: {
            minimumUsefulResidualMinutes: 60,
            maxReservoirPromotionAttempts: 50,
            maxAcquisitionPasses: 1,
          },
        },
        logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      },
    );
  });

  const readSnapshot = (explicitIds: string[] = [], acquisitionEpoch = 0) =>
    (service as any).readCatalogSnapshot({
      phase: 'GATHER',
      acquisitionEpoch,
      window,
      destination,
      explicitIds,
    });
  const compose = (experiences: any[]) =>
    (service as any).composeExperiences(experiences, preferenceSpec);
  const plan = (selection: any) =>
    (service as any).planFromSelection(
      selection,
      { requestedDays: 1 },
      preferenceSpec,
    );

  it('9. every snapshot is a fresh catalog read: later knowledge replaces earlier objects', async () => {
    const stale = row('exp-a');
    const enriched = {
      ...row('exp-a'),
      canonicalName: 'Experience exp-a (enriched)',
    };
    catalog.findVerifiedWithinForMatching
      .mockResolvedValueOnce([stale])
      .mockResolvedValueOnce([enriched]);
    catalog.findVerifiedByIds.mockResolvedValue([]);

    const first = await readSnapshot([], 0);
    const second = await readSnapshot([], 1);

    expect(catalog.findVerifiedWithinForMatching).toHaveBeenCalledTimes(2);
    // The canonical PostGIS window: center and radius only, no result cap.
    expect(catalog.findVerifiedWithinForMatching).toHaveBeenNthCalledWith(
      1,
      window.latitude,
      window.longitude,
      window.radiusMeters,
    );
    expect(first.experiences[0]).toBe(stale);
    expect(second.experiences[0]).toBe(enriched);
    expect(second.acquisitionEpoch).toBe(1);
  });

  it('a snapshot keeps request-scoped rows (venue anchors, area walks) and only destination-eligible window rows', async () => {
    const inside = row('exp-inside');
    const outside = row('exp-outside', 'geo-outside', 1);
    const anchored = row('exp-anchored', 'geo-anchored', 1);
    catalog.findVerifiedWithinForMatching.mockResolvedValue([inside, outside]);
    catalog.findVerifiedByIds.mockResolvedValue([anchored]);

    const snapshot = await readSnapshot(['exp-anchored']);

    expect(catalog.findVerifiedByIds).toHaveBeenCalledWith(['exp-anchored']);
    expect(
      snapshot.experiences.map((experience: any) => experience.id),
    ).toEqual(['exp-anchored', 'exp-inside']);
  });

  it('8. discovery order never changes the candidate universe, the selection or the overlap outcome', async () => {
    // exp-b and exp-c resolve the same real place: the overlap filter must
    // keep the same one whichever was acquired first.
    const a = row('exp-a');
    const b = row('exp-b', 'geo-shared', 0.002);
    const c = row('exp-c', 'geo-shared', 0.002);

    const run = async (windowRows: any[], discovered: any[]) => {
      catalog.findVerifiedWithinForMatching.mockResolvedValueOnce(windowRows);
      catalog.findVerifiedByIds.mockResolvedValueOnce(discovered);
      const snapshot = await readSnapshot(discovered.map((item) => item.id));
      const selection = await compose(snapshot.experiences);
      const planned = await plan(selection);
      return {
        universe: snapshot.experiences.map((experience: any) => experience.id),
        selected: selection.initialExperiences.map((item: any) => item.id),
        reservoir: selection.reservoirExperiences.map((item: any) => item.id),
        overlapExcluded: planned.overlapExcluded,
        planned: planned.planningSolution.days[0].experiences.map(
          (item: any) => item.experienceId,
        ),
      };
    };

    const bFirst = await run([b, a], [c]);
    const cFirst = await run([c, a], [b]);

    expect(bFirst.universe).toEqual(['exp-a', 'exp-b', 'exp-c']);
    expect(cFirst).toEqual(bFirst);
  });

  it('11. a plan derives every planner input from its own selection only', async () => {
    const preGather = await compose([row('exp-a'), row('exp-b')]);
    await plan(preGather);
    normalizer.normalizeExperiences.mockClear();

    const enrichedB = {
      ...row('exp-b'),
      canonicalName: 'Experience exp-b (enriched)',
    };
    const postGather = await compose([enrichedB, row('exp-new')]);
    const finalPlan = await plan(postGather);

    expect([...finalPlan.candidatesById.keys()].sort()).toEqual([
      'exp-b',
      'exp-new',
    ]);
    expect(finalPlan.candidatesById.get('exp-b').canonicalName).toBe(
      'Experience exp-b (enriched)',
    );
    const normalizedIds = normalizer.normalizeExperiences.mock.calls.flatMap(
      ([experiences]: [any[]]) => experiences.map((item) => item.id),
    );
    expect(normalizedIds).not.toContain('exp-a');
    expect(
      finalPlan.planningSolution.days[0].experiences.map(
        (item: any) => item.experienceId,
      ),
    ).not.toContain('exp-a');
  });
});
