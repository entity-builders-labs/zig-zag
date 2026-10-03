import { OverturePlacesIndexService } from './overture-places-index.service';

const row = (overrides: Record<string, unknown> = {}) => ({
  featureId: 'gers-1',
  countryCode: 'AR',
  partitionKey: 'ar-cuyo',
  name: 'Alfa Crux',
  normalizedName: 'alfa crux',
  latitude: -33.1,
  longitude: -69.2,
  upstreamDataset: 'meta',
  upstreamRecordId: '113197860037852',
  upstreamUpdatedAt: new Date('2026-09-20T00:00:00.000Z'),
  license: 'CDLA-Permissive-2.0',
  ...overrides,
});

const published = (overrides: Record<string, unknown> = {}) => ({
  id: 'session-1',
  release: '2026-09-23.1',
  completeness: 'PARTIAL_PARTITION',
  ...overrides,
});

describe('OverturePlacesIndexService', () => {
  it('keeps exact-name multiplicity UNKNOWN for a partial index', async () => {
    const prisma = {
      overturePlaceIndex: { findMany: jest.fn().mockResolvedValue([row()]) },
      overturePlacesImportSession: {
        findFirst: jest.fn().mockResolvedValue(published()),
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
    expect(result.coverage).toBe('PARTIAL_OR_UNKNOWN');
    expect(result.candidates[0]?.nameEvidenceMultiplicity.exactName).toBe(
      'UNKNOWN',
    );
  });

  it('permits SINGLE only from the same published complete-country snapshot', async () => {
    const prisma = {
      overturePlaceIndex: { findMany: jest.fn().mockResolvedValue([row()]) },
      overturePlacesImportSession: {
        findFirst: jest
          .fn()
          .mockResolvedValue(published({ completeness: 'COMPLETE_COUNTRY' })),
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
    expect(result.candidates[0]?.nameEvidenceMultiplicity.exactName).toBe(
      'SINGLE',
    );
    expect(result.candidates[0]?.provider).toBe('overture');
  });

  it('keeps multiple exact matches ambiguous even with incomplete coverage', async () => {
    const prisma = {
      overturePlaceIndex: {
        findMany: jest
          .fn()
          .mockResolvedValue([row(), row({ featureId: 'gers-2' })]),
      },
      overturePlacesImportSession: {
        findFirst: jest.fn().mockResolvedValue(published()),
      },
    };
    const result = await new OverturePlacesIndexService(
      prisma as any,
    ).lookupExactPlace({
      hintKey: 'branch',
      hintName: 'Bodega A16',
      countryCode: 'AR',
      role: 'venue',
    });
    expect(result.candidates[0]?.nameEvidenceMultiplicity.exactName).toBe(
      'MULTIPLE',
    );
  });

  it('uses no remote source at runtime', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new OverturePlacesIndexService({
      overturePlaceIndex: { findMany },
      overturePlacesImportSession: {
        findFirst: jest.fn().mockResolvedValue(published()),
      },
    } as any);
    await service.lookupExactPlace({
      hintKey: 'x',
      hintName: 'Generic Winery',
      countryCode: 'AR',
      role: 'venue',
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ importSessionId: 'session-1' }),
      }),
    );
  });

  describe('enumerated extent (RW4-ID-CORRESPONDENCE-1)', () => {
    const session = (overrides: Record<string, unknown> = {}) => ({
      id: 'aoi-1',
      release: '2026-09-23.1',
      sourceUri: 's3://overturemaps/release',
      countryCode: 'AR',
      partitionKey: 'aoi',
      completeness: 'PARTIAL_PARTITION' as const,
      expectedSourceCoverage: 'OPERATIONAL_AOI' as const,
      expectedPageKeys: ['aoi-00001'],
      ...overrides,
    });
    const lookup = (snapshot: Record<string, unknown>) =>
      new OverturePlacesIndexService({
        overturePlaceIndex: { findMany: jest.fn().mockResolvedValue([row()]) },
        overturePlacesImportSession: {
          findFirst: jest.fn().mockResolvedValue(published(snapshot)),
        },
      } as any).lookupExactPlace({
        hintKey: 'alfa',
        hintName: 'Alfa Crux',
        countryCode: 'AR',
        role: 'venue',
      });

    it('an operational AOI import must declare the extent it enumerated', async () => {
      const create = jest.fn();
      const service = new OverturePlacesIndexService({
        overturePlacesImportSession: { create },
      } as any);
      await expect(service.beginImport(session())).rejects.toThrow(
        'enumerated extent',
      );
      await expect(
        service.beginImport(
          session({
            enumeratedExtent: {
              west: -68.5,
              south: -34,
              east: -69.5,
              north: -33,
            },
          }),
        ),
      ).rejects.toThrow('Invalid enumerated extent');
      expect(create).not.toHaveBeenCalled();
    });

    it('stores the extent as typed columns, never in the manifest', async () => {
      const create = jest.fn();
      await new OverturePlacesIndexService({
        overturePlacesImportSession: { create },
      } as any).beginImport(
        session({
          enumeratedExtent: {
            west: -69.5,
            south: -34,
            east: -68.5,
            north: -33,
          },
        }),
      );
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          extentWest: -69.5,
          extentSouth: -34,
          extentEast: -68.5,
          extentNorth: -33,
          status: 'IMPORTING',
        }),
      });
      expect(create.mock.calls[0][0].data).not.toHaveProperty(
        'enumeratedExtent',
      );
    });

    it('a lookup exposes the published extent; multiplicity stays UNKNOWN', async () => {
      const result = await lookup({
        extentWest: -69.5,
        extentSouth: -34,
        extentEast: -68.5,
        extentNorth: -33,
      });
      expect(result.coverage).toBe('PARTIAL_OR_UNKNOWN');
      expect(result.enumeratedExtent).toEqual({
        west: -69.5,
        south: -34,
        east: -68.5,
        north: -33,
      });
      expect(result.candidates[0]?.nameEvidenceMultiplicity.exactName).toBe(
        'UNKNOWN',
      );
    });

    it('a snapshot with no typed extent claims none', async () => {
      const result = await lookup({
        extentWest: null,
        extentSouth: null,
        extentEast: null,
        extentNorth: null,
      });
      expect(result).not.toHaveProperty('enumeratedExtent');
    });
  });
});
