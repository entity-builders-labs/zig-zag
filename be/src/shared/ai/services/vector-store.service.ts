import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Document } from '@langchain/core/documents';
import { Chroma } from '@langchain/community/vectorstores/chroma';
import { Where, ChromaClient } from 'chromadb';
import { Activity } from '@prisma/client';
import aiConfig from '../ai.config';
import { AiEmbeddingService } from './ai-embedding.service';

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

import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class VectorStoreService implements OnModuleInit {
  private readonly logger = new Logger(VectorStoreService.name);
  private vectorStore: Chroma | null = null;

  // Failure tracking
  private embeddingFailureCount = 0;
  private readonly MAX_EMBEDDING_FAILURES = 3;

  constructor(
    @Inject(aiConfig.KEY)
    private readonly config: ConfigType<typeof aiConfig>,
    private readonly embeddingService: AiEmbeddingService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    await this.embeddingService.ensureInitialized();
    await this.initializeVectorStore().catch((error) => {
      this.logger.error(
        'Failed to initialize vector store during startup',
        error,
      );
    });
  }

  // Helper to get Chroma Config
  private async getChromaConfig(): Promise<any> {
    const collectionName = this.config.chromaCollectionName || 'activities';

    // Check if Chroma Cloud credentials are provided
    const isChromaCloud =
      this.config.chromaApiKey &&
      this.config.chromaTenant &&
      this.config.chromaDatabase;

    if (isChromaCloud) {
      // Chroma Cloud Logic
      this.logger.log(
        `Configuring Chroma Cloud (tenant: ${this.config.chromaTenant}, database: ${this.config.chromaDatabase})...`,
      );

      let chromaUrl = this.config.chromaUrl || 'https://api.trychroma.com';
      if (!chromaUrl.startsWith('http')) chromaUrl = `https://${chromaUrl}`;

      // We need to ensure the header is sent as 'X-Chroma-Token', not 'X_CHROMA_TOKEN'
      const tokenHeaderType: any = 'X-Chroma-Token';

      const chromaClient = new ChromaClient({
        path: chromaUrl,
        auth: {
          provider: 'token',
          credentials: this.config.chromaApiKey!,
          tokenHeaderType,
        },
        tenant: this.config.chromaTenant!,
        database: this.config.chromaDatabase!,
      });

      return {
        collectionName,
        index: chromaClient,
        url: chromaUrl,
        collectionMetadata: {
          'hnsw:space': 'cosine',
        },
        clientParams: {
          auth: {
            provider: 'token',
            credentials: this.config.chromaApiKey!,
            tokenHeaderType: 'X-Chroma-Token' as any,
          },
          tenant: this.config.chromaTenant!,
          database: this.config.chromaDatabase!,
        },
      };
    } else if (this.config.chromaUrl) {
      // Remote self-hosted
      let url = this.config.chromaUrl;
      if (!url.startsWith('http')) url = `http://${url}`;

      this.logger.log(`Configuring Chroma at ${url}...`);
      return {
        collectionName,
        url: url,
      };
    } else {
      // Local
      const isDocker = process.env.DOCKER_CONTAINER === 'true';
      const defaultUrl = isDocker
        ? 'http://chroma:8000'
        : 'http://localhost:8001';

      this.logger.log(
        `Configuring local Chroma instance (defaulting to ${defaultUrl})...`,
      );
      return {
        collectionName,
        url: defaultUrl,
      };
    }
  }

  async initializeVectorStore() {
    try {
      const embeddings = this.embeddingService.getEmbeddings();
      if (!embeddings) {
        this.logger.warn(
          'Embeddings service not ready or disabled. Vector store initialization skipped.',
        );
        return;
      }

      const chromaConfig = await this.getChromaConfig();

      this.logger.log('Initializing Chroma vector store...');
      const initStartTime = Date.now();

      const initPromise = Chroma.fromDocuments(
        [],
        embeddings,
        chromaConfig as any,
      );

      const CHROMA_TIMEOUT = 10000; // 10 seconds
      const timeoutPromise: Promise<never> = new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Chroma initialization timeout (${CHROMA_TIMEOUT / 1000}s)`,
              ),
            ),
          CHROMA_TIMEOUT,
        ),
      );

      this.vectorStore = await Promise.race([initPromise, timeoutPromise]);

      const initTime = Date.now() - initStartTime;
      this.logger.log(`✓ Chroma initialized in ${initTime}ms.`);
    } catch (error: any) {
      this.logger.warn(
        `⚠️  Chroma vector store initialization failed: ${error.message}. Semantic search unavailable.`,
      );
      this.vectorStore = null;
    }
  }

  async saveActivityEmbedding(activities: Activity[]) {
    if (!this.embeddingService.getEmbeddings() || !this.vectorStore) {
      return;
    }

    try {
      const docs = activities.map((activity) => {
        const sanitizedMetadata: Record<string, string | number | boolean> = {};

        for (const [key, value] of Object.entries(activity)) {
          if (value === null || value === undefined) continue;

          if (value instanceof Date) {
            sanitizedMetadata[key] = value.toISOString();
          } else if (typeof value === 'object') {
            sanitizedMetadata[key] = JSON.stringify(value);
          } else {
            sanitizedMetadata[key] = value as string | number | boolean;
          }
        }

        return new Document({
          pageContent: `Name: ${activity.name}. Description: ${activity.description}. Metadata: ${JSON.stringify(
            activity.metadata,
          )}`,
          metadata: sanitizedMetadata,
        });
      });

      const embedding = await this.embeddingService
        .getEmbeddings()!
        .embedDocuments(docs.map((doc) => doc.pageContent));
      await this.vectorStore.addVectors(embedding, docs, {
        ids: activities.map((activity) => activity.id.toString()),
      });

      this.embeddingFailureCount = 0;
      this.logger.debug(
        `Successfully saved embeddings for ${activities.length} activities`,
      );
    } catch (error) {
      this.embeddingFailureCount++;
      if (/dimension/i.test(error.message || '')) {
        // The collection was created with a different embedding provider's
        // vector size (e.g. it already has OpenAI's 1536-dim vectors and the
        // provider just switched to Bedrock at 256/512/1024). Every write
        // will fail identically until the collection is recreated.
        this.logger.error(
          `Failed to save embeddings: dimension mismatch with the existing Chroma collection ` +
            `"${this.config.chromaCollectionName || 'activities'}". This usually means the ` +
            `embedding provider/model changed after the collection was created — set a new ` +
            `CHROMA_COLLECTION_NAME (or run "yarn match:init" against a fresh one) to fix. ` +
            `Original error: ${error.message}`,
        );
      } else {
        this.logger.error(`Failed to save embeddings: ${error.message}`);
      }
    }
  }

  async addActivityToVectorStore(activity: Activity) {
    if (!this.vectorStore) return;

    let metadata: ActivityMetadata = {};
    try {
      metadata =
        typeof activity.metadata === 'string'
          ? JSON.parse(activity.metadata)
          : activity.metadata || {};
    } catch {
      metadata = {};
    }

    const activityText = `Activity Details:
${activity.name} is a ${metadata.physicalIntensity || 3} intensity activity.
About this activity: ${activity.description || 'No description available'}
${metadata.enhancedDescription || ''}
This activity is ideal for ${metadata.targetAudience || 'all audiences'} and is best experienced ${metadata.bestTimeToVisit || 'any time'}.
It can be done during ${metadata.timeOfDayPreference ? metadata.timeOfDayPreference.join(', ') : 'any time of day'}.
Activity type: ${activity.type}.
Keywords: ${metadata.tags ? metadata.tags.join(', ') : ''}.
`;

    await this.vectorStore.addDocuments([
      {
        pageContent: activityText,
        id: activity.id,
        metadata: {
          activityId: activity.id,
          activityName: activity.name,
          activityType: activity.type || '',
          activityMetadata:
            typeof activity.metadata === 'string'
              ? activity.metadata
              : JSON.stringify(activity.metadata || {}),
          tags: (metadata.tags || []).join(','),
          timeOfDay: (metadata.timeOfDayPreference || []).join(','),
          physicalIntensity: metadata.physicalIntensity || 3,
          complementaryBefore: (
            metadata.complementaryActivities?.before || []
          ).join(','),
          complementaryAfter: (
            metadata.complementaryActivities?.after || []
          ).join(','),
        },
      },
    ]);
  }

  async findSimilarActivities(prompt: string, k: number = 10, filter?: Where) {
    if (!this.vectorStore) return [] as any[];
    const results = await this.vectorStore.similaritySearch(prompt, k, {
      ...filter,
    });
    return results;
  }

  async resetVectorStore() {
    try {
      this.logger.log('Resetting vector store...');
      const chromaConfig = await this.getChromaConfig();
      const embeddings = this.embeddingService.getEmbeddings();

      if (embeddings) {
        this.vectorStore = await Chroma.fromDocuments(
          [],
          embeddings,
          chromaConfig as any,
        );
        this.logger.log('Vector store reset successfully');
      }
    } catch (error) {
      this.logger.error('Error resetting vector store:', error);
      throw error;
    }
  }

  async rebuildVectorStore() {
    try {
      // 1. Reset vector store
      await this.resetVectorStore();

      // 2. Get all activities from database
      const activities = await this.prisma.activity.findMany({
        where: {
          metadata: { not: null },
        },
      });

      this.logger.log(
        `Rebuilding vector store with ${activities.length} activities...`,
      );

      // 3. Add all activities to vector store
      for (const activity of activities) {
        try {
          await this.addActivityToVectorStore(activity);
        } catch (error) {
          this.logger.error(`Error adding activity ${activity.id}:`, error);
        }
      }

      this.logger.log('Vector store rebuilt successfully');
      return { success: true, count: activities.length };
    } catch (error) {
      this.logger.error('Error rebuilding vector store:', error);
      throw error;
    }
  }

  async testChromaConnection(): Promise<any> {
    const result: any = {
      status: 'unknown',
      timestamp: new Date().toISOString(),
    };
    // Simplified check
    if (this.vectorStore) {
      try {
        await this.vectorStore.similaritySearch('test', 1);
        result.status = 'connected';
      } catch (e) {
        result.status = 'error';
        result.error = e.message;
      }
    } else {
      result.status = 'not_initialized';
    }
    return result;
  }
}
