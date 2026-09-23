# Component Resolution + Partial Composite Recovery — Implementation Plan

Status: **architecture reviewed; ready for staged implementation.**
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
| 3. Catalog-first identity resolution | READY | *(this commit)* | — | — | Starts now that Stage 2 source authority is live. |
| 4. Geographic + partial-composite cutover | BLOCKED | — | — | — | Starts after identity outcomes are explicit/stable. |
| 5. Trace + RW1 verification | BLOCKED | — | — | — | Final milestone validation; thresholds only from observed evidence. |

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
unless characterization proves it necessary.

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
