# Component Resolution + Partial Composite Recovery — Implementation Plan

Status: **milestone complete (Stage 5 DONE 2026-09-25); one open cross-cutting finding (Experience dedupe) recorded in the Stage 5 addendum.**
Written: 2026-09-22.
Execution plan compacted: 2026-09-23.
Branch: `feat/preference-first-selection`.

Canonical design amendment:
`docs/superpowers/specs/2026-09-22-component-resolution-geographic-validation-and-enrichment-amendment.md`

Empirical baseline:
`spikes/rw1-san-telmo-historical-walk/forensic-rerun-2026-09-22/`

## Goal

Replace the current LLM-owned `required` / all-or-nothing composite gate with
an auditable component-resolution pipeline that:

- attempts every evidence-backed component;
- reuses canonical catalog GeoEntities before opening external resolution work;
- preserves provider/canonical-candidate evidence;
- performs component-level geographic relation checks;
- separates per-component truth from composite geographic coherence;
- preserves source-backed partial research deficits instead of erasing them;
- leaves planner eligibility fail-closed until the Experience is fully admitted
  by the canonical policy.

The architecture has already received independent adversarial review. This plan
is intentionally organized into **five implementation stages**. Do not split it
into a long sequence of micro-phases unless a concrete blocker requires a new
checkpoint.

## Progress

Every implementation stage MUST update this section in the same commit that
implements the stage. Do not mark a stage DONE without real validation.

| Stage | Status | Starting HEAD | Completed commit | Validation | Key findings / next gate |
| --- | --- | --- | --- | --- | --- |
| 1. Characterization lock | DONE | `286c85930eeff59c97e8c02918c3620ab203a44c` | `a0b6c75b50bf37807ab6c2450f94c8e81c9fc9d2` | jest (5 spec files, 187 tests) + tsc --noEmit + eslint (touched files) all green | 9 RW1-derived characterization cases frozen; `required` blast radius inventoried; several defects found that were previously undocumented (see below). Stage 2 unblocked. |
| 2. Source-grounded contract cutover | DONE | `a7df3b579282cee6b57fef8a914080d507e47fac` | *(this commit)* | jest (152/153 suites, 1746/1747 tests; 1 pre-existing arch failure) + tsc (clean) + eslint (clean) | LLM-owned `required` eliminated from discovery contract; deterministic source-support admission gate implemented; Santa Mónica blocked; semantic document bumped to v3; Stage 3 unblocked. |
| 3. Catalog-first identity resolution | DONE | `9eaf5ec1d9caddba55ccab1e0d5c2774f45f61b3` (PLACE cutover); `d1059a7cf786256acff2e9ca2311cac1ec7ab1b9` (verified hint memory) | `52c6da1`,`9424dc5`,`77de1fa`,`c101fea`; `6b60add`,`3abb70f`,`4b64b90` *(progress: this commit)* | unit 1987/1988 (pre-existing preference-first-architecture failure); integration on zigzag_test 91/94 (the 3 baseline failures; `catalog-reuse` passed); real-Postgres verified-hint memory 10/10 incl. concurrency (mutation-checked) and GIN EXPLAIN; live COLD/WARM on a fresh DB (15 hints incl. Solar de French); SerpApi/Serper/Google Places 0; tsc + eslint clean | Name-divergent WARM reuse closed by verified hint memory on `GeoEntity` (text[] + GIN, no new table). See the 2026-09-25 verified hint memory addendum and `spikes/stage3-verified-hint-memory-cold-warm-2026-09-25/assessment.md`. Stage 4 UNBLOCKED. |
| 4. Geographic + partial-composite cutover | DONE | `5a9ec4322a006aa0489625d5bac1202d7cdc8cbb` | `f4d4f81`,`0307a94`,`8bc5ce0` *(progress: this commit)* | unit 2021/2022 (baseline preference-first-architecture); integration 95/98 on zigzag_test (the 3 baseline failures) incl. new partial-composite-isolation 4/4 (mutation-checked); tsc + eslint clean; bounded live COLD/WARM/COLD (Serper, SerpApi 0) | `required` has no geographic/reuse/planner authority; single area-scope policy gives typed per-component relations (MultiLineString included); full source composition is the only admission fact; A-B-C-D-E-F never persists as A-B-D-F. No schema, no thresholds. Live partial shape not extracted (variance). See the 2026-09-25 Stage 4 addendum. Stage 5 UNBLOCKED. |
| 5. Trace + RW1 verification | DONE | `94e9cb10e33cbe085511e5ac7cced36db7700aa2` | `576bbe5`,`3097641`,`d38d4be`,`f2e164c` *(progress: this commit)* | unit 2041/2042 (baseline preference-first-architecture); integration 95/98 on zigzag_test (3 baseline failures); trace-failure-semantics 15/15 (RED first, mutation-checked); tsc + eslint clean; live RW1 3 COLD + 1 WARM + 1 targeted COLD (Serper; SerpApi/Google Places 0) | Trace distinguishes every terminal component state (false NO_OSM_MATCH on provider failure fixed; contradicted vs unconfirmed split) and states each composite's geographic/persistence/planner outcome. RW1: 2 composites (2/2, INSIDE, CGV accepted); partial/ambiguous/OUTSIDE/ROUTE not observed live (deterministic Stage 4 proof). No threshold selected. OPEN FINDING: Experience dedupe blocks single-vs-2-stop composites (order-dependent), characterized, needs a policy decision. Milestone COMPLETE. |

### Stage 1 — Characterization lock (2026-09-23)

**Scope.** Tests/fixtures only. No production file was changed (`git diff
--stat` against the starting commit touches exactly five `*.spec.ts` files,
zero production `.ts` files).

**Commands executed and real outcome:**

```
cd be && yarn jest \
  src/modules/tours/services/identity-verifier.service.spec.ts \
  src/modules/tours/utils/area-scope-membership-policy.spec.ts \
  src/modules/tours/services/experience-proposal-resolver.service.spec.ts \
  src/modules/tours/utils/experience-candidate-extraction.util.spec.ts \
  src/modules/tours/services/experience-catalog.service.spec.ts
# Test Suites: 5 passed, 5 total. Tests: 187 passed, 187 total.

cd be && yarn typecheck        # tsc --noEmit — clean, no errors
cd be && npx eslint <the same five files>   # 0 problems after --fix
                                             # (10 prettier-only formatting
                                             # fixes; no logic changes)
```

The full repo-wide `be` test/lint suite was not re-run in full; only the
five touched spec files plus `tsc --noEmit` (whole-project) were executed,
proportionate to a tests-only change with zero production-file diff.

**Characterization added (9 required cases), by file:**

- `identity-verifier.service.spec.ts` — Case A (El Zanjón de Granados:
  three real acquisition paths converging on `osm:node:9953027884`, all
  REJECTED by a non-corroborating `WIKIDATA_IDENTITY_MATCH(NEARBY)`; the
  differently-worded hint matching the candidate's own canonical name
  exactly still verifies) and Case F (Nuestra Señora de Belén: real
  `EXACT_NAME MULTIPLE` + non-corroborating Wikidata collapses to
  `REJECTED`, not `AMBIGUOUS`, even though the bare `MULTIPLE` signal alone
  already yields `AMBIGUOUS` today).
- `area-scope-membership-policy.spec.ts` — Case D (a real Calle-Defensa-
  shaped `ROUTE` entering a San Telmo-shaped `AREA` polygon, proving the
  existing `geometryHasPointInArea`/`segmentsIntersect` LineString×polygon
  logic already exists) and Case C (an explicitly-labeled DESIGN fixture —
  a resolved point outside the area connected by an intersecting route —
  clearly distinguished in comments from the observed RW1 Plaza de Mayo
  acquisition failure).
- `experience-proposal-resolver.service.spec.ts` — Cases B, E and H in one
  fixture built from the real cold-2 "San Telmo Historic Self-Guided Route"
  candidate (real `ev-10` text, real componentHints): the destination-
  association gate bounds acquisition to exactly one `LOCAL_OSM_POOL`
  attempt per hint for the whole candidate (not just the affected hint);
  "Plaza de Mayo" and "Pasaje San Lorenzo" both acquire-then-reject the
  wrong real local candidate and stay explicit `unresolved`/
  `UNCONFIRMED_MATCH`; the proposal-level `rejectionReasons` still defaults
  to `NO_OSM_MATCH` even though both components had a real candidate
  acquired and rejected. A second fixture reproduces Case A at the
  resolver level (`LOCAL_OSM_POOL` + `NOMINATIM` both resolving
  `osm:node:9953027884`, both `REJECTED`).
- `experience-candidate-extraction.util.spec.ts` — Case G (Basílica de
  Santa Mónica / `ev-11`: the real ev-11 snippet text never mentions the
  basilica; `extractExperienceCandidates` accepts the hint anyway because
  it only ever receives the evidence-KEY set, never the evidence TEXT).
- `experience-catalog.service.spec.ts` — Case I (Solar de French: the same
  `LOCAL_OSM_POOL` hint resolves the identical real `osm:node:6903962986`
  in every cold run — provider identity is stable — but three different
  `Experience` UUIDs get persisted, one per empty cold DB, because no
  catalog-first lookup exists yet; test asserts
  `ExperienceCatalogService.findGeoEntityCandidatesForHint` does not exist).

**`required` blast-radius inventory** (grouped by policy meaning; file:line
references are against commit `286c859`):

- discovery/source admission — `GeoEntityHint.required`
  (`experience-discovery.interface.ts:9`); the LLM JSON schema/prompt that
  asks for it (`experience-discovery-extraction.prompt.ts:136,145`, plus
  unrelated JSON-Schema-meta `required:[...]` keys at :159,174 — a naming
  collision, not the same field); the normalizer boundary
  (`experience-candidate-extraction.util.ts:128`, defaults non-`true` to
  `false`); structured (non-LLM) source synthesis, which always hardcodes
  `required:true` (`structured-experience-candidate-synthesizer.service.ts:
  28,37,46`); structured-source corroboration/merging, which OR-aggregates
  `required` across merged hints (`structured-candidate-corroboration.
  service.ts:538`); and the `MULTI_COMPONENT_EXPERIENCE`/`SINGLE_PLACE`
  admission gate that literally counts LLM-authored `required:true`
  non-area hints (`acquisition-candidate-requirement.util.ts:8-22` — the
  exact target of amendment §3's replacement).
- component-resolution behavior — the all-or-nothing
  `unresolvedRequired` gate and the `rejectionReasons` NO_OSM_MATCH-
  fidelity defect (`experience-proposal-resolver.service.ts:966-1008`,
  see Case H); the OR-across-every-resolved-entity `required` recompute
  after geoEntityId dedup (`experience-proposal-resolver.service.ts:
  1733-1760`).
- area-scope membership — `AreaScopeComponentFact.required`
  (`area-scope-membership.interface.ts:19`) and the canonical
  `evaluateAreaScopeMembership` primitive that filters to required
  components before applying `AREA_CONTAINED`/`AREA_ANCHORED_ROUTE`
  (`area-scope-membership-policy.ts:26-65`, see Cases C/D).
- composite geographic strategy — ~10 call sites across
  `rejectIfExternalScopeViolated`, `tryCanonicalGeometry` (canonical-route
  handling) and the area-anchored-waypoint/single-venue branches in
  `composite-geographic-validation.service.ts` (lines ~272-760) —
  `required` currently drives which validation strategy runs at all; this
  is Stage 4's explicit target, not touched here.
- persistence — `ExperienceComponent.required` / `TourExperienceComponent.
  required` (`prisma/schema.prisma:89,290`, both `@default(true)`),
  forwarded into the frozen tour snapshot by
  `tour-experience-snapshot.util.ts:16,68`.
- **planner/read behavior (not listed in the plan's own inventory
  prompt — found by inspection):** `spatial-footprint.util.ts:104,129`
  (`buildOrderedComponentFootprints`/`buildExperienceFootprint`) filters
  OUT any persisted component with `required === false` when computing a
  composite Experience's planner-facing centroid/bounds/ordered-footprint
  geometry. This means a persisted *optional* component is invisible to
  the deterministic daily planner's spatial reasoning today — a real
  behavioral fork Stage 2/3/4 must account for, since it survives even
  after `GeoEntityHint.required` stops being LLM-authored (the schema
  field itself is untouched by this milestone).
  `planning-candidate-normalizer.service.ts:18` only *describes* preserving
  required components in a comment; it has no actual `.required` field
  read — confirms the planner's selection/normalization step itself does
  not branch on `required`, only the footprint geometry helper above does.
- trace/forensics — `ComponentResolutionAudit.required`
  (`experience-resolution.interface.ts:130`) and its serialization in
  `generation-trace-builder.util.ts:176,1471` — this is the exact shape
  read directly from the RW1 `generation-trace.json` files above.
- embedding document — `experience-semantic-document.util.ts:19,63`
  (serializes the `required`/`optional` token into the canonical semantic
  document text) and `experience-embedding-indexer.service.ts:83` (feeds
  `ExperienceComponent.required` into that document builder at index
  time) — amendment §18's explicit Stage 2 target (remove the token, bump
  `EXPERIENCE_EMBEDDING_DOCUMENT_VERSION`, reindex).
- tests/fixtures only / type-declared-but-unread — `experience-dedupe.
  util.ts:4` declares a `required?: boolean | null` type and references
  "required" only in prose comments; no mechanical `.required` read exists
  in that file today (the dedupe comparison filters by role, not by this
  field) — a minor documentation/code-drift, not a live behavioral fork.
