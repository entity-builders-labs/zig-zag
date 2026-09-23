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
| 1. Characterization lock | TODO | `7b52367f9da49b965fc503909f855167e54bbda6` | — | — | Freeze current failure shapes before behavior changes. |
| 2. Source-grounded contract cutover | BLOCKED | — | — | — | Starts only after Stage 1 fixtures are trustworthy. |
| 3. Catalog-first identity resolution | BLOCKED | — | — | — | Starts only after Stage 2 source authority is live. |
| 4. Geographic + partial-composite cutover | BLOCKED | — | — | — | Starts after identity outcomes are explicit/stable. |
| 5. Trace + RW1 verification | BLOCKED | — | — | — | Final milestone validation; thresholds only from observed evidence. |

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
9. **Solar de French cross-run stability**
   - the same hint can select different real OSM identities across cold runs;
   - preserve this as a temporal/cross-run stability fixture.

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
- Solar de French cannot silently oscillate when canonical prior knowledge
  already establishes the entity, while genuine conflict stays explicit;
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
