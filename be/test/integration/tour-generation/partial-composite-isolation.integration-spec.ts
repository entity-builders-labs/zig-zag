import { withDefaultGeographicAuthorization } from 'src/modules/tours/utils/geographic-validation-authorization.util';
import { ExperienceCatalogService } from 'src/modules/tours/services/experience-catalog.service';
import { CompositeGeographicValidationService } from 'src/modules/tours/services/composite-geographic-validation.service';
import { ExperienceProposalResolverService } from 'src/modules/tours/services/experience-proposal-resolver.service';
import { ExperienceCandidate } from 'src/modules/tours/interfaces/experience-discovery.interface';
import { GeographicScope } from 'src/modules/tours/interfaces/experience-resolution.interface';
import { getPrisma, resetDb, closeDb } from '../support/test-db';

/**
 * Stage 4 hard gates against real Postgres (component-resolution-and-
 * partial-composite-recovery-plan.md): source composition is the authority
 * on which components make up an Experience. A composite whose source says
 * A-B-C-D-E-F, with C and E unresolved, must never persist as a VERIFIED
 * A-B-D-F, must never reach the planner's catalog boundary, and resolving
 * A/B/D/F must create/reuse GeoEntities only -- never standalone
 * Experiences. Real resolver + real geographic validation + real catalog;
 * only the local OSM pool transport is faked.
 */
