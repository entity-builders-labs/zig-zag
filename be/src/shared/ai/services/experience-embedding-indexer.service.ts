import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import { AiEmbeddingService } from './ai-embedding.service';
import { EmbeddingWriteResult } from '../interfaces/embedding-index.interface';

/** Writes only canonical Experience embeddings; tour generation remains read-only. */
@Injectable()
export class ExperienceEmbeddingIndexerService {
  constructor(private readonly prisma: PrismaService, private readonly embeddings: AiEmbeddingService) {}

  async index(ids?: string[]): Promise<EmbeddingWriteResult> {
    const identity = this.embeddings.getIndexIdentity();
    const experiences = await this.prisma.experience.findMany({
      where: ids?.length ? { id: { in: ids } } : { status: 'VERIFIED' },
      select: { id: true, canonicalName: true, description: true, metadata: true },
    });
    if (!experiences.length) return { status: 'no_work', requestedIds: ids ?? [], indexedIds: [], identity };
    const engine = this.embeddings.getEmbeddings();
    if (!engine) {
      const status = this.embeddings.getStatus();
      return { status: 'unavailable', requestedIds: experiences.map(e => e.id), indexedIds: [], identity, reason: status.status === 'unavailable' ? status.reason : 'Embedding provider unavailable' };
    }
    const documents = experiences.map(e => [e.canonicalName, e.description ?? '', JSON.stringify(e.metadata ?? {})].filter(Boolean).join('\n'));
    try {
      const vectors = await engine.embedDocuments(documents);
      for (const [index, experience] of experiences.entries()) {
        const vector = `[${vectors[index].join(',')}]`;
        await this.prisma.$executeRaw(Prisma.sql`UPDATE "experience" SET "embedding" = ${vector}::vector, "embeddingProvider" = ${identity.provider}, "embeddingModel" = ${identity.model}, "embeddingDimensions" = ${identity.dimensions}, "embeddingDocumentVersion" = ${identity.documentVersion}, "embeddedAt" = NOW() WHERE "id" = ${experience.id}`);
      }
      return { status: 'indexed', requestedIds: experiences.map(e => e.id), indexedIds: experiences.map(e => e.id), identity };
    } catch (error) {
      return { status: 'unavailable', requestedIds: experiences.map(e => e.id), indexedIds: [], identity, reason: error instanceof Error ? error.message : String(error) };
    }
  }
}
