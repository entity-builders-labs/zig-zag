import { ExperienceCatalogService } from '../../../src/modules/tours/services/experience-catalog.service';
import {
  PlanningCandidateNormalizerService,
  PlanningProjectableExperience,
} from '../../../src/modules/tours/services/planning-candidate-normalizer.service';
import { derivePreferenceUtility } from '../../../src/modules/tours/utils/preference-utility.util';
import { PreferenceUtilityResult } from '../../../src/modules/tours/interfaces/preference-utility.interface';
import { composableExperience } from '../../../src/modules/tours/fixtures/composable-experience.fixture';
import { planningDaysFixture } from '../../../src/modules/tours/fixtures/planning-input.fixture';
import { STRUCTURED_ADMISSION_POLICY_VERSION } from '../../../src/modules/tours/admission/structured-admission-policy';
import { closeDb, getPrisma, resetDb } from '../support/test-db';

const scope = { latitude: -34.6, longitude: -58.38, radiusMeters: 2_000 };
const days = planningDaysFixture(1, { startDate: '2026-10-19' });

async function createAdmittedPlace(
  prisma: Awaited<ReturnType<typeof getPrisma>>,
  name: string,
  externalId: string,
  point: { latitude: number; longitude: number },
) {
  const entity = await prisma.geoEntity.create({
    data: {
      name,
      kind: 'PLACE',
      ...point,
      geometry: {
        type: 'Point',
        coordinates: [point.longitude, point.latitude],
      },
    },
  });
  await prisma.geoEntityIdentity.create({
    data: { geoEntityId: entity.id, provider: 'openstreetmap', externalId },
  });
  await prisma.geoEntityAdmission.create({
    data: {
      geoEntityId: entity.id,
      outcome: 'ADMITTED',
      rule: STRUCTURED_ADMISSION_POLICY_VERSION,
      signals: ['EXPLICIT_VISITOR_CLASSIFICATION'],
      exclusions: [],
      policyVersion: STRUCTURED_ADMISSION_POLICY_VERSION,
      evidence: { provider: 'openstreetmap', externalId },
      evaluatedAt: new Date('2026-10-19T00:00:00.000Z'),
    },
  });
  return entity;
}

function normalizeRows(rows: PlanningProjectableExperience[]) {
  const derived = derivePreferenceUtility({
    experiences: rows.map((row) =>
      composableExperience({
        id: row.id,
        canonicalName: row.canonicalName ?? row.name ?? row.id,
        components: row.components,
        qualityScore: null,
        durationMinutes: row.durationMinutes,
      }),
    ),
    preferenceSpec: { facets: [], assertions: [] },
    softAnchorIds: new Set(),
    semantic: null,
  });
  const utility: PreferenceUtilityResult = {
    ...derived,
    semanticRanking: {
      status: 'not_requested',
      requestedCandidateCount: 0,
      indexedCandidateCount: 0,
    },
  };
  return new PlanningCandidateNormalizerService().normalizeExperiences(
    rows,
    utility,
    { days },
  );
}

