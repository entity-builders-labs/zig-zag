/**
 * Read-only re-exports of spike 1 modules whose contracts still hold in
 * revision 2 (design R11). Spike 1 files are never modified by spike 2.
 */
export * from '../../gap-driven-destination-knowledge-2026-10-10/src/contracts';
export * from '../../gap-driven-destination-knowledge-2026-10-10/src/keys';
export * from '../../gap-driven-destination-knowledge-2026-10-10/src/stores';
export * from '../../gap-driven-destination-knowledge-2026-10-10/src/recording';
export * from '../../gap-driven-destination-knowledge-2026-10-10/src/facets';
export * from '../../gap-driven-destination-knowledge-2026-10-10/src/geometry';
export { corridorLine } from '../../gap-driven-destination-knowledge-2026-10-10/src/corridor';
export { deriveExperiences, recompose } from '../../gap-driven-destination-knowledge-2026-10-10/src/composition/reusable';
export type { RecompositionReport } from '../../gap-driven-destination-knowledge-2026-10-10/src/composition/reusable';
export { composeTour } from '../../gap-driven-destination-knowledge-2026-10-10/src/composition/tour';
export type { PlannerPort, TourComposition } from '../../gap-driven-destination-knowledge-2026-10-10/src/composition/tour';
export { toPlanningCandidate } from '../../gap-driven-destination-knowledge-2026-10-10/src/composition/projection';
export { SpikePlanner } from '../../gap-driven-destination-knowledge-2026-10-10/src/planner';
export { COMPOSITION_POLICY } from '../../gap-driven-destination-knowledge-2026-10-10/src/policy';
export type { CompositionPolicy } from '../../gap-driven-destination-knowledge-2026-10-10/src/policy';
export { captureFromQuote, documentFromHtml, locateQuote, normalizeWhitespace } from '../../gap-driven-destination-knowledge-2026-10-10/src/research/documents';
export type { FetchedDocument } from '../../gap-driven-destination-knowledge-2026-10-10/src/research/documents';
export { registrableDomain, isGovernmentHosted } from '../../gap-driven-destination-knowledge-2026-10-10/src/research/domain';
export { liveWebTools } from '../../gap-driven-destination-knowledge-2026-10-10/src/research/tools';
export type { WebTools, SearchResult } from '../../gap-driven-destination-knowledge-2026-10-10/src/research/tools';
export { parseJsonObject, langChainLlm } from '../../gap-driven-destination-knowledge-2026-10-10/src/research/llm';
export type { LlmPort } from '../../gap-driven-destination-knowledge-2026-10-10/src/research/llm';
export { findSentences } from '../../gap-driven-destination-knowledge-2026-10-10/src/research/agent';
export { verifyProvenance, hasSignal, publisherOf } from '../../gap-driven-destination-knowledge-2026-10-10/src/grounding/provenance';
export { llmSupportVerifier, claimStatement, VerifierUnavailable } from '../../gap-driven-destination-knowledge-2026-10-10/src/grounding/support-verifier';
export type { SupportVerifier, SupportQuestion } from '../../gap-driven-destination-knowledge-2026-10-10/src/grounding/support-verifier';
export { isGeographicDataCapture } from '../../gap-driven-destination-knowledge-2026-10-10/src/grounding/ground';
export { buildEnvironment, readEnvFile, resolveDestination } from '../../gap-driven-destination-knowledge-2026-10-10/src/wiring';
export type { SpikeEnvironment, ResolvedDestination } from '../../gap-driven-destination-knowledge-2026-10-10/src/wiring';
export { OsmGeoResolver } from '../../gap-driven-destination-knowledge-2026-10-10/src/grounding/identity';
export type { IdentityResult } from '../../gap-driven-destination-knowledge-2026-10-10/src/grounding/identity';
