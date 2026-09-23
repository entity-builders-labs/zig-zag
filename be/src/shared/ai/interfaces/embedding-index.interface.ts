export type EmbeddingProvider = 'openai' | 'ollama' | 'bedrock';

export interface EmbeddingIndexIdentity {
  provider: EmbeddingProvider;
  model: string;
  dimensions: number;
  documentVersion: number;
}

/**
 * Increment whenever the canonical Experience semantic document changes
 * materially. v3 (Stage 2 cutover, component-resolution-and-partial-
 * composite-recovery-plan.md): removed the `required`/`optional` component
 * token -- `required` is no longer an LLM-authored geographic-truth fact,
 * so it no longer belongs in the semantic-similarity document (amendment
 * §18). Bumping this triggers reindexing of stale v2 VERIFIED rows through
 * the existing version-aware `ExperienceEmbeddingIndexerService.index()`.
 */
export const EXPERIENCE_EMBEDDING_DOCUMENT_VERSION = 3;

export type EmbeddingServiceStatus =
  | {
      status: 'ready';
      identity: EmbeddingIndexIdentity;
    }
  | {
      status: 'unavailable';
      identity: EmbeddingIndexIdentity;
      reason: string;
    };

export interface EmbeddingWriteResult {
  status: 'indexed' | 'unavailable' | 'no_work';
  requestedIds: string[];
  indexedIds: string[];
  identity: EmbeddingIndexIdentity;
  reason?: string;
}

export interface SemanticSimilarityResult {
  status: 'applied' | 'unavailable';
  scores: Map<string, number>;
  requestedCandidateCount: number;
  indexedCandidateCount: number;
  identity: EmbeddingIndexIdentity;
  reason?: string;
}