- **excluded as unrelated naming collisions** (same word, different
  concept — noted so a future grep isn't misled): `auth`/`apple-login`
  dto "required" fields; `preference-spec.interface.ts`/
  `preference-interpreter.service.ts`/`preference-spec-builder.util.ts`/
  `preference-sufficiency.util.ts` (facet-preference "required" concept,
  unrelated to `GeoEntityHint`); `experience-generation.service.ts`'s
  `requiredEligibleCount` (coverage/capacity target count);
  `experience-classification.service.ts` and
  `experience-semantic-classification.prompt.ts` (a different LLM call —
  semantic classification, not discovery — plus more JSON-Schema-meta
  `required:[...]` keys); `groq-grounded-search.service.ts`'s
  `tool_choice: 'required'` (an unrelated Groq/OpenAI tool-calling API
  parameter); `daily-planning.interface.ts`/`tour-completeness.
  interface.ts` (English-prose "required" in comments only).

**Failure classification** (per amendment §10/§12, task item 5):

- El Zanjón de Granados: **resolver/acquisition defect** — genuine
  multi-path identity convergence on one real object exists; the current
  policy rejects it anyway (this is a policy-gap defect in the code, not
  a genuine world-knowledge ambiguity).
- Plaza de Mayo (RW1 observed failure): **resolver/acquisition defect** —
  the `hasDestinationAssociationEvidence` gate and the fuzzy name-overlap
  matcher jointly acquire the wrong real candidate for an entirely
  unambiguous, world-famous real square; not a knowledge deficit.
- Pasaje San Lorenzo: **resolver/acquisition defect**, same mechanism as
  Plaza de Mayo (bounded to one attempt, wrong fuzzy match) — the pipeline
  correctly leaves it `unresolved` rather than force-resolving, which is
  the one part of this case that is NOT a defect.
- NO_OSM_MATCH false summary: **resolver/acquisition defect** — a plain
  code bug in the rejection-reason aggregation
  (`experience-proposal-resolver.service.ts:980-997`), not a system/
  provider limitation.
- Basílica de Santa Mónica / `ev-11`: **source-contract violation** — the
  extractor cited evidence that does not support the emitted component;
  the pipeline currently only avoids persisting it by accident (no real
  POI exists), which is a separate, unrelated resolver outcome.
- Nuestra Señora de Belén: **KNOWLEDGE_DEFICIT** — a genuinely common
  devotional name with multiple real, structurally different candidates
  (a plain node and a distinct "Capilla ..." building); this is the kind
  of case the future Tourism Researcher loop should target, once Stage
  2-5 land. *Mixed note:* the IdentityVerifier precedence defect found in
  Case F (WIKIDATA_IDENTITY_MATCH always short-circuiting before the
  EXACT_NAME MULTIPLE → AMBIGUOUS fallback) is itself a **resolver
  defect** layered on top of this genuine knowledge deficit — the
  classification is not purely one or the other.
- Solar de French: **spans two concerns, not one label.** Provider-side
  identity resolution for the stable geoapify-keyed hint is NOT a defect
  (it is correctly, repeatedly VERIFIED against the same real
  `osm:node:6903962986`). The cross-run instability is a **resolver/
  acquisition defect of omission** — no catalog-first reuse exists yet, so
  each empty cold run re-derives and re-persists a new canonical identity
  for the same real place (exactly Stage 3's target). Separately, the
  warm run's differently-keyed LLM-authored "solar-de-french" hint
  surfacing two structurally different real OSM objects (a node and a
  relation) for the same name is a genuine **KNOWLEDGE_DEFICIT**-shaped
  divergent-cluster case, distinct from the cross-run-stability finding.

**Architecture deviation:** NONE. No production semantics were changed;
Stage 2-5 are unaffected and remain BLOCKED.

**Engineering-principles gate (applicable categories only, since this
stage is tests-only):**

- provider isolation: PASS (no provider-name branching added).
- typed canonical facts: PASS (fixtures use the existing typed
  `GeoEntityHint`/`IdentityEvidence`/`AreaScopeComponentFact` contracts,
  no ad-hoc metadata bags).
- single identity authority: PASS (no new identity logic added;
  `IdentityVerifier` remains the sole authority exercised).
- single geographic authority: PASS (`evaluateAreaScopeMembership`
  remains the sole authority exercised; Case C/D fixtures reuse it, do
  not reimplement it).
- no provider voting: PASS (not applicable — no new logic).
- no destination hacks: PASS (no San-Telmo-specific production code; all
  San Telmo/Buenos Aires values are test fixtures only).
- no production behavior change during characterization: PASS (`git diff
  --stat` touches only five `*.spec.ts` files).

**Stage 2 unblocked:** YES.

### Stage 2 — Source-grounded contract cutover (2026-09-23)

**Scope.** Discovery contract, extraction prompts, LLM schemas, candidate extraction normalizer, structured source synthesis, candidate corroboration, multi-component admission, and semantic document versioning.

**Commands executed and real outcome:**

```
cd be && npx tsc --noEmit -p .   # Clean, 0 errors
cd be && yarn lint               # Clean, 0 problems (after prettier-only fixes)
cd be && yarn test               # Test Suites: 152 passed, 1 failed, 153 total. Tests: 1746 passed, 1 failed, 1747 total.
```

The single failing test is `preference-first-architecture.spec.ts:25`.
- Offending production line: `experience-proposal-resolver.service.ts:507` (added in earlier commit `02fc6918` as a forensic output summary `destinationBoundary: boundary ? ... : undefined`).
- This line already existed at starting HEAD `a7df3b5` and was untouched by Stage 2.
- Production code and the architecture test were NOT modified or weakened merely to force 1747/1747; this is accurately recorded as a known pre-existing repository failure.

**Integration-test safety guard:**
Two integration spec files (`area-route-walk-geographic-validation.integration-spec.ts` and `experience-identity-dedupe.integration-spec.ts`) were updated and typecheck successfully, but were NOT executed at runtime because the configured `DATABASE_URL` points to the live Zig-Zag database and the harness refuses destructive `TRUNCATE` without an explicitly disposable test DB.
`ALLOW_DESTRUCTIVE_TEST_DB` was NOT set against the current DB to prevent data loss. Integration tests require a dedicated disposable `zigzag_test` database; fixtures typecheck but runtime integration execution was intentionally skipped for database safety. This is a validation-environment limitation, not a Stage 2 code blocker.

**Production contracts changed:**
- `GeoEntityHint`: removed `required` boolean property. `GeoEntityHint` itself
  gained NO `supportSpan` field (this was misstated in an earlier revision of
  this Progress entry and corrected 2026-09-23 -- see the corrective addendum
  below). The real contract:
  ```
  raw extraction shape (LLM output, has supportSpan)
          |
          v
  deterministic source-support gate (verifyTextualComponentSourceSupport)
          |
          v
  canonical GeoEntityHint (no supportSpan)
  ```
  `supportSpan` exists only on the raw, pre-canonical componentHint shape the
  extractor emits; the source-support gate consumes and verifies it, and the
  canonical `GeoEntityHint` produced afterward never carries it.
- `experience-discovery-extraction.prompt.ts`: removed `required` from extraction instructions and componentHints JSON Schema.
- Provider adapters (`gemini-discovery.provider.ts`, `groq-discovery.provider.ts`, `ollama-discovery.provider.ts`): schemas synchronized to eliminate `required`.
- Source support admission:
  - Extracted textual componentHints must supply `supportSpan` that exists verbatim (case/whitespace-normalized) in cited `SourceObservation` text.
  - Implemented `verifyTextualComponentSourceSupport` in `component-source-support.util.ts`.
  - Normalizer in `experience-candidate-extraction.util.ts` deterministically drops unsupported components before any entity or geographic resolution.
- `StructuredExperienceCandidateSynthesizerService`: componentHints are built 1:1 from source observation titles and treated as supported by construction; removed hardcoded `required: true`.
- `acquisition-candidate-requirement.util.ts`: redefined `MULTI_COMPONENT_EXPERIENCE` admission to require at least two distinct source-supported non-area components.
- `experience-semantic-document.util.ts`: removed `required`/`optional` tokens from canonical semantic document.
- `embedding-index.interface.ts`: bumped `EXPERIENCE_EMBEDDING_DOCUMENT_VERSION` from 2 to 3.

**Deleted obsolete paths:**
- Removed `hint.required` filtering and assignment throughout `experience-candidate-extraction.util.ts`.
- Removed `required` merging logic in `structured-candidate-corroboration.service.ts`.
- Removed `required`/`optional` token emission in `experience-semantic-document.util.ts`.
- Removed legacy contract assertions expecting `required` in `gemini-discovery.contract-spec.ts` and `groq-discovery.contract-spec.ts`.

**Migration seams intentionally left for Stage 4:**
- `geo-entity-hint-required-migration.util.ts`: introduced `isMigrationRequiredHint(_hint: GeoEntityHint): true` as a typed, explicit interim seam.
- Used in:
  - `ExperienceProposalResolverService` (candidate-level admission gate and geoEntityId dedup).
  - `CompositeGeographicValidationService` (interim filter for geographic strategy evaluation).
- These remaining `required` usages are NOT LLM-authored and do not represent canonical semantic truth. They remain strictly because Stage 4 owns geographic and planner semantic cutover, and are documented as temporary Stage-4 debt.

**Planner finding:**
Stage 1 proved that `spatial-footprint.util.ts` still has behavior tied to persisted `required`.
Stage 2 does NOT silently claim this is resolved; this authority belongs to Stage 4.

**Embedding version change:**
- `EXPERIENCE_EMBEDDING_DOCUMENT_VERSION` bumped 2 -> 3.
- `ExperienceEmbeddingIndexerService` tested and verified to select stale v2 rows for reindexing.
- No GeoEntity embeddings or second vector store added.

**Santa Mónica regression verification:**
- Basílica de Santa Mónica (`ev-11`) is now deterministically rejected at candidate extraction time with `SPAN_NOT_FOUND_IN_CITED_EVIDENCE`.
- No external provider acquisition (OSM, Nominatim, Places, Wikidata) is invoked.

**Unexpected findings:** NONE.

**Architecture deviation:** NONE. All canonical principles and provider isolation invariants preserved.

**Engineering-principles gate:**
- provider isolation: PASS (no provider-name branching added).
- typed canonical facts: PASS (`supportSpan` exists only on the raw extraction shape; canonical `GeoEntityHint` remains typed and contains no `supportSpan`, with no untyped bags).
- source authority: PASS (deterministic verification against cited SourceObservation text).
- single admission policy: PASS (`component-source-support.util.ts` and `acquisition-candidate-requirement.util.ts` are canonical).
- no hidden metadata protocol: PASS (no untyped side-channels or magic flags).
- no magic semantic defaults: PASS (explicit fail-closed seam `isMigrationRequiredHint` documented for Stage 4 removal).
- no premature Stage-4 redesign: PASS (Stage 4 geographic/partial-composite redesign untouched).
- embedding ranking-only authority: PASS (version bumped, ranking only).
- deletion/cutover discipline: PASS (obsolete `required` paths cleaned up).

**Stage 3 unblocked:** YES.

### Stage 2 corrective addendum (2026-09-23)

A review of the Stage 2 cutover found two remaining source-grounding gaps.
Both are fixed here; nothing else about Stage 2's scope changed.

**1. Title+snippet source-support verification.**
The extractor is shown each evidence record as `[key] title-or-source:
snippet` (`buildDiscoveryEvidenceBlock`), but `verifyTextualComponentSourceSupport`
and its callers (`groq-discovery.provider.ts`, `ollama-discovery.provider.ts`,
`gemini-discovery.provider.ts`) previously threaded through only the snippet
half. A component whose real support text lived in the cited record's title
was incorrectly rejected.
- `DiscoveryEvidenceRecord` (`experience-candidate-extraction.util.ts`) now
  carries `title?` alongside `text` (the snippet).
- `verifyTextualComponentSourceSupport` (`component-source-support.util.ts`)
  now checks both the title and the snippet/text of each cited evidence
  record, same-record only -- no cross-record rescue, no fuzzy/alias/semantic
  matching, no geography/provider lookup, no metadata side-channel.
- `supportSpan` still never becomes part of the canonical `GeoEntityHint` --
  see the corrected contract above.

**2. Distinct-component counting for MULTI_COMPONENT_EXPERIENCE.**
`candidateSatisfiesEvidenceRequirement` previously counted
`componentHints.filter(role !== 'area').length`, so the same obvious
component duplicated twice (even under a different hint `key`/
`evidenceKeys`) could satisfy `MULTI_COMPONENT_EXPERIENCE` on its own.
- `acquisition-candidate-requirement.util.ts` now collapses componentHints by
  a deterministic, provider-neutral fingerprint (normalized component name +
  structural role + `expectedKind`; case/diacritics/punctuation/whitespace
  normalization only) before counting for both `SINGLE_PLACE` and
  `MULTI_COMPONENT_EXPERIENCE`. No fuzzy matching, aliases, semantic
  similarity, coordinates, provider identity, or Stage 3 canonical-identity
  logic was introduced -- names that could later prove to be aliases of the
  same real place remain distinct here; identity resolution stays Stage 3's
  job.

**Embedding decision (unchanged scope, documented rationale):**
`EXPERIENCE_EMBEDDING_DOCUMENT_VERSION` stays at 3. No cron, job, CLI
command, HTTP endpoint, or startup reindex was added for bulk migration of
stale-version embeddings, and `ExperienceEmbeddingIndexerService`'s existing
test proving stale document versions are selectable for reindexing is
unchanged. Rationale:
- the current development database/catalog is disposable (see AGENTS.md's
  early-stage deletion rule); rebuilding the DB produces v3 embeddings
  directly, with no migration needed.
- a production bulk-reindex mechanism only becomes relevant once a
  persistent catalog must survive a future semantic-document version change
  without a rebuild -- that is not the current situation.
- individual Experience updates already go through the existing normal flow
  unaffected by this decision: dedupe `NEW` generates an embedding; dedupe
  `SAME` invalidates the existing embedding via the current persistence path,
  and the resolver indexes that Experience again. `semanticDocumentChanged`
  behavior on the `SAME` path (currently conservative -- always `true`, even
  when the semantic document may be unchanged) is unchanged by this fix; it
  is separate future optimization/debt, not Stage 2 scope.

**Validation executed for this addendum:**
```
cd be && npx tsc --noEmit -p .
cd be && npx eslint <changed files>
cd be && yarn test
```
See the corrective commit for exact output. The pre-existing
`preference-first-architecture.spec.ts` failure (documented above, unrelated
production line untouched since starting HEAD) is unaffected by this
addendum.

**isMigrationRequiredHint:** untouched -- remains the explicit, typed,
temporary Stage-4 migration seam described above.

**Scope discipline:** no catalog-first GeoEntity lookup, El Zanjón
corroboration semantics, Plaza acquisition continuation, Nuestra Señora de
Belén IdentityVerifier precedence, NO_OSM_MATCH fidelity, component
geographic relations, CompositeGeographicValidation redesign,
spatial-footprint `required` behavior, partial-composite persistence, or
Tourism Researcher work was touched. Those remain Stage 3/4 scope.

**Stage 3 unblocked:** YES (unchanged).

### Stage 2 corrective addendum — source-composition authority (2026-09-23)

Adversarial Astra/Terra review found a remaining Stage 2 gap: the extraction
normalizer's own comment said "an unsupported hint does NOT invalidate the
whole candidate: it is dropped, and sibling hints with genuine source
support survive" -- this silently let the extractor rewrite raw source
composition (raw `A-B-C`, `C` unsupported) into a smaller canonical
candidate (`A-B`), which is exactly the authority Stage 2 was supposed to
deny it. This addendum fixes that, and only that.

**Two failure classes, kept explicitly separate (do not conflate in any
future stage):**

```text
SOURCE_CONTRACT_VIOLATION
  -- the extractor cited evidence that does not actually support a
     component it emitted. A source-contract failure on ANY declared
     component invalidates the WHOLE raw candidate -- it never authorizes
     a reduced Experience variant. Decided here, at extraction time, before
     any identity/geographic work begins.

source-backed but identity/geography unresolved
  -- a component whose citation DID pass the source-support gate, but whose
     real-world identity or geographic relation could not later be
     resolved/verified (Stage 3/4 concern: catalog-first resolution,
     IdentityVerifier, CompositeGeographicValidation). This is the
     deliberate partial-composite characterization case the architecture
     wants to preserve and measure -- Stage 2 does NOT reject it, does NOT
     touch it, and this fix does not change its handling in any way.
```

**Production contract changed:**
- `experience-candidate-extraction.util.ts`: removed the buggy
  "drop the unsupported hint, keep the candidate" branch. For each raw
  candidate, every structurally-valid declared `componentHint` is now run
  through the existing `verifyTextualComponentSourceSupport` gate (title+
  snippet verification itself is UNCHANGED -- see the prior addendum above)
  and recorded in a new typed audit. If ANY declared component is
  `UNSUPPORTED`, the whole raw candidate is marked
  `SOURCE_CONTRACT_VIOLATION`: no canonical `ExperienceCandidate` is
  emitted, and a deterministic validation error containing
  `SOURCE_CONTRACT_VIOLATION` is recorded. Only when ALL structurally-valid
  declared components are `SUPPORTED` does the canonical candidate get
  built and emitted, unchanged from before.
- New typed contract (`experience-candidate-extraction.util.ts`):
  `ComponentSourceSupportStatus`, `ComponentSourceSupportAudit` (per
  component: index/key/name/role/expectedKind/evidenceKeys/status/reason),
  `CandidateSourceSupportAudit` (per raw candidate:
  candidateName/status/emittedComponentCount/supportedComponentCount/
  unsupportedComponentCount/components). No metadata bag, no LLM-authored
  truth, no persistence schema, no new Experience lifecycle state, no
  percentage threshold -- typed facts only.
  `component-source-support.util.ts` gained one additive export,
  `isUnsupportedComponentSourceSupportResult` (a type-predicate function):
  this repo's `tsconfig.json` sets `strictNullChecks: false`, under which
  plain `if (result.supported)` control-flow narrowing of the existing
  `ComponentSourceSupportResult` discriminated union is unreliable in this
  TypeScript version (confirmed via isolated repro); an explicit type
  predicate narrows correctly regardless. The verification logic itself
  (`verifyTextualComponentSourceSupport`) is byte-for-byte unchanged.
- `ExperienceExtractionResult` gained `sourceSupportAudits:
  CandidateSourceSupportAudit[]` (always populated, one entry per raw
  candidate that had at least one structurally-valid componentHint).
- `WebAcquisitionResult` (`experience-acquisition.service.ts`) gained
  `sourceSupportAudits?: CandidateSourceSupportAudit[]`, threaded straight
  from the extractor's result. `candidateDecisions` is untouched and still
  only ever evaluates canonical `ExperienceCandidate`s that already passed
  this gate -- a `SOURCE_CONTRACT_VIOLATION` raw candidate never reaches
  `candidateDecisions`, `execution.candidates`,
  `candidateSatisfiesEvidenceRequirement`, or
  `ExperienceProposalResolver`/materialization. Proven directly at the
  `ExperienceAcquisitionService.executePlan` seam (new test: "never threads
  a SOURCE_CONTRACT_VIOLATION raw candidate into candidateDecisions or
  execution.candidates, only into sourceSupportAudits").
- `generation-trace.interface.ts` / `generation-trace-builder.util.ts`:
  `TraceAcquisitionSource.web.extractor` gained
  `sourceSupportAudits: CandidateSourceSupportAudit[]`, populated in
  `buildAcquisitionStep()` from `webResult.sourceSupportAudits`. No new
  trace stage, no new rejection classification -- a source-contract
  violation is never labeled `NO_OSM_MATCH` or `KNOWLEDGE_DEFICIT` anywhere
  in the trace, because it never reached identity acquisition.
- No frontend change. This is internal pipeline state; the interactive
  Tour generation UX (`generationStatus`/`generationMessage`/completion
  rules) is unaffected -- a source-contract-invalid candidate simply never
  becomes planner-eligible, the same as any other candidate that fails to
  reach admission today.

**Santa Mónica regression re-verified under the corrected contract:**
Raw candidate `Basílica de Santa Mónica (unsupported) + Plaza Dorrego
(supported) + Calle Defensa (supported)` now produces ZERO canonical
candidates (previously, before Stage 1, it accepted all three; the buggy
Stage 2 interim behavior this addendum removes would have shrunk it to
`Plaza Dorrego + Calle Defensa`). The per-component audit still preserves
all three facts (`Santa Mónica: UNSUPPORTED /
SPAN_NOT_FOUND_IN_CITED_EVIDENCE`, the other two: `SUPPORTED`) for
observability.

**Tests:** `experience-candidate-extraction.util.spec.ts` -- replaced the
test that locked the old "drops only the unsupported hint" behavior with a
dedicated `describe('source-composition-authority correction
(SOURCE_CONTRACT_VIOLATION)')` block (13 tests): whole-candidate rejection
on first/middle/last/multiple unsupported components with the per-component
audit preserved; unchanged emission when all components are supported; all
three `ComponentSourceSupportReason` values preserved
(`NO_SUPPORT_SPAN`/`MISSING_EVIDENCE_TEXT`/`SPAN_NOT_FOUND_IN_CITED_EVIDENCE`);
title-only and snippet-only support still pass; support cited from the
wrong `evidenceKey` still fails; Santa Mónica confirmed blocked before any
identity/provider acquisition. The pre-existing Case G test (Santa Mónica,
single unsupported component) was updated to assert the new
`SOURCE_CONTRACT_VIOLATION` message/audit instead of the retired "no
source-supported componentHints remain" message -- the underlying
behavioral assertion (0 candidates emitted) is unchanged. Also added:
`experience-acquisition.service.spec.ts` (acquisition-seam wiring test
above) and `generation-trace-builder.util.spec.ts` ("surfaces
sourceSupportAudits in the web extractor trace block").

**Validation executed for this addendum:**
```
cd be && npx tsc --noEmit -p .        # clean, 0 errors
cd be && npx eslint <all 12 changed files>   # 0 problems after --fix
                                              # (prettier-only formatting)
cd be && yarn test
# Test Suites: 1 failed, 153 passed, 154 total.
# Tests: 1 failed, 1772 passed, 1773 total.
```
The single failing test is the same pre-existing, documented
`preference-first-architecture.spec.ts:25` failure recorded in the original
Stage 2 entry above (offending line `experience-proposal-resolver.service.
ts:507`, predates this addendum and every prior Stage 2 commit). It was not
modified or weakened to force a green total.

**Partial-resolution boundary explicitly preserved (unchanged by this
addendum):**
- source-backed components that remain unresolved/ambiguous at
  identity/geography time are NOT treated as source violations -- they are
  a completely separate, later concern (Stage 3 `IdentityVerifier`
  outcomes, Stage 4 `CompositeGeographicValidationService`,
  `isMigrationRequiredHint`).
- no partial-resolution acceptance threshold (no `resolutionRatio >= X AND
  resolvedComponentCount >= Y` or equivalent) was chosen or implied by this
  fix. That decision belongs to Stage 5's RW1-grounded characterization,
  once the Stage 4 component matrix exists.
- Stage 3 catalog-first identity resolution, Stage 4 geographic/
  partial-composite cutover, `CompositeGeographicValidationService`,
  `AREA` membership, persisted `required`, planner spatial footprint, Tour
  snapshots, and the Tourism Researcher loop are all untouched.

**Architecture deviation:** NONE.

**Engineering-principles gate:**
- provider isolation: PASS (no provider-name branching added).
- typed canonical facts: PASS (`ComponentSourceSupportAudit`/
  `CandidateSourceSupportAudit` are explicit typed contracts, no metadata
  bag, no untyped side-channel).
- source authority: PASS -- this fix is precisely the correction of a prior
  source-authority leak (the extractor could previously narrow real source
  composition unilaterally).
- single admission policy: PASS (still `component-source-support.util.ts`
  + `acquisition-candidate-requirement.util.ts`; no parallel gate added).
- no magic semantic defaults: PASS (no threshold, no invented ratio).
- no premature Stage 3/4 redesign: PASS (catalog-first identity resolution,
  geographic strategy selection, and partial-composite persistence are
  completely untouched).
- deletion/cutover discipline: PASS (the buggy "drop hint, keep candidate"
  branch and its locking test were fully removed, not left reachable
  behind a flag).

**Stage 3 unblocked:** YES (unchanged; Stage 3 itself was NOT started by
this commit).

### Stage 3 — Catalog-first identity resolution: first checkpoint (2026-09-23)

**Scope.** The first value checkpoint inside Stage 3 only (per the
checkpoint brief that authorized this commit) — catalog-first
`GeoEntity` reuse plus lazy OSM pool acquisition, wired into the
resolver, with a no-network proof and the Solar de French warm-reuse
characterization. Candidate correlation across catalog rows, the
remaining bounded-continuation characterization, El Zanjón re-testing,
and any further `IdentityVerifier` evolution are explicitly **not**
attempted here — see "Remaining Stage 3 work" below. Stage 4 remains
untouched and BLOCKED.

**Repository.**
- Starting HEAD: `8060782ed22ff80d5d1f00ac21a134a36f8a3ed7`.
- Checkpoint commit: *(this commit)*.
- Remote HEAD after push: *(recorded after push, below)*.

**Catalog lookup — `ExperienceCatalogService.findGeoEntityCandidatesForHint`**
(`be/src/modules/tours/services/experience-catalog.service.ts`):
- Exact query shape: `prisma.geoEntity.findMany({ where: { kind,
  latitude: { gte, lte }, longitude: { gte, lte } }, include: {
  identities: { select: { provider, externalId }, orderBy: { createdAt:
  'asc' } } } })`, followed by an in-process strict
  `normalizeGeoName(row.name) === normalizeGeoName(hintName)` filter —
  the same normalization/exact-match primitives
  (`normalizeGeoName`/`countExactNormalizedMatches`'s own definition)
  the resolver's existing local-OSM-pool matching already uses, so no
  second identity-matching primitive was introduced.
- Geographic bound: a lat/lon bounding box, reusing the exact
  degree-delta formula `findNearbyMatchingGeoEntity` already used
  inline (now extracted into a shared
  `ExperienceCatalogService.boundingBoxDegreeDeltas`), derived from
  `POINT_RADIUS` directly or from `AREA_BOUNDARY` via the existing
  `boundingBoxToCenterRadius` helper (`geometry-search-area.util.ts`) —
  no second geographic-envelope algorithm. An `AREA_BOUNDARY` scope with
  no usable geometry fails closed to `{ candidates: [] }` with **zero**
  `findMany` calls (test: "fails closed — no query at all").
- Kind filter: `where.kind = request.expectedKind` (`GeoEntity.kind`,
  the existing enum — `GeoEntityHint.expectedKind` is already the exact
  same `'PLACE' | 'AREA' | 'ROUTE'` literal union).
- Matching rule: strict normalized-name equality only inside the
  bounded, same-kind pool. No fuzzy score, no substring/alias matching,
  no geographic-nearest-wins, no provider voting. 0 matches → catalog
  miss; 1 → returned as the sole candidate; 2+ → all returned (the
  service never picks a winner — see "candidate correlation" gate
  below).
- Existing indexes used: `geo_entity_kind_idx` (`@@index([kind])`) and
  `geo_entity_latitude_longitude_idx` (`@@index([latitude, longitude])`,
  from `prisma/schema.prisma`). No migration was added.
- `EXPLAIN (ANALYZE, BUFFERS)` result (read-only, run against the local
  dev Postgres container `zigzag-postgres`, 101 `geo_entity` rows —
  disposable dev data per `AGENTS.md`'s early-stage rule, no write
  performed):
  ```
  Bitmap Heap Scan on geo_entity (actual time=0.432..0.435 rows=5 loops=1)
    Recheck Cond: (latitude BETWEEN ... AND longitude BETWEEN ...)
    Filter: (kind = 'PLACE'::"GeoEntityKind")
    Heap Blocks: exact=5
    ->  Bitmap Index Scan on geo_entity_latitude_longitude_idx
          Index Cond: (latitude BETWEEN ... AND longitude BETWEEN ...)
  Planning Time: 1.091 ms
  Execution Time: 0.475 ms
  ```
  The planner uses the existing `[latitude, longitude]` btree index for
  the bounded box and applies `kind` as a cheap residual filter on the
  small (5-row) bitmap result — confirms the existing indexes are
  sufficient for this bounded lookup at the current data volume, so no
  new index was introduced per §17's instruction. (The table also
  already carries an unrelated `geo_entity_location_gist_idx` geography
  GIST index from a prior migration, available as headroom if a future
  stage needs true radial `ST_DWithin` — not required or used here.)

**Resolver behavior** (`experience-proposal-resolver.service.ts`):
- Catalog-first ordering (corrected 2026-09-23 — see "Correction" below):
  for every component hint, `resolveViaCatalog` now runs **before** the
  existing `TRUSTED_OBSERVATION_REUSE` pre-check and before any pool
  selection — a `VERIFIED` catalog match `continue`s to the next hint
  before `TRUSTED_OBSERVATION_REUSE`, the OSM pools, or any other
  external strategy is ever reached. `TRUSTED_OBSERVATION_REUSE` runs
  second, only when catalog reuse was not terminal (miss, ambiguous, or
  a unique match that failed verification).
- Lazy OSM implementation: the old eager `Promise.all([lookupStreets*,
  lookupPois*])` at the top of `resolve()` was replaced with two
  request-scoped memoized getters (`getStreetLookup`/`getPoiLookup`,
  plain synchronous check-then-set — safe under
  `mapWithBoundedConcurrency`'s concurrent candidates since neither
  getter awaits before caching its promise). Each is invoked only at the
  exact point a hint's own resolution path needs that pool (ROUTE →
  streets only, PLACE/venue → pois only, AREA → neither, unless its
  `AREA_TO_PLACE_CORRECTION` fallback needs pois) and is cached for the
  rest of that `resolve()` call.
- How the existing GeoEntity id is reused: a new
  `reuseCatalogGeoEntity(candidate, geoEntityId)` builds the
  `ResolvedGeoEntity` directly from the catalog's own canonical facts —
  it never calls `upsertGeoEntity`. `EntityCandidate` itself was **not**
  changed to carry a canonical id (preserving its "no id before
  verification" invariant for every other strategy); the catalog's
  `geoEntityId` travels alongside it on a separate
  `CatalogAcquisitionResult` type used only at this seam.
- IdentityVerifier path: unchanged and unweakened. A unique catalog
  match becomes an `EntityCandidate` with `canonicalName` = the
  GeoEntity's own name and `nameEvidenceMultiplicity.exactName =
  'SINGLE'`; the existing `buildLocalIdentityEvidence` (unmodified)
  detects the exact-name match and emits `EXACT_NAME/SINGLE`, which the
  existing `IdentityVerifier.verify` (byte-for-byte unmodified) already
  treats as immediately `VERIFIED` — no new identity logic anywhere. An
  ambiguous (2+) catalog match is deliberately **not** run through
  `IdentityVerifier` at all (there is no well-formed single-candidate
  representation for a genuinely competing pool); it is recorded as an
  observability-only `CATALOG_REUSE` attempt
  (`poolCandidateCount` = match count, no verification decision) and
  falls through unchanged to the existing external pipeline.

**No-network proof** (`experience-proposal-resolver.service.spec.ts`,
describe block "Stage 3 — catalog-first identity resolution", test
"all-catalog-hit"): for a two-component candidate (one venue, one
route) whose every component resolves from the catalog —
- street OSM calls: 0 (`lookupStreetsNear`/`lookupStreetsWithin` never
  called);
- POI OSM calls: 0 (`lookupPoisNear`/`lookupPoisWithin` never called);
- Nominatim calls: 0 (`nominatim.search` never called);
- Places calls: 0 (`placesApi.getPlaceDetails`/`searchText` never
  called — since the correction below, `CATALOG_REUSE` resolving the
  venue hint is terminal, so the pre-existing P2-B
  `TRUSTED_OBSERVATION_REUSE` local check never even runs for it; a
  route hint still skips that check entirely as before, since routes
  were never eligible for it);
- Wikidata calls: 0 (`wikidata.getEntitySummaries` never called — the
  catalog match's `EXACT_NAME/SINGLE` evidence is `VERIFIED` by
  `IdentityVerifier` directly, so `IdentityEvidenceCollector.collect`'s
  network branch is never reached);
- `catalog.upsertGeoEntity`: 0 calls (both resolved `geoEntityId`s are
  the catalog's own, reused directly).

**Mixed fixture** (same describe block, test "mixed hit/miss"): three
components A/B/C on one candidate, A and C hit the catalog, B misses —
- catalog-hit components: A, C — each shows exactly one
  `CATALOG_REUSE` attempt, `VERIFIED`, and are never re-proved
  externally merely because B missed;
- externalized component: B — shows `['CATALOG_REUSE',
  'LOCAL_OSM_POOL']`, resolves via the existing pipeline
  (`upsertGeoEntity` called exactly once, for B only);
- shared pool invocation count: `lookupPoisWithin` called exactly
  **once** for the whole candidate (memoized), even though it is
  consulted only because B needed it.

An **ambiguous-catalog** test (same describe block) additionally proves
a 2-candidate bounded catalog match is never arbitrarily resolved: the
`CATALOG_REUSE` attempt records `poolCandidateCount: 2` with no
verification decision, and resolution falls through and genuinely
succeeds via `LOCAL_OSM_POOL` instead (`upsertGeoEntity` called once,
for the OSM-resolved entity — never for either ambiguous catalog row).
A kind/scope-wiring test proves `findGeoEntityCandidatesForHint` is
called with the hint's own `expectedKind` and the resolver's
`entityResolutionScope` (not the wider destination `geographicScope`)
when both are present.

**Solar de French** (`experience-catalog.service.spec.ts`, describe
block "ExperienceCatalogService — Solar de French warm-reuse (Stage
3)", reusing the Stage 1 `osm:node:6903962986` characterization
baseline):
- previous GeoEntity id: a simulated prior-cold-run row,
  `geo-solar-french-cold-1` (provider `openstreetmap`, externalId
  `osm:node:6903962986`);
- warm GeoEntity id: the SAME `geo-solar-french-cold-1` — a later
  compatible hint's `findGeoEntityCandidatesForHint` call returns it as
  the sole candidate;
- external calls implied by this read: none (this is the catalog READ
  the resolver's own no-network tests above prove is sufficient to
  avoid re-acquisition once persisted);
- ambiguity: a second test in the same block proves the SEPARATE,
  genuinely divergent within-run node-vs-relation cluster the Stage 1
  corpus also observed (`osm:node:6903962986` vs `osm:relation:9314953`,
  both named "Solar de French") is **not** hidden — the bounded catalog
  pool returns both rows as 2 candidates, preserved as explicit
  ambiguity for later Stage-3 correlation work, exactly as the
  checkpoint brief required.

**Validation.**
```
cd be && npx tsc --noEmit -p .
# Clean, 0 errors.

cd be && npx eslint <all 7 changed files>
# 0 problems after --fix (prettier-only formatting; no logic changes).

cd be && yarn test
# Test Suites: 1 failed, 153 passed, 154 total.
# Tests: 1 failed, 1786 passed, 1787 total.
```
The single failing test is the same pre-existing, already-documented
`preference-first-architecture.spec.ts:25` failure recorded in the
Stage 2 entry above (offending line
`experience-proposal-resolver.service.ts:507`'s `destinationBoundary`
field, predates this commit and every prior Stage 2/2-addendum
commit). It was not modified or weakened to force a green total.
Integration specs (`test/integration/**`) were not executed for the
same DB-safety reason documented in Stage 2 (no disposable
`zigzag_test` database configured); they typecheck cleanly against the
real `ExperienceCatalogService`, which now has this method for real —
no mock-completeness gap exists there since those tests use the
concrete class, not hand-rolled mocks.

**Test-mock migration note.** Adding a new call inside the existing,
heavily-mocked `resolveCandidate` hint loop meant every hand-rolled
`catalog` test double across
`experience-proposal-resolver.service.spec.ts` (84 object-literal
mocks + 7 bare `{} as any` stand-ins that are actually reached by a
componentHint-bearing candidate),
`experience-proposal-resolver-trace.spec.ts` (2), and
`experience-proposal-resolver.concurrency.spec.ts` (1) needed a
`findGeoEntityCandidatesForHint` stub (default: catalog miss,
`{ candidates: [] }`, which byte-for-byte preserves every pre-existing
test's resolution behavior). This is stale-fixture maintenance, not a
production compatibility shim — no `?.()` optional-chaining guard was
added to `resolveViaCatalog`'s real call site, since `catalog` is a
required, always-real constructor dependency in production. Roughly 10
pre-existing assertions on `componentAudits[*].attempts` (order/length/
strategy) were updated to account for the new leading `CATALOG_REUSE`
attempt or the now-lazy OSM pool calls — each change is a mechanical
consequence of the new call ordering, not a weakened invariant; a few
`.find(a => a.strategy === X)`-based assertions needed no change at all
since they were already order-independent.

**Stage.**
- Stage 3: IN PROGRESS.
- Spike checkpoint: **READY** (CATALOG-FIRST WARM-REUSE READY FOR
  SPIKES).
- Stage 4: BLOCKED (untouched — no `isMigrationRequiredHint`,
  `ExperienceComponent.required`, `CompositeGeographicValidationService`,
  partial-composite, planner, or Researcher semantics were touched).

**Remaining Stage 3 work** (deliberately not attempted in this
checkpoint):
- deterministic candidate correlation across catalog rows (same
  `(provider, externalId)`, same OSM object surfaced through different
  acquisition paths, provider cross-reference to an existing
  `GeoEntityIdentity`) — today, ambiguous catalog rows are only ever
  left explicit, never correlated/grouped;
- full bounded-continuation characterization for a catalog-miss hint
  through the rest of the strategy ladder under Stage 3's new ordering
  (Plaza de Mayo/Pasaje San Lorenzo-style cases, now with `CATALOG_REUSE`
  as the new first attempt);
- El Zanjón de Granados re-test under catalog-first + bounded
  continuation, per §"Wikidata / corroboration sequencing" (only after
  which `IdentityVerifier` corroboration semantics may be revisited, and
  only if still necessary);
- final Stage-3 exit gate (Progress must record Solar de French AND El
  Zanjón outcomes together, plus query/performance evidence at
  realistic data volume, before Stage 3 can be marked DONE).

**Architecture deviation:** NONE.

**Correction (2026-09-23) — resolver order was backwards.** The
checkpoint above shipped with `TRUSTED_OBSERVATION_REUSE` running
*before* `CATALOG_REUSE`, inverted from the catalog-first invariant this
checkpoint exists to establish. `TRUSTED_OBSERVATION_REUSE` is not pure
local reuse: for an eligible structured `SourceObservation` it can still
execute `placesApi.getPlaceDetails(observation.externalId)` — a real
external call — before the catalog was ever consulted. A warm run where
a `GeoEntity` already exists in the catalog AND the current acquisition
run also contains a matching `SourceObservation` for the same hint would
therefore still perform unnecessary Internet work and reach
`CATALOG_REUSE` too late to matter.

Fixed by reordering `resolveCandidate`'s per-hint block so
`CATALOG_REUSE` runs first and is terminal on a `VERIFIED` unique match;
`TRUSTED_OBSERVATION_REUSE` runs second, reached only on a catalog miss,
an ambiguous catalog match, or a unique catalog match that failed
verification. Same-run structured observations are useful acquisition
reuse, but they may still require an external provider detail fetch.
Persisted canonical GeoEntity knowledge must therefore precede them in
the Stage 3 catalog-first hierarchy. No other Stage 3 semantics changed:
`findGeoEntityCandidatesForHint`, catalog matching, `IdentityVerifier`,
`reuseCatalogGeoEntity`, the lazy OSM loaders, and Stage 4 are all
untouched.

Regression coverage added in the same describe block
("Stage 3 — catalog-first identity resolution"):
- "warm run: catalog identity for a hint takes priority over a matching
  same-run SourceObservation" — catalog hit + a compatible
  `SourceObservation` for the same hint → `attempts` = `['CATALOG_REUSE']`
  only, `TRUSTED_OBSERVATION_REUSE` never attempted,
  `placesApi.getPlaceDetails` 0 calls, `catalog.upsertGeoEntity` 0 calls,
  resolved `geoEntityId` is the catalog's own.
- "catalog miss: TRUSTED_OBSERVATION_REUSE still runs normally (as the
  second strategy)" — proves the fallback is preserved, not deleted:
  `attempts` begins `['CATALOG_REUSE', 'TRUSTED_OBSERVATION_REUSE']` and
  `getPlaceDetails` is still called when the catalog misses.

The pre-existing "all-catalog-hit" test's venue-hint assertion was
updated mechanically from `['TRUSTED_OBSERVATION_REUSE', 'CATALOG_REUSE']`
to `['CATALOG_REUSE']` — the same scenario, corrected to the new (and
now correctly catalog-first) attempt order.

**Validation (correction).**
```
cd be && npx tsc --noEmit -p .
# Clean, 0 errors.

cd be && npx eslint <changed files>
# 0 problems.

cd be && yarn test
# Test Suites: 1 failed, 153 passed, 154 total.
# Tests: 1 failed, 1788 passed, 1789 total.
```
The single failing suite/test is the same pre-existing, already-documented
`preference-first-architecture.spec.ts:25` failure recorded above and in
the Stage 2 entry — unrelated to this change, not modified here.

**Stage (superseded by the 2026-09-24 addendum below).**
- Stage 3: IN PROGRESS.
- The catalog-first warm-reuse checkpoint passed and subsequent live characterization has expanded the known acquisition/identity failure set.
- Stage 4: BLOCKED until Stage 3's structured-resolution/identity outcomes are explicit and stable.

**Engineering-principles / checkpoint architecture gate (§21):**
- catalog lookup is bounded: **PASS** (kind + lat/lon box at the
  Prisma `where`, `EXPLAIN` confirms the existing btree index is used).
- no full GeoEntity scan: **PASS**.
- catalog service does not declare identity truth: **PASS**
  (`findGeoEntityCandidatesForHint` returns candidates/facts only;
  `IdentityVerifier` remains the sole VERIFIED/AMBIGUOUS/REJECTED
  authority).
- IdentityVerifier remains final authority: **PASS** (byte-for-byte
  unmodified; no `if (catalogHit) return VERIFIED` shortcut anywhere).
- catalog is not represented as provider voting: **PASS** (`provider:
  'catalog'` appears only as a diagnostic trace label, the same
  convention `'trusted_observation'` already uses — never as a
  persisted `GeoEntityIdentity.provider` or an input to any voting
  logic).
- catalog hit reuses existing GeoEntity id: **PASS**
  (`reuseCatalogGeoEntity`).
- catalog hit avoids upsertGeoEntity: **PASS** (asserted directly in
  the no-network test).
- all-catalog-hit avoids OSM pool fetch: **PASS**.
- all-catalog-hit avoids Nominatim: **PASS**.
- all-catalog-hit avoids Places: **PASS**.
- all-catalog-hit avoids Wikidata network lookup: **PASS**.
- mixed hit/miss only externalizes the misses: **PASS**.
- lazy OSM loaders execute at most once per resolver call: **PASS**
  (memoized getters, asserted via `toHaveBeenCalledTimes(1)` in the
  mixed fixture).
- no standalone Experience auto-created from component reuse: **PASS**
  (component resolution still only ever produces/reuses a `GeoEntity`;
  `persistVerifiedExperience` is unchanged and still the only Experience
  write path, reached the same way as before).
- no Stage-4 required/partial semantics changed: **PASS**
  (`isMigrationRequiredHint` and every Stage-4-owned file untouched).
- no destination-specific production hacks: **PASS** (all San
  Telmo/Solar-de-French/Buenos-Aires values are test fixtures only).


### Stage 3 progress addendum — live identity/acquisition characterization (2026-09-24)

This addendum records the Stage 3 production fixes and live controls that landed
after the first catalog-first checkpoint. It **does not mark Stage 3 DONE** and
does not unblock Stage 4.

**Repository evidence through remote HEAD
`d1637b91ee2c5f57fd9bcebd4bb874731b9ccc35`:**

- `33066625615b614cbdba0ec1c614abb0ca235fe5`
  (`fix(tours): verify component identity by ID, not string matching`):
  added within-hint `IDENTITY_CONVERGENCE` when two independent acquisition
  strategies return the exact same self-namespaced external identity. A targeted
  live check verified El Zanjón de Granados through LOCAL_OSM_POOL + NOMINATIM
  convergence. The same commit also made `Defensa Street` verify in a targeted
  live check through a ROUTE-only OWN_QID permissive-name workaround. The
  convergence mechanism is useful evidence; the ROUTE-specific permissive-name
  rule is **not** treated as the desired end-state architecture.
- `3d386e7c19e465dfdf3b5e12422ad6e7fef081ec`
  (`fix(tours): report AMBIGUOUS and UNCONFIRMED_MATCH truthfully in the Bitácora`):
  corrected trace/rejection fidelity so "candidate acquired but not confirmed"
  no longer collapses to `NO_OSM_MATCH`, and non-corroborating Wikidata over a
  real multi-candidate name collision reports `AMBIGUOUS` rather than implying
  active contradiction. Persistence behavior is unchanged.
- `bdd99c536a771d3a4e4e644e3d2924ec2e1742de`
  (`fix(tours): bias Nominatim search toward the request destination`):
  added a destination-centered soft Nominatim `viewbox` (no `bounded=1`),
  reusing the existing 50 km bias scale. Real full-HTTP-path control runs
  produced **4/4 like-for-like flips to VERIFIED and 0 regressions**, all on the
  same real "José de San Martín" component that countrywide importance ranking
  previously pushed out of Nominatim's top-5 window.
- `6e915b760c0b3286aa11b76cb07bc46c87fa8345`:
  recorded the Buenos-Aires-walks component survey and the Nominatim-bias live
  control artifacts. The survey separates at least three real failure
  mechanisms: provider result-window geography, OSM POI tag coverage, and
  `map_to_area`/boundary topology gaps.
- `3adaaf0326e0ab477622fd13adc2891dcac726fc`
  (`fix(osm): include named indoor pedestrian corridors in POI pool`):
  added the generic OSM category `highway=corridor + name` to local POI
  queries. Live validation showed the category is narrow and surfaces real
  named galleries/passages; no identity policy changed.
- `d1637b91ee2c5f57fd9bcebd4bb874731b9ccc35`:
  recorded the corridor control and a concrete live `map_to_area` gap:
  "Galería Güemes" is a real downtown Buenos Aires OSM object but is absent
  from the exact CABA relation-derived area pool used by the resolver, while a
  broader Buenos Aires relation can surface it. This proves that local
  `map_to_area` completeness cannot be assumed as a hard identity-resolution
  prerequisite.

**Current architectural reading from the evidence:**

1. The composite extractor/source contract is no longer the dominant observed
   failure for these cases; the recurring deficit is
   `GeoEntityHint -> canonical GeoEntity`.
2. Stage 3 failures are not one thing:
   - some are true acquisition/coverage misses;
   - some are provider result-window/geographic-bias misses;
   - some acquire the correct canonical object and then fail identity policy;
   - some are boundary-pool completeness defects.
3. `IDENTITY_CONVERGENCE` is a valid strong fact, but current implementation
   only correlates repeated external IDs **within one hint's strategy ladder**.
   It does not yet satisfy the full Stage 3 candidate-correlation gate across
   catalog rows/provider cross-references.
4. Nominatim now has useful destination soft bias, but
   `ExperienceProposalResolverService.resolveViaNominatim` still returns
   `not_applicable` for `ROUTE` hints. Therefore the new bias does not yet
   address `Defensa Street`/Pasaje-style ROUTE acquisition through Nominatim.
5. The live `map_to_area` counterexample means destination/anchor polygons
   should remain geographic-validation evidence and may support discovery, but
   must not silently become a hard completeness assumption for canonical
   component identity.
6. The ROUTE-only `OWN_QID -> requireAllTokens:false` fix remains a temporary
   compatibility workaround pending a more structural provider-native
   resolution path; do not generalize it into more per-kind/per-name matching
   heuristics.

**Next Stage 3 gate — structured provider-native resolution spike:**

Before adding more IdentityVerifier/name heuristics, characterize an isolated
resolver whose contract is:

```text
name + expectedKind + destination/country
        |
        v
structured provider search with soft destination bias
        |
        v
provider-native canonical external ID + structural kind/admin facts
        |
        v
RESOLVED / AMBIGUOUS / NOT_FOUND / INCOMPATIBLE
```

The spike must reuse the Nominatim soft-bias infrastructure already landed,
must not first require membership in a `map_to_area` local pool, and must
explicitly cover ROUTE lookup. Names may drive retrieval/ranking but must not
be the terminal identity authority.

Required real controls include the existing Stage 3 failures
`Defensa Street`, `Dorrego Square`, `San Lorenzo Passage`,
`El Zanjón de Granados`, `Mafalda Statue`, `Caminito Street`,
`Boca Juniors Stadium`, `Ezeiza Mansion`, plus `Galería Güemes` as the
known `map_to_area` incompleteness control and negative collision cases.

If that isolated gate passes, integrate it behind catalog reuse and ahead of
the legacy local-pool/name path; then run a broad **Buenos Aires walking-route
COLD/WARM spike** through the real HTTP/outbox/processor path to measure
product-level impact across many grounded composite candidates.

**Stage status after this addendum:**

- Stage 3: **IN PROGRESS**.
- Stage 3 DONE: **NO** — full candidate correlation, structured-resolution
  gate, broad COLD/WARM composite evidence, and final query/performance exit
  evidence are still pending.
- Stage 4: **BLOCKED** — `isMigrationRequiredHint`, partial-composite lifecycle,
  planner eligibility, and persisted `required` semantics remain untouched.
- Architecture deviation: **documented pivot in evaluation strategy, not yet a
  production cutover**. The evidence now justifies testing provider-native
  structured resolution before adding more name/Wikidata heuristics.

### Stage 3 progress addendum — structured provider-native resolution spike, gate FAILED (2026-09-24)

The next gate identified by the addendum above (an isolated structured
provider-native resolver, characterized against real Nominatim/Geoapify
before any production integration) was executed. **The gate did not pass.**
Per this plan's own explicit discipline for that gate ("if it fails: STOP,
document why, do not add exceptions to force it green"), no production
integration, IdentityVerifier evidence type, ROUTE-workaround retirement,
small San Telmo E2E control, or Buenos-Aires-walks mega-spike were
performed as a result. Full evidence:
`spikes/stage3-structured-geoentity-resolution-2026-09-24/assessment.md`
(matrix.json/summary.md alongside it).

**What was built** (isolated, not wired into production):
`StructuredGeoEntityResolverService` (`name + expectedKind + destination ->
RESOLVED/AMBIGUOUS/NOT_FOUND/INCOMPATIBLE`), reusing the already-landed
Nominatim soft-viewbox bias and the Places destination bias radius (no new
bias mechanism), plus a genuinely new ROUTE path that queries Nominatim at
all (today's `resolveViaNominatim` early-returns for
`hint.expectedKind === 'ROUTE'`). An incidental provider-adapter fix was
required first: `GeoapifyPlacesApiService` was silently discarding the real
`category` field every Autocomplete response already carries, always
reporting `types: []` — fixed and TDD'd, since PLACE structural-category
filtering was otherwise impossible to test honestly.

**Gate result — 3 of 6 required rows failed:**

1. Defensa Street (hard RESOLVED requirement): **FAIL**. Under the real OSM
   name ("Defensa"), Nominatim returns 5 same-importance segments, **none
   in San Telmo/CABA** (all in other partidos). This is a distinct,
   previously-unobserved failure mode from the one `bdd99c5` already fixed:
   the soft bias reliably wins for a name with few national homonyms (its
   own "José de San Martín" case) but not for an ordinary street name with
   many nationally-tied-importance segments — Nominatim's own top-5 result
   window can simply never contain the destination's own segment.
2. San Lorenzo Passage (RESOLVED-or-honest-AMBIGUOUS requirement): **FAIL**
   in substance. Real name "Pasaje San Lorenzo" returns `AMBIGUOUS`, but
   across 5 segments in Chaco/Santa Fe — the real San Telmo passage never
   appears in the candidate set at all. Reporting `AMBIGUOUS` for a set that
   does not contain the right answer is a coverage miss wearing an
   ambiguity label, not the honest-ambiguity the gate intended.
3. Negative controls (0 false RESOLVED requirement): **FAIL**. Bare
   "San Martín" (AREA) resolved confidently to a real but ~30km-distant
   partido, because Nominatim's raw results contained exactly one
   structurally area-eligible object at all (the only other raw result was
   correctly excluded by the existing `osmType==='node'` rule in
   `isAreaScaleEligible`) — with only one survivor, there was no internal
   disagreement available to surface as ambiguity.

**What passed and should not be lost:** El Zanjón de Granados (PLACE)
resolved cleanly with zero fuzzy/Wikidata evidence, using only Geoapify's
own category and geography; the same held for "Estadio Alberto J. Armando"
("La Bombonera"). Plaza Dorrego and Plaza San Martín correctly stayed
`AMBIGUOUS` among several real, structurally identical candidates rather
than guessing. Galería Güemes decisively confirms the Group-C requirement:
identity resolution for this class of hint can be done entirely through
Geoapify Places, with zero Overpass/`map_to_area` calls, and still
correctly reports `AMBIGUOUS` between the real downtown object and the
known Ramos Mejía homonym (`d1637b9`'s finding). The new multi-segment
ROUTE grouping logic (collapsing several OSM ways of one real street into
one identity via normalized name + real address locality, never distance)
is unit-tested and held up correctly whenever the underlying provider
result set actually contained the right segments — every live ROUTE
failure above is upstream of that logic, in what Nominatim's bare-name
search itself returns.

**A separate structural gap was found and deliberately left unfixed** (per
STOP discipline, not silently patched to chase a green spike):
"Cementerio de la Recoleta" is tagged `landuse=cemetery` in real OSM data,
which satisfies neither the current AREA (`isAreaScaleEligible` requires
`class` `boundary`/`place`) nor PLACE (Geoapify's `type=amenity` parameter)
structural filters. Large "ground" features (cemeteries, and plausibly
stadium grounds, campuses, `landuse`-tagged parks) are an undocumented
blind spot in both existing structural predicates, independent of the
ROUTE/AREA findings above.

**Stage status after this addendum:**

- Stage 3: **IN PROGRESS** (unchanged from the prior addendum's own
  assessment — this spike neither advances nor regresses the exit-gate
  checklist below, since it stopped before touching production).
- Stage 3 DONE: **NO** — same outstanding items as before (full candidate
  correlation, broad COLD/WARM composite evidence, final query/performance
  exit evidence), **plus** ROUTE bare-name resolution and the AREA
  single-candidate false-positive risk are now concretely characterized
  open problems rather than untested hypotheses.
- Stage 4: **BLOCKED**, untouched.
- What must be solved before this path can be retried: a ROUTE resolution
  mechanism that works for common Argentine street names without the
  already-ruled-out options (no second parallel bias mechanism, no
  distance-as-identity, no per-place translation/alias lists) — the actual
  next design question, not yet answered by this task.

### Stage 3 progress addendum — targeted ROUTE acquisition + AREA destination compatibility spike, gate PASSED (2026-09-24)

Starting HEAD: `13e3500164ccc6a4ddbdff3a00a896e4e3dfb939` (verified equal to
the fork's remote HEAD before any change). Evidence commit: `b480143`
(`test(tours): characterize targeted ROUTE + AREA dest compatibility`). Full
evidence: `spikes/stage3-targeted-route-resolution-2026-09-24/`
(`assessment.md`, `summary.md`, `matrix.json`).

The previous addendum's STOP identified ROUTE acquisition, not identity, as
the failure: Nominatim bare-name search with a soft viewbox and a hard top-5
window never returned the destination's own street for common Argentine
street names. This spike replaced that acquisition strategy for ROUTE
(Nominatim kept only as a control) and, separately, fixed the AREA
single-survivor false positive. **It is characterization only. Nothing was
wired into `ExperienceProposalResolverService` or any production path.**

**Targeted ROUTE results (real local Overpass/Nominatim, real
`DestinationResolutionService` → `osm:relation:1224652`, acquisition radius
17 800 m):**

| Strategy | Mandatory controls with correct CABA street present | False RESOLVED |
| --- | --- | --- |
| Old Nominatim free-form bare name + soft bias | 0 / 6 | 1 (Plaza Dorrego → bus-stop nodes as ROUTE) |
| Nominatim structured `street=`/`city=` control | 2 / 6 | n/a (control) |
| Targeted OSM exact-name highway query + topology clusters + admin compatibility | **6 / 6** | **0** |

- Defensa / Defensa Street: RESOLVED to one 14-way CABA cluster; 8 homonym
  clusters in Lomas de Zamora, La Matanza, and Avellaneda INCOMPATIBLE by
  admin hierarchy.
- Pasaje San Lorenzo / San Lorenzo Passage: the correct San Telmo cluster is
  present; AMBIGUOUS because a second real, disconnected "San Lorenzo"
  footway exists in Flores. No proximity winner.
- Caminito / Caminito Street: RESOLVED to the La Boca `highway=pedestrian`
  way; the Lomas de Zamora homonym is INCOMPATIBLE.
- English glosses needed only the generic designator drop ("Street",
  "Passage"); no per-place alias or translation table.

**AREA destination compatibility:** San Telmo, Recoleta, Monserrat, and
Belgrano RESOLVED (destination admin unit in their `is_in` hierarchy). "San
Martín" (Partido de General San Martín) is now **INCOMPATIBLE**; it was the
previous spike's confident false RESOLVED. La Plata, Villa General Belgrano
(Lanús), Fisherton (Rosario), and Cerro de las Rosas (Córdoba and
Catamarca) are INCOMPATIBLE. Rosario is NOT_FOUND.

**Known non-resolutions (fail-closed, documented, not patched):**
Balcarce/Chile over-split by pure OSM topology into several compatible
clusters (AMBIGUOUS); "Pasaje Giuffra" is NOT_FOUND because its OSM name
tag is "Doctor José M. Giuffra".

**Stage status after this addendum:**

- Stage 3: **IN PROGRESS**. Stage 3 DONE: **NO**.
- Remaining before production integration, per the assessment's proposal:
  canonical identity for a multi-way ROUTE cluster; one owner for the
  destination-scope policy (admin-hierarchy compatibility vs the existing
  polygon containment), plus batching or replacing per-segment `is_in`
  probes; then integration behind catalog reuse as a typed structural
  fact feeding correlation → `IdentityVerifier`, deleting the ROUTE
  `OWN_QID → requireAllTokens:false` workaround and the Nominatim
  bare-name ROUTE path in the same cutover; AREA compatibility in the
  production Nominatim AREA path; then the San Telmo E2E control and the
  Buenos Aires walks COLD/WARM spike. The other outstanding exit items
  (full candidate correlation, broad COLD/WARM evidence, final
  query/performance evidence) are unchanged.
- Stage 4: **BLOCKED**, untouched.

### Stage 3 progress addendum — ROUTE/AREA production cutover + San Telmo E2E, gate NOT met (2026-09-24)

Starting HEAD: `56c5cb163434b5debc33bd93d43e1245ef2b1f25` (verified equal to
the fork remote). Commits:

- `b5f9177` feat(tours): persist canonical multi-way route identities.
- `ac39023` feat(tours): cut over targeted route and destination compatibility.
- `a7e5505` refactor(tours): remove legacy route identity workarounds.
- `3e63838` test(tours): align integration suite with targeted ROUTE path.
- `544f9d7` refactor(osm): remove dead street-pool adapters.

**Canonical ROUTE identity.** One real street is persisted as ONE
`GeoEntity(kind=ROUTE)` plus one `GeoEntityIdentity(openstreetmap,
osm:way:N)` per real way. There is no synthetic cluster identity. The work
is done by `ExperienceCatalogService.upsertGeoEntityWithIdentities`, under
the same per-kind advisory lock as `upsertGeoEntity`:

- if any known identity exists, the call reuses that GeoEntity and
  attaches the missing identities;
- if the known identities belong to 2+ GeoEntities, it returns
  `IDENTITY_CONFLICT` and writes nothing;
- no proximity is used anywhere in this decision.

Geometry is a `MultiLineString` of the real segments. On reuse, lines are
unioned (dedup at OSM 1e-7 precision) and gaps are never bridged. The
representative point is the middle vertex of the longest segment.

Correlation after targeted acquisition is
`findGeoEntityIdsByIdentities(openstreetmap, segmentIds)`: 0 known → new,
1 → reuse, 2+ → fail closed. `IdentityVerifier` judges a typed
`STRUCTURED_ROUTE_RESOLUTION` fact, so the name is never the terminal
authority.

**Catalog-first ROUTE reuse.** For a ROUTE hint, the bounded
`routeRetrievalQueryVariants` are EXACT catalog lookups over the
destination scope. A single compatible match is `CATALOG_REUSE` (typed
`CATALOG_ROUTE_RETRIEVAL_VARIANT_MATCH`); 2+ matches are ambiguous and
lead to targeted acquisition.

**The ROUTE production path is now:**
`CATALOG_REUSE → TARGETED_ROUTE`. The same path is used by component
resolution and by named anchors (`AreaRouteAnchorResolverService`).
Removed:

- the `map_to_area`/`around` street pool and its adapters;
- the Nominatim bare-name ROUTE path (from the spike resolver);
- the `OWN_QID + ROUTE → requireAllTokens:false` workaround.

**Destination scope has a single owner:**
`evaluateDestinationCompatibility` (COMPATIBLE / INCOMPATIBLE / UNKNOWN),
used by:

- AREA (Nominatim, local, catalog, anchor);
- ROUTE clusters and catalog ROUTE rows;
- composite geographic validation's destination-boundary check.

The implementation is containment in the hydrated destination admin
boundary. It was characterized equal to the `is_in` admin-hierarchy
verdict on 60/60 real probes (Defensa, San Lorenzo, Caminito, Galería
Güemes x2, San Martín, La Plata, San Telmo); see
`spikes/stage3-destination-policy-characterization-2026-09-24/`. The cost
drops from 28 s of `is_in` calls to 9 ms, and there are now 0 admin
network calls. UNKNOWN (for example a point-scale destination) is never
treated as compatible.

**San Telmo HTTP E2E (COLD): gate NOT met, STOP.** The run completed in
349.7 s on a fresh DB.

- The Basílica + Defensa control candidate did not recur.
- The extractor produced no ROUTE hint, so there were 0 `TARGETED_ROUTE`
  attempts live.
- The only multi-component candidate reached 5/7 components (Basílica
  RESOLVED) and was rejected by the Stage-2 `isMigrationRequiredHint`
  all-or-nothing seam (`UNRESOLVED_REQUIRED_COMPONENT`: Mafalda Statue
  `NO_OSM_MATCH`, Farmacia la Estrella `UNCONFIRMED_MATCH`).
- Result: 0 composites and 0 ROUTE GeoEntities persisted, 0 duplicate
  identities.
- Per the task, **the Buenos Aires walks mega-spike was not run**. Its
  requests and driver are prepared in
  `spikes/stage3-buenosaires-walks-mega-control-2026-09-24/`.

**Stage 3 exit gate, reviewed literally:**

| Exit item | Evidence | Status |
| --- | --- | --- |
| Catalog reuse without full-table scan | bounded kind + bbox lookup (unchanged); ROUTE variants use the destination bbox | met (unit/query evidence) |
| Unambiguous canonical GeoEntity avoids external calls | unit: ROUTE variant reuse with 0 network | **live WARM not evidenced** |
| Ambiguous catalog → bounded external resolution | unit | met (unit) |
| Correlation and IdentityVerifier separate | strong-identity correlation + typed evidence | met |
| Solar de French prior-knowledge reuse | earlier unit characterization; live COLD only | **live WARM not evidenced** |
| El Zanjón re-tested | live COLD: RESOLVED (LOCAL_OSM_POOL; NOMINATIM + IDENTITY_CONVERGENCE) | met |
| ROUTE identity | real-Postgres 5/5 + unit | **not exercised live** |
| Real COLD/WARM composites | none persisted | **not met** |

**Stage status:**

- Stage 3: **IN PROGRESS**. Stage 3 DONE: **NO**.
- Stage 4: **BLOCKED**, untouched: `isMigrationRequiredHint`, `required`
  columns, the partial-composite lifecycle and planner eligibility were
  not changed.

### Stage 3 progress addendum — PLACE provider cutover + strong-identity convergence (2026-09-25)

Starting HEAD: `9eaf5ec1d9caddba55ccab1e0d5c2774f45f61b3` (verified equal to
the fork remote). Preceding evidence commits: `e6b366d` (PLACE provider
search characterization), `7dff58e`/`2e6d6dc`/`9eaf5ec` (Serper client,
grounded provider, Maps/Places characterization). Commits of this step:

- `52c6da1` fix(integrations): use Geoapify forward geocoding for PLACE search.
- `9424dc5` feat(tours): converge PLACE candidates on strong identities.
- `77de1fa` fix(tours): propagate destination country code to grounded search.
- `c101fea` fix(tours): widen PLACE search window, scope Nominatim PLACE matches.

**PLACE acquisition.** `GeoapifyPlacesApiService.searchText` now calls
`/v1/geocode/search` with the hint as free-form `text` (never structured
fields), no `type`, hard circle `filter` + proximity `bias`, `format=json`;
still no global search without a bias. `result_type`/`category` are
normalized at the adapter into a provider-neutral `PlaceData.featureClass`.
The resolver's PLACES step is: search (hint unchanged, 10-result window —
Geoapify `limit` is not a truncation, `limit=3` dropped the real pharmacy
live) → structural PLACE compatibility (`street`, `administrative_area`,
`postcode`, `transport_stop` are never a PLACE) → the single destination
policy (positively outside → dropped; UNKNOWN drops nothing) → bounded
selection + name multiplicity over the survivors → Place Details for the ONE
selected candidate (capability `declaresSourceIdentitiesInDetails`), whose
explicit `datasource.raw.osm_type/osm_id` and Wikidata QID become
`PlaceData.sourceIdentities`. The opaque `place_id` is never parsed. The
NOMINATIM PLACE branch now applies the same destination policy (it had let
the Ramos Mejía "Galería Güemes" verify as `EXACT_NAME SINGLE`).

**Identity.** `EntityCandidate.identities` is the complete strong identity
set; `provider/externalId` stay the primary acquisition handle and are a
member of it. `IDENTITY_CONVERGENCE` is the exact intersection of identity
sets keyed `namespace/canonicalId` across strategies of one hint and records
the shared identity; no names, coordinates or provider counts. Nominatim
PLACE candidates now use the `openstreetmap` namespace (acquisition strategy
!= identity provider). Multi-identity PLACEs persist through the same
`upsertGeoEntityWithIdentities` authority as ROUTE (0/1/2+ owners → create /
reuse + attach / `IDENTITY_CONFLICT`). No schema migration.

**Country code.** `DestinationResolution.countryCode` →
`ExperienceDiscoveryScope.destinationCountryCode` (one builder for both the
preference-deficit and the planner residual-capacity plan paths) →
`ExperienceAcquisitionPlan.destination` → `executeWebSourcePlan` →
`ExperienceGroundedSearchRequest.destinationCountryCode` → Serper `gl`
(ISO-2 only, never from a free-text country, never `hl`). Trace records
`destinationCountryCode` + `groundedProviderLocale`. Live: `AR` → body
`gl=ar`, Serper echo `gl=ar`, SerpApi 0.

**Live COLD/WARM** (`spikes/stage3-place-cutover-cold-warm-2026-09-25/`,
fresh dedicated DB): Farmacia RESOLVED by
`IDENTITY_CONVERGENCE(NOMINATIM; openstreetmap/osm:node:3348573778)`, one
PLACE GeoEntity (Geoapify handle + OSM identity); Mafalda RESOLVED with the
raw hint (full pipeline: LOCAL_OSM_POOL + own QID; PLACES alone: Geoapify
selects "Mafalda, Susanita and Manolito", details → `osm:node:2472979623` +
`Q111038841`, VERIFIED); Galería Güemes fails closed (Ramos Mejía
`INCOMPATIBLE` in both NOMINATIM and PLACES); Defensa Street never a PLACE
(8/8 `street` rejected); Parque Lezama the park; Recoleta Cemetery the
cemetery (persistence REUSED the Cementerio GeoEntity, attaching its
Geoapify + Wikidata identities). WARM: 11 GeoEntities / 16 identities before
and after — 0 duplicates. Hints whose text equals the canonical name reuse
the catalog with 0 provider calls (7/7, 80–150 ms); name-divergent hints are
re-acquired onto the same GeoEntity.

**Stage 3 exit gate, reviewed literally:**

| Exit item | Evidence | Status |
| --- | --- | --- |
| Catalog reuse without full-table scan | bounded kind + bbox query (unchanged); live WARM 80–150 ms | PASS |
| Unambiguous canonical GeoEntity avoids unnecessary external identity calls | live WARM: 7/7 exact-canonical-name hints + Solar de French → CATALOG_REUSE, 0 provider calls; name-divergent hints (Farmacia, Mafalda, El Zanjón, Recoleta EN) re-acquire 3–9 calls onto the same GeoEntity | PARTIAL — see blocker 1 |
| Ambiguous catalog matches fail closed into bounded external resolution | unit (unchanged); live Güemes fails closed | PASS (catalog); identity ambiguity: see blocker 2 |
| Correlation and IdentityVerifier separate | correlation = exact identity-set intersection producing typed evidence; IdentityVerifier alone decides | PASS |
| Solar de French prior-knowledge reuse, node-vs-relation divergence explicit | live: node `6903962986` and relation `9314953` stay separate; convergence on the relation; WARM CATALOG_REUSE 0 calls | PASS |
| El Zanjón re-tested before corroboration relaxation | live COLD RESOLVED by keyed `IDENTITY_CONVERGENCE`; no relaxation | PASS |
| Farmacia resolved | live COLD by exact OSM identity convergence | PASS |
| Mafalda resolved | live COLD with the raw hint; PLACES path alone also VERIFIED | PASS |
| Progress records tests, performance/query evidence, remaining deficits | this addendum + assessment | PASS |

**Stage status:**

- Stage 3: **IN PROGRESS**. Stage 3 DONE: **NO**. Named blockers:
  1. *Name-divergent WARM reuse* — catalog-first retrieval is exact-name
     only and the schema has no typed fact recording which hint text was
     verified to which GeoEntity. Closing this needs a persisted
     observed-name/alias model (a Prisma migration); per task discipline it
     was **not** added and needs an explicit decision first.
  2. *San Martín negative control* — LOCAL_OSM_POOL observes
     `DECLARED_ALIAS_MATCH(MULTIPLE)`, but IdentityVerifier rule 4 accepts a
     name-only `WIKIDATA_IDENTITY_MATCH(OWN_QID)` before the multiplicity
     fallback, so "San Martín" resolves to the Monumento al General San
     Martín. Pre-existing; the generic rule must be characterized with
     controls before integration.
- Debt: `representativePoint` uses the first polygon of a MultiPolygon as the
  Places/Nominatim bias center; the anchor resolver still labels Nominatim
  anchors with the `nominatim` namespace; `catalog-reuse` integration spec is
  flaky at baseline (planner infeasibility).
- Stage 4: **BLOCKED**, untouched (`required`, `isMigrationRequiredHint`,
  partial-composite lifecycle, planner eligibility).

### Stage 3 progress addendum — verified hint memory closes name-divergent WARM reuse, Stage 3 DONE (2026-09-25)

Starting HEAD: `d1059a7cf786256acff2e9ca2311cac1ec7ab1b9` (verified equal
to the fork remote). Baseline re-verified at that HEAD before any change:
unit 1962/1963 (only `preference-first-architecture.spec.ts`), integration
81/84 (the 3 known failures: 2 × `acquisition-degradation`, 1 ×
`canonical-orchestration`; the `catalog-reuse` flake passed this time).
Commits:

- `6b60add` feat(db): remember verified GeoEntity hint names.
- `3abb70f` feat(tours): reuse GeoEntities by verified hint name.
- `4b64b90` test(tours): prove name-divergent warm catalog reuse.

**Model — verified hint memory, not an alias engine.** `GeoEntity` gains
`verifiedHintNames text[]` (the hint text, verbatim) and
`verifiedHintNameKeys text[]` (its `normalizeGeoName` key — the single
existing normalization), positionally aligned (DB `CHECK` on equal
cardinality), deduplicated by key, GIN-indexed
(`geo_entity_verifiedHintNameKeys_idx`). Migration
`20260925180000_add_geo_entity_verified_hint_names` is additive (empty
defaults, no backfill, no canonical name/identity/metadata rewritten). A
separate table was not needed: the fact belongs to the GeoEntity
aggregate, `text[] @>` is GIN-indexable, and one conditional `UPDATE`
keeps both arrays atomic and idempotent. `GeoEntity.name` stays the
canonical display name. Not globally unique: the same key may live on
several GeoEntities.

**Write path.** `ExperienceProposalResolverService` remembers `hint.name`
only after IdentityVerifier VERIFIED an external resolution and persistence
returned a GeoEntity of the hint's own expected kind — never on
CATALOG_REUSE, REJECTED, AMBIGUOUS, UNCONFIRMED, NO_CANDIDATE,
IDENTITY_CONFLICT or provider failure, never during acquisition.
`ExperienceCatalogService.rememberVerifiedHintName` is one `UPDATE ... SET
both = array_append(...) WHERE id = $id AND NOT ("verifiedHintNameKeys" @>
ARRAY[$key])`: concurrent writers serialize on the row lock and READ
COMMITTED re-evaluates the guard, so no lost update and no duplicate
(12-way concurrent test; a naive read-modify-write fails it). Best-effort:
a failed write is audited (`verifiedHintMemory: FAILED`) and never fails
resolution.

**Read path.** `findGeoEntityCandidatesForHint` = canonical-name matches
(unchanged bounded kind + bbox query) ∪ `SELECT id FROM geo_entity WHERE
"verifiedHintNameKeys" @> ARRAY[$key]::text[] AND kind = $kind AND
latitude/longitude BETWEEN bbox` (`@>`, not `= ANY`, so GIN can serve it),
unioned by id with `matchKind` typed per candidate (canonical wins for the
same row). One verified-hint match → `CATALOG_VERIFIED_HINT_MATCH
(verifiedHintKey, SINGLE)` evidence; IdentityVerifier accepts it like
EXACT_NAME(SINGLE) and returns AMBIGUOUS on MULTIPLE. 2+ in-scope matches
of either kind stay ambiguous and fall through to bounded external
acquisition — never a winner. Catalog (facts/multiplicity), resolver
(orchestration) and IdentityVerifier (authority) stay separate.

**Query evidence.** Real Postgres, 5,001 PLACE rows inside the bbox after
`ANALYZE`: `Bitmap Index Scan on "geo_entity_verifiedHintNameKeys_idx"`
(asserted in the integration spec). The 12-row live DB uses `Index Scan
using geo_entity_latitude_longitude_idx` with `@>` as a filter — bounded,
no sequential scan either way.

**Live COLD/WARM** (`spikes/stage3-verified-hint-memory-cold-warm-2026-09-25/`,
fresh DB, same harness extended): Farmacia la Estrella, Mafalda Statue,
Recoleta Cemetery and El Zanjón de Granados are COLD-resolved and
remembered, then WARM `CATALOG_REUSE` via `VERIFIED_HINT(SINGLE)` onto the
same GeoEntity with **0** Geoapify/Nominatim/Overpass/Wikidata calls
(85–139 ms; previously 17 identity calls, 3.9–7.2 s). The 8 exact-name
regressions (Casa Mínima, Mercado de San Telmo, Plaza Dorrego, Basílica de
San Francisco, Parque Lezama, Cementerio de la Recoleta, Plaza San Martín,
Solar de French) stay `CATALOG_REUSE` / `EXACT_NAME(SINGLE)` / 0 calls.
Galería Güemes fails closed and Defensa Street is never a PLACE — neither
is remembered. GeoEntity 12 / identities 18 / memory entries 13 before and
after WARM. SerpApi, Serper, Google Places: 0.

**San Martín.** "San Martín" is an adversarial bare-name control added by
the harness, not an observed source-backed production hint. Its current
IdentityVerifier behavior (own-QID Wikidata match verifying over
`DECLARED_ALIAS_MATCH(MULTIPLE)`) remains hardening debt and does not block
Stage 3. IdentityVerifier was not changed. Consequence to carry with that
debt: its wrong COLD resolution is now remembered, so WARM reuses it; if the
rule is hardened later, stale memory entries must be cleared (dev data is
disposable).

**Stage 3 exit gate, reviewed literally:**

| Exit item | Evidence | Status |
| --- | --- | --- |
| Catalog reuse works without full-table scan | canonical: bounded kind + bbox; verified hint: kind + bbox + GIN `@>` (EXPLAIN evidence above) | PASS |
| Unambiguous canonical GeoEntity avoids unnecessary external identity calls | live WARM: 12/12 COLD-resolved gated hints (4 name-divergent + 8 exact-name) → CATALOG_REUSE, same GeoEntity, 0 identity calls | PASS |
| Ambiguous catalog matches fail closed into bounded external resolution | unit: verified-hint MULTIPLE and canonical+verified-hint mixes → no winner, external pipeline runs; real Postgres: shared key → both candidates | PASS |
| Candidate correlation and IdentityVerifier remain separate | catalog returns facts + `matchKind`; typed evidence; IdentityVerifier alone decides | PASS |
| Solar de French reuses established canonical knowledge | live COLD convergence on `osm:relation:9314953`; WARM CATALOG_REUSE 0 calls, 167 ms | PASS |
| El Zanjón re-tested | live COLD keyed `IDENTITY_CONVERGENCE`; WARM CATALOG_REUSE via verified hint, 0 calls; no corroboration relaxation | PASS |
| Progress records tests/performance/query evidence and remaining real deficits | this addendum + assessment | PASS |

**Stage status:** Stage 3 **DONE**. Stage 4 **UNBLOCKED** (untouched:
`required`, `isMigrationRequiredHint`, partial-composite lifecycle, planner
eligibility, component geographic relation, CompositeGeographicValidation
cutover). Debt carried, not blocking: San Martín hardening (above);
`representativePoint` uses the first MultiPolygon polygon;
`AreaRouteAnchorResolverService` labels Nominatim anchors with the
`nominatim` namespace; `catalog-reuse` integration flake.

### Stage 4 — Geographic + partial-composite cutover, DONE (2026-09-25)

Starting HEAD: `5a9ec4322a006aa0489625d5bac1202d7cdc8cbb` (verified equal
to the fork remote; no new commits). Baseline re-verified at that HEAD
before any change: unit 1987/1988 (only `preference-first-architecture`),
integration 91/94 on `zigzag_test` (2 × `acquisition-degradation`,
1 × `canonical-orchestration`; `catalog-reuse` passed). Commits:

- `f4d4f81` test(tours): characterize required-driven geographic branches.
- `0307a94` refactor(tours): replace required with structural component
  geography.
- `8bc5ce0` test(tours): verify partial composite planner isolation on
  Postgres.
- progress/assessment: this commit.

**`required` blast radius — every behavioral read, classified.**

| Read (at `5a9ec43`) | Class | Stage 4 outcome |
| --- | --- | --- |
| `isMigrationRequiredHint` (always `true`) in the resolver's whole-candidate gate (`unresolvedRequired`) | A | Replaced by `sourceCompositionComplete` (every source hint RESOLVED); reason `INCOMPLETE_SOURCE_COMPOSITION`. Util deleted. |
| same seam in `dedupeResolvedEntitiesByGeoEntity` (OR-recompute of `required`) | A | Removed; dedupe by canonical GeoEntity kept (existing policy). |
| same seam in CGV `rejectIfExternalScopeViolated`, `tryCanonicalGeometry` (route + area branches), `validateExperience` (venue-centric + unresolved gates) | A | One structural guard first (`incomplete_source_composition`, `missing_coordinates`); strategies run over the full resolved set; area shortcut counts source AREA components; canonical-area membership goes through the policy. |
| `AreaScopeComponentFact.required` filter in `evaluateAreaScopeMembership` | A | Field removed; every component evaluated; typed per-component relations. |
| `ExperienceCatalogService.findVerifiedMultiComponentInArea` passing persisted `required` | A | All persisted components evaluated (with their `GeoEntity.kind`). |
| `findVerifiedMultiComponentByExactComponent` `where: {required: true}` | A | Filter removed: any persisted component matches. |
| `spatial-footprint.util.ts` `required !== false` (planner footprint) | C | Removed: the planner footprint derives from every persisted component of an admitted Experience. Partials never persist, so they never get a footprint. |
| `ComponentResolutionAudit.required` / `TraceComponentHint.required` / FE bitácora "required/optional" label | A (displayed authority) | Removed; trace/bitácora show `identityStatus`. |
| `VerifiedExperienceInput.components[].required` → `ExperienceComponent.required` write | B | No longer written; the column keeps its schema default `true` = "member of the admitted source composition". No reader. |
| `TourExperienceComponent.required` via `tour-experience-snapshot.util.ts` | B | Kept as a pass-through copy of the column (no reader, no authority). Dropping both columns is a follow-up migration, not done here. |
| `DedupeComponentFingerprint.required` (declared, never read) | B→removed | Type field removed. |
| `preference-*` facet `required`, JSON-Schema `required: [...]`, DTO/Swagger `required`, Groq `tool_choice: 'required'`, `requiredEligibleCount` | D | Untouched (unrelated meaning). |

`isMigrationRequiredHint` was a pure Stage-2 migration seam (always
`true`, not legacy-data compat); it is deleted, not preserved.

**Component fact model** (`experience-resolution.interface.ts`,
built by `component-resolution-facts.util.ts`, pure, no provider call):

- identity: `RESOLVED | UNRESOLVED | AMBIGUOUS | CONFLICTED` (conflicted =
  the verified identities are owned by several GeoEntities);
- geography (RESOLVED only): `geoEntityId`, `geoEntityKind`,
  `canonicalGeometry: POINT | LINE | POLYGON | NONE`,
  `geographicRelation: INSIDE | INTERSECTS | OUTSIDE | UNDETERMINED`,
  `distanceToBoundaryMeters` for OUTSIDE points (observability only);
- deficit (non-RESOLVED only): reason `NO_CANDIDATE_ACQUIRED |
  CANDIDATE_UNCONFIRMED | AMBIGUOUS_CANDIDATES | IDENTITY_CONFLICT |
  PROVIDER_FAILURE | DESTINATION_INCOMPATIBLE |
  DESTINATION_COMPATIBILITY_UNKNOWN`, classification `KNOWLEDGE_DEFICIT`
  (only AMBIGUOUS_CANDIDATES) | `OPERATIONAL_FAILURE` (provider) |
  `PENDING_CLASSIFICATION` (everything runtime cannot tell apart from a
  resolver/acquisition defect — never auto-research);
- `sourceOrder` only when the source evidenced a sequence;
- coverage: `totalComponents, identityResolvedComponents,
  geographicallyAcceptedComponents, unresolvedComponents,
  ambiguousComponents, conflictedComponents, resolutionRatio,
  openResearchDeficits, sourceCompositionComplete`;
- relation scope: request validation AREA → destination AREA →
  destination POINT_RADIUS (point components only) → UNAVAILABLE.

Built for every candidate (admitted or not), attached to
`ResolvedExperienceCandidate.componentResolution`, the forensic audit and
the trace. Transient: never persisted, never an admission threshold.

**Geographic policy** (`area-scope-membership-policy.ts`, still the single
authority; no new engine — same `geometryContainsPoint`/orientation
primitives): PLACE point → INSIDE (covered, boundary inclusive) / OUTSIDE
(+measured distance); ROUTE LineString **and MultiLineString** → segment
intersection (INSIDE/INTERSECTS/OUTSIDE), endpoints never decide alone;
AREA polygon → vertex coverage + edge intersection (the scope polygon
itself is INSIDE); ROUTE/AREA without line/polygon geometry →
UNDETERMINED (no centroid approximation; the canonical kind decides, role
only as a fallback). `AREA_CONTAINED` requires every component INSIDE;
`AREA_ANCHORED_ROUTE` requires a LINE entering the area or a non-line
component INSIDE. **Calle Defensa**: a MultiLineString route entering San
Telmo is `LINE / INTERSECTS` and anchors the walk — at `5a9ec43` the
policy did not recognize MultiLineString at all (characterized in
`f4d4f81`). **NEAR is not classified**: it needs a boundary threshold;
Stage 5 must derive it from the recorded distances.

**Composite validation.** Component relations (policy) and composite
coherence (CGV strategies: anchored route, canonical area/route, destination
+ coherence radius) are separate decisions. Deterministic example: Plaza de
Mayo design fixture OUTSIDE + Calle Defensa INTERSECTS + El Zanjón INSIDE →
accepted under `AREA_ANCHORED_ROUTE`, rejected under `AREA_CONTAINED`
(offending: Plaza de Mayo and the only-intersecting street). A found and
fixed inconsistency: under strict containment an INTERSECTS line failed
the decision but was not listed as offending.

**Partial composite.** Source A-B-C-D-E-F, C/E unresolved: A/B/D/F are
RESOLVED with `INSIDE` facts and GeoEntities; C/E are
`UNRESOLVED / NO_CANDIDATE_ACQUIRED / PENDING_CLASSIFICATION` with no
relation; coverage 6 / 4 / geo-accepted 4 / ratio 4/6 /
`sourceCompositionComplete: false`; the candidate is rejected
(`INCOMPLETE_SOURCE_COMPOSITION`) before composite validation. Real
Postgres: 4 GeoEntities, 0 Experience, 0 ExperienceComponent,
`findVerifiedWithin` / `findVerifiedWithinForMatching` (the
planner/facet retrieval boundaries, `status = VERIFIED`) and
`findVerifiedMultiComponentByExactComponent` all empty. Same for an
AMBIGUOUS B (two real exact-name candidates — the only
`KNOWLEDGE_DEFICIT`, listed in `openResearchDeficits`). A later
independently sourced A-B composite reuses the GeoEntities and is the only
Experience. Mutation check: disabling both composition guards turns the
gate red (`accepted` instead of `rejected`).

**Persistence / schema / thresholds.** Complete composites persist exactly
their source-backed membership and evidenced order (two hints converging
on one GeoEntity stay one component — existing canonical policy, no new
rule). Single-PLACE Experiences keep their path (venue-centric
unchanged). No new lifecycle, status, table or durable partial object:
transient facts + trace suffice. **Prisma migration: NO. New thresholds:
NONE** (the POINT_RADIUS relation uses the request's own radius).

**Live control** (`spikes/stage4-partial-composite-live-control-2026-09-25/`):
RW1 San Telmo request, real HTTP path, Serper (SerpApi 0), Geoapify,
local Nominatim/Overpass. COLD 1 (362 s): one 3-hint composite, 3/3
RESOLVED/INSIDE, persisted with exactly 3 components; 9 single-component
candidates stayed explicit `UNRESOLVED / NO_CANDIDATE_ACQUIRED`,
including Pasaje San Lorenzo. WARM (34 s): catalog sufficient, 0
resolution, counts unchanged. COLD 2: one 2-hint composite, 2/2, persisted.
**No source-backed composite with unresolved components was extracted in
either COLD** (extractor variance; the Stage 3 E2E on the same request
got 5/7). Stopped after two COLDs instead of steering the request; the
partial shape is proven deterministically and on real Postgres only.

**Tests.** Unit: new `required-geographic-authority.spec.ts` (7, incl.
required=true/false mutation cases on policy, footprint, warm reuse and
the resolver: identical relations/footprints/coverage),
`component-resolution-facts.util.spec.ts` (8), policy relation matrix
(+13), CGV Stage 4 block (+6); expectations flipped where they encoded
the replaced semantics (CGV reason/audit names, resolver persistence
without `required`, normalizer footprint now includes a legacy
`required:false` component, B5 warm-reuse integration tests). Totals:
unit 2021/2022; integration 95/98 on `zigzag_test`; `tsc --noEmit` clean;
eslint clean on every touched backend file (FE has no eslint config; FE
`tsc` shows only pre-existing `@types/react` duplication errors in
untouched files).

**Baseline failures.** Pre-existing, unchanged: unit
`preference-first-architecture.spec.ts` (`destinationBoundary` in the
resolver); integration 2 × `acquisition-degradation` + 1 ×
`canonical-orchestration` (`tour.executionSummary` undefined; the Tour
itself is built). No new regressions; nothing fixed incidentally;
`catalog-reuse` passed in every run (flake not reproduced).

**Architecture deviations.** None of substance. Small FE touch
(bitácora label + trace contract type) because the backend stopped
emitting `required`. Identity (IdentityVerifier, corroboration, providers,
hint memory) untouched; San Martín untouched.

**Engineering-principles gate.** Provider isolation PASS (no provider
branching added); typed facts PASS (no metadata bags); single geographic
authority PASS (policy evolved, CGV canonical-area check routed through
it); unknown is first-class PASS (UNDETERMINED / PENDING_CLASSIFICATION,
no defaults); migration to one authority PASS (seam deleted, no dual
path); no magic thresholds PASS.

**Stage 4 exit gate, literally:**

| Exit item | Evidence | Status |
| --- | --- | --- |
| No hidden `required` authority in component/composite geography | blast-radius table; mutation tests; seam deleted; only B/D reads remain | PASS |
| Calle Defensa uses the existing route-intersection authority | LineString + MultiLineString fixtures through `evaluateAreaScopeMembership` / `classifyComponentAreaRelation` → LINE/INTERSECTS | PASS |
| Component relations and composite coherence are separate decisions | typed per-component facts vs CGV strategies; OUTSIDE component in an accepted anchored walk | PASS |
| Partial/unresolved state cannot become planner-eligible | real Postgres: 0 rows, empty planner retrieval boundaries; mutation-checked | PASS |
| Source A-B-C-D-E-F cannot persist silently as A-B-D-F | resolver + CGV guards; unit + Postgres | PASS |
| No automatic component → standalone Experience promotion | Postgres: GeoEntities only, 0 Experiences, exact-component lookup empty | PASS |
| Progress records validation and remaining research-only deficits | this addendum; live: all deficits PENDING_CLASSIFICATION, 0 KNOWLEDGE_DEFICIT | PASS |

**Remaining deficits / debt.** Live partial composite not yet observed
(Stage 5 RW1). NEAR threshold (Stage 5, from recorded distances). POINT_
RADIUS relation for LINE/POLYGON components is UNDETERMINED (no rule
yet). `spatial-footprint` still only draws `LineString` routes (a
MultiLineString route falls back to its point) — planner geometry debt.
`required` columns can be dropped by a later migration. Carried from
Stage 3, untouched: San Martín hardening, `representativePoint` first
polygon, anchor `nominatim` namespace, `catalog-reuse` flake. Live side
note: COLD 2's extractor emitted "Calle Defensa" as a PLACE waypoint.

**Stage status:** Stage 4 **DONE**. Stage 5 **UNBLOCKED** (not started).

### Stage 5 — Trace + RW1 verification, DONE (2026-09-25)

Starting HEAD: `94e9cb10e33cbe085511e5ac7cced36db7700aa2` (verified equal to
the fork remote; no new commits). Baseline re-verified at that HEAD: unit
2021/2022 (only `preference-first-architecture`), integration 95/98 on
`zigzag_test` (2 × `acquisition-degradation`, 1 × `canonical-orchestration`;
`catalog-reuse` passed), tsc + eslint clean. Commits:

- `576bbe5` feat(tours): complete component and composite trace fidelity.
- `3097641` fix(tours): report unrecognized extractor envelopes in the trace.
- `d38d4be` feat(tours): explain AMBIGUOUS_DEDUPE in the composite outcome.
- `f2e164c` test(tours): verify RW1 cold warm milestone behavior.
- progress: this commit.

Evidence: `spikes/stage5-rw1-final-verification-2026-09-25/`
(`assessment.md`, `summary.md`, `matrix.json`, per-run traces, provider
counts, DB snapshots, real planner-boundary output).

**Trace contract.** Component: hint + evidence keys, expected role/kind,
every attempt (strategy, provider, query, outcome, selected identity,
convergence/multiplicity evidence, verdict), identity status, GeoEntity id +
kind + canonical geometry, relation (RESOLVED only), deficit reason +
classification. New deficit `CANDIDATE_REJECTED` (IdentityVerifier REJECTED
every acquired candidate: contradicted) separate from `CANDIDATE_UNCONFIRMED`
(not corroborated). Composite (`catalog_materialization.materializationAudit[].compositeOutcome`):
coverage, geographic decision (`NOT_EVALUATED` for an incomplete
composition / `ACCEPTED` / `REJECTED`), persistence (+ dedupe conflict ids
and recorded signals), `plannerEligible`. Summaries name every component
(`C=UNRESOLVED/NO_CANDIDATE_ACQUIRED(PENDING_CLASSIFICATION)`), so a partial
A-B-C-D-E-F keeps C/E visible. FE bitácora renders geography, deficit,
coverage and composite outcome; a rejected candidate is `REJECTED`, not
`UNRESOLVED`. Bounded: no raw payloads or geometry.

**False `NO_OSM_MATCH`.** Stage 1's acquired-then-unconfirmed case stays
`UNCONFIRMED_MATCH` (Case H). A second live-reachable variant was found and
fixed: a hint whose Places/Nominatim provider failed with nothing acquired
ended `NO_OSM_MATCH` while its typed deficit said PROVIDER_FAILURE; it now
ends `PROVIDER_FAILURE`. A candidate with no resolved component lists every
component's distinct reason instead of one precedence-picked reason that
masked AMBIGUOUS/IDENTITY_CONFLICT/provider failure. An unrecognized
extractor envelope is reported (`extractor_envelope_unrecognized`) instead
of reading as an empty answer.

**RW1 (observed).** COLD 1/2/3 + WARM on `576bbe5`, targeted COLD 4 on
`3097641`. Composites extracted: 1, 0, 0, 1 (2 hints each; 2 of 9 web
extraction passes emitted anything; COLD 4 shows a zero pass is a genuine
empty model answer). Both composites 2/2 RESOLVED, INSIDE, CGV
`component_defined` ACCEPTED; COLD 1 persisted (planner-selected), COLD 4
`AMBIGUOUS_DEDUPE` (below). Every live deficit is `NO_CANDIDATE_ACQUIRED /
PENDING_CLASSIFICATION` (0 KNOWLEDGE_DEFICIT). El Zanjón →
`osm:node:9953027884` in all COLDs via two convergence paths, WARM via
verified hint. Solar French → `osm:node:6903962986` in all COLDs; the Stage 3
`osm:relation:9314953` divergence stays explicit. Plaza de Mayo only in
evidence text; Calle Defensa never a ROUTE hint. WARM: 4/4 resolved via
`CATALOG_REUSE`, same GeoEntity and Experience ids, counts unchanged, 0
Geoapify/Wikidata identity calls, 338 s → 65 s. Real `findVerifiedWithin` /
`findVerifiedWithinForMatching` return exactly the PERSISTED outcomes in
every COLD DB. DB integrity: 0 duplicate identities, Experience names or
same-kind hint keys.

**Not observed live** (proof stays deterministic, Stage 4): partial
composite, AMBIGUOUS/CONFLICTED/provider-failed component, OUTSIDE/
INTERSECTS/UNDETERMINED relation, Plaza de Mayo relation, Calle Defensa
ROUTE, POINT_RADIUS, MultiLineString in the planner.

**OPEN FINDING (not fixed).** Experience dedupe (`setOverlap` divides by the
larger set) scores a single venue vs a 2-stop composite containing it at
`componentOverlap = 0.5`, the AMBIGUOUS cutoff: whichever persists second
fails closed. Live: COLD 1 lost a standalone Plaza Dorrego; COLD 4 lost a
complete, CGV-accepted composite. A 3-stop composite is unaffected
(cardinality artifact). Pre-existing Gate 1 policy, contradicts the
amendment's shared-GeoEntity statement; characterized in
`experience-dedupe.util.spec.ts` ("OPEN FINDING"). Changing it is an
Experience-identity policy decision, not Stage 5 work.

**THRESHOLD DECISIONS.** NEAR distance: NOT SELECTED — insufficient
evidence (0 OUTSIDE components live). Partial-resolution ratio: NOT
SELECTED — insufficient evidence (no partial live). Minimum component
count: NOT SELECTED — insufficient evidence.

**Milestone completion gate.**

| Item | Status | Evidence |
| --- | --- | --- |
| Source/composition authority | PASS | Stage 2/4; RW1 composites persisted exactly their source set |
| Source-support admission blocks unsupported components | PASS | Stage 2 Santa Mónica regression; RW1 every live component SUPPORTED (blocking path NOT EXERCISED LIVE) |
| Failure classification separates knowledge/system/source defects | PASS | typed deficits + this stage's trace fixes; live: 0 KNOWLEDGE_DEFICIT, provider failures OPERATIONAL |
| Catalog-first GeoEntity reuse before external re-resolution | PASS | WARM 4/4 CATALOG_REUSE, 0 identity calls; intra-run CATALOG_REUSE in COLD 1 |
| Bounded/index-backed catalog retrieval | PASS | Stage 3 EXPLAIN (unchanged) |
| No automatic component → standalone Experience promotion | PASS | Stage 4 Postgres; COLD 1 composite created no Lezama Experience |
| Provider isolation | PASS | no provider branching added |
| Typed canonical facts | PASS | new trace facts are typed unions; no metadata bags |
| Single candidate-correlation owner | PASS | unchanged |
| Single IdentityVerifier authority | PASS | unchanged; trace only reports its verdicts |
| Single geographic authority | PASS | unchanged |
| No LLM-owned geographic truth | PASS | unchanged |
| No magic thresholds | PASS | none added; dedupe evidence omitted rather than defaulted when absent |
| Embedding document version/reindex after `required` removal | PASS | document v3, no `required`; all live Experiences indexed at v3 |
| Semantic similarity ranking-only | PASS | dedupe "semanticSimilarity" is token overlap; no embedding in identity/geography |
| No provider voting | PASS | convergence = identity equality |
| No new semantic taxonomy | PASS | none |
| Partial state cannot reach planner | PASS (deterministic) / NOT EXERCISED LIVE | Stage 4 Postgres + real planner boundaries = PERSISTED outcomes live |
| Trace explainability, incl. no false NO_OSM_MATCH | PASS | `trace-failure-semantics.spec.ts`; live traces answer every RW1 question |
| RW1 cold/warm evidence | PASS | spike above |
| Tests/typecheck/lint executed | PASS | unit 2041/2042, integration 95/98 (baselines), tsc + eslint clean |

**Engineering-principles gate.** Provider isolation PASS; typed boundaries
PASS; single policy authority PASS (deficit taxonomy owned by
`component-resolution-facts.util.ts`, summaries derived from it); unknown
explicit PASS (no invented dedupe signals, unrecognized extractor shape
reported); migration cutover PASS (no dual path); frontend domain ownership
PASS (FE renders backend facts, no local policy). No Prisma migration.

**Debt.** Dedupe finding above; low extraction yield on walk evidence;
failed identity resolutions re-attempted every run; POINT_RADIUS
ROUTE/AREA relation UNDETERMINED; MultiLineString planner footprint;
`required` columns; San Martín hardening; `catalog-reuse` flake;
`representativePoint` first polygon; anchor `nominatim` namespace.

**Stage status:** Stage 5 **DONE**. Milestone **COMPLETE**, with the Experience
dedupe finding open for a separate policy decision.

### Cross-cutting product-shape note — simple, composite, and mixed Tour requests (2026-09-23)

The current milestone is intentionally focused on making multi-component
Experiences trustworthy, but **single-place Experiences remain a first-class
product shape**. Simple and composite Experiences are not separate Tour
engines: a single Tour request may require either shape or both, and all
verified Experiences converge into the same catalog, composition, and planner
pipeline.

#### Canonical Experience shapes

For acquisition/admission purposes the existing canonical requirements remain:

```text
SINGLE_PLACE
= exactly one distinct, source-backed, meaningful non-area component
  whose expectedKind is PLACE

MULTI_COMPONENT_EXPERIENCE
= at least two distinct, source-backed, meaningful non-area components
```

These describe the **structure of an Experience**, not a Tour type. A Tour may
legitimately contain any sequence such as:

```text
SIMPLE
SIMPLE
COMPOSITE
SIMPLE
COMPOSITE
```

The deterministic daily planner remains downstream of Experience selection and
should continue to plan every selected Experience against the request-specific
dates, opening hours, start point, travel time, pace, and other temporal/spatial
constraints.

#### Natural source responsibilities

The source hierarchy is intentionally different for discovering simple POIs
versus discovering authored multi-component activities/routes.

For a simple request such as:

```text
Buenos Aires
intent: visit
theme: art
```

the intended discovery responsibility is:

```text
Experience catalog
    ↓ coverage deficit
Places-style structured POI discovery
    ↓
Wikivoyage / grounded Web as complementary tourism/editorial evidence
    ↓
ExperienceCandidate(SINGLE_PLACE)
    ↓
component identity/geography resolution:
GeoEntity catalog
→ same-run structured observation reuse
→ local OSM
→ Nominatim
→ Places identity fallback
```

Places is the natural primary cold-discovery source for ordinary physical POIs
because it provides structured place/category/location facts and tourism-quality
signals. OSM/Nominatim are primarily identity/geography authorities in this
flow, not the primary answer to "which art places should a tourist visit?".
Wikivoyage and grounded Web can add tourism/editorial relevance and cover places
that a structured POI query misses. TripAdvisor-like sources, if integrated
later, belong in this discovery/quality layer rather than becoming canonical
geographic identity authorities.

For a composite request such as a wine route, historic walk, gallery circuit,
or other authored multi-stop activity, the intended discovery responsibility is:

```text
Experience catalog
    ↓ coverage deficit
grounded Web / Wikivoyage
    ↓
source-backed multi-component composition
    ↓
per-component resolution
    ↓
GeoEntity catalog first
→ bounded external identity/geography only for unknown components
```

Places can supply or corroborate individual physical components, but it must not
silently invent the semantic composition of a route merely because several POIs
exist near one another.

#### Mixed request semantics

A request can explicitly require both forms. Example:

```text
Destination: Mendoza
theme: wine
intent: route_like   # "ruta del vino"
intent: visit        # "conocer lugares"
```

Conceptually this means two acquisition obligations coexist:

```text
obligation A
facets: theme:wine + intent:route_like
shape: MULTI_COMPONENT_EXPERIENCE

obligation B
facets: theme:wine + intent:visit
shape: SINGLE_PLACE
```

Both obligations contribute Experiences to one common verified catalog/pool;
there are not two independent Tours. Composition should then select a useful mix
and the planner should schedule that mix normally.

Example target portfolio:

```text
COMPOSITE
"Ruta del vino de Luján de Cuyo"
  - Bodega A
  - Bodega B
  - Bodega C

SIMPLE
"Visitar Museo del Vino"

SIMPLE
"Visitar otra bodega / attraction"
```

#### What current code already does

The current preference/acquisition path already has partial support for this
model:

- `deriveAcquisitionEvidenceRequirements()` maps `intent:visit` to
  `SINGLE_PLACE`;
- `intent:walk` / `intent:route_like` map to
  `MULTI_COMPONENT_EXPERIENCE`;
- therefore a mixed `visit + route_like` request produces **both** acquisition
  evidence requirements;
- `candidateSatisfiesEvidenceRequirement()` keeps the simple/composite
  admission rules source-grounded and deterministic;
- `composeSet()` reserves coverage for requested preference facets before
  filling the remainder of the portfolio, so `intent:visit` and
  `intent:route_like` can both influence selection.

#### Known current gaps — measure before redesign

Two current-code limitations are explicitly documented here so the upcoming
spikes can decide whether they require production changes.

**1. Provider coalescing can lose facet conjunction/context.**

`ExperienceAcquisitionPlannerService` currently unions provider capabilities
across deficits. For the Mendoza example:

```text
theme:wine        → Places: winery
intent:visit      → Places: museum, tourist_attraction
intent:route_like → Web/Wikivoyage route-oriented discovery
```

The coalesced Places plan can therefore become approximately:

```text
[winery, museum, tourist_attraction]
```

without preserving that the simple-place obligation was specifically
`wine + visit`. That can over-broaden discovery (for example, any unrelated
museum in Mendoza rather than wine-related places).

Future direction, only if spike evidence justifies it: preserve an explicit
acquisition-obligation/context boundary so provider queries retain the facet
combination and requested Experience shape that caused them.

**2. Final composition covers facets, but does not yet enforce facet × shape.**

`composeSet()` knows that `intent:visit` and `intent:route_like` are
requested facets, but the final selection contract does not currently require:

```text
intent:visit      → covered by at least one SINGLE_PLACE
intent:route_like → covered by at least one MULTI_COMPONENT_EXPERIENCE
```

A sufficiently multi-tagged composite Experience could theoretically satisfy
both facets and leave no standalone place even though the user asked for both
forms. Do not add a new selection rule preemptively; first characterize the
real behavior in mixed spikes.

A related future portfolio concern is **subsumption/redundancy**, not identity
dedupe. If a selected composite wine route already contains Catena and Norton,
automatically adding a simple "Visit Catena" Experience in the same Tour may be
redundant unless that standalone Experience represents independently useful
tourism semantics. The two Experiences are not identity-equal; this is a
composition-quality decision to characterize later.

#### Spike gate for simple/composite/mixed behavior

Before broadening Stage 3 implementation, run the real generation path with at
least these three profiles:

```text
SIMPLE
Buenos Aires + theme:art + intent:visit

COMPOSITE
Mendoza + theme:wine + intent:route_like

MIXED
Mendoza + theme:wine + intent:route_like + intent:visit
```

Run cold/warm variants where useful. Record:

- whether the Tour materializes;
- simple vs multi-component Experiences offered/selected;
- which acquisition sources produced each shape;
- catalog Experience reuse;
- component-level `CATALOG_REUSE`;
- external-call reduction on warm runs;
- whether the mixed request actually selects both Experience forms;
- whether provider coalescing produces off-theme simple places;
- whether simple Experiences duplicate physical content already subsumed by a
  selected composite Experience.

These observations are **not Stage 3 completion blockers by themselves**. They
are an early product checkpoint intended to determine whether the existing
acquisition/composition semantics are already good enough for large-scale
catalog-population spikes or whether one contained shape-mix fix is needed
first.


For each completed stage also record, directly below the table:

- tests/commands actually executed and their real outcome;
- any production behavior discovered that contradicted the plan;
- any architecture deviation (must be `NONE` or explicitly justified);
- whether the next stage is unblocked.

A coding agent must not silently redesign a later stage while executing the
current one. If current code contradicts a canonical invariant, stop and report
the contradiction before broadening scope.

## Constraints

- no San-Telmo-specific production code;
- no provider-majority voting;
- no provider-name branching in domain policy;
- no new closed tourism semantic-type taxonomy;
- no threshold chosen merely to make RW1 pass;
- no weakening source/composition authority;
- no partial research object becomes planner-eligible accidentally;
- evolve existing canonical identity/geographic policies rather than adding
  parallel versions;
- preserve provider cost-control rules;
- component resolution may create/reuse GeoEntities but never auto-promotes
  them into standalone Experiences;
- planner backfill may add independent Experiences to a Tour but never mutates
  source-backed composite membership;
- catalog-first retrieval must be bounded/index-backed and must never load or
  scan the full `GeoEntity` table for application-side name matching.

---

## Stage 1 — Characterization lock

### Goal

Freeze the important current behaviors and failure shapes **before** changing
production semantics. This stage is tests/fixtures/diagnostics only unless a
test harness defect makes a minimal non-behavioral production change necessary.

### Required characterization

Create deterministic fixtures/tests from the RW1 evidence for:

1. **El Zanjón de Granados**
   - multiple acquisition paths converge on the same canonical OSM object;
   - current Wikidata semantics can still reject one path.
2. **Plaza de Mayo acquisition**
   - wrong local candidate is acquired and rejected;
   - characterize why later applicable strategies do or do not run.
3. **Plaza de Mayo geographic design fixture**
   - separate deterministic fixture with a correctly resolved point outside
     the San Telmo polygon but near/connected to the route;
   - do not misrepresent this as the observed RW1 failure.
4. **Calle Defensa**
   - existing ROUTE LineString/polygon intersection behavior.
5. **Pasaje San Lorenzo**
   - unresolved/weak route identity remains explicit.
6. **Divergent candidate clusters**
   - incompatible candidate clusters remain ambiguous.
7. **Basílica de Santa Mónica / ev-11**
   - unsupported extractor component is reproducible as a source-contract
     regression case.
8. **NO_OSM_MATCH fidelity**
   - candidate acquired + identity rejected is distinguishable from no
     candidate acquired.
9. **Solar de French catalog-memory baseline**
   - Stage 1 disproved the earlier cross-cold-run identity-oscillation hypothesis: the same `LOCAL_OSM_POOL` hint resolves the same real `osm:node:6903962986` in the cold runs;
   - preserve instead the actual gap: each empty cold DB persists a fresh Experience because no catalog-first read-side lookup exists yet, while the warm evidence also shows a within-run node-vs-relation divergence worth retaining for later correlation tests.

Also inventory every behaviorally meaningful read of:

- `GeoEntityHint.required`;
- `ExperienceComponent.required`;
- `AreaScopeComponentFact.required`;
- unresolved-required decisions;
- required-driven geographic strategy selection;
- semantic-document `required/optional` serialization.

Group the inventory by **policy behavior**, not merely by filename.

### Failure classification

For every RW1 fixture classify the observed condition as one of:

- `KNOWLEDGE_DEFICIT`;
- provider/operational failure;
- resolver/acquisition defect;
- source-contract violation.

Only the first class may later be handed to the Tourism Researcher.

### Exit gate

Stage 1 is DONE only when:

- characterization tests pass and accurately reproduce the intended baseline;
- the `required` blast radius is documented in tests/plan notes;
- no production behavior has been intentionally changed;
- Progress is updated with the exact test commands and findings.

---

## Stage 2 — Source-grounded contract cutover

### Goal

Remove LLM-owned `required` from discovery/source authority and make source
support deterministic before identity resolution.

### Scope

Change the discovery contract, prompt, JSON schema, normalizer, structured
source synthesis and fixtures so `GeoEntityHint` no longer contains
`required`.

Redefine `MULTI_COMPONENT_EXPERIENCE` admission using source-backed
composition: at least two meaningful non-area geographic components belonging
to the same evidenced Experience.

Add the hard **source-support admission gate**:

- a structured source item explicitly supports/names the component; or
- textual evidence contains a bounded supporting span/claim;
- if the extractor emits a support span, backend code verifies that the span
  actually exists in the cited SourceObservation;
- aliases/translations are identity concerns later, not a reason to weaken
  source grounding.

The Santa Mónica fixture must be rejected **before geographic/provider
acquisition**, even if a real similarly named POI exists.

### Embedding migration in the same cutover

Because the Experience semantic document currently serializes component
`required/optional` state:

- remove those semantic tokens;
- bump `EXPERIENCE_EMBEDDING_DOCUMENT_VERSION` from the current v2 to the
  next version;
- prove stale v2 VERIFIED rows are selected for reindex;
- use the existing version-aware indexer;
- do not add GeoEntity embeddings or a second vector store.

### Exit gate

Stage 2 is DONE only when:

- no LLM-owned `required` remains in the discovery/source contract;
- source-support admission is deterministic and Santa Mónica is blocked;
- semantic-document versioning/reindex behavior is covered;
- obsolete compatibility paths/tests are deleted under the early-stage rule;
- Progress records validation and confirms Stage 3 is unblocked.

---

## Stage 3 — Catalog-first identity resolution

### Goal

Make canonical GeoEntity knowledge the first identity-resolution boundary,
then use external providers only for unresolved/ambiguous deficits.

### Ownership

```text
ExperienceProposalResolverService
        ↓
ExperienceCatalogService.findGeoEntityCandidatesForHint(...)
        ↓
candidate correlation
        ↓
IdentityVerifier
        ↓
bounded external acquisition only if still needed
```

Responsibilities:

- `ExperienceProposalResolverService`: orchestration and continuation;
- `ExperienceCatalogService`: provider-neutral catalog candidate retrieval;
- candidate correlation: deterministic grouping of exact/canonical identity
  observations;
- `IdentityVerifier`: the single final authority for whether a
  candidate/cluster satisfies the hint.

Catalog retrieval/correlation must not become a second fuzzy identity engine.

### Catalog-first behavior

A sufficiently unambiguous match to an already canonical GeoEntity is terminal
success for **component identity resolution**. Do not call OSM/Nominatim/Places/
Wikidata merely to re-prove identity already established in the catalog.

External resolution opens only when catalog knowledge is:

- absent;
- ambiguous;
- positively contradicted;
- missing a fact actually required by the current decision.

Reuse the existing schema before inventing new schema:

- `GeoEntity.kind: GeoEntityKind` already exists;
- name/address/coordinates/geometry are first-class;
- `GeoEntityIdentity(provider, externalId)` owns exact persisted identities.

Do not add a duplicate kind field. A dedicated alias model is not required
unless characterization proves it necessary. *(2026-09-25: characterization
proved name-divergent hints need it; implemented as verified hint memory on
`GeoEntity` itself — `verifiedHintNames`/`verifiedHintNameKeys` text[] +
GIN — written only after a VERIFIED resolution. Not an alias engine.)*

### Query constraint

Catalog retrieval must use a bounded, index-backed candidate query. It MUST NOT
load/scan the full `GeoEntity` table for application-side matching.

The exact SQL/index/schema strategy is an implementation decision. If a schema
or index change is proposed, justify it from the actual query shape and query
plan rather than adding it speculatively.

### Candidate correlation

Correlation may deterministically group observations when they expose the same
canonical identity fact, for example:

- exact persisted provider/external id;
- the same OSM object surfaced through different paths;
- a provider cross-reference to an existing `GeoEntityIdentity`.

When grouping itself is uncertain, keep competing clusters explicit and let
`IdentityVerifier` decide. Never implement provider voting.

### Bounded acquisition continuation

A rejected first candidate is **not** an automatic stop.

Continue through further applicable strategies only while permitted by canonical
cost/budget/stop policy. Do not fan out blindly to every provider. Trace the
reason when acquisition stops.

The Plaza de Mayo fixture must characterize this behavior.

### Wikidata / corroboration sequencing

Do not begin by weakening IdentityVerifier.

First land:

1. source grounding from Stage 2;
2. catalog-first reuse;
3. candidate correlation;
4. bounded continuation.

Then re-test El Zanjón.

Only if genuine unresolved cases remain should this same stage evolve
IdentityVerifier to distinguish:

- sufficient positive evidence;
- corroborated;
- not corroborated / insufficient;
- positively contradicted;
- ambiguous clusters.

Do not add destination exceptions or a fuzzy magic threshold.

### Persistence boundary

Resolving a component creates/reuses a GeoEntity only.

It MUST NOT automatically create a standalone Experience. Existing
`upsertGeoEntity()` / `findNearbyMatchingGeoEntity()` remain the write-time
persistence/reconciliation boundary after identity verification; catalog-first
is the new read-time reuse boundary before provider research.

### Exit gate

Stage 3 is DONE only when:

- catalog reuse works without full-table scan;
- an unambiguous canonical GeoEntity avoids unnecessary external identity calls;
- ambiguous catalog matches fail closed into bounded external resolution;
- candidate correlation and IdentityVerifier remain separate authorities;
- Solar de French reuses sufficiently established canonical prior knowledge
  instead of re-resolving from a blank slate, while the observed within-run
  node-vs-relation divergence stays explicit for correlation/ambiguity handling;
- El Zanjón is re-tested before any corroboration relaxation is accepted;
- Progress records tests, performance/query evidence, and any remaining
  identity deficit.

---

## Stage 4 — Geographic + partial-composite cutover

### Goal

Remove `required` as geographic authority and preserve per-component truth
without silently materializing trimmed Experiences.

### Component geography

Evolve the existing area-scope membership policy as the single authority.

Every evidence-backed component contributes to coverage/research state.

Every **resolved** physical component receives a geographic relation.

Unresolved/ambiguous components remain explicit deficits rather than implicit
geographic failures.

AREA/ROUTE/PLACE strategy selection is based on:

- structural role/kind;
- actual canonical geometry;
- resolution outcome;
- source-backed order/sequence;
- request scope.

For AREA semantics expose typed relations equivalent to:

- INSIDE;
- INTERSECTS;
- NEAR;
- OUTSIDE.

Reuse the existing ROUTE LineString/polygon segment-intersection mechanics. Do
not build a second geometry engine.

### Resolution coverage

Produce an auditable component matrix including at least:

- totalComponents;
- identityResolvedComponents;
- geoAcceptedComponents;
- unresolvedComponents;
- ambiguousComponents;
- resolutionRatio;
- openResearchDeficits.

Do not define canonical X/Y acceptance thresholds yet.

### Composite Geographic Validation

Cut over `CompositeGeographicValidationService` from `required`-driven
strategy selection to resolved structural facts.

Characterize and migrate all affected branches, including:

- `rejectIfExternalScopeViolated`;
- `tryCanonicalGeometry`;
- `validateExperience`.

Treat this as a strategy redesign, not a mechanical field deletion.

### Partial-composite invariant

If source evidence says A-B-C-D-E-F and C/E remain unresolved, do NOT silently
persist A-B-D-F as the same Experience.

A reduced variant requires independent source authority.

Coverage ratio is observability/research-priority evidence only, not
composition authority.

If durable partial-research persistence needs a new lifecycle/schema, stop and
write that design before migrating. A transient/trace-level partial result is
acceptable for this milestone if sufficient for characterization.

### Exit gate

Stage 4 is DONE only when:

- no hidden `required` authority remains in component/composite geography;
- Calle Defensa uses the existing route-intersection authority;
- component relations and composite coherence are separate decisions;
- partial/unresolved state cannot become planner-eligible accidentally;
- no automatic component → standalone Experience promotion exists;
- Progress records validation and remaining research-only deficits.

---

## Stage 5 — Trace + RW1 verification

### Goal

Make the new behavior observable and prove the milestone against the same
real-world corpus before choosing thresholds.

### Bitácora

Per component expose:

- evidence key/source;
- catalog lookup/reuse outcome;
- acquisition attempts;
- candidate identities/clusters;
- canonical convergence/divergence;
- decisive identity evidence;
- not-corroborated vs contradicted;
- component geographic relation;
- final component status;
- research deficit classification.

At composite level expose:

- total/resolved/geo-accepted counts;
- resolution ratio;
- set-level geographic decision;
- planner-eligible vs research-only state.

Fix summary fidelity:

- no candidate acquired;
- provider failed;
- candidate acquired but identity rejected/unconfirmed;
- ambiguous clusters;

must remain distinct. The RW1 false `NO_OSM_MATCH` summary requires a
regression test.

### RW1 rerun

Run fresh cold databases plus a warm rerun of the forensic corpus.

Required analysis:

- number of source-backed composites extracted;
- per-component resolution matrices;
- El Zanjón outcome;
- Plaza de Mayo acquisition continuation;
- deterministic resolved outside-but-near AREA fixture;
- Calle Defensa typed ROUTE/AREA relation;
- Solar de French cross-run stability;
- composites reaching Composite Geographic Validation;
- composite acceptance/rejection reasons;
- false-positive identity cases;
- genuine unresolved knowledge deficits.

Only after this evidence may the team propose:

- partial-resolution ratio X;
- minimum component count Y;
- any generic AREA-boundary NEAR threshold.

Do not reuse Wikidata's existing 200m corroboration-search radius merely because
the number exists.

### Exit gate

Stage 5 is DONE only when:

- RW1 cold/warm evidence is captured and reviewed;
- trace reasons faithfully describe what happened;
- no threshold is selected without observed distributions/counterexamples;
- completion-gate PASS/FAIL is recorded;
- Progress contains the final commit SHA and validation evidence.

---

## Cross-cutting planner/backfill boundary

This milestone preserves the existing separation between composite membership
and Tour completion:

- geographic proximity / Nearby may help discover or resolve candidates;
- it never proves that a new stop belongs to an existing composite;
- planner residual capacity consumes verified catalog/ranked reservoir first;
- bounded targeted acquisition may create additional independent Experiences;
- every new Experience follows the normal evidence/resolution/validation/
  catalog path;
- planner scheduling must not rewrite source-backed composite membership.

Whether a future Tour execution model may interleave an independent Experience
between components of another Experience is a separate planner-model decision
and is not implemented here.

## Explicitly outside this milestone

The Tourism Researcher repair loop is **not Stage 6** of this implementation.

After this milestone is verified, a separate follow-up may consume only genuine
`KNOWLEDGE_DEFICIT` outcomes:

```text
openResearchDeficit
→ bounded research action
→ append observations
→ deterministic re-evaluation
→ verified / exhausted / manual review
```

Provider failures, resolver/acquisition defects, source-contract violations and
misleading summary reasons remain engineering/operational work, not Researcher
tasks.

TripAdvisor/source expansion and planner interleaving also remain follow-up
work unless separately authorized.

## Completion gate

Before declaring the milestone complete, report PASS/FAIL for:

- source/composition authority;
- source-support admission blocks unsupported extracted components;
- failure classification separates knowledge deficits from system/source defects;
- catalog-first GeoEntity reuse before external re-resolution;
- bounded/index-backed catalog retrieval;
- no automatic component → standalone Experience promotion;
- provider isolation;
- typed canonical facts;
- single candidate-correlation owner;
- single IdentityVerifier decision authority;
- single geographic policy authority;
- no LLM-owned geographic truth;
- no magic thresholds;
- embedding semantic-document version bumped/reindexed after `required` removal;
- semantic similarity remains ranking-only;
- no provider voting;
- no new semantic taxonomy;
- partial state cannot reach planner;
- trace explainability, including no false `NO_OSM_MATCH`;
- RW1 cold/warm evidence;
- tests/typecheck/lint actually executed.

A green test suite is necessary but not sufficient if any applicable
architecture check is FAIL.
