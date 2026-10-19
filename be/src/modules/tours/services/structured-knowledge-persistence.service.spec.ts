import { StructuredKnowledgePersistenceService } from './structured-knowledge-persistence.service';
import { evaluateStructuredPlaceAdmission } from '../admission/structured-place-admission';

describe('StructuredKnowledgePersistenceService', () => {
  const prismaMock = () =>
    ({
      geoEntityAdmission: { upsert: jest.fn().mockResolvedValue({}) },
      geoEntityRelation: { upsert: jest.fn().mockResolvedValue({}) },
      geoEntityOpeningHours: { upsert: jest.fn().mockResolvedValue({}) },
      geoEntityIdentity: { update: jest.fn().mockResolvedValue({}) },
    }) as any;

  it('persists an ADMITTED admission with canonical signals', async () => {
    const prisma = prismaMock();
    const svc = new StructuredKnowledgePersistenceService(prisma);
    const record = evaluateStructuredPlaceAdmission({
      tags: { tourism: 'museum' },
    });
    await svc.upsertAdmission('geo-1', record, {
      provider: 'openstreetmap',
      externalId: 'osm:node:1',
    });
    expect(prisma.geoEntityAdmission.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { geoEntityId: 'geo-1' },
        create: expect.objectContaining({
          outcome: 'ADMITTED',
          signals: ['EXPLICIT_VISITOR_CLASSIFICATION'],
          evidence: expect.objectContaining({
            provider: 'openstreetmap',
            externalId: 'osm:node:1',
          }),
        }),
      }),
    );
  });

  it('maps ROAD_OR_ROUTE to ROAD_OR_ROUTE_AS_PLACE and drops SUB_FEATURE', async () => {
    const prisma = prismaMock();
    const svc = new StructuredKnowledgePersistenceService(prisma);
    const record = evaluateStructuredPlaceAdmission({
      tags: { highway: 'residential' },
    });
    await svc.upsertAdmission('geo-1', record, { provider: 'openstreetmap' });
    const call = prisma.geoEntityAdmission.upsert.mock.calls[0][0];
    expect(call.create.outcome).toBe('EXCLUDED_CATEGORY');
    expect(call.create.exclusions).toEqual(['ROAD_OR_ROUTE_AS_PLACE']);
  });

  it('persists INSUFFICIENT_ADMISSION_EVIDENCE for a bare artwork', async () => {
    const prisma = prismaMock();
    const svc = new StructuredKnowledgePersistenceService(prisma);
    const record = evaluateStructuredPlaceAdmission({
      tags: { tourism: 'artwork' },
    });
    await svc.upsertAdmission('geo-1', record, { provider: 'openstreetmap' });
    const call = prisma.geoEntityAdmission.upsert.mock.calls[0][0];
    expect(call.create.outcome).toBe('INSUFFICIENT_ADMISSION_EVIDENCE');
    expect(call.create.exclusions).toEqual([]);
  });

  it('persists a PART_OF relation with a visit-unit classification', async () => {
    const prisma = prismaMock();
    const svc = new StructuredKnowledgePersistenceService(prisma);
    await svc.upsertRelation({
      childId: 'child-1',
      parentId: 'parent-1',
      evidenceSource: 'DECLARED_CONTAINMENT',
      evidence: { relationClass: 'grave:cemetery' },
      visitUnitClassification: 'CHILD_REQUIRES_PARENT_VISIT',
      classificationVersion: 'visit-unit-v1',
    });
    expect(prisma.geoEntityRelation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          childId_parentId_type: {
            childId: 'child-1',
            parentId: 'parent-1',
            type: 'PART_OF',
          },
        },
      }),
    );
  });

  it('persists UNKNOWN opening hours when no schedule is provided', async () => {
    const prisma = prismaMock();
    const svc = new StructuredKnowledgePersistenceService(prisma);
    await svc.upsertOpeningHours('geo-1', { source: 'openstreetmap' });
    expect(prisma.geoEntityOpeningHours.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: 'UNKNOWN' }),
      }),
    );
  });

  it('persists KNOWN opening hours with schedule and timezone', async () => {
    const prisma = prismaMock();
    const svc = new StructuredKnowledgePersistenceService(prisma);
    await svc.upsertOpeningHours('geo-1', {
      source: 'openstreetmap',
      timezone: 'America/Argentina/Buenos_Aires',
      schedule: { windows: [] },
      scheduleVersion: 1,
    });
    expect(prisma.geoEntityOpeningHours.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: 'KNOWN' }),
      }),
    );
  });
});
