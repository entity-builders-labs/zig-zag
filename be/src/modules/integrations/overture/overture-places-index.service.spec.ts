import { OverturePlacesIndexService } from './overture-places-index.service';

const row = (overrides: Record<string, unknown> = {}) => ({
  featureId: 'gers-1',
  release: '2026-09-23.1',
  countryCode: 'AR',
  partitionKey: 'ar-cuyo',
  name: 'Alfa Crux',
  normalizedName: 'alfa crux',
  latitude: -33.1,
  longitude: -69.2,
  lapsedAt: null as Date | null,
  upstreamDataset: 'meta',
  upstreamRecordId: '113197860037852',
  upstreamUpdatedAt: new Date('2026-09-20T00:00:00.000Z'),
  license: 'CDLA-Permissive-2.0',
  ...overrides,
});

describe('OverturePlacesIndexService', () => {
  it('keeps exact-name multiplicity UNKNOWN for a partial index', async () => {
    const prisma = {
      overturePlaceIndex: { findMany: jest.fn().mockResolvedValue([row()]) },
      overturePlacesCoverage: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const result = await new OverturePlacesIndexService(
      prisma as any,
    ).lookupExactPlace({
      hintKey: 'alfa',
      hintName: 'Alfa Crux',
      countryCode: 'AR',
      role: 'venue',
    });
    expect(result.coverage).toBe('PARTIAL_OR_UNKNOWN');
    expect(result.candidate?.nameEvidenceMultiplicity.exactName).toBe(
      'UNKNOWN',
    );
  });

  it('permits SINGLE only after complete country coverage is declared', async () => {
    const prisma = {
      overturePlaceIndex: { findMany: jest.fn().mockResolvedValue([row()]) },
      overturePlacesCoverage: {
        findFirst: jest.fn().mockResolvedValue({ id: 'coverage' }),
      },
    };
    const result = await new OverturePlacesIndexService(
      prisma as any,
    ).lookupExactPlace({
      hintKey: 'alfa',
      hintName: 'Alfa Crux',
      countryCode: 'AR',
      role: 'venue',
    });
    expect(result.coverage).toBe('COMPLETE_COUNTRY');
    expect(result.candidate?.nameEvidenceMultiplicity.exactName).toBe('SINGLE');
    expect(result.candidate?.provider).toBe('overture');
  });

  it('keeps multiple exact matches ambiguous even with incomplete coverage', async () => {
    const prisma = {
      overturePlaceIndex: {
        findMany: jest
          .fn()
          .mockResolvedValue([row(), row({ featureId: 'gers-2' })]),
      },
      overturePlacesCoverage: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const result = await new OverturePlacesIndexService(
      prisma as any,
    ).lookupExactPlace({
      hintKey: 'branch',
      hintName: 'Bodega A16',
      countryCode: 'AR',
      role: 'venue',
    });
    expect(result.candidate?.nameEvidenceMultiplicity.exactName).toBe(
      'MULTIPLE',
    );
  });

  it('uses no remote source at runtime', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new OverturePlacesIndexService({
      overturePlaceIndex: { findMany },
      overturePlacesCoverage: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any);
    await service.lookupExactPlace({
      hintKey: 'x',
      hintName: 'Generic Winery',
      countryCode: 'AR',
      role: 'venue',
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ countryCode: 'AR' }),
      }),
    );
  });
});
