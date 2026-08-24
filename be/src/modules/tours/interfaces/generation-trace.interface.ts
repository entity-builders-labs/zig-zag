import { GenerationAuditResult } from '../utils/generation-audit.util';
import { PlacesCrawlProvenance } from '@integrations/google-places/interfaces/places-api.interface';

// Chronological pipeline steps a live tour generation actually went
// through — see docs/superpowers/specs/2026-08-20-generation-bitacora-design.md.
export type TraceStage =
  | 'tour_intent'
  | 'destination_resolution'
  | 'db_search'
  // Kept so traces persisted before provider-neutral naming remain readable.
  | 'google_places_crawl'
  | 'places_crawl'
  | 'embeddings'
  | 'llm_generation'
  | 'verification';

export interface TraceCandidate {
  source: 'db' | 'google_places' | 'geoapify' | 'osm' | 'wikidata';
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
  placesProvenance?: PlacesCrawlProvenance;
  providerStatus?: 'success' | 'failed';
  degradedReason?: string;
}

export interface GenerationTrace {
  steps: GenerationTraceStep[];
  aiReasoning?: string;
  hallucinatedCount: number;
  duplicateCount: number;
  auditFindings?: GenerationAuditResult;
}
