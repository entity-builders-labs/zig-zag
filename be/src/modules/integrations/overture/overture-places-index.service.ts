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
  sessionId: string;
  pageKey: string;
  records: OverturePlaceImportRecord[];
}

export interface OverturePlacesImportSession {
  id: string;
  release: string;
  sourceUri: string;
  countryCode: string;
  partitionKey: string;
  completeness: OvertureCoverageCompleteness;
  expectedSourceCoverage: 'COUNTRY_ENUMERATED' | 'OPERATIONAL_AOI';
  expectedPageKeys: string[];
  licenseNotice?: string;
}

export interface OvertureIdentityLookup {
  /**
   * Every exact-name record of the published snapshot, ordered by feature
   * id (a stable order, never a preference). Choosing which one to try is
   * the resolver's candidate-selection policy, not the index's.
   */
  candidates: EntityCandidate[];
  resultCount: number;
  /** The population supporting exact-name multiplicity. */
  coverage: 'COMPLETE_COUNTRY' | 'PARTIAL_OR_UNKNOWN';
}

@Injectable()
export class OverturePlacesIndexService {
  constructor(private readonly prisma: PrismaService) {}

  async beginImport(input: OverturePlacesImportSession): Promise<void> {
    if (
      input.completeness === 'COMPLETE_COUNTRY' &&
      input.expectedSourceCoverage !== 'COUNTRY_ENUMERATED'
    )
      throw new Error(
        'Country completeness requires COUNTRY_ENUMERATED evidence',
      );
    await this.prisma.overturePlacesImportSession.create({
      data: { ...input, status: 'IMPORTING' },
    });
  }

  /**
   * Idempotent bounded page import. It never changes the active snapshot;
   * only finalizeImport publishes a whole, verified session.
   */
  async importBatch(batch: OverturePlacesImportBatch): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.overturePlacesImportSession.findUniqueOrThrow({
        where: { id: batch.sessionId },
      });
      if (session.status !== 'IMPORTING')
        throw new Error('Import is not active');
      if (!session.expectedPageKeys.includes(batch.pageKey))
        throw new Error(`Unexpected import page: ${batch.pageKey}`);
      for (const record of batch.records) {
        if (record.countryCode !== session.countryCode)
          throw new Error(
            'Imported record country differs from import session',
          );
        await tx.overturePlaceIndex.upsert({
          where: {
            importSessionId_featureId: {
              importSessionId: session.id,
              featureId: record.featureId,
            },
          },
          create: {
            importSessionId: session.id,
            featureId: record.featureId,
            countryCode: record.countryCode,
            partitionKey: session.partitionKey,
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
            countryCode: record.countryCode,
            partitionKey: session.partitionKey,
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
        });
      }
      await tx.overturePlacesImportSession.update({
        where: { id: session.id },
        data: {
          completedPageKeys: Array.from(
            new Set([...session.completedPageKeys, batch.pageKey]),
          ),
        },
      });
    });
  }

  async failImport(sessionId: string, partitionKey: string): Promise<void> {
    await this.prisma.overturePlacesImportSession.update({
      where: { id: sessionId },
      data: { status: 'FAILED', failedPartitionKeys: { push: partitionKey } },
    });
  }

  async abortImport(sessionId: string): Promise<void> {
    await this.prisma.overturePlacesImportSession.update({
      where: { id: sessionId },
      data: { status: 'ABORTED' },
    });
  }

  async finalizeImport(
    sessionId: string,
    manifest: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.overturePlacesImportSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      const missing = session.expectedPageKeys.filter(
        (page) => !session.completedPageKeys.includes(page),
      );
      if (
        session.status !== 'IMPORTING' ||
        missing.length ||
        session.failedPartitionKeys.length
      )
        throw new Error('Import cannot publish with missing or failed pages');
      const now = new Date();
      await tx.overturePlacesImportSession.updateMany({
        where: { countryCode: session.countryCode, status: 'PUBLISHED' },
        data: { status: 'SUPERSEDED' },
      });
      await tx.overturePlacesImportSession.update({
        where: { id: session.id },
        data: {
          status: 'PUBLISHED',
          manifest,
          finalizedAt: now,
          publishedAt: now,
        },
      });
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
      return { candidates: [], resultCount: 0, coverage: 'PARTIAL_OR_UNKNOWN' };
    const snapshot = await this.prisma.overturePlacesImportSession.findFirst({
      where: { countryCode: input.countryCode, status: 'PUBLISHED' },
      orderBy: { publishedAt: 'desc' },
    });
    if (!snapshot)
      return { candidates: [], resultCount: 0, coverage: 'PARTIAL_OR_UNKNOWN' };
    const rows = await this.prisma.overturePlaceIndex.findMany({
      where: { importSessionId: snapshot.id, normalizedName },
      orderBy: { featureId: 'asc' },
    });
    const coverage =
      snapshot.completeness === 'COMPLETE_COUNTRY'
        ? 'COMPLETE_COUNTRY'
        : 'PARTIAL_OR_UNKNOWN';
    if (!rows.length) return { candidates: [], resultCount: 0, coverage };
    const multiplicity =
      rows.length > 1
        ? 'MULTIPLE'
        : coverage === 'COMPLETE_COUNTRY'
          ? 'SINGLE'
          : 'UNKNOWN';
    return {
      resultCount: rows.length,
      coverage,
      candidates: rows.map((row) => ({
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
        // The import keeps no category, so the structure is unknown; the
        // record derives from its upstream dataset (e.g. Meta), not from
        // Overture itself.
        structuralKind: 'UNKNOWN',
        ...(row.upstreamDataset
          ? { upstreamDatasets: [row.upstreamDataset.toLowerCase()] }
          : {}),
        persistenceMetadata: {
          overture: {
            release: snapshot.release,
            upstreamDataset: row.upstreamDataset,
            upstreamRecordId: row.upstreamRecordId,
            upstreamUpdatedAt: row.upstreamUpdatedAt?.toISOString(),
            license: row.license,
          },
        } as Prisma.InputJsonValue,
      })),
    };
  }
}
