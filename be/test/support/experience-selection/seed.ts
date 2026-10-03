import { ExperienceStatus, GeoEntityKind, MediaStatus } from '@prisma/client';
import { PrismaService } from '../../../src/core/database/prisma.service';
import {
  EMBEDDING_DIMENSIONS,
  INDEX_IDENTITY,
  projectAxisVector,
} from './axis-oracle';
import {
  ALWAYS_OPEN,
  buildCompetitiveCorpus,
  RowOracle,
  SeedRow,
} from './corpus';

export interface SeededCorpus {
  seedRows: SeedRow[];
  oracleById: Map<string, RowOracle>;
}

/**
 * Seeds the shared competitive corpus into the connected (disposable) database.
 * Single-component POI-source rows. Non-distractor rows get a deterministic
 * `projectAxisVector` embedding + the axis-oracle index identity; distractors
 * keep a NULL embedding so `getSimilarityScores` excludes them.
 */
export async function seedCompetitiveCorpus(
  prisma: PrismaService,
): Promise<SeededCorpus> {
  const seedRows = buildCompetitiveCorpus();
  const oracleById = new Map(seedRows.map((r) => [r.id, r.oracle]));

  await prisma.geoEntity.createMany({
    // A UNIQUE name per row: rows in one cluster are within ~150 m of each
    // other, so a shared name would make filterOverlappingExperienceCandidates
    // collapse the whole cluster into a single physical place.
    data: seedRows.map((row) => ({
      id: `geo-${row.id}`,
      name: `${row.canonicalName} — ${row.id}`,
      kind: GeoEntityKind.PLACE,
      latitude: row.latitude,
      longitude: row.longitude,
      address: `Benchmark ${row.clusterKey}, Buenos Aires`,
      metadata: { cluster: row.clusterKey },
    })),
  });

  await prisma.experience.createMany({
    data: seedRows.map((row) => ({
      id: row.id,
      canonicalName: row.canonicalName,
      description: row.description,
      durationMinutes: row.durationMinutes,
      price: row.price,
      status: ExperienceStatus.VERIFIED,
      qualityScore: row.qualityScore,
      latitude: row.latitude,
      longitude: row.longitude,
      openingHours: JSON.parse(JSON.stringify(ALWAYS_OPEN)),
      metadata: JSON.parse(
        JSON.stringify({
          themes: row.themes,
          traits: row.traits,
          intents: row.intents,
          dimensionedTraits: row.dimensionedTraits,
          oracle: row.oracle,
        }),
      ),
      mediaStatus: MediaStatus.ENRICHED,
      mediaUpdatedAt: new Date('2026-09-01T00:00:00.000Z'),
      ...(row.axisWeights
        ? {
            embeddingProvider: INDEX_IDENTITY.provider,
            embeddingModel: INDEX_IDENTITY.model,
            embeddingDimensions: INDEX_IDENTITY.dimensions,
            embeddingDocumentVersion: INDEX_IDENTITY.documentVersion,
            embeddedAt: new Date('2026-09-01T00:00:00.000Z'),
          }
        : {}),
    })),
  });

  await prisma.experienceComponent.createMany({
    data: seedRows.map((row) => ({
      experienceId: row.id,
      geoEntityId: `geo-${row.id}`,
      order: 1,
      role: 'venue',
      required: true,
    })),
  });

  // Deterministic embeddings for the non-distractor rows, in one statement.
  const embedded = seedRows.filter((row) => row.axisWeights);
  if (embedded.length > 0) {
    const values = embedded
      .map((row) => {
        const vec = projectAxisVector(row.axisWeights!);
        if (vec.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(`bad vector length for ${row.id}`);
        }
        return `('${row.id}', '[${vec.join(',')}]')`;
      })
      .join(',\n');
    await prisma.$executeRawUnsafe(
      `UPDATE "experience" AS e
         SET "embedding" = v.emb::vector
         FROM (VALUES ${values}) AS v(id, emb)
        WHERE e.id = v.id`,
    );
  }

  return { seedRows, oracleById };
}
