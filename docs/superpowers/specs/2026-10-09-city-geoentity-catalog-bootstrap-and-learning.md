# City GeoEntity Catalog Bootstrap and Learning — Durable Contract

Status: **PROPOSED / DEFERRED / NOT IMPLEMENTATION AUTHORITY**  
Created: 2026-10-09  
Related plan: `docs/superpowers/plans/2026-10-09-city-geoentity-catalog-bootstrap.md`  
Roadmap: `docs/superpowers/plans/2026-09-09-travel-content-agentic-planning-convergence-roadmap.md`

This specification defines durable domain and architecture invariants for future
city/destination catalog bootstrap and catalog learning.

It does **not** activate an execution track, authorize implementation, or block
the current Preference-First merge reconciliation.

## 1. Domain separation

The system must preserve the distinction:

```text
GeoEntity
= canonical knowledge that a real-world entity/place exists

Experience
= canonical knowledge that a traveler can do, visit, consume or participate in
  something
```

A GeoEntity may support:

```text
zero Experiences
one Experience
many Experiences
```

Therefore:

```text
GeoEntity existence != Experience existence
```

and:

```text
GeoEntity bootstrap must not imply blanket Experience creation.
```

Examples:

- a museum, market or landmark may be both a GeoEntity and support one or more
  traveler-facing Experiences;
- an ATM, office, utility facility or arbitrary building may be a valid
  GeoEntity while supporting no traveler-facing Experience;
- the same place may support multiple Experiences with different traveler
  semantics.

## 2. City onboarding authority

When a city/destination is onboarded, Zig-Zag may proactively discover and
populate GeoEntity knowledge across the destination.

The onboarding objective is:

```text
broad identity-bearing destination knowledge
```

not:

```text
precompute every possible Experience
```

The bootstrap must resolve destination geography through the canonical
geographic boundary before treating discovered records as in-scope knowledge.

Provider records are evidence about possible entities. A provider record is not
automatically a canonical GeoEntity.

Cross-provider reconciliation must be explicit, idempotent and evidence-backed.

## 3. Canonical GeoEntity knowledge

A canonical GeoEntity may accumulate reusable facts including:

- canonical name;
- typed aliases;
- translations and locale-specific names;
- historical or informal names;
- abbreviations;
- provider identifiers;
- OSM identifiers;
- Wikidata identifiers;
- coordinates / geometry;
- address/locality;
- physical kind/category;
- provenance;
- freshness/reverification metadata;
- human-administration state where applicable.

The catalog must preserve enough provenance to explain which source or decision
established each correctness-relevant fact.

No provider, LLM or translation model is automatically an identity authority.

## 4. Alias and translation authority

Aliases and translations are durable identity knowledge and must be typed and
provenanced.

The model must be able to distinguish at least the semantic states:

```text
OBSERVED_ALIAS
AUTOMATICALLY_CONFIRMED_ALIAS
HUMAN_CONFIRMED_ALIAS
REVOKED_ALIAS
```

Equivalent names may include, when evidence supports them:

- official alternate names;
- historical names;
- abbreviations;
- multilingual names;
- source-specific canonical renderings;
- translations.

But:

```text
generated translation != confirmed alias
lexical similarity != confirmed alias
repeated retrieval result != confirmed alias
```

An LLM/provider-generated alias or translation is a proposal until canonical
evidence or human confirmation establishes the association.

A revoked alias must cease to act as positive identity authority without
requiring deletion of the underlying GeoEntity.

## 5. Identity authority and unknown-state invariant

City bootstrap does not weaken the existing identity contract.

Canonical invariant:

```text
retrieval similarity may retrieve;
it never proves identity.
```

and:

```text
unknown remains unknown.
```

Therefore a runtime or bootstrap candidate that lacks sufficient identity
evidence must remain unresolved / insufficient rather than being attached to a
merely plausible GeoEntity.

The future catalog may improve recall by carrying stronger prior knowledge, but
it must not retroactively legitimize weak automatic identity rules.

Human-confirmed catalog knowledge may be stronger evidence than runtime
heuristics because the association itself is a durable administered fact.

## 6. Human administration / backoffice

Backoffice is part of the canonical knowledge lifecycle.

The domain must support auditable administrative actions such as:

```text
CONFIRM identity
REVOKE identity
MERGE duplicate GeoEntities
SPLIT incorrectly merged GeoEntities
ADD alias
CONFIRM alias
REVOKE alias
correct canonical fields
review unresolved learning proposals
```

Administrative actions must be durable, attributable and replay-safe.

A later automatic bootstrap/re-enrichment run must not silently overwrite a
human-confirmed correction with weaker provider evidence.

A human-confirmed alias/identity may become reusable decisive catalog knowledge
for future matching.

## 7. Simple Experience bootstrap

A destination may bootstrap a conservative set of simple Experiences from
tourism-relevant GeoEntities.

This requires a separate experience-worthiness/product policy.

The following implication is forbidden:

```text
GeoEntity exists
→ therefore create Experience
```

The allowed conceptual flow is:

```text
GeoEntity
+ traveler-facing eligibility/product evidence
→ candidate simple Experience
→ normal Experience validation/persistence semantics
```

Likely tourism-relevant classes may include museums, landmarks, parks, markets,
viewpoints, attractions and historic sites, but no category list in this spec is
an automatic acceptance whitelist.

The implementation must demonstrate that non-tourism GeoEntities do not become
Experiences merely because they were discovered during city bootstrap.

## 8. Composite and source-defined Experiences

Composite Experiences remain primarily evidence-defined and demand-driven.

