import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import { AiEmbeddingService } from './ai-embedding.service';
import { EmbeddingWriteResult } from '../interfaces/embedding-index.interface';
import { buildExperienceSemanticDocument } from '../utils/experience-semantic-document.util';

/** Writes only canonical Experience embeddings; tour generation remains read-only. */
@Injectable()
export class ExperienceEmbeddingIndexerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: AiEmbeddingService,
  ) {}

  async index(ids?: string[]): Promise<EmbeddingWriteResult> {
    const identity = this.embeddings.getIndexIdentity();
    const experiences = await this.prisma.experience.findMany({
      where: ids?.length
        ? { id: { in: ids } }
        : {
            status: 'VERIFIED',
            OR: [
              { embedding: null },
              { embeddingProvider: { not: identity.provider } },
              { embeddingModel: { not: identity.model } },
              { embeddingDimensions: { not: identity.dimensions } },
              { embeddingDocumentVersion: { not: identity.documentVersion } },
            ],
          },
      include: {
        components: {
          include: { geoEntity: true },
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
        },
        traits: { include: { traitDefinition: true } },
      },
    });

    if (!experiences.length) {
      return {
        status: 'no_work',
        requestedIds: ids ?? [],
        indexedIds: [],
        identity,
      };
    }

    const engine = this.embeddings.getEmbeddings();
    if (!engine) {
      const status = this.embeddings.getStatus();
      return {
        status: 'unavailable',
        requestedIds: experiences.map((experience) => experience.id),
        indexedIds: [],
        identity,
        reason:
          status.status === 'unavailable'
            ? status.reason
            : 'Embedding provider unavailable',
      };
    }

    const documents = experiences.map((experience) => {
      const metadata = this.metadata(experience.metadata);
      return buildExperienceSemanticDocument({
        canonicalName: experience.canonicalName,
        description: experience.description,
        durationMinutes: experience.durationMinutes,
        price: experience.price,
        themes: this.stringList(metadata.themes),
        intents: this.stringList(metadata.intents ?? metadata.archetypes),
        traits: experience.traits.map(({ traitDefinition }) => ({
          dimension: traitDefinition.dimension,
          key: traitDefinition.key,
          label: traitDefinition.label,
        })),
        components: experience.components.map((component) => ({
          role: component.role,
          required: component.required,
          geoEntity: {
            name: component.geoEntity.name,
            kind: component.geoEntity.kind,
            address: component.geoEntity.address,
          },
        })),
      });
    });

    try {
      const vectors = await engine.embedDocuments(documents);
      if (vectors.length !== experiences.length) {
        throw new Error(
          `Embedding provider returned ${vectors.length} vectors for ${experiences.length} Experiences`,
        );
      }

      const indexedIds: string[] = [];
      for (const [index, experience] of experiences.entries()) {
        const vector = vectors[index];
        if (!Array.isArray(vector) || vector.length !== identity.dimensions) {
          throw new Error(
            `Embedding for ${experience.id} has ${vector?.length ?? 0} dimensions; expected ${identity.dimensions}`,
          );
        }
        const serialized = `[${vector.join(',')}]`;
        await this.prisma.$executeRaw(
          Prisma.sql`UPDATE "experience"
            SET "embedding" = ${serialized}::vector,
                "embeddingProvider" = ${identity.provider},
                "embeddingModel" = ${identity.model},
                "embeddingDimensions" = ${identity.dimensions},
                "embeddingDocumentVersion" = ${identity.documentVersion},
                "embeddedAt" = NOW()
            WHERE "id" = ${experience.id}`,
        );
        indexedIds.push(experience.id);
      }

      return {
        status: 'indexed',
        requestedIds: experiences.map((experience) => experience.id),
        indexedIds,
        identity,
      };
    } catch (error) {
      return {
        status: 'unavailable',
        requestedIds: experiences.map((experience) => experience.id),
        indexedIds: [],
        identity,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Idempotent rebuild: only rows missing or stale for the current index identity are selected. */
  async rebuild(): Promise<EmbeddingWriteResult> {
    return this.index();
  }

  private metadata(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private stringList(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }
}
