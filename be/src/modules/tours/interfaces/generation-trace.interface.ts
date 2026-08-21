import { GenerationAuditResult } from '../utils/generation-audit.util';

// Chronological pipeline steps a live tour generation actually went
// through — see docs/superpowers/specs/2026-08-20-generation-bitacora-design.md.
export type TraceStage =
  | 'destination_resolution'
  | 'db_search'
  | 'google_places_crawl'
  | 'osm_streets'
  | 'osm_boundary'
  | 'neighborhood_shortlist'
  | 'embeddings'
  | 'wikidata_enrichment'
  | 'llm_generation'
  | 'verification';

export interface TraceCandidate {
  source: 'db' | 'google_places' | 'osm' | 'wikidata';
  id: string;
  name: string;
  detail?: string;
  offered: boolean;
  chosen: boolean;
}

export interface GenerationTraceStep {
  stage: TraceStage;
  label: string;
  summary: string;
  candidates?: TraceCandidate[];
}

export interface GenerationTrace {
  steps: GenerationTraceStep[];
  aiReasoning?: string;
  hallucinatedCount: number;
  duplicateCount: number;
  auditFindings?: GenerationAuditResult;
}
