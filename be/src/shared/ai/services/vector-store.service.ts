import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Activity, ActivityKind, Prisma } from '@prisma/client';
import {
  EmbeddingIndexIdentity,
  EmbeddingWriteResult,
  SemanticSimilarityResult,
} from '../interfaces/embedding-index.interface';
import { PrismaService } from '../../../core/database/prisma.service';
import { AiEmbeddingService } from './ai-embedding.service';
import {
  SemanticActivityDocumentBuilder,
  SemanticActivityRecord,
} from './semantic-activity-document-builder.service';

export interface SimilarActivityResult {
  pageContent: string;
  metadata: Record<string, unknown>;
}

interface ActivitySimilarityRow {
  id: string;
  name: string;
  description: string | null;
  type: string | null;
  metadata: unknown;
  distance: number;
}

export class EmbeddingWriteError extends Error {
  constructor(
    message: string,
    readonly requestedIds: string[],
    readonly identity: EmbeddingIndexIdentity,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = EmbeddingWriteError.name;
  }
}

@Injectable()
export class VectorStoreService implements OnModuleInit {
  private readonly logger = new Logger(VectorStoreService.name);

  constructor(
    private readonly embeddingService: AiEmbeddingService,
    private readonly prisma: PrismaService,
    private readonly documentBuilder: SemanticActivityDocumentBuilder,
  ) {}

  async onModuleInit() {
    await this.embeddingService.ensureInitialized();
  }

  private toVectorLiteral(vector: number[]): string {
    return `[${vector.join(',')}]`;
  }

  private compatibleIdentitySql(identity: EmbeddingIndexIdentity) {
    return Prisma.sql`
      "embeddingProvider" = ${identity.provider}
      AND "embeddingModel" = ${identity.model}
      AND "embeddingDimensions" = ${identity.dimensions}
      AND "embeddingDocumentVersion" = ${identity.documentVersion}
    `;
  }

  private incompatibleIdentitySql(identity: EmbeddingIndexIdentity) {
    return Prisma.sql`
      "embeddingProvider" IS DISTINCT FROM ${identity.provider}
      OR "embeddingModel" IS DISTINCT FROM ${identity.model}
      OR "embeddingDimensions" IS DISTINCT FROM ${identity.dimensions}
      OR "embeddingDocumentVersion" IS DISTINCT FROM ${identity.documentVersion}
    `;
  }

  private async loadSemanticRecords(
    activityIds: string[],
  ): Promise<SemanticActivityRecord[]> {
    if (activityIds.length === 0) return [];

    return this.prisma.activity.findMany({
      where: { id: { in: activityIds } },
      include: {
        family: {
          include: {
            areaActivity: { select: { name: true } },
          },
        },
        compositeWaypoints: {
          orderBy: { order: 'asc' },
          include: {
            waypointActivity: {
              select: {
                name: true,
                kind: true,
                type: true,
                knownActivityTypeName: true,
              },
            },
          },
        },
      },
    });
  }