The city bootstrap must not manufacture route/walk/theme compositions from
mere geographic proximity or from the combinatorial set of available
GeoEntities.

Canonical flow remains:

```text
source/evidence-defined composition
→ resolve members against canonical GeoEntities
→ geographic/product validation
→ Experience identity/dedupe
→ reconciliation
→ persistence
```

A future authoritative source may justify preloading a bounded composite
Experience, but the same evidence and validation contracts still apply.

No city bootstrap shortcut may bypass composition evidence.

## 9. Runtime catalog-first identity

Tour generation should prefer already-established catalog knowledge.

Conceptual order:

```text
source member
→ canonical catalog lookup
→ confirmed name / alias / translation match if available
→ otherwise runtime resolver
```

A catalog miss is not proof that an entity does not exist.

A runtime resolver miss or `INSUFFICIENT_EVIDENCE` is a valid outcome.

Correct-but-unproven members may remain unresolved until additional evidence or
human confirmation is available.

## 10. Runtime learning loop

Runtime discovery may propose new reusable knowledge.

Conceptual flow:

```text
catalog miss
→ runtime evidence collection
→ identity decision
→ typed learning proposal
→ canonical automatic acceptance under strong evidence
   OR
→ backoffice review
```

The learning loop must preserve the evidence strength that justified the
assertion.

Not every runtime `VERIFIED` decision necessarily has the same future catalog
authority. The future model must be able to retain enough provenance/decision
strength to avoid silently promoting weak evidence into permanent
discriminating truth.

This is the durable home for the current verified-hint provenance concern.

## 11. Persistence and reconciliation invariants

Catalog bootstrap and learning must be:

- idempotent across reruns;
- deterministic at deterministic-core boundaries;
- correction-aware;
- provenance-preserving;
- merge/revoke aware;
- resistant to downgrade from stronger to weaker knowledge.

A later observation must not silently:

- remove a human-confirmed alias;
- replace a canonical identifier with a weaker conflicting one;
- merge two entities merely because their names are similar;
- split a confirmed entity because one provider temporarily omits an ID.

Conflicts must fail closed or enter an explicit review/correction path.

## 12. Freshness and reverification

Destination knowledge is cumulative but not eternally immutable.

The catalog architecture must allow explicit freshness and reverification
policies for facts that can change.

Identity facts, aliases, provider IDs, operational facts and traveler-facing
Experience facts may have different freshness semantics.

A provider outage or missing record must never be interpreted automatically as
negative identity knowledge.

## 13. Relationship to Preference-First

This spec does not reopen accepted Preference-First architecture.

Preference-First remains responsible for the current canonical runtime path:

```text
evidence
→ resolve
→ validate
→ classify
→ dedupe
→ persist
→ re-read
→ plan
```

City bootstrap adds reusable prior catalog knowledge; it does not create a
second privileged generation authority.

The current identity blocker `RW4-ID-FALSE-VERIFY-2` must be corrected on its
own merits. Future bootstrap/backoffice is not justification for preserving a
false automatic `VERIFIED`.

## 14. Motivating examples are not special cases

Examples such as:

- El Zanjón de Granados;
- Farmacia la Estrella;
- Museo Nacional del Cabildo;
- translated/source-rendered names such as National Bank;

motivate the need for durable aliases and curated destination knowledge.

They do not authorize:

- destination-specific rules;
- name-specific exceptions;
- stopword dictionaries as identity truth;
- arbitrary similarity thresholds;
- provider-specific privileged identity decisions.

The architecture must generalize beyond these examples.

## 15. Observability and audit

Bootstrap and learning operations must expose enough audit information to
answer:

- what candidate record was observed?
- from which provider/source?
- what canonical GeoEntity was proposed?
- what evidence established correspondence?
- what alias/translation was proposed or confirmed?
- what decision accepted/rejected it?
- was a human involved?
- what previous knowledge was preserved/revoked/merged?
- which downstream simple Experience, if any, was derived?

Audit is explanatory evidence, not a hidden policy API.

## 16. Acceptance invariants

A future implementation cannot be accepted unless it proves at minimum:

1. Re-running the same city bootstrap is idempotent.
2. Cross-provider duplicates reconcile without name-only merging.
3. Confirmed aliases/translations resolve representative source wordings.
4. Unconfirmed generated aliases do not become identity truth.
5. Human corrections survive later automated refreshes.
6. GeoEntity existence does not automatically create an Experience.
7. A conservative simple-Experience seed set can be produced from
   traveler-relevant GeoEntities.
8. Composite Experiences are not manufactured from proximity.
9. Runtime catalog misses can remain `INSUFFICIENT_EVIDENCE`.
10. Runtime learning can propose knowledge without bypassing canonical
    verification/backoffice authority.
11. Revoked aliases/identities stop deciding future matches.
12. Catalog bootstrap reduces repeated identity acquisition without introducing
    a parallel identity authority.

## 17. Non-goals

This spec does not define:

- exact provider mix;
- exact city sweep size;
- arbitrary coverage percentages;
- exact confidence thresholds;
- exact taxonomy of tourism-relevant entity classes;
- exact backoffice UI;
- exact scheduling/worker infrastructure;
- exact LLM/provider choices;
- exact vector/embedding strategy;
- bulk composite Experience precomputation.

Those belong to characterization, implementation planning or later focused
specifications where evidence is available.

## 18. Activation boundary

This spec is a durable intended contract, not authorization to execute it.

Execution requires an explicit owner decision and an ACTIVE track with its own
branch/worktree, progress document and plan milestone.

Until then:

```text
Status = PROPOSED / DEFERRED
Current Preference-First work continues independently.
```
