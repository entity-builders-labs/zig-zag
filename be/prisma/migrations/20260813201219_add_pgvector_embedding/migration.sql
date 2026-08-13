-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- AlterTable
ALTER TABLE "activity" ADD COLUMN     "embedding" vector(256);

-- CreateIndex
-- HNSW over IVFFlat: IVFFlat needs a `lists` param tuned to row count at
-- build time, which is awkward for a table that starts empty and grows
-- incrementally. HNSW builds/maintains itself per-insert with no retuning.
-- vector_cosine_ops matches the cosine-space semantics ChromaDB used.
-- This index is raw-SQL-only and invisible to schema.prisma — see the
-- comment on Activity.embedding for why that matters for future migrations.
CREATE INDEX IF NOT EXISTS "activity_embedding_hnsw_idx"
  ON "activity" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
