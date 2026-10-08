import { GeoEntityKind } from '@prisma/client';
import { ExperienceCatalogService } from 'src/modules/tours/services/experience-catalog.service';
import { CatalogKnowledgeAdministrationService } from 'src/modules/tours/services/catalog-knowledge-administration.service';
import { buildTourExperienceCreateData } from 'src/modules/tours/utils/tour-experience-snapshot.util';
import { getPrisma, resetDb, closeDb } from '../support/test-db';

/**
 * Partial composite persistence + administrative correction of a false
 * verified hint, against real Postgres (2026-10-08).
 *
 * The scenario reproduces the RW4 poisoned state with synthetic rows: the
 * hint "National Bank" was falsely VERIFIED as the First National Bank of
 * Boston building, remembered in that GeoEntity's hint memory, and persisted
 * as a resolved member of a Plaza de Mayo walk. An administrator revokes the
 * wrong association (the member becomes UNRESOLVED and the walk persists as
 * PARTIAL), then confirms the member against the existing Banco de la
 * Nacion GeoEntity (PARTIAL -> COMPLETE, the hint is learned for it).
 *
 * Tours freeze their components in TourExperienceComponent, so enrichment
 * reaches only Tours materialized after it. Tour snapshots are built with
 * the production snapshot builder over the production Experience load
 * shape.
 */
