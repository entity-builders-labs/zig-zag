-- Experience Domain V2 owns the semantic index. The historical Activity HNSW
-- index is dropped with Activity during the V2 cutover and cannot serve
-- Experience retrieval.
CREATE INDEX IF NOT EXISTS "experience_embedding_hnsw_idx"
  ON "experience" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
