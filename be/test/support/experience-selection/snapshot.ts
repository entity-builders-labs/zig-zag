import { createHash } from 'crypto';
import { PrismaService } from '../../../src/core/database/prisma.service';

export interface CorpusSnapshot {
  count: number;
  ids: string[];
  rowHash: string;
  identityRows: Array<{
    id: string;
    provider: string | null;
    model: string | null;
    dimensions: number | null;
    documentVersion: number | null;
  }>;
  embeddingHash: string;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * A structural fingerprint of the whole `experience` table — every non-embedding
 * column plus a separate hash of the raw `embedding::text`. Re-checked between
 * profiles so a benchmark can never silently mutate the fixture to manufacture
 * the expected result (the trick the scale spec's counterfactual uses).
 */
export async function snapshotCorpus(
  prisma: PrismaService,
): Promise<CorpusSnapshot> {
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      canonicalName: string;
      description: string | null;
      durationMinutes: number | null;
      price: number | null;
      qualityScore: number | null;
      status: string;
      latitude: number | null;
      longitude: number | null;
      openingHours: unknown;
      metadata: unknown;
      embeddingProvider: string | null;
      embeddingModel: string | null;
      embeddingDimensions: number | null;
      embeddingDocumentVersion: number | null;
      embedding_text: string | null;
    }>
  >(
    `SELECT id, "canonicalName", description, "durationMinutes", price,
            "qualityScore", status::text AS status, latitude, longitude,
            "openingHours", metadata,
            "embeddingProvider", "embeddingModel", "embeddingDimensions",
            "embeddingDocumentVersion", "embedding"::text AS embedding_text
       FROM "experience"
      ORDER BY id`,
  );

  const rowHash = sha(
    rows
      .map((r) =>
        stableJson({
          id: r.id,
          canonicalName: r.canonicalName,
          description: r.description,
          durationMinutes: r.durationMinutes,
          price: r.price,
          qualityScore: r.qualityScore,
          status: r.status,
          latitude: r.latitude,
          longitude: r.longitude,
          openingHours: r.openingHours,
          metadata: r.metadata,
        }),
      )
      .join('\n'),
  );

  const embeddingHash = sha(
    rows.map((r) => `${r.id}\t${r.embedding_text ?? 'NULL'}`).join('\n'),
  );

  return {
    count: rows.length,
    ids: rows.map((r) => r.id),
    rowHash,
    identityRows: rows.map((r) => ({
      id: r.id,
      provider: r.embeddingProvider,
      model: r.embeddingModel,
      dimensions: r.embeddingDimensions,
      documentVersion: r.embeddingDocumentVersion,
    })),
    embeddingHash,
  };
}

export async function reverifyCorpus(
  prisma: PrismaService,
  baseline: CorpusSnapshot,
): Promise<void> {
  const current = await snapshotCorpus(prisma);
  expect(current).toEqual(baseline);
}
