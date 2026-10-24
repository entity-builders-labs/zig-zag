# Catalog supply and grounded reputation
Objective: recover independently supported Experience supply, then evaluate optional grounded-web reputation without starting 40.2.
Branch: `feat/synthetic-tours-openspec`; delivery: `feature-branch-chain`; runner: Jest, backend tooling and local Buenos Aires smoke. Forecast: 900–1,600 authored lines, excluding generated files.

## Specs

### S1 — Optional enrichment and admission independence
- Preserve the exact user rule: `Wikidata must not be required for admission.`
- Preserve `descriptive classification alone != independent visitability` and existing explicit-visitor/qualifying-heritage paths.
- New canonical independent-visitability evidence must be provider-neutral, typed, source-grounded, and distinct from class. No class allowlist, C5 admission, historical-object noise, or composition shortcut.
- Validate tomb, memorial, artwork, parent/sub-feature, and trusted linked-identity behavior.

### S2 — Preference facts remain independent
- Reuse `GeoEntityTargetObservation` for canonical preference observations only.
- Preserve gastronomy, art, history and architecture relevance without Wikidata; do not fabricate `qualityScore`.

### S3 — Grounded reputation is separate
- Exact separation: `admission != prominence != reputation != preference relevance != planning readiness`.
- Reputation is post-admission, bounded to a shortlist, provider-neutral, typed, citation/provenance-backed, ranking-only and `UNKNOWN` when unsupported.
- No opaque LLM score, no admission authority, no Google Places/Foursquare/Gemini Maps, and no reliance on `GeoEntityTargetObservation` as reputation storage.
- Verify current Groq model/tool configuration and report sample coverage, matches, UNKNOWN, sources, identity mismatches, latency, token/cost data if available, and cache behavior.

### S4 — Validation and delivery
- Preserve 39.11/39.12 evidence. Run local Overpass/Nominatim with Argentina dataset and disposable `zigzag_39_test`; Wikidata optional, Groq only for bounded reputation, no public Overpass/Nominatim or Gemini Maps.
- Measure admission/composition, Wikidata dependence, historic-object counts, gastronomy, reputation outcomes, four preference profiles and evidence-based top 30 ranking reasons.
- Do not start 40.2. Commit bounded work units and push to the existing feature upstream only after gates.

## Tasks
- T0 — S1–S4 — inline — update active OpenSpec first with independent visitability, preference independence and bounded grounded reputation capability/tasks; validate and commit spec checkpoint.
- T1 — S1–S2 — inline — implement 39.13/39.14 with tests; commit evidence after focused/suite checks. Risk: item 3 (canonical admission and preference evidence contracts are shared by adapters and catalog consumers).
- T2 — S3 — inline — run a bounded Groq grounded-reputation sample; add only the smallest typed post-admission spike and record measured evidence, with UNKNOWN neutral.
- T3 — S4 — inline — rerun local Buenos Aires smoke and record 39.15 evidence without rewriting 39.11/39.12; keep 40.2 blocked.

## Log

### L1 — Original request (verbatim scope excerpt)

> Restore legitimate admission without making Wikidata mandatory, then test whether grounded web reputation provides the missing quality signal.
>
> Structured POI / OSM → existence, class, geometry, structured visitability
>
> Admission → is this a legitimate independently visitable Experience candidate?
>
> Wikidata → optional identity corroboration + encyclopedic notability/prominence
>
> Grounded web reputation → optional reputation/tourism-quality evidence
>
> Preference relevance → match to user's requested interests
>
> Planning → duration, opening hours, routing
>
> admission != prominence != reputation != preference relevance != planning readiness
>
> Grounded reputation must be post-admission, ranking-only, provider-neutral, typed and provenance-backed, UNKNOWN when unsupported, and never required for an Experience to exist.
>
> Do not start 40.2.

### L2 — Prior checkpoint
- Spec-only optional-Wikidata amendment committed as `fdb63a68` after exact-file inspection; 39.11/39.12 history remains intact.
- `git fetch origin --prune` and `scripts/agent-preflight` passed: WRITE AUTHORIZED and INTEGRATION READY. Three file-overlap warnings remain visible and are not write blockers.
- Read-only code map: admission policy is `be/src/modules/tours/admission/structured-admission-policy.ts`; target observations encode preference compatibility, not reputation; Groq currently uses `openai/gpt-oss-120b` + `browser_search` in acquisition, not post-admission ranking.
