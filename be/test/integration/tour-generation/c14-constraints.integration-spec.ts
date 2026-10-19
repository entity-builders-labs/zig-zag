import { Prisma } from '@prisma/client';
import { closeDb, getPrisma, resetDb } from '../support/test-db';

describe('tour-generation integration · C14 database constraints', () => {
  const prismaPromise = getPrisma();

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  it('enforces the C14 relation, hours, duration, and traversal checks', async () => {
    const prisma = await prismaPromise;
    const child = await prisma.geoEntity.create({
      data: { name: 'C14 child', kind: 'PLACE' },
    });
    const parent = await prisma.geoEntity.create({
      data: { name: 'C14 parent', kind: 'PLACE' },
    });
    const experience = await prisma.experience.create({
      data: { canonicalName: 'C14 constraint test', status: 'VERIFIED' },
    });

    await expect(
      prisma.$executeRaw(Prisma.sql`
        INSERT INTO geo_entity_relation
          (id, "childId", "parentId", type, "evidenceSource", evidence, "evaluatedAt")
        VALUES ('c14-self', ${child.id}, ${child.id}, 'PART_OF',
          'DECLARED_CONTAINMENT', '{}'::jsonb, NOW())
      `),
    ).rejects.toThrow(/geo_entity_relation_no_self_reference/);

    await expect(
      prisma.$executeRaw(Prisma.sql`
        INSERT INTO geo_entity_opening_hours
          ("geoEntityId", status, source, "retrievedAt")
        VALUES (${child.id}, 'KNOWN', 'test', NOW())
      `),
    ).rejects.toThrow(/geo_entity_opening_hours_known_consistent/);

    await expect(
      prisma.$executeRaw(Prisma.sql`
        INSERT INTO geo_entity_visit_duration
          ("geoEntityId", status, "minMinutes", "typicalMinutes", "maxMinutes",
           evidence, "resolverVersion", "resolvedAt")
        VALUES (${child.id}, 'RESOLVED', 90, 60, 120, '{}'::jsonb, 'test', NOW())
      `),
    ).rejects.toThrow(/geo_entity_visit_duration_range_ordered/);

    await expect(
      prisma.$executeRaw(Prisma.sql`
        INSERT INTO geo_entity_visit_duration
          ("geoEntityId", status, evidence, "resolverVersion", "resolvedAt")
        VALUES (${child.id}, 'RESOLVED', '{}'::jsonb, 'test', NOW())
      `),
    ).rejects.toThrow(/geo_entity_visit_duration_resolved_consistent/);

    await expect(
      prisma.$executeRaw(Prisma.sql`
        INSERT INTO geo_entity_visit_duration
          ("geoEntityId", status, "typicalMinutes", evidence, "resolverVersion", "resolvedAt")
        VALUES (${child.id}, 'INSUFFICIENT_EVIDENCE', 60, '{}'::jsonb, 'test', NOW())
      `),
    ).rejects.toThrow(/geo_entity_visit_duration_insufficient_consistent/);

    await expect(
      prisma.$executeRaw(Prisma.sql`
        INSERT INTO experience_component
          (id, "experienceId", "geoEntityId", role, participation,
           "traversalFromGeoEntityId")
        VALUES ('c14-visit-traversal', ${experience.id}, ${child.id}, 'venue',
          'VISIT', ${parent.id})
      `),
    ).rejects.toThrow(/experience_component_traversal_participation/);
  });

  it('enforces C14 uniqueness and GeoEntity-owned cascade deletion', async () => {
    const prisma = await prismaPromise;
    const child = await prisma.geoEntity.create({
      data: { name: 'C14 cascade child', kind: 'PLACE' },
    });
    const parent = await prisma.geoEntity.create({
      data: { name: 'C14 cascade parent', kind: 'PLACE' },
    });
    await prisma.geoEntityRelation.create({
      data: {
        childId: child.id,
        parentId: parent.id,
        type: 'PART_OF',
        evidenceSource: 'DECLARED_CONTAINMENT',
        evidence: { source: 'fixture' },
        evaluatedAt: new Date(),
      },
    });
    await expect(
      prisma.geoEntityRelation.create({
        data: {
          childId: child.id,
          parentId: parent.id,
          type: 'PART_OF',
          evidenceSource: 'DECLARED_CONTAINMENT',
          evidence: { source: 'duplicate' },
          evaluatedAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await prisma.geoEntityOpeningHours.create({
      data: {
        geoEntityId: child.id,
        status: 'UNKNOWN',
        source: 'openstreetmap',
        retrievedAt: new Date(),
      },
    });
    await prisma.geoEntityVisitDuration.create({
      data: {
        geoEntityId: child.id,
        status: 'INSUFFICIENT_EVIDENCE',
        evidence: { source: 'test' },
        resolverVersion: 'test',
        resolvedAt: new Date(),
      },
    });
    await prisma.geoEntityAdmission.create({
      data: {
        geoEntityId: child.id,
        outcome: 'ADMITTED',
        rule: 'test',
        policyVersion: 'test',
        evidence: { source: 'test' },
        evaluatedAt: new Date(),
      },
    });

    await prisma.geoEntity.delete({ where: { id: child.id } });
    expect(
      await prisma.geoEntityAdmission.count({
        where: { geoEntityId: child.id },
      }),
    ).toBe(0);
    expect(
      await prisma.geoEntityOpeningHours.count({
        where: { geoEntityId: child.id },
      }),
    ).toBe(0);
    expect(
      await prisma.geoEntityVisitDuration.count({
        where: { geoEntityId: child.id },
      }),
    ).toBe(0);
    expect(
      await prisma.geoEntityRelation.count({ where: { childId: child.id } }),
    ).toBe(0);
  });

  it('keeps composition signatures unique without requiring legacy backfill', async () => {
    const prisma = await prismaPromise;
    await prisma.experience.create({
      data: { canonicalName: 'C14 unsigned', status: 'VERIFIED' },
    });
    await prisma.experience.create({
      data: {
        canonicalName: 'C14 signature one',
        status: 'VERIFIED',
        compositionSignature: 'c14-signature',
      },
    });
    await expect(
      prisma.experience.create({
        data: {
          canonicalName: 'C14 signature duplicate',
          status: 'VERIFIED',
          compositionSignature: 'c14-signature',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(
      await prisma.experience.count({ where: { compositionSignature: null } }),
    ).toBe(1);
  });
});
