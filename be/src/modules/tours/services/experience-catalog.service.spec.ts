import { ExperienceCatalogService } from './experience-catalog.service';

describe('ExperienceCatalogService dedupe', () => {
  const input: any = { canonicalName: ' Museo Central ', components: [{ geoEntityId: 'geo-1', role: 'venue' }], evidence: [{ source: 'search', url: 'https://example.test', title: 'Museo', snippet: 'evidence' }] };

  it('reuses the same verified experience and adds missing evidence', async () => {
    const same: any = { id: 'exp-1', canonicalName: 'museo central', components: [{ geoEntityId: 'geo-1' }], evidence: [], traits: [] };
    const tx: any = { $executeRaw: jest.fn(), experience: { findMany: jest.fn().mockResolvedValue([same]), create: jest.fn() }, experienceEvidence: { createMany: jest.fn() } };
    const prisma: any = { $transaction: jest.fn((callback: any) => callback(tx)) };
    const service = new ExperienceCatalogService(prisma, {} as any);
    const result = await service.persistVerifiedExperience(input);
    expect(result.id).toBe('exp-1');
    expect(result.dedupeDecision).toBe('SAME');
    expect(tx.experience.create).not.toHaveBeenCalled();
    expect(tx.experienceEvidence.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ experienceId: 'exp-1', source: 'search' })] });
  });

  it('serializes the identity check inside the database transaction', async () => {
    const tx: any = { $executeRaw: jest.fn(), experience: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({ id: 'exp-new' }) } };
    const prisma: any = { $transaction: jest.fn((callback: any) => callback(tx)) };
    const result = await new ExperienceCatalogService(prisma, {} as any).persistVerifiedExperience({ ...input, evidence: [] });
    expect(result.dedupeDecision).toBe('NEW');
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.experience.create).toHaveBeenCalled();
  });

  it('returns AMBIGUOUS when the name exists with a different component', async () => {
    const tx: any = { $executeRaw: jest.fn(), experience: { findMany: jest.fn().mockResolvedValue([{ id: 'exp-old', canonicalName: 'museo central', components: [{ geoEntityId: 'geo-other' }], evidence: [], traits: [] }]), create: jest.fn() } };
    const prisma: any = { $transaction: jest.fn((callback: any) => callback(tx)) };
    const result = await new ExperienceCatalogService(prisma, {} as any).persistVerifiedExperience(input);
    expect(result.dedupeDecision).toBe('AMBIGUOUS');
    expect(tx.experience.create).not.toHaveBeenCalled();
  });
});
