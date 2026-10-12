/**
 * Read-only re-exports of spike 1 and spike 2 modules used by spike 3.
 * Spike 1/2 files are never modified (hash manifests checked at verdict).
 */
export * from '../../structured-world-first-2026-10-10/src/spike1';
export { Spike2Catalog } from '../../structured-world-first-2026-10-10/src/catalog';
export type { Spike2Snapshot } from '../../structured-world-first-2026-10-10/src/catalog';
export type { CandidateFacts, StructuredFact } from '../../structured-world-first-2026-10-10/src/contracts';
export { osmStructuredAdapter, wikidataFactsAdapter, StructuredProviderFailure } from '../../structured-world-first-2026-10-10/src/adapters/structured';
export type { OsmRecord, OsmStructuredAdapter, WikidataFacts, WikidataFactsAdapter } from '../../structured-world-first-2026-10-10/src/adapters/structured';
export { osmNames } from '../../structured-world-first-2026-10-10/src/discovery';
