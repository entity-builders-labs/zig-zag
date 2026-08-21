import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Activity, Prisma } from '@prisma/client';
import { AiEmbeddingService } from './ai-embedding.service';
import { PrismaService } from '../../../core/database/prisma.service';

export interface ActivityMetadata {
  timeOfDayPreference?: string[];
  physicalIntensity?: number;
  enhancedDescription?: string;
  targetAudience?: string;
  bestTimeToVisit?: string;
  tags?: string[];
  complementaryActivities?: {
    before?: string[];
    after?: string[];
  };
  seasonalityScore?: any;
  combinationScore?: any;
}

export interface SimilarActivityResult {
  pageContent: string;
  metadata: Record<string, unknown>;
}

interface ActivityContentFields {
  name: string;
  description: string | null;
  metadata: unknown;
}

interface ActivitySimilarityRow extends ActivityContentFields {
  id: string;
  type: string | null;
  distance: number;
}

@Injectable()
export class VectorStoreService implements OnModuleInit {
  private readonly logger = new Logger(VectorStoreService.name);

  constructor(
    private readonly embeddingService: AiEmbeddingService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    await this.embeddingService.ensureInitialized();
  }

  private toVectorLiteral(vector: number[]): string {
    return `[${vector.join(',')}]`;
  }

  private buildActivityPageContent(activity: ActivityContentFields): string {
    return `Name: ${activity.name}. Description: ${activity.description}. Metadata: ${JSON.stringify(
      activity.metadata,
    )}`;
  }

  private buildRichActivityText(activity: Activity): string {
    let metadata: ActivityMetadata = {};
    try {
      metadata =
        typeof activity.metadata === 'string'
          ? JSON.parse(activity.metadata)
          : (activity.metadata as ActivityMetadata) || {};
    } catch {
      metadata = {};
    }

    return `Activity Details:
${activity.name} is a ${metadata.physicalIntensity || 3} intensity activity.
About this activity: ${activity.description || 'No description available'}
${metadata.enhancedDescription || ''}
This activity is ideal for ${metadata.targetAudience || 'all audiences'} and is best experienced ${metadata.bestTimeToVisit || 'any time'}.
It can be done during ${metadata.timeOfDayPreference ? metadata.timeOfDayPreference.join(', ') : 'any time of day'}.
Activity type: ${activity.type}.
Keywords: ${metadata.tags ? metadata.tags.join(', ') : ''}.
`;
  }

  async saveActivityEmbedding(activities: Activity[]) {
    if (!this.embeddingService.getEmbeddings() || activities.length === 0) {
      return;
    }

    try {
      const texts = activities.map((activity) =>
        this.buildActivityPageContent(activity),
      );
      const vectors = await this.embeddingService
        .getEmbeddings()!
        .embedDocuments(texts);

      await Promise.all(
        activities.map((activity, i) => {
          const literal = this.toVectorLiteral(vectors[i]);
          return this.prisma.$executeRaw`
            UPDATE "activity" SET "embedding" = ${literal}::vector WHERE "id" = ${activity.id}
          `;
        }),
      );

      this.logger.debug(
        `Successfully saved embeddings for ${activities.length} activities`,
      );
    } catch (error) {
      this.logger.error(`Failed to save embeddings: ${error.message}`);
    }
  }

  async addActivityToVectorStore(activity: Activity) {
    if (!this.embeddingService.getEmbeddings()) return;

    const activityText = this.buildRichActivityText(activity);
    const vector = await this.embeddingService
      .getEmbeddings()!
      .embedQuery(activityText);
    const literal = this.toVectorLiteral(vector);

    await this.prisma.$executeRaw`
      UPDATE "activity" SET "embedding" = ${literal}::vector WHERE "id" = ${activity.id}
    `;
  }

  async findSimilarActivities(
    prompt: string,
    k: number = 10,
  ): Promise<SimilarActivityResult[]> {
    const embeddings = this.embeddingService.getEmbeddings();
    if (!embeddings) return [];

    const queryVector = await embeddings.embedQuery(prompt);
    const literal = this.toVectorLiteral(queryVector);

    const rows = await this.prisma.$queryRaw<ActivitySimilarityRow[]>`
      SELECT id, name, description, type, metadata, embedding <=> ${literal}::vector AS distance
      FROM "activity"
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${literal}::vector
      LIMIT ${k}
    `;

    return rows.map((row) => ({
      pageContent: this.buildActivityPageContent(row),
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

  /**
   * Cosine similarity (1 - cosine distance) between an embedding of
   * `queryText` and each of `candidateIds`' own stored embedding — scoped to
   * exactly this candidate set, unlike findSimilarActivities' open-ended
   * top-k search. A candidate with no indexed embedding is simply absent
   * from the returned map (callers treat a missing id as zero similarity),
   * not defaulted to any particular value here.
   */
  async getSimilarityScores(
    candidateIds: string[],
    queryText: string,
  ): Promise<Map<string, number>> {
    const embeddings = this.embeddingService.getEmbeddings();
    if (!embeddings || candidateIds.length === 0) return new Map();

    const queryVector = await embeddings.embedQuery(queryText);
    const literal = this.toVectorLiteral(queryVector);

    const rows = await this.prisma.$queryRaw<{ id: string; distance: number }[]>`
      SELECT id, embedding <=> ${literal}::vector AS distance
      FROM "activity"
      WHERE id IN (${Prisma.join(candidateIds)}) AND embedding IS NOT NULL
    `;

    return new Map(rows.map((row) => [row.id, 1 - row.distance]));
  }

  /** Clears every stored embedding without touching Activity rows themselves. */
  async resetVectorStore() {
    this.logger.log('Clearing all activity embeddings...');
    await this.prisma.$executeRaw`UPDATE "activity" SET "embedding" = NULL`;
  }

  async rebuildVectorStore() {
    try {
      const activities = await this.prisma.activity.findMany({
        where: { metadata: { not: null } },
      });

      this.logger.log(
        `Rebuilding embeddings for ${activities.length} activities...`,
      );

      let successCount = 0;
      for (const activity of activities) {
        try {
          await this.addActivityToVectorStore(activity);
          successCount++;
        } catch (error) {
          this.logger.error(
            `Error embedding activity ${activity.id}: ${error.message}`,
          );
        }
      }

      this.logger.log(
        `Vector store rebuilt: ${successCount}/${activities.length} succeeded`,
      );
      return { success: true, count: successCount };
    } catch (error) {
      this.logger.error('Error rebuilding vector store:', error);
      throw error;
    }
  }

  async testVectorStoreConnection(): Promise<{
    status: string;
    timestamp: string;
    embeddedCount?: number;
    error?: string;
  }> {
    const result = {
      status: 'unknown',
      timestamp: new Date().toISOString(),
    } as {
      status: string;
      timestamp: string;
      embeddedCount?: number;
      error?: string;
    };

    try {
      const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM "activity" WHERE embedding IS NOT NULL
      `;
      result.status = 'connected';
      result.embeddedCount = Number(rows[0]?.count ?? 0);
    } catch (e) {
      result.status = 'error';
      result.error = e.message;
    }
    return result;
  }
}
