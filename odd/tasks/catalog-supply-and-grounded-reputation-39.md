# Catalog supply and grounded reputation
Objective: recover independently supported Experience supply, preserve the completed grounded-web reputation experiment as historical evidence, then evaluate bounded Foursquare reputation without starting 40.2.
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

### S3 — Optional reputation is separate
- Exact separation: `admission != prominence != reputation != preference relevance != planning readiness`.
- Reputation is post-admission, bounded to a shortlist, provider-neutral, typed, provenance-backed, ranking-only and `UNKNOWN` when unsupported.
- No opaque score, no admission authority, no reputation in `GeoEntityTargetObservation`, and no production ranking authority until the experiment justifies it.
- Preserve the completed Groq pilot as historical evidence; the new bounded Foursquare spike measures current endpoint/version, match accuracy, rating/popularity coverage, billing, latency and cache behavior.

### S4 — Validation and delivery
- Preserve 39.11/39.12 and prior 39.15/39.16 evidence. Run local Overpass/Nominatim with Argentina dataset and disposable `zigzag_39_test`; Wikidata optional, Foursquare only for bounded post-admission reputation, no Groq reputation, public Overpass/Nominatim or Gemini Maps in the new comparison.
- Measure admission/composition, Wikidata dependence, historic-object counts, gastronomy, reputation outcomes, four preference profiles and evidence-based top 30 ranking reasons.
- Do not start 40.2. Commit bounded work units and push to the existing feature upstream only after gates.

### S5 — Foursquare reputation spike
- Query only already-admitted/composed Experiences; reputation never creates catalog identity or admission. Normalize rating/popularity into provider-neutral typed facts with provider, external place id, observation time, source field and scale; `UNKNOWN` is neutral.
- Audit canonical and returned identities, coordinates and categories; reject conflicting geography and keep ambiguity `UNKNOWN`. Reuse canonical identity/spatial authority and add no arbitrary threshold or place-specific exception.
- Compare existing production ordering with a bounded experimental typed ranking after existing preference and prominence dimensions; do not add an opaque scalar or enable production ranking authority.
- Report endpoint/version, match and field coverage, Pro/Premium billing, calls, latency, cache and cost; rerun the local Buenos Aires smoke and preserve earlier measurements.

## Tasks
- T0 — S1–S4 — inline — complete active OpenSpec update with independent visitability, preference independence and bounded grounded reputation capability/tasks; strict validation passed. Commit `7afdfc91`.
- T1 — S1–S2 — inline — implement 39.13/39.14 with tests; complete focused/suite and independent high-risk verification; record commit evidence. Risk: items 1 and 3 (additive persisted Prisma enum contract and shared canonical admission/preference evidence). Complete in `b1caad64`; verifier and focused checks passed.
- T2 — S3 — inline — run a bounded Groq grounded-reputation sample; add only the smallest typed post-admission spike and record measured evidence, with UNKNOWN neutral. Complete as diagnostic-only: 9 eligible candidate queries, one validated fact and eight rate-limited UNKNOWN; no ranking integration.
- T3 — S4 — inline — rerun local Buenos Aires smoke and record 39.15 evidence without rewriting 39.11/39.12; keep 40.2 blocked. Complete with `APPROACH_PARTIALLY_VALIDATED`; no final push authorized.
- T4 — S3–S5 — inline — add Foursquare reputation contract/task to active OpenSpec first; run task 39.17 as a bounded post-admission Places API experiment and compare typed ranking evidence without production authority. Pending Foursquare API credentials.
- T5 — S4–S5 — inline — rerun local Buenos Aires smoke per task 39.18, record the catalog and reputation verdicts, run gates, commit and push only after required evidence is complete. Do not start 40.2.

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

### L3 — Owner direction (2026-10-24)
- The validation goal is `Restore legitimate admission without making Wikidata mandatory, then test whether grounded web reputation provides the missing quality signal.`
- Wikidata, reputation, prominence, preference relevance and planning readiness remain separate; reputation is post-admission, ranking-only, typed/provenance-backed and UNKNOWN when unsupported.
- Add the bounded Groq reputation capability/task before implementing it; no Google Places, Foursquare or Gemini Maps; do not start 40.2.

### L4 — T1 implementation and verification (2026-10-24)
- Added provider-neutral paired class/independent-visitability admission evidence; OSM adapter maps only explicit public/customer foot/access semantics. Class-only and historic/artwork safeguards remain supporting-only.
- Removed Wikidata identity as a prerequisite for food discovery and verified canonical gastronomy observations persist for a no-QID restaurant.
- Independent verifier passed against `7afdfc91`; parent spot-check passed. Focused tests: 10 suites/122 tests; disposable DB integration: 3 tests; Prisma, typecheck, ESLint, OpenSpec strict validation and diff checks passed.
- Replay diagnostic: 2,712 candidates / 701 admitted, with only 4 carrying the new explicit-access evidence. This is not Buenos Aires smoke evidence; measure class-level recovery and quality in 39.15 before broadening the canonical source evidence.

### L5 — Grounded reputation and final smoke (2026-10-24)
- Final local smoke: 339 admitted/composed vs 335 in 39.12; gastronomy candidates rose 59→4,479 but Experiences remained 4. Tombs/memorials/monuments/artworks stayed 1/2/5/1; 132 Experiences lack Wikidata identity and 207 have it. Preference profiles respond, but several landmark ranks shifted materially. Full report: `spikes/catalog-quality-smoke-2026-10-24/RESULTS.md`.
- Reputation pilot queried only 9 already-composed eligible Experiences. One Casa Rosada official-tourism fact was source-reviewed; eight Groq calls returned HTTP 429. The successful response used 147,111 tokens, cost was unavailable, and no canonical cache exists. Evidence coverage did not justify ranking integration.
- Process deviation disclosed: two exploratory Café Tortoni calls were made before verifying composition; the candidate was absent and those results were excluded. The pilot script now filters by composed order.
- Final verdict `APPROACH_PARTIALLY_VALIDATED`; no push and no 40.2.

### L6 — Foursquare reputation direction (2026-10-25)
- Owner replaces the inconclusive Groq follow-up with a bounded Foursquare reputation spike. The completed Groq result remains historical and unchanged; no Foursquare output may influence admission or create catalog entities.
- Current official Foursquare docs identify Places API version `2025-06-17`; Place Match documents English-speaking country support, so Argentina should use a supported search/matching path. Rating, popularity and veracity metadata are Premium fields; published Premium pricing implies $1.875 per 100 calls if that rate applies. Capture account/billing evidence rather than assuming plan access.
- OpenSpec updated and passed `openspec validate --changes --strict` and `git diff --check` before product implementation. New tasks: 39.17 bounded Foursquare experiment and 39.18 final local smoke.
- No Foursquare API key/configuration is currently present in `.env` or the process environment, and repository code has no Foursquare adapter. Live provider measurement is blocked until the secret is configured locally; do not put credentials in Git or chat.
