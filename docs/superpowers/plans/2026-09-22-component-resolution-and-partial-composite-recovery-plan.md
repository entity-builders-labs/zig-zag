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
   an entity absent from cited source evidence cannot become a component.

Tests must prove the old behavior first where practical.

## Phase 1 — Remove LLM-owned `required`

Change the discovery contract, prompt, JSON schema, normalizer and fixtures so
`GeoEntityHint` no longer contains `required`.

Redefine `MULTI_COMPONENT_EXPERIENCE` admission using source-backed
composition: at least two meaningful non-area geographic components belonging
to the same evidenced Experience.

Structured-source synthesis must use the same resulting domain contract; do not
retain a hidden second meaning of `required`.

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

Add a provider-neutral correlation step that groups observations believed to
represent the same real-world entity.

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

A unique strong candidate may verify without Wikidata when the canonical
identity policy has sufficient evidence.

Do not introduce destination exceptions or an open-ended fuzzy-score magic
threshold merely to accept El Zanjón.

## Phase 4 — Component geographic relation

Evolve the existing area-scope membership policy as the single authority.

For AREA scopes, expose typed relation facts equivalent to:

- inside;
- intersects;
- near boundary;
- outside.

Implementation names may differ.

Rules:

- PLACE membership uses polygon containment and boundary distance;
- ROUTE membership uses actual geometry/intersection/corridor semantics;
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
- Plaza de Mayo AREA relation;
- Calle Defensa ROUTE relation;
- how many composites reach Composite Geographic Validation;
- composite acceptance/rejection reasons;
- false-positive identity cases;
- unresolved deficits.

Only after this rerun propose:

- partial-resolution ratio X;
- minimum component count Y;
- any generic NEAR threshold not already owned by a canonical primitive.

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

Examples include unresolved aliases, address confirmation, official-site
identity, provider ambiguity and missing composition facts.

The LLM may decide what to investigate; it never declares geographic identity
truth.

TripAdvisor can enter as a source-aware composite evidence capability under the
same authority model, but is not required to complete the component-resolution
cutover.

## Completion gate

Before declaring this milestone complete, report PASS/FAIL for:

- source/composition authority;
- catalog-first GeoEntity reuse before external re-resolution;
- no automatic component → standalone Experience promotion;
- provider isolation;
- typed canonical facts;
- single identity policy authority;
- single geographic policy authority;
- no LLM-owned geographic truth;
- no magic thresholds;
- embedding semantic-document version bumped/reindexed after `required` removal;
- semantic similarity remains ranking-only, never identity/coverage authority;
- no provider voting;
- no new semantic taxonomy;
- partial state cannot reach planner;
- trace explainability;
- RW1 cold/warm evidence;
- tests/typecheck/lint actually executed.

A green test suite is not sufficient if any applicable architecture check is
FAIL.