  async saveActivityEmbedding(
    activities: Array<Pick<Activity, 'id'>>,
  ): Promise<EmbeddingWriteResult> {
    const requestedIds = [...new Set(activities.map(({ id }) => id))];
    const status = this.embeddingService.getStatus();

    if (requestedIds.length === 0) {
      return {
        status: 'no_work',
        requestedIds,
        indexedIds: [],
        identity: status.identity,
      };
    }

    if (status.status === 'unavailable') {
      return {
        status: 'unavailable',
        requestedIds,
        indexedIds: [],
        identity: status.identity,
        reason: status.reason,
      };
    }

    try {
      const records = await this.loadSemanticRecords(requestedIds);
      const recordsById = new Map(records.map((record) => [record.id, record]));
      const orderedRecords = requestedIds
        .map((id) => recordsById.get(id))
        .filter((record): record is SemanticActivityRecord => !!record);

      if (orderedRecords.length !== requestedIds.length) {
        const loadedIds = new Set(orderedRecords.map(({ id }) => id));
        const missingIds = requestedIds.filter((id) => !loadedIds.has(id));
        throw new Error(`Activity rows not found: ${missingIds.join(', ')}`);
      }

      const vectors = await this.embeddingService
        .getEmbeddings()!
        .embedDocuments(
          orderedRecords.map((activity) =>
            this.documentBuilder.build(activity),
          ),
        );

      if (vectors.length !== orderedRecords.length) {
        throw new Error(
          `Embedding provider returned ${vectors.length} vectors for ${orderedRecords.length} documents`,
        );
      }

      await this.prisma.$transaction(
        orderedRecords.map((activity, index) => {
          const literal = this.toVectorLiteral(vectors[index]);
          return this.prisma.$executeRaw`
            UPDATE "activity"
            SET "embedding" = ${literal}::vector,
                "embeddingProvider" = ${status.identity.provider},
                "embeddingModel" = ${status.identity.model},
                "embeddingDimensions" = ${status.identity.dimensions},
                "embeddingDocumentVersion" = ${status.identity.documentVersion},
                "embeddedAt" = NOW()
            WHERE "id" = ${activity.id}
          `;
        }),
      );

      const indexedIds = orderedRecords.map(({ id }) => id);
      this.logger.debug(
        `Indexed ${indexedIds.length} activities with ${status.identity.provider}/${status.identity.model} document v${status.identity.documentVersion}`,
      );
      return {
        status: 'indexed',
        requestedIds,
        indexedIds,
        identity: status.identity,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new EmbeddingWriteError(
        `Failed to index activity embeddings: ${message}`,
        requestedIds,
        status.identity,
        error,
      );
    }
  }

  async backfillMissingActivityEmbeddings(
    activities: Array<Pick<Activity, 'id'>>,
  ): Promise<EmbeddingWriteResult> {
    const requestedIds = [...new Set(activities.map(({ id }) => id))];
    const status = this.embeddingService.getStatus();

    if (requestedIds.length === 0) {
      return {
        status: 'no_work',
        requestedIds,
        indexedIds: [],
        identity: status.identity,
      };
    }

    if (status.status === 'unavailable') {
      return {
        status: 'unavailable',
        requestedIds,
        indexedIds: [],
        identity: status.identity,
        reason: status.reason,
      };
    }

    const incompatibleIdentity = this.incompatibleIdentitySql(status.identity);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "activity"
      WHERE "id" IN (${Prisma.join(requestedIds)})
        AND (
          "embedding" IS NULL
          OR (${incompatibleIdentity})
        )
    `;

    if (rows.length === 0) {
      return {
        status: 'no_work',
        requestedIds,
        indexedIds: [],
        identity: status.identity,
      };
    }

    return this.saveActivityEmbedding(rows);
  }

  async addActivityToVectorStore(
    activity: Pick<Activity, 'id'>,
  ): Promise<EmbeddingWriteResult> {
    return this.saveActivityEmbedding([activity]);
  }

  async findSimilarActivities(
    prompt: string,
    k: number = 10,
  ): Promise<SimilarActivityResult[]> {
    const status = this.embeddingService.getStatus();
    if (status.status === 'unavailable') return [];

    const queryVector = await this.embeddingService
      .getEmbeddings()!
      .embedQuery(prompt);
    const literal = this.toVectorLiteral(queryVector);
    const compatibleIdentity = this.compatibleIdentitySql(status.identity);

    const rows = await this.prisma.$queryRaw<ActivitySimilarityRow[]>`
      SELECT "id", "name", "description", "type", "metadata",
             "embedding" <=> ${literal}::vector AS "distance"
      FROM "activity"
      WHERE "embedding" IS NOT NULL
        AND "isArchived" = false
        AND "kind" != ${ActivityKind.AREA}::"ActivityKind"
        AND ${compatibleIdentity}
      ORDER BY "embedding" <=> ${literal}::vector
      LIMIT ${k}
    `;

    return rows.map((row) => ({
      pageContent: [
        `Name: ${row.name}`,
        row.description ? `Description: ${row.description}` : undefined,
        row.type ? `Type: ${row.type}` : undefined,
      ]
        .filter(Boolean)
        .join('\n'),
      metadata: {
        activityId: row.id,
        activityName: row.name,
        activityType: row.type,
        distance: row.distance,
        ...(row.metadata && typeof row.metadata === 'object'
          ? (row.metadata as Record<string, unknown>)
          : {}),
      },
    }));
  }

  async findSimilarActivitiesForActivity(
    activityId: string,
    k: number = 10,
  ): Promise<SimilarActivityResult[]> {
    const [activity] = await this.loadSemanticRecords([activityId]);
    if (!activity) return [];

    return this.findSimilarActivities(this.documentBuilder.build(activity), k);
  }

  async getSimilarityScores(
    candidateIds: string[],
    queryText: string,
  ): Promise<SemanticSimilarityResult> {
    const requestedIds = [...new Set(candidateIds)];
    const status = this.embeddingService.getStatus();

    if (requestedIds.length === 0) {
      return {
        status: 'applied',
        scores: new Map(),
        requestedCandidateCount: 0,
        indexedCandidateCount: 0,
        identity: status.identity,
      };
    }

    if (status.status === 'unavailable') {
      return {
        status: 'unavailable',
        scores: new Map(),
        requestedCandidateCount: requestedIds.length,
        indexedCandidateCount: 0,
        identity: status.identity,
        reason: status.reason,
      };
    }

    try {
      const queryVector = await this.embeddingService
        .getEmbeddings()!
        .embedQuery(queryText);
      const literal = this.toVectorLiteral(queryVector);
      const compatibleIdentity = this.compatibleIdentitySql(status.identity);
      const rows = await this.prisma.$queryRaw<
        { id: string; distance: number }[]
      >`
        SELECT "id", "embedding" <=> ${literal}::vector AS "distance"
        FROM "activity"
        WHERE "id" IN (${Prisma.join(requestedIds)})
          AND "embedding" IS NOT NULL
          AND ${compatibleIdentity}
      `;

      return {
        status: 'applied',
        scores: new Map(rows.map((row) => [row.id, 1 - row.distance])),
        requestedCandidateCount: requestedIds.length,
        indexedCandidateCount: rows.length,
        identity: status.identity,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Semantic ranking unavailable: ${reason}`);
      return {
        status: 'unavailable',
        scores: new Map(),
        requestedCandidateCount: requestedIds.length,
        indexedCandidateCount: 0,
        identity: status.identity,
        reason,
      };
    }
  }

  /** V2 semantic lookup: embeddings are read from Experience, never Activity. */
  async getExperienceSimilarityScores(
    candidateIds: string[],
    queryText: string,
  ): Promise<SemanticSimilarityResult> {
    const requestedIds = [...new Set(candidateIds)];
    const status = this.embeddingService.getStatus();
    if (requestedIds.length === 0) return { status: 'applied', scores: new Map(), requestedCandidateCount: 0, indexedCandidateCount: 0, identity: status.identity };
    if (status.status === 'unavailable') return { status: 'unavailable', scores: new Map(), requestedCandidateCount: requestedIds.length, indexedCandidateCount: 0, identity: status.identity, reason: status.reason };
    try {
      const queryVector = await this.embeddingService.getEmbeddings()!.embedQuery(queryText);
      const literal = this.toVectorLiteral(queryVector);
      const compatibleIdentity = this.compatibleIdentitySql(status.identity);
      const rows = await this.prisma.$queryRaw<{ id: string; distance: number }[]>`
        SELECT "id", "embedding" <=> ${literal}::vector AS "distance"
        FROM "experience"
        WHERE "id" IN (${Prisma.join(requestedIds)})
          AND "embedding" IS NOT NULL
          AND ${compatibleIdentity}
      `;
      return { status: 'applied', scores: new Map(rows.map((row) => [row.id, 1 - row.distance])), requestedCandidateCount: requestedIds.length, indexedCandidateCount: rows.length, identity: status.identity };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { status: 'unavailable', scores: new Map(), requestedCandidateCount: requestedIds.length, indexedCandidateCount: 0, identity: status.identity, reason };
    }
  }

  async getCompatibleExperienceIndexCount(candidateIds: string[]): Promise<number> {
    if (candidateIds.length === 0) return 0;
    const identity = this.embeddingService.getIndexIdentity();
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS "count" FROM "experience"
      WHERE "id" IN (${Prisma.join([...new Set(candidateIds)])})
        AND "embedding" IS NOT NULL
        AND ${this.compatibleIdentitySql(identity)}
    `;
    return Number(rows[0]?.count ?? 0);
  }

  async getCompatibleIndexCount(activityIds: string[]): Promise<number> {
    if (activityIds.length === 0) return 0;

    const identity = this.embeddingService.getIndexIdentity();
    const compatibleIdentity = this.compatibleIdentitySql(identity);
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS "count"
      FROM "activity"
      WHERE "id" IN (${Prisma.join([...new Set(activityIds)])})
        AND "embedding" IS NOT NULL
        AND ${compatibleIdentity}
    `;
    return Number(rows[0]?.count ?? 0);
  }

  async invalidateActivityEmbedding(activityId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "activity"
      SET "embedding" = NULL,
          "embeddingProvider" = NULL,
          "embeddingModel" = NULL,
          "embeddingDimensions" = NULL,
          "embeddingDocumentVersion" = NULL,
          "embeddedAt" = NULL
      WHERE "id" = ${activityId}
    `;
  }

  async resetVectorStore(): Promise<void> {
    this.logger.log('Clearing all activity embeddings and index identity...');
    await this.prisma.$executeRaw`
      UPDATE "activity"
      SET "embedding" = NULL,
          "embeddingProvider" = NULL,
          "embeddingModel" = NULL,
          "embeddingDimensions" = NULL,
          "embeddingDocumentVersion" = NULL,
          "embeddedAt" = NULL
    `;
  }

  async rebuildVectorStore(): Promise<{
    success: true;
    count: number;
    identity: EmbeddingIndexIdentity;
  }> {
    const status = this.embeddingService.getStatus();
    if (status.status === 'unavailable') {
      throw new EmbeddingWriteError(
        `Cannot rebuild embeddings: ${status.reason}`,
        [],
        status.identity,
      );
    }

    await this.resetVectorStore();
    const activities = await this.prisma.activity.findMany({
      where: {
        isArchived: false,
        kind: { not: ActivityKind.AREA },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    this.logger.log(
      `Rebuilding ${activities.length} embeddings with ${status.identity.provider}/${status.identity.model} document v${status.identity.documentVersion}...`,
    );

    let indexedCount = 0;
    const batchSize = 50;
    try {
      for (let offset = 0; offset < activities.length; offset += batchSize) {
        const result = await this.saveActivityEmbedding(
          activities.slice(offset, offset + batchSize),
        );
        if (result.status !== 'indexed') {
          throw new EmbeddingWriteError(
            `Embedding rebuild stopped with status ${result.status}: ${result.reason ?? 'unknown reason'}`,
            result.requestedIds,
            result.identity,
          );
        }
        indexedCount += result.indexedIds.length;
      }
    } catch (error) {
      // A failed provider/model switch must not leave a partially rebuilt
      // index looking authoritative. Reset any batches written by this run;
      // callers receive the original error and semantic retrieval stays
      // explicitly unavailable until a complete rebuild succeeds.
      try {
        await this.resetVectorStore();
      } catch (cleanupError) {
        const cleanupMessage =
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError);
        this.logger.error(
          `Failed to clear partial embedding rebuild: ${cleanupMessage}`,
        );
      }
      throw error;
    }

    this.logger.log(
      `Vector store rebuilt: ${indexedCount}/${activities.length} indexed`,
    );
    return { success: true, count: indexedCount, identity: status.identity };
  }

  async testVectorStoreConnection(): Promise<{
    status: string;
    timestamp: string;
    compatibleCount?: number;
    incompatibleCount?: number;
    identity?: EmbeddingIndexIdentity;
    error?: string;
  }> {
    const result = {
      status: 'unknown',
      timestamp: new Date().toISOString(),
    } as {
      status: string;
      timestamp: string;
      compatibleCount?: number;
      incompatibleCount?: number;
      identity?: EmbeddingIndexIdentity;
      error?: string;
    };

    try {
      const identity = this.embeddingService.getIndexIdentity();
      const compatibleIdentity = this.compatibleIdentitySql(identity);
      const incompatibleIdentity = this.incompatibleIdentitySql(identity);
      const rows = await this.prisma.$queryRaw<
        { compatibleCount: bigint; incompatibleCount: bigint }[]
      >`
        SELECT
          COUNT(*) FILTER (
            WHERE "embedding" IS NOT NULL AND ${compatibleIdentity}
          ) AS "compatibleCount",
          COUNT(*) FILTER (
            WHERE "embedding" IS NOT NULL AND (${incompatibleIdentity})
          ) AS "incompatibleCount"
        FROM "activity"
      `;
      result.status = 'connected';
      result.identity = identity;
      result.compatibleCount = Number(rows[0]?.compatibleCount ?? 0);
      result.incompatibleCount = Number(rows[0]?.incompatibleCount ?? 0);
    } catch (error) {
      result.status = 'error';
      result.error = error instanceof Error ? error.message : String(error);
    }
    return result;
  }
}
