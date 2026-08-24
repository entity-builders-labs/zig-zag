export type EmbeddingProvider = 'openai' | 'ollama' | 'bedrock';

export interface EmbeddingIndexIdentity {
  provider: EmbeddingProvider;
  model: string;
  dimensions: number;
  documentVersion: number;
}

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
