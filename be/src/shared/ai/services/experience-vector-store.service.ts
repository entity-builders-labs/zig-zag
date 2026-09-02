import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import { AiEmbeddingService } from './ai-embedding.service';
import {
  EmbeddingIndexIdentity,
  SemanticSimilarityResult,
} from '../interfaces/embedding-index.interface';

/** Experience-only semantic retrieval. Embeddings are written by the
 * catalog/indexing pipeline and this service is deliberately read-only for
 * tour generation. */
@Injectable()
export class ExperienceVectorStoreService implements OnModuleInit {
  constructor(
    private readonly embeddingService: AiEmbeddingService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
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

  async getSimilarityScores(
    candidateIds: string[],
    queryText: string,
  ): Promise<SemanticSimilarityResult> {
    const requestedIds = [...new Set(candidateIds)];
    const identity = this.embeddingService.getIndexIdentity();
    if (requestedIds.length === 0) {
      return { status: 'applied', scores: new Map(), requestedCandidateCount: 0, indexedCandidateCount: 0, identity };
    }
    const status = this.embeddingService.getStatus();
    if (status.status === 'unavailable') {
      return { status: 'unavailable', scores: new Map(), requestedCandidateCount: requestedIds.length, indexedCandidateCount: 0, identity, reason: status.reason };
    }
    try {
      const queryVector = await this.embeddingService.getEmbeddings()!.embedQuery(queryText);
      const literal = this.toVectorLiteral(queryVector);
      const rows = await this.prisma.$queryRaw<{ id: string; distance: number }[]>`
        SELECT "id", "embedding" <=> ${literal}::vector AS "distance"
        FROM "experience"
        WHERE "id" IN (${Prisma.join(requestedIds)})
          AND "embedding" IS NOT NULL
          AND ${this.compatibleIdentitySql(identity)}
      `;
      return { status: 'applied', scores: new Map(rows.map((row) => [row.id, 1 - row.distance])), requestedCandidateCount: requestedIds.length, indexedCandidateCount: rows.length, identity };
    } catch (error) {
      return { status: 'unavailable', scores: new Map(), requestedCandidateCount: requestedIds.length, indexedCandidateCount: 0, identity, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  async getCompatibleIndexCount(candidateIds: string[]): Promise<number> {
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
}
