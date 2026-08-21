import { GenerationAuditResult } from '../utils/generation-audit.util';

// Chronological pipeline steps a live tour generation actually went
// through — see docs/superpowers/specs/2026-08-20-generation-bitacora-design.md.
// `embeddings` deliberately documents an absence rather than a real
// candidate source: generateTourActivities selects candidates purely by
// geographic proximity today, never by pgvector similarity (that only
// happens in the deprecated TourGenerationService.generateTour()).
export type TraceStage =
  | 'db_search'
  | 'google_places_crawl'
  | 'osm_streets'
  | 'osm_boundary'
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