describe('tour-generation integration · C14 single-place composition', () => {
  beforeEach(async () => {
    const prisma = await getPrisma();
    const [row] = await prisma.$queryRaw<Array<{ database: string }>>`
      SELECT current_database() AS database`;
    if (row?.database !== 'zigzag_39_test') {
      throw new Error('Task 40.1 integration tests require zigzag_39_test.');
    }
    await resetDb();
  });

  afterAll(async () => closeDb());

  it('composes one stable Experience from admission and projects C14 knowledge only', async () => {
    const prisma = await getPrisma();
    const catalog = new ExperienceCatalogService(prisma, {} as any);
    const place = await createAdmittedPlace(
      prisma,
      'Single-place museum',
      'osm:node:201',
      {
        latitude: -34.6,
        longitude: -58.38,
      },
    );
    await prisma.geoEntityVisitDuration.create({
      data: {
        geoEntityId: place.id,
        status: 'RESOLVED',
        minMinutes: 60,
        typicalMinutes: 75,
        maxMinutes: 90,
        authorityClass: 'STRUCTURED_PROVIDER',
        evidenceQuality: 'DIRECT',
        evidence: [
          { provider: 'openstreetmap', field: 'visit_duration_minutes' },
        ],
        resolverVersion: 'duration-v1',
        resolvedAt: new Date('2026-10-19T00:00:00.000Z'),
      },
    });
    await prisma.geoEntityOpeningHours.create({
      data: {
        geoEntityId: place.id,
        status: 'KNOWN',
        timezone: 'America/Argentina/Buenos_Aires',
        schedule: {
          weekly: {
            '1': [
              {
                startMinutesFromMidnight: 540,
                endMinutesFromMidnight: 1020,
                lastAdmissionMinutesFromMidnight: 960,
              },
            ],
          },
          exceptions: {},
        },
        scheduleVersion: 1,
        source: 'institutional',
        sourceRecordRef: 'hours:201',
        sourceRaw: null,
        parserVersion: 'hours-v1',
        retrievedAt: new Date('2026-10-19T00:00:00.000Z'),
      },
    });

    const composedIds = await catalog.composeAdmittedPlacesWithinScope(scope);
    expect(composedIds).toHaveLength(1);
    const [experience] = await prisma.experience.findMany({
      where: { id: composedIds[0] },
      include: { components: true },
    });
    expect(experience).toMatchObject({
      canonicalName: 'Single-place museum',
      status: 'VERIFIED',
      durationMinutes: null,
      openingHours: null,
      description: null,
    });
    expect(experience.components).toHaveLength(1);
    expect(
      await prisma.experience.count({
        where: { components: { some: { geoEntityId: place.id } } },
      }),
    ).toBe(1);
    expect(experience.components[0]).toMatchObject({
      geoEntityId: place.id,
      participation: 'VISIT',
      required: true,
      sourcePosition: 0,
    });
    expect(await prisma.geoEntityTargetObservation.count()).toBe(0);

    const firstId = experience.id;
    const firstSignature = experience.compositionSignature;
    const initialRows = await catalog.findVerifiedByIds([firstId]);
    const firstProjection = normalizeRows(initialRows);
    expect(
      firstProjection.candidates[0].components[0].visit?.duration,
    ).toMatchObject({
      minutes: 75,
      provenance: {
        source: 'GEO_ENTITY_VISIT_DURATION',
        evidenceBacked: true,
        geoEntityId: place.id,
        authorityClass: 'STRUCTURED_PROVIDER',
        resolverVersion: 'duration-v1',
      },
    });
    expect(
      firstProjection.candidates[0].components[0].visit?.openingHoursByDay[0],
    ).toMatchObject({
      status: 'KNOWN_OPEN_WINDOW',
      provenance: {
        source: 'GEO_ENTITY_OPENING_HOURS',
        provider: 'institutional',
        sourceRecordRef: 'hours:201',
      },
    });

    await prisma.geoEntityVisitDuration.update({
      where: { geoEntityId: place.id },
      data: {
        typicalMinutes: 80,
        authorityClass: 'OFFICIAL_SITE',
        evidenceQuality: 'CORROBORATED',
        evidence: [{ provider: 'official-site', field: 'duration' }],
        resolverVersion: 'duration-v2',
        resolvedAt: new Date('2026-10-20T00:00:00.000Z'),
      },
    });
    await prisma.geoEntityOpeningHours.update({
      where: { geoEntityId: place.id },
      data: {
        schedule: {
          weekly: {
            '1': [
              {
                startMinutesFromMidnight: 540,
                endMinutesFromMidnight: 1080,
                lastAdmissionMinutesFromMidnight: 1020,
              },
            ],
          },
          exceptions: {},
        },
        source: 'official-site',
        sourceRecordRef: 'hours:201:v2',
        retrievedAt: new Date('2026-10-20T00:00:00.000Z'),
      },
    });
    const recomposedIds = await catalog.composeAdmittedPlacesWithinScope(scope);
    expect(recomposedIds).toEqual([firstId]);
    expect(
      await prisma.experience.count({
        where: { compositionSignature: firstSignature },
      }),
    ).toBe(1);
    const updatedProjection = normalizeRows(
      await catalog.findVerifiedByIds([firstId]),
    );
    expect(
      updatedProjection.candidates[0].components[0].visit?.duration,
    ).toMatchObject({
      minutes: 80,
      provenance: {
        authorityClass: 'OFFICIAL_SITE',
        resolverVersion: 'duration-v2',
      },
    });
    expect(
      updatedProjection.candidates[0].components[0].visit?.openingHoursByDay[0],
    ).toMatchObject({
      status: 'KNOWN_OPEN_WINDOW',
      windows: [
        {
          startMinutesFromMidnight: 540,
          endMinutesFromMidnight: 1080,
          lastAdmissionMinutesFromMidnight: 1020,
        },
      ],
      provenance: { sourceRecordRef: 'hours:201:v2' },
    });

    await prisma.geoEntityOpeningHours.update({
      where: { geoEntityId: place.id },
      data: {
        status: 'UNKNOWN',
        schedule: null,
        scheduleVersion: null,
        timezone: null,
        source: 'openstreetmap',
        sourceRecordRef: 'hours:201:unknown',
      },
    });
    await catalog.composeAdmittedPlacesWithinScope(scope);
    expect(
      normalizeRows(await catalog.findVerifiedByIds([firstId])).candidates[0]
        .components[0].visit?.openingHoursByDay[0],
    ).toMatchObject({ status: 'UNKNOWN' });
    expect(
      await prisma.experience.findUniqueOrThrow({ where: { id: firstId } }),
    ).toMatchObject({
      status: 'VERIFIED',
      compositionSignature: firstSignature,
    });

    const noDuration = await createAdmittedPlace(
      prisma,
      'No duration place',
      'osm:node:202',
      {
        latitude: -34.601,
        longitude: -58.381,
      },
    );
    await catalog.composeAdmittedPlacesWithinScope(scope);
    const noDurationExperience = await prisma.experience.findFirstOrThrow({
      where: { components: { some: { geoEntityId: noDuration.id } } },
    });
    await prisma.experience.update({
      where: { id: noDurationExperience.id },
      data: {
        durationMinutes: 240,
        metadata: { openingHours: { status: 'known' } },
      },
    });
    const noDurationCatalogRows = await catalog.findVerifiedByIds([
      noDurationExperience.id,
    ]);
    expect(noDurationCatalogRows[0].durationMinutes).toBeNull();
    expect(noDurationCatalogRows[0].metadata).not.toHaveProperty(
      'openingHours',
    );
    const noDurationProjection = normalizeRows(noDurationCatalogRows);
    expect(noDurationProjection.candidates).toHaveLength(0);
    expect(noDurationProjection.ineligible).toContainEqual({
      experienceId: noDurationExperience.id,
      reason: 'MISSING_REQUIRED_DURATION',
    });
    expect(
      await prisma.experience.findUniqueOrThrow({
        where: { id: noDurationExperience.id },
      }),
    ).toMatchObject({ status: 'VERIFIED' });
    expect(
      await prisma.geoEntityAdmission.findUniqueOrThrow({
        where: { geoEntityId: noDuration.id },
      }),
    ).toMatchObject({ outcome: 'ADMITTED' });
    expect(
      await prisma.geoEntityOpeningHours.findUnique({
        where: { geoEntityId: noDuration.id },
      }),
    ).toBeNull();

    const parent = await createAdmittedPlace(
      prisma,
      'Parent site',
      'osm:node:203',
      {
        latitude: -34.602,
        longitude: -58.382,
      },
    );
    const child = await createAdmittedPlace(
      prisma,
      'Parent sub-feature',
      'osm:node:204',
      {
        latitude: -34.6021,
        longitude: -58.3821,
      },
    );
    await prisma.geoEntityRelation.create({
      data: {
        childId: child.id,
        parentId: parent.id,
        type: 'PART_OF',
        evidenceSource: 'PROVIDER_SITE_MEMBERSHIP',
        evidence: { source: 'fixture' },
        visitUnitClassification: 'CHILD_REQUIRES_PARENT_VISIT',
        classificationVersion: 'visit-unit-v1',
        evaluatedAt: new Date('2026-10-19T00:00:00.000Z'),
      },
    });
    await catalog.composeAdmittedPlacesWithinScope(scope);
    expect(
      await prisma.experienceComponent.findMany({
        where: { geoEntityId: child.id },
      }),
    ).toHaveLength(0);
    expect(
      await prisma.geoEntityAdmission.findUniqueOrThrow({
        where: { geoEntityId: child.id },
      }),
    ).toMatchObject({ outcome: 'ADMITTED' });

    const unadmittedParent = await prisma.geoEntity.create({
      data: {
        name: 'Unadmitted parent',
        kind: 'PLACE',
        latitude: -34.603,
        longitude: -58.383,
      },
    });
    const orphanedChild = await createAdmittedPlace(
      prisma,
      'Child of unadmitted parent',
      'osm:node:205',
      { latitude: -34.6031, longitude: -58.3831 },
    );
    await prisma.geoEntityRelation.create({
      data: {
        childId: orphanedChild.id,
        parentId: unadmittedParent.id,
        type: 'PART_OF',
        evidenceSource: 'PROVIDER_SITE_MEMBERSHIP',
        evidence: { source: 'fixture' },
        visitUnitClassification: 'CHILD_REQUIRES_PARENT_VISIT',
        classificationVersion: 'visit-unit-v1',
        evaluatedAt: new Date('2026-10-19T00:00:00.000Z'),
      },
    });
    const ambiguousChild = await createAdmittedPlace(
      prisma,
      'Ambiguous child',
      'osm:node:206',
      { latitude: -34.604, longitude: -58.384 },
    );
    await prisma.geoEntityRelation.create({
      data: {
        childId: ambiguousChild.id,
        parentId: parent.id,
        type: 'PART_OF',
        evidenceSource: 'PROVIDER_SITE_MEMBERSHIP',
        evidence: { source: 'fixture' },
        visitUnitClassification: 'AMBIGUOUS_PARENT_RELATIONSHIP',
        classificationVersion: 'visit-unit-v1',
        evaluatedAt: new Date('2026-10-19T00:00:00.000Z'),
      },
    });
    await catalog.composeAdmittedPlacesWithinScope(scope);
    expect(
      await prisma.experienceComponent.findMany({
        where: { geoEntityId: { in: [orphanedChild.id, ambiguousChild.id] } },
      }),
    ).toHaveLength(0);
    expect(await prisma.geoEntityTargetObservation.count()).toBe(0);
  });
});
