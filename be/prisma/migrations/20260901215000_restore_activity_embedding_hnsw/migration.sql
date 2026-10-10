-- The pgvector HNSW index is intentionally not represented in schema.prisma.
-- Keep it across future Prisma-generated migrations.
CREATE INDEX IF NOT EXISTS "activity_embedding_hnsw_idx"
  ON "activity" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