describe('tour-generation integration · partial composite isolation (Stage 4)', () => {
  let catalog: ExperienceCatalogService;

  const BOUNDARY: any = {
    id: 'osm:relation:1',
    name: 'Buenos Aires',
    osmType: 'relation',
    osmId: 1,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-58.55, -34.7],
          [-58.3, -34.7],
          [-58.3, -34.45],
          [-58.55, -34.45],
          [-58.55, -34.7],
        ],
      ],
    },
    tags: { boundary: 'administrative' },
  };
  const SCOPE: GeographicScope = { kind: 'AREA_BOUNDARY', boundary: BOUNDARY };
  const CENTER = { latitude: -34.62, longitude: -58.372 };

  const walk = (letters: string[]): ExperienceCandidate => ({
    name: `Walk ${letters.join('-')}`,
    description: 'An evidenced San Telmo walk',
    themes: ['history'],
    traits: [],
    intents: ['walk'],
    orderedByEvidence: true,
    componentHints: letters.map((letter) => ({
      key: `stop-${letter}`,
      name: `Stop ${letter}`,
      role: 'waypoint' as const,
      expectedKind: 'PLACE' as const,
      evidenceKeys: ['ev-1'],
    })),
    evidenceKeys: ['ev-1'],
    shortReason: 'evidence-backed walk',
  });
  const poiFor = (letter: string, index: number) => ({
    id: `osm:node:${100 + index}`,
    name: `Stop ${letter}`,
    osmType: 'node',
    osmId: 100 + index,
    geometry: {
      type: 'Point',
      coordinates: [
        CENTER.longitude + index * 0.0004,
        CENTER.latitude + index * 0.0004,
      ],
    },
    tags: { tourism: 'attraction' },
  });

  const resolveWith = (
    poolLetters: string[],
    candidates: ExperienceCandidate[],
  ) => {
    const service = new ExperienceProposalResolverService(
      {
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: poolLetters.map(poiFor),
        }),
      } as any,
      catalog,
      new CompositeGeographicValidationService(),
    );
    return service.resolve({
      destinationName: 'Buenos Aires',
      geographicScope: SCOPE,
      candidates: withDefaultGeographicAuthorization(candidates),
      evidence: [
        { key: 'ev-1', source: 'web', title: 'San Telmo walk', snippet: '' },
      ],
    });
  };

  /** Every catalog boundary the planner/acquisition reads candidates from. */
  const plannerVisibleIds = async () => {
    const within = await catalog.findVerifiedWithin(
      CENTER.latitude,
      CENTER.longitude,
      5_000,
    );
    const forMatching = await catalog.findVerifiedWithinForMatching(
      CENTER.latitude,
      CENTER.longitude,
      5_000,
    );
    return {
      within: within.map((row: { id: string }) => row.id),
      forMatching: forMatching.map((row: { id: string }) => row.id),
    };
  };

  beforeAll(async () => {
    const prisma = await getPrisma();
    catalog = new ExperienceCatalogService(prisma, {
      getStatus: () => ({ provider: 'none' }),
    } as any);
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  it('A-B-C-D-E-F with C/E unresolved: GeoEntities for A/B/D/F, no VERIFIED A-B-D-F, nothing planner-visible, no standalone promotion', async () => {
    const prisma = await getPrisma();

    const result = await resolveWith(
      ['A', 'B', 'D', 'F'],
      [walk(['A', 'B', 'C', 'D', 'E', 'F'])],
    );

    const candidate = result.resolved[0];
    expect(candidate.status).toBe('rejected');
    expect(candidate.rejectionReasons).toEqual([
      'INCOMPLETE_SOURCE_COMPOSITION',
    ]);
    expect(candidate.experienceId).toBeUndefined();
    // Component truth survives, transiently: C/E are explicit deficits.
    expect(
      candidate.componentResolution!.components.map((fact) => [
        fact.hintKey,
        fact.identityStatus,
        fact.resolved?.geographicRelation ?? null,
      ]),
    ).toEqual([
      ['stop-A', 'RESOLVED', 'INSIDE'],
      ['stop-B', 'RESOLVED', 'INSIDE'],
      ['stop-C', 'UNRESOLVED', null],
      ['stop-D', 'RESOLVED', 'INSIDE'],
      ['stop-E', 'UNRESOLVED', null],
      ['stop-F', 'RESOLVED', 'INSIDE'],
    ]);
    expect(candidate.componentResolution!.coverage).toMatchObject({
      totalComponents: 6,
      identityResolvedComponents: 4,
      unresolvedComponents: 2,
      sourceCompositionComplete: false,
    });

    // Component resolution created the four GeoEntities...
    const geoEntities = await prisma.geoEntity.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    expect(geoEntities.map((row) => row.name)).toEqual([
      'Stop A',
      'Stop B',
      'Stop D',
      'Stop F',
    ]);
    // ...and NOTHING else: no trimmed Experience, no component rows, no
    // standalone Experience per resolved component.
    expect(await prisma.experience.count()).toBe(0);
    expect(await prisma.experienceComponent.count()).toBe(0);
    for (const geo of geoEntities) {
      expect(
        await catalog.findVerifiedMultiComponentByExactComponent(geo.id),
      ).toEqual([]);
    }
    expect(await plannerVisibleIds()).toEqual({ within: [], forMatching: [] });
  });

  it('complete A-B-C: persists one VERIFIED Experience with exactly the source-backed membership and order, and it is planner-visible', async () => {
    const prisma = await getPrisma();

    const result = await resolveWith(['A', 'B', 'C'], [walk(['A', 'B', 'C'])]);

    const candidate = result.resolved[0];
    expect(candidate.status).toBe('accepted');
    expect(candidate.componentResolution!.coverage).toMatchObject({
      totalComponents: 3,
      identityResolvedComponents: 3,
      sourceCompositionComplete: true,
    });
    expect(await prisma.experience.count()).toBe(1);
    const experience = await prisma.experience.findUniqueOrThrow({
      where: { id: candidate.experienceId! },
      include: {
        components: {
          include: { geoEntity: { select: { name: true } } },
          orderBy: { order: 'asc' },
        },
      },
    });
    expect(experience.status).toBe('VERIFIED');
    expect(
      experience.components.map((component) => [
        component.order,
        component.geoEntity.name,
      ]),
    ).toEqual([
      [1, 'Stop A'],
      [2, 'Stop B'],
      [3, 'Stop C'],
    ]);
    const visible = await plannerVisibleIds();
    expect(visible.within).toEqual([experience.id]);
    expect(visible.forMatching).toEqual([experience.id]);
  });

  it('a later complete composite sharing A/B reuses their GeoEntities without promoting the earlier partial', async () => {
    const prisma = await getPrisma();

    await resolveWith(
      ['A', 'B', 'D', 'F'],
      [walk(['A', 'B', 'C', 'D', 'E', 'F'])],
    );
    const geoBefore = await prisma.geoEntity.count();

    const result = await resolveWith(['A', 'B'], [walk(['A', 'B'])]);

    expect(result.resolved[0].status).toBe('accepted');
    // Catalog-first reuse: no duplicate GeoEntities for A/B.
    expect(await prisma.geoEntity.count()).toBe(geoBefore);
    // Only the independently source-backed A-B composite exists.
    const experiences = await prisma.experience.findMany({
      include: { components: true },
    });
    expect(experiences).toHaveLength(1);
    expect(experiences[0].canonicalName).toBe('Walk A-B');
    expect(experiences[0].components).toHaveLength(2);
  });

  it('A-B-C with B AMBIGUOUS (two real exact-name candidates): B stays explicit, no winner, no trimmed A-C persisted', async () => {
    const prisma = await getPrisma();
    const service = new ExperienceProposalResolverService(
      {
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            poiFor('A', 0),
            poiFor('B', 1),
            // A second, structurally distinct real object with the same
            // exact name, ~1.5 km away.
            { ...poiFor('B', 40), id: 'osm:node:999', osmId: 999 },
            poiFor('C', 2),
          ],
        }),
      } as any,
      catalog,
      new CompositeGeographicValidationService(),
    );

    const result = await service.resolve({
      destinationName: 'Buenos Aires',
      geographicScope: SCOPE,
      candidates: withDefaultGeographicAuthorization([walk(['A', 'B', 'C'])]),
    });

    const candidate = result.resolved[0];
    const b = candidate.componentResolution!.components[1];
    expect(b.hintKey).toBe('stop-B');
    expect(b.identityStatus).toBe('AMBIGUOUS');
    expect(b.resolved).toBeUndefined();
    expect(b.deficit).toEqual({
      reason: 'AMBIGUOUS_CANDIDATES',
      classification: 'KNOWLEDGE_DEFICIT',
    });
    expect(candidate.componentResolution!.coverage).toMatchObject({
      identityResolvedComponents: 2,
      ambiguousComponents: 1,
      openResearchDeficits: ['stop-B'],
      sourceCompositionComplete: false,
    });
    expect(candidate.status).toBe('rejected');
    expect(await prisma.experience.count()).toBe(0);
    expect(await plannerVisibleIds()).toEqual({ within: [], forMatching: [] });
  });
});
