import { GeoEntityHint } from '../interfaces/experience-discovery.interface';

/**
 * STAGE-2 MIGRATION SEAM -- Stage-4-removable.
 *
 * `GeoEntityHint.required` was removed in the Stage 2 source-grounded
 * contract cutover (docs/superpowers/plans/2026-09-22-component-resolution-
 * and-partial-composite-recovery-plan.md) because it was an LLM-authored
 * geographic-truth flag: the extraction LLM must never decide which
 * component is allowed to kill a real Experience (see the amendment,
 * "Remove LLM-owned `required` from geographic truth").
 *
 * Several call sites still owned by Stage 4 -- composite geographic
 * validation strategy selection (`CompositeGeographicValidationService`),
 * the resolver's whole-candidate admission gate
 * (`ExperienceProposalResolverService`), and the persisted/trace `required`
 * fields downstream of them -- have not yet been redesigned around
 * per-component resolution outcomes + `resolutionRatio` (amendment §12;
 * plan Stage 4 "Resolution coverage" / "Composite Geographic Validation").
 *
 * Until Stage 4 lands, every source-supported component hint is treated as
 * required (fail-closed): this is NOT an LLM signal, NOT a fuzzy default,
 * and NOT a new policy invented to satisfy a threshold. It is the most
 * conservative interim reading available -- it can only make the pipeline
 * reject MORE than before (never silently accept a partial composite as if
 * it were geographically/compositionally complete) -- and for
 * structured-source hints it is IDENTICAL to production behavior before
 * this cutover (`StructuredExperienceCandidateSynthesizerService` always
 * set `required: true`). For web-extraction-origin hints it is stricter
 * than before (previously the LLM could mark a hint optional); that is the
 * deliberate fail-closed direction, not an accident.
 *
 * Stage 4 MUST replace every caller of this function with real
 * per-component resolution/geographic outcomes and resolutionRatio-based
 * admission. Do not add a new caller outside genuine Stage-2 migration
 * debt, and do not use this to reintroduce per-hint LLM authority under a
 * different name.
 */
// The parameter documents intent for every call site and future Stage 4
// callers; it is deliberately unused today (see doc comment above).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function isMigrationRequiredHint(_hint: GeoEntityHint): true {
  return true;
}
