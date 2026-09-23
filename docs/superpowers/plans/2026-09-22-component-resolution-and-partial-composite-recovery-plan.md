# Component Resolution + Partial Composite Recovery — Implementation Plan

Status: **proposed implementation plan; docs-only; not authorization to implement.**
Written: 2026-09-22.
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

No production work should begin until the amendment and this plan have received
independent architectural review.

## Constraints

- no San-Telmo-specific code;
- no provider-majority voting;
- no provider-name branching in domain policy;
- no new closed tourism semantic-type taxonomy;
- no threshold chosen merely to make RW1 pass;
- no weakening source/composition authority;
- no partial research object becomes planner-eligible accidentally;
- evolve existing canonical identity/geographic policies rather than adding
  parallel versions;
- preserve provider cost-control rules;
- component resolution may create/reuse GeoEntities but never auto-promotes them into standalone Experiences;
- planner backfill may add independent Experiences to a Tour but never mutates source-backed composite membership.

## Phase 0 — Characterization tests before behavior changes

Create deterministic fixtures from real RW1 failure shapes, including:

1. El Zanjón:
   hint `El Zanjón de Granados`; OSM/Nominatim/Places paths converge to the
   same canonical OSM object; Wikidata does not fully corroborate.
2. Plaza de Mayo:
   evidence-backed route component outside the San Telmo polygon but near its
   boundary and connected by the walk.
3. Calle Defensa:
   ROUTE LineString intersects the San Telmo AREA.
4. Pasaje San Lorenzo:
   unresolved/weak route identity remains an explicit deficit.
5. divergent-provider case:
   two candidate clusters that cannot be safely correlated remain AMBIGUOUS.
6. extractor hallucination:
   reproduce cold-2's `Basílica de Santa Mónica` / `ev-11` shape and prove
   that a component unsupported by its cited source is rejected **before**
   geographic acquisition, even if a real similarly named POI exists.
7. summary-reason fidelity:
   reproduce "candidate(s) acquired but identity rejected" and prove the
   proposal-level reason cannot degrade to `NO_OSM_MATCH`.
8. Plaza de Mayo acquisition:
   characterize why the observed RW1 path stopped after the wrong Plaza
   Dorrego candidate instead of continuing through every *applicable,
   policy-permitted* acquisition strategy.
9. Solar de French cross-run stability:
   replay the same component hint against the cold-run evidence where
   `EXACT_NAME+SINGLE` selected different real OSM identities across runs.
   Characterize this as temporal/cross-run identity instability, prove that
   canonical prior GeoEntity knowledge is reused when sufficiently established,
   and prove that conflicting new evidence produces ambiguity/research rather
   than silently oscillating the canonical identity.

For each RW1 failure fixture, classify the observed failure before changing
behavior:

- genuine `KNOWLEDGE_DEFICIT`;
- provider/operational failure;
- resolver/acquisition defect;
- source-contract violation.

Only genuine knowledge deficits are eligible for the future Researcher.

Tests must prove the old behavior first where practical.

## Phase 1 — Remove LLM-owned `required`

Change the discovery contract, prompt, JSON schema, normalizer and fixtures so
`GeoEntityHint` no longer contains `required`.

Redefine `MULTI_COMPONENT_EXPERIENCE` admission using source-backed
composition: at least two meaningful non-area geographic components belonging
to the same evidenced Experience.

Structured-source synthesis must use the same resulting domain contract; do not
retain a hidden second meaning of `required`.

At the same extraction/normalization boundary, add a hard **source-support
admission gate**. Every component must point to verifiable support in its cited
SourceObservation (structured item or bounded textual support span). If a
support span is emitted by the extractor, validate that it is actually present
in the cited evidence record. Do not implement this as a naive fuzzy
name-token overlap rule: aliases/translations belong to identity resolution,
while this gate answers only "did this source actually originate this
component?".

Phase 3 identity-leniency changes are blocked until this gate has
characterization coverage, including the Santa Mónica regression.

Delete superseded tests/compatibility code under the early-stage deletion rule.


Because `buildExperienceSemanticDocument()` currently serializes component
`required/optional` state, this contract removal is also an embedding-index
migration:

- remove those tokens from the canonical Experience semantic document;
- bump `EXPERIENCE_EMBEDDING_DOCUMENT_VERSION` (current implementation: v2)
  to a new version;
- add tests proving stale v2 rows are selected for reindex;
- reindex VERIFIED Experiences through the existing version-aware indexer;
- do not add a second vector store or GeoEntity embedding table for this fix.

## Phase 2 — Catalog-first GeoEntity resolution + candidate observations

Before external provider acquisition, add one canonical provider-neutral lookup
against accumulated GeoEntity knowledge.

Concrete ownership:

- `ExperienceProposalResolverService` orchestrates catalog-first lookup at the
  start of component resolution and decides whether external acquisition is
  still required;
- `ExperienceCatalogService` exposes one provider-neutral read-side method
  conceptually equivalent to `findGeoEntityCandidatesForHint(...)`;
- that catalog method returns candidate facts only and MUST NOT make the final
  hint-identity decision;
- candidate correlation groups exact/canonical identity observations;
- `IdentityVerifier` remains the one final authority for whether a candidate
  cluster satisfies the hint.

Reuse existing schema facts before adding schema:

- `GeoEntity.kind` already exists as typed `GeoEntityKind`
  (`PLACE | AREA | ROUTE`);
- `name`, `address`, coordinates and geometry are first-class;
- `GeoEntityIdentity(provider, externalId)` already owns persisted exact
  provider identities.

Do not introduce another typed kind in metadata or a migration for it.
A dedicated alias model is not a prerequisite for the first fail-closed
catalog-first implementation: ambiguous name-only matches continue to external
resolution. Characterization must justify any future alias schema.

Also preserve the distinction between existing write-time reconciliation and
the new read-time reuse path. `upsertGeoEntity()` /
`findNearbyMatchingGeoEntity()` already reduce duplicate rows **after a
provider candidate has been verified and has coordinates**. They cannot replace
catalog-first lookup for a hint that is being resolved before those provider
facts exist.

Implementation constraint: catalog-first retrieval must use a bounded,
index-backed candidate query and MUST NOT load/scan the full `GeoEntity` table
for application-side name matching. The exact SQL/index/schema strategy is an
implementation decision for Phase 2 and should be justified from the existing
schema and query plan rather than prescribed here.

For each component hint:

1. attempt to match an existing canonical GeoEntity using the same identity
   facts/policies that make external candidates comparable;
2. reuse it when identity is unambiguous, structurally compatible and not
   positively contradicted;
3. when catalog knowledge is insufficient/ambiguous/stale, open a precise
   deficit and continue with bounded external acquisition;
4. correlate external observations with the existing canonical candidate rather
   than treating the request as a blank-slate identity problem;
5. persist/reconcile the final GeoEntity through the existing catalog boundary.

Catalog reuse is not a provider vote and must not become "name looks similar,
therefore trust DB".

Resolving a component in this phase creates/reuses a GeoEntity only. It must
not synthesize a standalone Experience unless acquisition/discovery separately
originated that Experience from tourism evidence.

Extend the canonical resolution contract so each component can retain the typed
facts required to explain:

- acquisition strategy;
- provider identity/external id;
- canonical cross-reference when available;
- selected candidate;
- name/alias/address evidence;
- coordinates/geometry;
- outcome.

Add one canonical provider-neutral **candidate-correlation stage** adjacent to
the resolver. Its job is normalization/grouping of observations, not final
hint verification. It may deterministically collapse observations when they
share a canonical identity key/cross-reference (for example the same OSM
object or an existing GeoEntity identity). The existing IdentityVerifier
remains the one authority that decides whether the resulting candidate/cluster
actually satisfies the component hint.

Do not create a second fuzzy identity engine inside correlation. If grouping
requires uncertain name/address/coordinate inference, surface the competing
clusters/evidence to IdentityVerifier instead of silently merging them.

Define bounded acquisition continuation explicitly. Providers do **not** all
need to run on every hint (cost policy still applies), but "first candidate was
identity-rejected" must not silently terminate further applicable strategies
unless a canonical stop/budget rule says so. Trace the stop reason. Characterize
the Plaza de Mayo RW1 path as part of this work.

