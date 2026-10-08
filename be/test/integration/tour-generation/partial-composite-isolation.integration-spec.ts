import { withDefaultGeographicAuthorization } from 'src/modules/tours/utils/geographic-validation-authorization.util';
import { ExperienceCatalogService } from 'src/modules/tours/services/experience-catalog.service';
import { CompositeGeographicValidationService } from 'src/modules/tours/services/composite-geographic-validation.service';
import { ExperienceProposalResolverService } from 'src/modules/tours/services/experience-proposal-resolver.service';
import { ExperienceCandidate } from 'src/modules/tours/interfaces/experience-discovery.interface';
import { GeographicScope } from 'src/modules/tours/interfaces/experience-resolution.interface';
import { getPrisma, resetDb, closeDb } from '../support/test-db';

/**
 * Stage 4 hard gates against real Postgres (component-resolution-and-
 * partial-composite-recovery-plan.md), as amended by the PARTIAL composite
 * policy (2026-10-08): source composition is the authority on which
 * components make up an Experience. A composite whose source says
 * A-B-C-D-E-F, with C and E unresolved (missing knowledge), persists as a
 * PARTIAL Experience with ALL SIX source members -- never as a trimmed
 * A-B-D-F -- and resolving A/B/D/F creates/reuses GeoEntities only, never
 * standalone Experiences. Real resolver + real geographic validation + real
 * catalog; only the local OSM pool transport is faked.
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

  // INTENTIONAL_PRODUCT_CHANGE: PARTIAL_COMPOSITE_POLICY.
  // Old expectation: rejected (INCOMPLETE_SOURCE_COMPOSITION), 0 Experiences,
  // 0 component rows, nothing planner-visible. It qualifies for PARTIAL: 4
  // distinct resolved GeoEntities and C/E are NO_CANDIDATE_ACQUIRED
  // (MISSING_KNOWLEDGE). Still enforced unchanged: no trimmed A-B-D-F, no
  // fake GeoEntity for C/E, no standalone Experience per component.
  it('A-B-C-D-E-F with C/E unresolved: persists ONE PARTIAL Experience with all six source members in source order, no trimmed A-B-D-F, no standalone promotion', async () => {
    const prisma = await getPrisma();

    const result = await resolveWith(
      ['A', 'B', 'D', 'F'],
      [walk(['A', 'B', 'C', 'D', 'E', 'F'])],
    );

    const candidate = result.resolved[0];
    expect(candidate.status).toBe('accepted');
    expect(candidate.rejectionReasons).toEqual([]);
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

    // Only the four real GeoEntities exist: none was invented for C/E.
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

    // Exactly one Experience: the source-defined A-F, never a trimmed
    // A-B-D-F and never a standalone Experience per resolved component.
    expect(await prisma.experience.count()).toBe(1);
    const experience = await prisma.experience.findUniqueOrThrow({
      where: { id: candidate.experienceId! },
      include: {
        components: {
          include: { geoEntity: { select: { name: true } } },
          orderBy: { sourcePosition: 'asc' },
        },
      },
    });
    expect(experience.status).toBe('VERIFIED');
    expect(
      experience.components.map((member) => [
        member.sourcePosition,
        member.order,
        member.sourceName,
        member.resolutionState,
        member.resolutionReason,
        member.geoEntity?.name ?? null,
      ]),
    ).toEqual([
      [0, 1, 'Stop A', 'RESOLVED', null, 'Stop A'],
      [1, 2, 'Stop B', 'RESOLVED', null, 'Stop B'],
      [2, 3, 'Stop C', 'UNRESOLVED', 'NO_CANDIDATE_ACQUIRED', null],
      [3, 4, 'Stop D', 'RESOLVED', null, 'Stop D'],
      [4, 5, 'Stop E', 'UNRESOLVED', 'NO_CANDIDATE_ACQUIRED', null],
      [5, 6, 'Stop F', 'RESOLVED', null, 'Stop F'],
    ]);

    // Planner-visible through every catalog boundary, as a composite, with
    // only its resolved members as navigable components.
    const visible = await plannerVisibleIds();
    expect(visible.within).toEqual([experience.id]);
    expect(visible.forMatching).toEqual([experience.id]);
    const [projected] = await catalog.findVerifiedByIds([experience.id]);
    expect(projected.compositionCompleteness).toBe('PARTIAL');
    expect(
      projected.components.map((member: any) => member.geoEntity.name),
    ).toEqual(['Stop A', 'Stop B', 'Stop D', 'Stop F']);
    const stopA = geoEntities.find((row) => row.name === 'Stop A')!;
    expect(
      (await catalog.findVerifiedMultiComponentByExactComponent(stopA.id)).map(
        (row) => row.id,
      ),
    ).toEqual([experience.id]);
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

  // INTENTIONAL_PRODUCT_CHANGE: DEDUPE_STRUCTURAL_AUTHORITY (2026-10-08).
  // Old expectation (8bd16b97, owner review): the later A-B was held
  // AMBIGUOUS by the lexical rule "semantic overlap >= 0.58" alone, because
  // the fixture gives both walks the same description and themes. That
  // rule had no calibration (forensic cb39f467). Structurally A-B is a
  // SUBCOMPOSITION of the PARTIAL A-F: never SAME, never promoting it, and,
  // with no similar name, it coexists as NEW whatever the shared text.
  it('a later complete composite sharing A/B with an identically described PARTIAL A-F reuses their GeoEntities, is never merged into or promotes the partial, and persists as a coexisting SUBCOMPOSITION', async () => {
    const prisma = await getPrisma();

    const first = await resolveWith(
      ['A', 'B', 'D', 'F'],
      [walk(['A', 'B', 'C', 'D', 'E', 'F'])],
    );
    const partialId = first.resolved[0].experienceId!;
    const geoBefore = await prisma.geoEntity.count();

    const result = await resolveWith(['A', 'B'], [walk(['A', 'B'])]);

    // Catalog-first reuse: no duplicate GeoEntities for A/B.
    expect(await prisma.geoEntity.count()).toBe(geoBefore);
    const later = result.resolved[0];
    expect(later.status).toBe('accepted');
    expect(later.dedupeDecision).toBe('NEW');
    expect(later.experienceId).toBeDefined();
    expect(later.experienceId).not.toBe(partialId);
    expect(later.dedupeEvidence!.componentOverlap).toBeCloseTo(2 / 6);
    expect(later.dedupeEvidence!.structure).toMatchObject({
      relation: 'SUBCOMPOSITION',
      containment: 'INCOMING_WITHIN_EXISTING',
      sourceMemberCounts: { incoming: 2, existing: 6 },
    });
    expect(
      later.dedupeEvidence!.structure.sharedResolvedGeoEntityIds,
    ).toHaveLength(2);
    expect(later.dedupeEvidence!.decisiveEvidence).toBe(
      'SUBCOMPOSITION_SOURCE_UNKNOWN',
    );
    const smaller = await prisma.experience.findUniqueOrThrow({
      where: { id: later.experienceId! },
      include: { components: { orderBy: { sourcePosition: 'asc' } } },
    });
    expect(smaller.components).toHaveLength(2);
    // The partial is untouched: still PARTIAL, C/E still unresolved.
    const partial = await prisma.experience.findUniqueOrThrow({
      where: { id: partialId },
      include: { components: { orderBy: { sourcePosition: 'asc' } } },
    });
    expect(partial.components.map((member) => member.resolutionState)).toEqual([
      'RESOLVED',
      'RESOLVED',
      'UNRESOLVED',
      'RESOLVED',
      'UNRESOLVED',
      'RESOLVED',
    ]);
    expect(await prisma.experience.count()).toBe(2);
  });

  it('D7: an independently described COMPLETE A-B after the PARTIAL A-F is NEW, persists with its own two members, and leaves the partial untouched', async () => {
    const prisma = await getPrisma();

    const first = await resolveWith(
      ['A', 'B', 'D', 'F'],
      [walk(['A', 'B', 'C', 'D', 'E', 'F'])],
    );
    const partialId = first.resolved[0].experienceId!;
    const geoBefore = await prisma.geoEntity.count();

    const result = await resolveWith(
      ['A', 'B'],
      [
        {
          ...walk(['A', 'B']),
          description: 'Two plazas joined by a short stroll',
          themes: ['architecture'],
          intents: ['visit'],
        },
      ],
    );

    expect(result.resolved[0].status).toBe('accepted');
    expect(result.resolved[0].dedupeDecision).toBe('NEW');
    expect(await prisma.geoEntity.count()).toBe(geoBefore);
    const experiences = await prisma.experience.findMany({
      include: { components: { orderBy: { sourcePosition: 'asc' } } },
      orderBy: { canonicalName: 'asc' },
    });
    expect(experiences.map((row) => row.canonicalName)).toEqual([
      'Walk A-B',
      'Walk A-B-C-D-E-F',
    ]);
    expect(experiences[0].components).toHaveLength(2);
    expect(
      experiences[0].components.every(
        (member) => member.resolutionState === 'RESOLVED',
      ),
    ).toBe(true);
    const partial = experiences.find((row) => row.id === partialId)!;
    expect(partial.components).toHaveLength(6);
    expect(
      partial.components.filter(
        (member) => member.resolutionState === 'UNRESOLVED',
      ),
    ).toHaveLength(2);
  });

  // INTENTIONAL_PRODUCT_CHANGE: PARTIAL_COMPOSITE_POLICY.
  // Old expectation: rejected, 0 Experiences, nothing planner-visible. It
  // qualifies for PARTIAL: A and C are 2 distinct resolved GeoEntities and B
  // is AMBIGUOUS_CANDIDATES (MISSING_KNOWLEDGE). Still enforced unchanged:
  // B gets no winner and no GeoEntity, and no trimmed A-C is persisted --
  // the Experience keeps all three source members.
  it('A-B-C with B AMBIGUOUS (two real exact-name candidates): B stays explicit with no winner; the PARTIAL A-B-C persists with B unresolved, never a trimmed A-C', async () => {
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
    expect(candidate.status).toBe('accepted');
    expect(await prisma.experience.count()).toBe(1);
    const experience = await prisma.experience.findUniqueOrThrow({
      where: { id: candidate.experienceId! },
      include: {
        components: {
          include: { geoEntity: { select: { name: true } } },
          orderBy: { sourcePosition: 'asc' },
        },
      },
    });
    expect(
      experience.components.map((member) => [
        member.sourceName,
        member.resolutionState,
        member.resolutionReason,
        member.geoEntity?.name ?? null,
      ]),
    ).toEqual([
      ['Stop A', 'RESOLVED', null, 'Stop A'],
      ['Stop B', 'UNRESOLVED', 'AMBIGUOUS_CANDIDATES', null],
      ['Stop C', 'RESOLVED', null, 'Stop C'],
    ]);
    const visible = await plannerVisibleIds();
    expect(visible.within).toEqual([experience.id]);
    expect(visible.forMatching).toEqual([experience.id]);
  });
});
