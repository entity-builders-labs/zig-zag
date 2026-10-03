import { Injectable } from '@nestjs/common';
import { GeoEntityKind, Prisma } from '@prisma/client';
import { PrismaService } from '@core/database/prisma.service';
import { EntityCandidate } from '@tours/interfaces/experience-resolution.interface';
import { normalizeGeoName } from '@tours/utils/nominatim-match.util';

export type OvertureCoverageCompleteness =
  | 'COMPLETE_COUNTRY'
  | 'PARTIAL_PARTITION';

/** Normalized row emitted by the bounded GeoParquet import boundary. */
export interface OverturePlaceImportRecord {
  featureId: string;
  countryCode: string;
  name: string;
  alternateNames?: string[];
  latitude: number;
  longitude: number;
  address?: string;
  upstreamDataset?: string;
  upstreamRecordId?: string;
  upstreamUpdatedAt?: Date;
  license?: string;
}

export interface OverturePlacesImportBatch {
  release: string;
  sourceUri: string;
  countryCode: string;
  partitionKey: string;
  completeness: OvertureCoverageCompleteness;
  licenseNotice?: string;
  records: OverturePlaceImportRecord[];
}

export interface OvertureIdentityLookup {
  candidate?: EntityCandidate;
  resultCount: number;
  /** The population supporting exact-name multiplicity. */
  coverage: 'COMPLETE_COUNTRY' | 'PARTIAL_OR_UNKNOWN';
}

@Injectable()
export class OverturePlacesIndexService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent bounded import. A partial AOI refresh never lapsed records it
   * did not observe; only a declared complete refresh of that same indexed
   * partition may lapse its missing rows.
   */
  async importBatch(batch: OverturePlacesImportBatch): Promise<void> {
    const now = new Date();
    const ids = batch.records.map((record) => record.featureId);
    await this.prisma.$transaction(async (tx) => {
      await tx.overturePlacesCoverage.upsert({
        where: {
          countryCode_partitionKey_release: {
            countryCode: batch.countryCode,
            partitionKey: batch.partitionKey,
            release: batch.release,
          },
        },
        create: {
          countryCode: batch.countryCode,
          partitionKey: batch.partitionKey,
          release: batch.release,
          completeness: batch.completeness,
          sourceUri: batch.sourceUri,
          licenseNotice: batch.licenseNotice,
          synchronizedAt: now,
        },
        update: {
          completeness: batch.completeness,
          sourceUri: batch.sourceUri,
          licenseNotice: batch.licenseNotice,
          synchronizedAt: now,
        },
      });
      for (const record of batch.records) {
        await tx.overturePlaceIndex.upsert({
          where: { featureId: record.featureId },
          create: {
            featureId: record.featureId,
            release: batch.release,
            countryCode: record.countryCode,
            partitionKey: batch.partitionKey,
            name: record.name,
            normalizedName: normalizeGeoName(record.name),
            alternateNames: record.alternateNames ?? [],
            latitude: record.latitude,
            longitude: record.longitude,
            address: record.address,
            upstreamDataset: record.upstreamDataset,
            upstreamRecordId: record.upstreamRecordId,
            upstreamUpdatedAt: record.upstreamUpdatedAt,
            license: record.license,
            lastSeenAt: now,
          },
          update: {
            release: batch.release,
            countryCode: record.countryCode,
            partitionKey: batch.partitionKey,
            name: record.name,
            normalizedName: normalizeGeoName(record.name),
            alternateNames: record.alternateNames ?? [],
            latitude: record.latitude,
            longitude: record.longitude,
            address: record.address,
            upstreamDataset: record.upstreamDataset,
            upstreamRecordId: record.upstreamRecordId,
            upstreamUpdatedAt: record.upstreamUpdatedAt,
            license: record.license,
            lastSeenAt: now,
            lapsedAt: null,
          },
        });
      }
      if (batch.completeness === 'COMPLETE_COUNTRY') {
        await tx.overturePlaceIndex.updateMany({
          where: {
            countryCode: batch.countryCode,
            partitionKey: batch.partitionKey,
            ...(ids.length ? { featureId: { notIn: ids } } : {}),
          },
          data: { lapsedAt: now },
        });
      }
    });
  }

  /** Local indexed lookup only; this method performs no GeoParquet or HTTP IO. */
  async lookupExactPlace(input: {
    hintKey: string;
    hintName: string;
    countryCode: string;
    role: EntityCandidate['role'];
  }): Promise<OvertureIdentityLookup> {
    const normalizedName = normalizeGeoName(input.hintName);
    if (!normalizedName)
      return { resultCount: 0, coverage: 'PARTIAL_OR_UNKNOWN' };
    const [rows, completeCoverage] = await Promise.all([
      this.prisma.overturePlaceIndex.findMany({
        where: {
          countryCode: input.countryCode,
          normalizedName,
          lapsedAt: null,
        },
        orderBy: { featureId: 'asc' },
      }),
      this.prisma.overturePlacesCoverage.findFirst({
        where: {
          countryCode: input.countryCode,
          completeness: 'COMPLETE_COUNTRY',
        },
        orderBy: { synchronizedAt: 'desc' },
      }),
    ]);
    const coverage = completeCoverage
      ? 'COMPLETE_COUNTRY'
      : 'PARTIAL_OR_UNKNOWN';
    if (!rows.length) return { resultCount: 0, coverage };
    const multiplicity =
      rows.length > 1
        ? 'MULTIPLE'
        : coverage === 'COMPLETE_COUNTRY'
          ? 'SINGLE'
          : 'UNKNOWN';
    const row = rows[0];
    return {
      resultCount: rows.length,
      coverage,
      candidate: {
        hintKey: input.hintKey,
        hintName: input.hintName,
        provider: 'overture',
        externalId: row.featureId,
        canonicalName: row.name,
        kind: GeoEntityKind.PLACE,
        latitude: row.latitude,
        longitude: row.longitude,
        geometry: { type: 'Point', coordinates: [row.longitude, row.latitude] },
        role: input.role,
        nameEvidenceMultiplicity: {
          exactName: multiplicity,
          declaredAlias: 'UNKNOWN',
        },
        persistenceMetadata: {
          overture: {
            release: row.release,
            upstreamDataset: row.upstreamDataset,
            upstreamRecordId: row.upstreamRecordId,
            upstreamUpdatedAt: row.upstreamUpdatedAt?.toISOString(),
            license: row.license,
          },
        } as Prisma.InputJsonValue,
      },
    };
  }
}