describe('tour-generation integration · partial composite administration', () => {
  let catalog: ExperienceCatalogService;
  let admin: CatalogKnowledgeAdministrationService;

  const WINDOW = {
    provenance: 'DESTINATION_POINT_RADIUS' as const,
    center: { latitude: -34.6083, longitude: -58.3712 },
    radiusMeters: 3_000,
  };
  const lookupNationalBank = () =>
    catalog.findGeoEntityCandidatesForHint({
      hintName: 'National Bank',
      expectedKind: GeoEntityKind.PLACE,
      window: WINDOW,
    });

  const place = async (name: string, latitude: number, longitude: number) => {
    const result = await catalog.upsertGeoEntityWithIdentities({
      name,
      kind: GeoEntityKind.PLACE,
      latitude,
      longitude,
      identities: [
        {
          provider: 'openstreetmap',
          externalId: `node/${name.length}${latitude}`,
        },
      ],
    });
    if (result.status === 'IDENTITY_CONFLICT') throw new Error('conflict');
    return result.geoEntity.id;
  };

  let plazaDeMayo: string;
  let cabildo: string;
  let casaRosada: string;
  let firstNationalBankOfBoston: string;
  let bancoNacion: string;

  /** The production Experience load + snapshot builder, in one Tour. */
  const materializeTour = async (experienceId: string) => {
    const prisma = await getPrisma();
    const tour = await prisma.tour.create({ data: { name: 'Snapshot tour' } });
    const experience = await prisma.experience.findUniqueOrThrow({
      where: { id: experienceId },
      include: { components: { include: { geoEntity: true } } },
    });
    const created = await prisma.tourExperience.create({
      data: buildTourExperienceCreateData(
        tour.id,
        { dayNumber: 1, order: 1, duration: 2 },
        experience,
      ),
    });
    return created.id;
  };
  const snapshotOf = async (tourExperienceId: string) =>
    (
      await (
        await getPrisma()
      ).tourExperienceComponent.findMany({
        where: { tourExperienceId },
        orderBy: { name: 'asc' },
        select: { name: true, geoEntityId: true },
      })
    ).map((component) => component.name);

  /** The poisoned walk: National Bank resolved (falsely) to FNBB. */
  const persistPoisonedWalk = async () => {
    expect(
      await catalog.rememberVerifiedHintName(
        firstNationalBankOfBoston,
        'National Bank',
      ),
    ).toBe('REMEMBERED');
    const experience = await catalog.persistVerifiedExperience({
      canonicalName: 'Plaza de Mayo historic walk',
      metadata: { themes: ['history'], intents: ['walk'] },
      components: [
        { geoEntityId: plazaDeMayo, sourceName: 'Plaza de Mayo', order: 1 },
        { geoEntityId: cabildo, sourceName: 'Cabildo', order: 2 },
        {
          geoEntityId: firstNationalBankOfBoston,
          sourceName: 'National Bank',
          order: 3,
        },
        { geoEntityId: casaRosada, sourceName: 'Casa Rosada', order: 4 },
      ],
    });
    return experience.id;
  };
  const membersOf = async (experienceId: string) =>
    (
      await (
        await getPrisma()
      ).experienceComponent.findMany({
        where: { experienceId },
        orderBy: { sourcePosition: 'asc' },
      })
    ).map((member) => ({
      id: member.id,
      sourcePosition: member.sourcePosition,
      sourceName: member.sourceName,
      geoEntityId: member.geoEntityId,
      state: member.resolutionState,
      reason: member.resolutionReason,
      source: member.resolutionSource,
    }));
  const automaticAssertion = async () =>
    (await getPrisma()).geoEntityVerifiedHintAssertion.findFirstOrThrow({
      where: {
        geoEntityId: firstNationalBankOfBoston,
        hintKey: 'national bank',
        source: 'AUTOMATIC',
      },
    });

  beforeAll(async () => {
    const prisma = await getPrisma();
    catalog = new ExperienceCatalogService(prisma, {
      getStatus: () => ({ provider: 'none' }),
    } as any);
    admin = new CatalogKnowledgeAdministrationService(prisma);
  });

  beforeEach(async () => {
    await resetDb();
    plazaDeMayo = await place('Plaza de Mayo', -34.6083, -58.3712);
    cabildo = await place('Cabildo de Buenos Aires', -34.6088, -58.3739);
    casaRosada = await place('Casa Rosada', -34.6081, -58.3702);
    firstNationalBankOfBoston = await place(
      'Edificio First National Bank of Boston',
      -34.6063,
      -58.3733,
    );
    bancoNacion = await place(
      'Banco de la Nacion Argentina',
      -34.6077,
      -58.3709,
    );
  });

  afterAll(async () => {
    await closeDb();
  });

  it('National Bank lifecycle: poisoned -> ADMIN revoke -> PARTIAL -> ADMIN confirm Banco Nacion -> COMPLETE, with the hint learned for the right GeoEntity', async () => {
    const prisma = await getPrisma();
    const experienceId = await persistPoisonedWalk();

    // Poisoned state: the lookup returns the wrong building by hint memory.
    expect(
      (await lookupNationalBank()).candidates.map((candidate) => [
        candidate.geoEntityId,
        candidate.matchKind,
      ]),
    ).toEqual([[firstNationalBankOfBoston, 'VERIFIED_HINT']]);
    const poisonedTour = await materializeTour(experienceId);

    // ADMIN REVOKE of the automatic assertion.
    const assertion = await automaticAssertion();
    const revoke = await admin.revokeVerifiedHintAssertion({
      assertionId: assertion.id,
      reason: 'RW4-ID-FALSE-VERIFY-2: National Bank is Banco de la Nacion',
    });
    expect(revoke).toMatchObject({
      status: 'REVOKED',
      geoEntityId: firstNationalBankOfBoston,
      hintKey: 'national bank',
      removedFromLookupIndex: true,
      experiences: [{ experienceId, outcome: 'PARTIAL' }],
    });

    // Removed from active lookup...
    expect((await lookupNationalBank()).candidates).toEqual([]);
    expect(
      await prisma.geoEntity.findUniqueOrThrow({
        where: { id: firstNationalBankOfBoston },
        select: { verifiedHintNames: true, verifiedHintNameKeys: true },
      }),
    ).toEqual({ verifiedHintNames: [], verifiedHintNameKeys: [] });
    // ...with its audit history retained.
    const audited =
      await prisma.geoEntityVerifiedHintAssertion.findUniqueOrThrow({
        where: { id: assertion.id },
      });
    expect(audited).toMatchObject({
      geoEntityId: firstNationalBankOfBoston,
      hintName: 'National Bank',
      hintKey: 'national bank',
      source: 'AUTOMATIC',
      revocationReason:
        'RW4-ID-FALSE-VERIFY-2: National Bank is Banco de la Nacion',
    });
    expect(audited.createdAt).toBeInstanceOf(Date);
    expect(audited.revokedAt).toBeInstanceOf(Date);

    // The source member is UNRESOLVED; the Experience persists PARTIAL.
    const afterRevoke = await membersOf(experienceId);
    expect(
      afterRevoke.map((member) => [
        member.sourcePosition,
        member.sourceName,
        member.state,
        member.reason,
      ]),
    ).toEqual([
      [0, 'Plaza de Mayo', 'RESOLVED', null],
      [1, 'Cabildo', 'RESOLVED', null],
      [2, 'National Bank', 'UNRESOLVED', 'RESOLUTION_REVOKED'],
      [3, 'Casa Rosada', 'RESOLVED', null],
    ]);
    const [partial] = await catalog.findVerifiedByIds([experienceId]);
    expect(partial.compositionCompleteness).toBe('PARTIAL');
    const detail = await catalog.findById(experienceId);
    expect(detail!.sourceComposition).toEqual({
      completeness: 'PARTIAL',
      unresolvedMembers: [
        expect.objectContaining({
          sourcePosition: 2,
          sourceName: 'National Bank',
          resolutionReason: 'RESOLUTION_REVOKED',
        }),
      ],
    });
    const partialTour = await materializeTour(experienceId);

    // The automatic resolver can not silently re-learn the revoked pair.
    expect(
      await catalog.rememberVerifiedHintName(
        firstNationalBankOfBoston,
        'National Bank',
      ),
    ).toBe('SUPPRESSED_BY_REVOCATION');
    expect((await lookupNationalBank()).candidates).toEqual([]);

    // ADMIN CONFIRM against the existing Banco de la Nacion GeoEntity.
    const actor = await prisma.user.create({
      data: {
        email: 'catalog-admin@example.com',
        provider: 'GOOGLE',
        providerId: 'catalog-admin',
      },
    });
    const geoEntitiesBefore = await prisma.geoEntity.count();
    const nationalBankMember = afterRevoke[2];
    const confirm = await admin.confirmSourceMember({
      componentId: nationalBankMember.id,
      geoEntityId: bancoNacion,
      actorUserId: actor.id,
    });
    expect(confirm).toEqual({
      status: 'CONFIRMED',
      componentId: nationalBankMember.id,
      experienceId,
      geoEntityId: bancoNacion,
      hintKey: 'national bank',
      completeness: 'COMPLETE',
    });

    // PARTIAL -> COMPLETE in place: no new Experience, no new GeoEntity.
    expect(await prisma.experience.count()).toBe(1);
    expect(await prisma.geoEntity.count()).toBe(geoEntitiesBefore);
    expect((await membersOf(experienceId))[2]).toMatchObject({
      sourcePosition: 2,
      sourceName: 'National Bank',
      geoEntityId: bancoNacion,
      state: 'RESOLVED',
      reason: null,
      source: 'ADMIN',
    });
    const [complete] = await catalog.findVerifiedByIds([experienceId]);
    expect(complete.compositionCompleteness).toBe('COMPLETE');

    // Future identity lookup: Banco de la Nacion, VERIFIED_HINT.
    expect(
      (await lookupNationalBank()).candidates.map((candidate) => [
        candidate.geoEntityId,
        candidate.matchKind,
      ]),
    ).toEqual([[bancoNacion, 'VERIFIED_HINT']]);
    expect(
      await prisma.geoEntityVerifiedHintAssertion.findMany({
        where: { hintKey: 'national bank', revokedAt: null },
        select: { geoEntityId: true, source: true, actorUserId: true },
      }),
    ).toEqual([
      { geoEntityId: bancoNacion, source: 'ADMIN', actorUserId: actor.id },
    ]);

    // Existing Tours keep their own snapshot; a new Tour sees the enrichment.
    expect(await snapshotOf(poisonedTour)).toEqual([
      'Cabildo de Buenos Aires',
      'Casa Rosada',
      'Edificio First National Bank of Boston',
      'Plaza de Mayo',
    ]);
    expect(await snapshotOf(partialTour)).toEqual([
      'Cabildo de Buenos Aires',
      'Casa Rosada',
      'Plaza de Mayo',
    ]);
    expect(await snapshotOf(await materializeTour(experienceId))).toEqual([
      'Banco de la Nacion Argentina',
      'Cabildo de Buenos Aires',
      'Casa Rosada',
      'Plaza de Mayo',
    ]);
  });

  it('ADMIN confirm fails explicitly when the hint is already active on another GeoEntity (no silent double ownership)', async () => {
    const prisma = await getPrisma();
    await persistPoisonedWalk();
    const obelisco = await place('Obelisco', -34.6037, -58.3816);
    const teatroColon = await place('Teatro Colon', -34.6011, -58.3833);
    const other = await catalog.persistVerifiedExperience({
      canonicalName: 'Avenida 9 de Julio landmarks',
      components: [
        { geoEntityId: obelisco, sourceName: 'Obelisco' },
        { geoEntityId: teatroColon, sourceName: 'Teatro Colon' },
        {
          resolutionState: 'UNRESOLVED',
          resolutionReason: 'AMBIGUOUS_CANDIDATES',
          sourceName: 'National Bank',
        },
      ],
    });
    expect((other as any).dedupeDecision).toBe('NEW');
    const member = (await membersOf(other.id))[2];

    const result = await admin.confirmSourceMember({
      componentId: member.id,
      geoEntityId: bancoNacion,
    });

    expect(result).toEqual({
      status: 'HINT_OWNED_BY_ANOTHER_GEOENTITY',
      hintKey: 'national bank',
      ownerGeoEntityIds: [firstNationalBankOfBoston],
    });
    expect((await membersOf(other.id))[2].state).toBe('UNRESOLVED');
    expect(
      await prisma.geoEntityVerifiedHintAssertion.count({
        where: { geoEntityId: bancoNacion },
      }),
    ).toBe(0);
    expect(
      (await lookupNationalBank()).candidates.map((c) => c.geoEntityId),
    ).toEqual([firstNationalBankOfBoston]);
  });

  it('revoking one assertion keeps the hint while another active assertion still supports the same pair', async () => {
    const prisma = await getPrisma();
    const experienceId = await persistPoisonedWalk();
    await prisma.geoEntityVerifiedHintAssertion.create({
      data: {
        geoEntityId: firstNationalBankOfBoston,
        hintName: 'National Bank',
        hintKey: 'national bank',
        source: 'ADMIN',
      },
    });

    const result = await admin.revokeVerifiedHintAssertion({
      assertionId: (await automaticAssertion()).id,
    });

    expect(result).toMatchObject({
      status: 'REVOKED',
      removedFromLookupIndex: false,
      unresolvedMemberIds: [],
      experiences: [],
    });
    expect(
      (await lookupNationalBank()).candidates.map((c) => c.geoEntityId),
    ).toEqual([firstNationalBankOfBoston]);
    expect((await membersOf(experienceId))[2].state).toBe('RESOLVED');
    expect(
      await admin.revokeVerifiedHintAssertion({
        assertionId: (await automaticAssertion()).id,
      }),
    ).toMatchObject({ status: 'ALREADY_REVOKED' });
  });

  it('a revocation that leaves fewer than 2 distinct resolved GeoEntities ARCHIVES the Experience (rows kept, never planner-visible)', async () => {
    const prisma = await getPrisma();
    await catalog.rememberVerifiedHintName(
      firstNationalBankOfBoston,
      'National Bank',
    );
    const pair = await catalog.persistVerifiedExperience({
      canonicalName: 'Two banks',
      components: [
        { geoEntityId: plazaDeMayo, sourceName: 'Plaza de Mayo' },
        {
          geoEntityId: firstNationalBankOfBoston,
          sourceName: 'National Bank',
        },
      ],
    });

    const result = await admin.revokeVerifiedHintAssertion({
      assertionId: (await automaticAssertion()).id,
    });

    expect(result).toMatchObject({
      status: 'REVOKED',
      experiences: [{ experienceId: pair.id, outcome: 'ARCHIVED' }],
    });
    const archived = await prisma.experience.findUniqueOrThrow({
      where: { id: pair.id },
      include: { components: true },
    });
    expect(archived.status).toBe('ARCHIVED');
    expect(archived.components).toHaveLength(2);
    expect(await catalog.findVerifiedByIds([pair.id])).toEqual([]);
  });

  it('two source members resolving to the same GeoEntity are both persisted; they count once and never become two Tour stops', async () => {
    const prisma = await getPrisma();
    const experience = await catalog.persistVerifiedExperience({
      canonicalName: 'Caminito pair',
      components: [
        { geoEntityId: casaRosada, sourceName: 'Caminito' },
        { geoEntityId: casaRosada, sourceName: 'Caminito Street' },
      ],
    });

    expect(
      (await membersOf(experience.id)).map((member) => [
        member.sourceName,
        member.geoEntityId,
      ]),
    ).toEqual([
      ['Caminito', casaRosada],
      ['Caminito Street', casaRosada],
    ]);
    const [projected] = await catalog.findVerifiedByIds([experience.id]);
    expect(projected.components).toHaveLength(1);
    expect(
      await catalog.findVerifiedMultiComponentByExactComponent(casaRosada),
    ).toEqual([]);
    expect(await snapshotOf(await materializeTour(experience.id))).toEqual([
      'Casa Rosada',
    ]);
    // ...and by themselves they never admit a PARTIAL composite.
    await expect(
      catalog.persistVerifiedExperience({
        canonicalName: 'Caminito trio',
        components: [
          { geoEntityId: casaRosada, sourceName: 'Caminito' },
          {
            resolutionState: 'UNRESOLVED',
            resolutionReason: 'AMBIGUOUS_CANDIDATES',
            sourceName: 'Don Carlos',
          },
          { geoEntityId: casaRosada, sourceName: 'Caminito Street' },
        ],
      }),
    ).rejects.toThrow('BELOW_DISTINCT_FLOOR');
    expect(await prisma.experience.count()).toBe(1);
  });

  it('the database refuses an UNRESOLVED member with a GeoEntity, or one without a reason', async () => {
    const prisma = await getPrisma();
    const experience = await prisma.experience.create({
      data: { canonicalName: 'Guarded', status: 'VERIFIED' },
    });
    await expect(
      prisma.experienceComponent.create({
        data: {
          experienceId: experience.id,
          geoEntityId: plazaDeMayo,
          sourcePosition: 0,
          sourceName: 'Plaza de Mayo',
          resolutionState: 'UNRESOLVED',
          resolutionReason: 'NO_CANDIDATE_ACQUIRED',
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.experienceComponent.create({
        data: {
          experienceId: experience.id,
          sourcePosition: 1,
          sourceName: 'Somewhere',
          resolutionState: 'UNRESOLVED',
        },
      }),
    ).rejects.toThrow();
  });

  it('catalog reuse of a PARTIAL Experience: the same source composition seen again dedupes SAME onto it, no duplicate', async () => {
    const prisma = await getPrisma();
    const input = {
      canonicalName: 'Plaza de Mayo historic walk',
      metadata: { themes: ['history'], intents: ['walk'] },
      components: [
        { geoEntityId: plazaDeMayo, sourceName: 'Plaza de Mayo', order: 1 },
        { geoEntityId: cabildo, sourceName: 'Cabildo', order: 2 },
        {
          resolutionState: 'UNRESOLVED' as const,
          resolutionReason: 'CANDIDATE_UNCONFIRMED' as const,
          sourceName: 'National Bank',
          order: 3,
        },
        { geoEntityId: casaRosada, sourceName: 'Casa Rosada', order: 4 },
      ],
    };
    const first = await catalog.persistVerifiedExperience(input);
    const second = await catalog.persistVerifiedExperience(input);

    expect(second.id).toBe(first.id);
    expect((second as any).dedupeDecision).toBe('SAME');
    expect(await prisma.experience.count()).toBe(1);
    const pool = await catalog.findVerifiedWithinForMatching(
      WINDOW.center.latitude,
      WINDOW.center.longitude,
      2_000,
    );
    expect(pool.map((row) => [row.id, row.compositionCompleteness])).toEqual([
      [first.id, 'PARTIAL'],
    ]);
  });
});