It must not implement vote counts such as "two providers beat one".

## Phase 3 — Correct identity corroboration semantics

Evolve the single canonical IdentityVerifier/evidence contracts.

Required distinctions:

- sufficient positive identity evidence;
- corroborated;
- not corroborated / insufficient;
- positively contradicted;
- ambiguous competing candidate clusters.

Review the 2026-09-17 Wikidata gate. A failed/non-matching nearby Wikidata
lookup must not automatically become positive contradiction.

This phase runs only after catalog-first reuse/candidate correlation and the
source-support gate are characterized. Re-test El Zanjón first: if exact
canonical-object correlation already resolves it, do not weaken unrelated
identity cases merely to reproduce that success.

A remaining unique strong candidate may verify without Wikidata only when the
canonical IdentityVerifier has sufficient positive evidence after ambiguity
and contradiction checks. "One source can be enough" is not a blanket bypass.

Do not introduce destination exceptions or an open-ended fuzzy-score magic
threshold merely to accept El Zanjón.

## Phase 4 — Component geographic relation

Evolve the existing area-scope membership policy as the single authority.

This phase has an explicit dependency on Phase 1: the current
`AreaScopeComponentFact.required` filter/zero-required behavior must be
removed/redefined. The replacement rule is structural and resolution-based:

- every evidence-backed component contributes to coverage/research state;
- every **resolved** physical component participates in component-geographic
  relation evaluation;
- unresolved/ambiguous components remain deficits rather than being converted
  into implicit geographic failures;
- AREA/ROUTE/venue strategy selection is driven by canonical structural
  roles/kinds and available geometry, not an LLM-authored required bit.

For AREA scopes, expose typed relation facts equivalent to:

- inside;
- intersects;
- near boundary;
- outside.

Implementation names may differ.

Rules:

- PLACE membership uses polygon containment and boundary distance;
- ROUTE membership reuses the existing LineString/polygon segment-intersection
  mechanics and exposes the result as typed relation evidence; do not
  reimplement geometry math in a parallel policy;
- POINT_RADIUS keeps center/radius semantics;
- NEAR is evidence, not standalone acceptance;
- the area centroid is not the main membership primitive for real AREA scopes.

Record component geographic facts in the forensic trace.

## Phase 5 — Resolution coverage result

Replace proposal-level "one unresolved required component kills everything"
with a component matrix.

At minimum produce:

- totalComponents;
- identityResolvedComponents;
- geoAcceptedComponents;
- unresolvedComponents;
- ambiguousComponents;
- resolutionRatio;
- openResearchDeficits.

Do not define canonical X/Y thresholds in this phase.

Define clearly which result is research-only versus planner-eligible.

If persistence of partial research state requires a new DB model, stop and
write the schema/lifecycle design before migrating. A transient/trace-level
research result may be enough for the first characterization rerun.

## Phase 6 — Composite Geographic Validation without `required`

Update `CompositeGeographicValidationService` so it consumes resolved component
facts rather than LLM `required` flags.

Treat this as a strategy redesign, not a mechanical field deletion. Today
`required` influences multiple paths, including external-scope rejection,
canonical geometry shortcuts and generic/venue-centric Experience validation
(`rejectIfExternalScopeViolated`, `tryCanonicalGeometry`,
`validateExperience`). Characterize and cut over each branch so no hidden
`required` authority survives.

Strategy selection after cutover must be based on canonical structural facts
(AREA/ROUTE/PLACE roles/kinds, canonical geometry, source-backed sequence) plus
resolved component outcomes. Unresolved components remain explicit research
deficits and may limit planner eligibility, but they no longer choose the
geographic strategy by virtue of an LLM boolean.

Preserve its role as the single authority for set-level spatial coherence.

It should reason about:

- area anchoring;
- route geometry/corridor;
- component coherence;
- evidence-backed sequence where applicable;
- outside-but-near components only when the composite relation justifies them.

Remove obsolete `unresolved_required_component` semantics after cutover; do not
leave two decision paths.

## Phase 7 — Bitácora

Update trace contracts/rendering to expose, per component:

- evidence key/source;
- attempts;
- candidate identities;
- canonical convergence/divergence;
- decisive identity evidence;
- not-corroborated vs contradicted;
- component geographic relation;
- final component status;
- research deficit.

At composite level expose counts, ratio and set-level geographic outcome.

Fix summary-reason fidelity in the same cutover: "no provider candidate" and
"candidate acquired but identity rejected/unconfirmed" are distinct outcomes.
The RW1 `NO_OSM_MATCH` mis-summary must have a regression test.

Geometry payload-size invariants remain unchanged.

## Cross-cutting planner/backfill boundary

This milestone must preserve the distinction between composite membership and
Tour completion:

- geographic proximity / Nearby may help discover or resolve candidates;
- it never proves that a new stop belongs to an existing composite;
- after planning, meaningful residual capacity first consumes the verified
  catalog/ranked reservoir;
- if that is insufficient, bounded targeted acquisition may produce additional
  independent Experiences;
- any new Experience follows the full evidence/resolution/validation/catalog
  path before replanning;
- planner scheduling must not rewrite the source-backed membership of a
  composite.

Whether future Tour execution may interleave a standalone Experience between
components of another Experience while preserving precedence/continuity is a
separate planner-model decision and is not implemented by this milestone.

## Phase 8 — Rerun RW1 before setting thresholds

Run the same forensic corpus with fresh cold databases and a warm rerun.

Required analysis:

- how many real source-backed composites are extracted;
- per-component resolution matrices;
- El Zanjón outcome;
- Plaza de Mayo acquisition/fan-out outcome;
- a deterministic **resolved** outside-but-near AREA fixture for the Plaza-de-
  Mayo-style design scenario;
- Calle Defensa typed ROUTE/AREA relation using the existing intersection math;
- how many composites reach Composite Geographic Validation;
- composite acceptance/rejection reasons;
- false-positive identity cases;
- unresolved deficits.

Only after this rerun propose:

- partial-resolution ratio X;
- minimum component count Y;
- any generic AREA-boundary NEAR threshold not already owned by a canonical
  primitive. Do not reuse Wikidata's existing 200m confirmation-search radius
  merely because the number exists.

The proposal must use observed distributions and counterexamples, not one
successful fixture.

## Phase 9 — Targeted research repair loop

Only after Phases 0–8 are characterized, add the Tourism Researcher repair loop:

```text
openResearchDeficit
→ choose bounded next research action
→ collect source/provider observation
→ append evidence
→ deterministic re-evaluation
→ verified / exhausted / manual-review
```

Only `KNOWLEDGE_DEFICIT` outcomes may enter this loop. Provider failures,
resolver/acquisition defects, source-support violations and misleading summary
reasons are deterministic/engineering repair work, not "research".

Examples of legitimate research include unresolved aliases after normal
resolution succeeds, genuine same-name ambiguity, address/official-site
identity confirmation, competing plausible candidate clusters and missing
composition facts.

The LLM may decide what to investigate; it never declares geographic identity
truth.

TripAdvisor can enter as a source-aware composite evidence capability under the
same authority model, but is not required to complete the component-resolution
cutover.

## Completion gate

Before declaring this milestone complete, report PASS/FAIL for:

- source/composition authority;
- source-support admission gate blocks unsupported extracted components;
- RW1 failures classified as knowledge deficits vs provider/resolver/source defects;
- catalog-first GeoEntity reuse before external re-resolution;
- no automatic component → standalone Experience promotion;
- provider isolation;
- typed canonical facts;
- single candidate-correlation owner and single IdentityVerifier decision authority;
- single geographic policy authority;
- no LLM-owned geographic truth;
- no magic thresholds;
- embedding semantic-document version bumped/reindexed after `required` removal;
- semantic similarity remains ranking-only, never identity/coverage authority;
- no provider voting;
- no new semantic taxonomy;
- partial state cannot reach planner;
- trace explainability, including no false NO_OSM_MATCH summary after identity rejection;
- RW1 cold/warm evidence;
- tests/typecheck/lint actually executed.

A green test suite is not sufficient if any applicable architecture check is
FAIL.
