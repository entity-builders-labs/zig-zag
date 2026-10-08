# Experience Identity, Dedupe & Diversity — Design

Status: **canonical design decision record. Docs-only. Not authorization to implement.**
Written: 2026-09-12.
Branch: `feat/preference-first-selection`.

Related:
- `docs/superpowers/specs/2026-09-12-living-tourism-knowledge-base-design.md`
- `docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md`
- `docs/superpowers/plans/2026-09-12-experience-identity-postgres-integration-gate.md`

---

## 1. Problem

The living catalog must be able to represent several real Experiences that occupy the same place and satisfy the same themes/intents without collapsing them into one generic row.

Example: San Telmo can legitimately contain several real walks that all satisfy:

```text
area   = San Telmo
intent = walk
theme  = history
```

They may differ by actual composition, sequence, source-defined scope, starting point, ending point, duration or tourism concept.

Theme/intent/geographic scope describe an Experience. They do **not** define its canonical identity.

---

## 2. Five separate questions

These concerns must remain distinct:

```text
Dedupe
"Is this the same real Experience?"

Classification
"What is this Experience about?"

Preference matching
"Does it satisfy what this traveler asked for?"

Ranking / quality
"How strong is it for this request?"

Diversity
"Does it add something meaningfully different from what is already selected?"
```

No one stage may substitute for another.

In particular:
- same theme != SAME identity;
- same intent != SAME identity;
- same AREA != SAME identity;
- similar name != automatically SAME;
- component overlap != automatically SAME;
- low diversity for one Tour != duplicate catalog identity.

---

## 3. Canonical identity signals

Identity is evidence-backed and multi-signal.

Relevant signals may include:

```text
canonical / source names
provider/source identity
external ids when genuinely identifying the Experience
resolved component set
role-aware component set
component order when explicitly evidenced
route geometry when real
starting / ending point
scope
provenance overlap
source wording / explicit itinerary identity
duration or other stable structural characteristics
```

Themes/intents/traits may contribute semantic context to a dedupe fingerprint but must never independently establish identity.

The existing dedupe primitive already returns:

```text
SAME
NEW
AMBIGUOUS
```

and uses multiple signals including name similarity, semantic similarity, component overlap, role-aware component overlap, distance and provenance. That three-way decision remains the correct conceptual boundary.

---

## 4. Case 1 — SAME: several observations of one real Experience

Example:

```text
Source A:
"San Telmo Historical Walking Tour"
- Plaza Dorrego
- Mercado de San Telmo
- Pasaje Defensa
- El Zanjón

Source B:
"Historical Walk through San Telmo"
- Plaza Dorrego
- Mercado de San Telmo
- Pasaje Defensa
- El Zanjón
```

If identity evidence supports that both sources describe the same real Experience:

```text
→ SAME
```

Expected behavior:
- reuse one canonical `Experience.id`;
- preserve/add both observations/evidence;
- merge corroborated facts deterministically;
- never create two catalog rows solely because source wording differs;
- repeated provider order must not alter the canonical result.

The new observation enriches the existing Experience.

---

## 5. Case 2 — NEW: several real Experiences in the same scope

Example:

```text
Experience A — Colonial / Historical San Telmo Walk
- Plaza Dorrego
- Mercado
- Pasaje Defensa
- El Zanjón

Experience B — San Telmo Immigration Walk
- Mercado
- conventillo / immigration site
- Defensa
- Parque Lezama
```

Both can legitimately have:

```text
intent = walk
theme  = history
area   = San Telmo
```

If evidence shows they are distinct real Experiences:

```text
→ NEW
```

Expected behavior:
- persist both canonical Experiences;
- shared themes/intents do not collapse them;
- overlapping components do not collapse them automatically;
- both remain independently retrievable for the same facet;
- ranking decides which is better for a request;
- diversity policy decides whether selecting both in one Tour is useful.

The catalog must preserve tourism richness rather than normalize everything into `San Telmo Walk`.

---

## 6. Case 3 — AMBIGUOUS: strong overlap but identity is not proven

Example:

```text
Candidate A
- Plaza Dorrego
- Mercado
- Pasaje Defensa
- El Zanjón

Candidate B
- Plaza Dorrego
- Mercado
- Pasaje Defensa
- Parque Lezama
```

A naive rule such as:

```text
75% component overlap => SAME
```

is forbidden.

The question is whether the observations describe:
- one real Experience with partially different observations, or
- two different real itineraries.

When current evidence cannot establish either answer safely:

```text
→ AMBIGUOUS
```

Expected behavior:
- do not silently merge;
- do not claim a confident NEW identity merely to avoid the ambiguity;
- retain the ambiguity/evidence for future resolution;
- future corroboration may later resolve it to SAME or NEW.

Conservative ambiguity is preferable to irreversible catalog corruption.

---

## 6.1. Standalone/composite shared membership is not identity ambiguity

A standalone Experience and a source-backed composite may legitimately share
the same canonical `GeoEntity`:

```text
Experience("Visit Plaza Dorrego")
components = [Plaza Dorrego]

Experience("San Telmo Historical Walk")
components = [Plaza Dorrego, Mercado]
```

That shared membership is expected catalog structure. It does not mean the two
rows describe the same Experience, and it is not by itself an unresolved
identity conflict.

Canonical dedupe consequence:

- continue measuring component and role-aware overlap as auditable evidence;
- for **standalone-vs-composite** comparisons (one distinct component vs more
  than one), shared component membership alone MUST NOT force `SAME` or
  `AMBIGUOUS`;
- a similar name may still make the pair `AMBIGUOUS` (deferred debt, see
  "Structural identity authority" below); lexical/semantic text overlap may
  not;
- exact standalone-vs-standalone and exact composite-vs-composite duplicate
  behavior remains unchanged;
- composite-vs-composite partial-overlap policy remains conservative unless
  separate evidence justifies changing it;
- persistence order MUST NOT change whether the standalone and composite can
  coexist.

This is the dedupe corollary of the component-resolution amendment §16:

```text
GeoEntity existence != Experience existence
component membership != standalone Experience authority
```

It is a policy correction to the meaning of the overlap signal, not a new
numeric threshold.

### Structural identity authority (amendment 2026-10-08)

Name/text/semantic similarity is non-authoritative identity evidence.

It may nominate or corroborate a comparison, but SAME / AMBIGUOUS / DISTINCT
decisions require structural or independently grounded identity evidence.

This replaces the earlier reading of this section that "name/semantic
evidence may by itself make the pair AMBIGUOUS". Why
(`spikes/semantic-overlap-threshold-forensic-2026-10-08/README.md`):

- the `semanticOverlap >= 0.58 → AMBIGUOUS` rule had no calibration, dataset
  or rationale (`NO_EVIDENCE_FOUND_FOR_0_58`);
- the score is insertion-order dependent: persisted trait rows reach it only
  on the existing side, so one pair scored 0.500 or 0.857 depending on which
  Experience was persisted first (hard invariant 11);
- it conflates textual similarity (shared descriptions, templated LLM text,
  generic themes) with Experience identity;
- it cannot represent containment: a smaller source-defined composition
  inside a larger one was either merged or rejected by word overlap.

The dedupe primitive derives a deterministic **structural relation** from
the two source-defined compositions, over their **source members**
(see "Source member identity" below):

```text
EXACT_COMPOSITION  every member of each side has a counterpart (a PARTIAL
                   and its later COMPLETE view of one source included)
SUBCOMPOSITION     one member set strictly inside the other, with no
                   conflicting evidenced order over the shared members
PARTIAL_OVERLAP    shared members, neither contains the other
DISJOINT           no shared member grounded by a resolved GeoEntity
```

and a **source relation** from evidence URLs only (`SAME_SOURCE`,
`DIFFERENT_SOURCE`, `SOURCE_UNKNOWN`; titles/descriptions are never source
identity). One policy combines them:

| Relation | Outcome |
| --- | --- |
| EXACT_COMPOSITION | SAME when roles agree, names are identical or the curated concept fully agrees, and evidenced order does not conflict; else AMBIGUOUS |
| SUBCOMPOSITION | never SAME; AMBIGUOUS only with a similar name; otherwise NEW (coexist) for same, different or unknown source |
| PARTIAL_OVERLAP | AMBIGUOUS with a similar name or composite-vs-composite structural overlap; else NEW |
| DISJOINT | AMBIGUOUS only with a similar name; else NEW |

A same-source SUBCOMPOSITION is recorded as containment evidence in the
trace, not as identity. Persisted containment (`CONTAINS`) relations are
future work. The lexical semantic score remains for diagnostics and
candidate ordering only. The remaining uncalibrated cuts (name `>= 0.72`,
component `>= 0.5`, role-aware `>= 0.4`) are explicit follow-up debt; the
name cut is the last text-based AMBIGUOUS authority.

### Source member identity (amendment 2026-10-08, before C3)

The first structural-authority cut keyed a member by its GeoEntity when
resolved and by its source wording otherwise. The identity of an
Experience's composition then changed when a member resolved: a PARTIAL
A-B-C-D (C, D unresolved) and its later COMPLETE view were
PARTIAL_OVERLAP. Source-member identity and resolved GeoEntity identity are
now separate:

- **Source member identity** is the persisted `ExperienceComponent`
  `sourcePosition` inside its Experience plus its `sourceName` wording. It
  carries no GeoEntity and no resolution state. `sourcePosition` is source
  membership, never visiting order (§9).
- **Cross-Experience correspondence.** A position means nothing outside its
  own composition, so naked positions are never compared. Two members of
  different Experiences are the same source member when they carry the same
  normalized source wording (unless the members bearing that wording
  resolve to more than one distinct GeoEntity, so an ambiguous wording is
  no identity), or when both resolved to the same GeoEntity (supporting
  evidence that links differently worded members). Correspondence is
  transitive and symmetric; each corresponding member set spans at most one
  GeoEntity.
- **Grounding.** Only a shared member with a resolved GeoEntity on at least
  one side relates two compositions. Shared unresolved wording alone, and
  members without wording, are never shared structure.

The decision table above is unchanged. The trace records
`sourceCompositionRelation` with `sharedSourceMembers` (source positions
and correspondence basis) apart from `sharedResolvedGeoEntities`, which is
supporting evidence and never a member identity.

Known gap: a SAME onto a PARTIAL Experience merges evidence and metadata
but does not adopt the incoming resolution of its still-unresolved members;
enrichment of members happens through resolution or the admin primitives.

---

## 7. Same facets, different Experiences

This is explicitly valid:

```text
San Telmo
  ├─ Historical Walk A
  │    themes: [history, architecture]
  │    intents: [walk]
  │
  ├─ Historical Walk B
  │    themes: [history, architecture]
  │    intents: [walk]
  │
  ├─ Architecture Walk
  │    themes: [architecture, history]
  │    intents: [walk]
  │
  ├─ Food & Market Walk
  │    themes: [food, local_culture]
  │    intents: [walk]
  │
  └─ Jewish Heritage Walk
       themes: [history, culture]
       intents: [walk]
```

Facet equality is expected and useful. It gives preference-first retrieval several real alternatives.

---

## 8. Dedupe vs ranking vs diversity

Suppose two distinct Experiences share many stops:

```text
Walk A
Plaza Dorrego + Mercado + El Zanjón

Walk B
Plaza Dorrego + Mercado + El Zanjón + Pasaje Defensa
```

If they are evidence-backed distinct Experiences, they remain separate catalog rows.

During Tour selection:
- both may rank highly;
- if Walk A is already selected, Walk B may receive a redundancy/overlap penalty;
- that penalty affects this Tour's composition only;
- it MUST NOT mutate their canonical identity or delete one from the catalog.

Therefore:

```text
catalog dedupe != itinerary diversity
```

---

## 9. Evidence/order semantics

Component order is identity-relevant only when real evidence establishes it.

If source evidence explicitly defines:

```text
A → B → C → D
```

that sequence can strengthen identity comparison.

If no source establishes order, `ExperienceComponent.order = null` and dedupe must not manufacture an order merely to compare two Experiences.

Likewise, nearby POIs never define a walk identity by themselves.

---

## 10. Possible future `ExperienceFamily`

A future grouping such as:

```text
ExperienceFamily: "San Telmo historical walks"
  ├─ Experience A
  ├─ Experience B
  └─ Experience C
```

may eventually be useful for browsing, explanations or diversity control.

It is **not required now** and must not be introduced simply to solve identity. Independent canonical Experiences + component similarity + facet matching + diversity ranking are sufficient until a concrete product need proves otherwise.

---

## 11. Hard invariants

1. `theme`, `intent`, `trait`, destination and AREA are classification/retrieval signals, not canonical identity keys.
2. Multiple Experiences with the same facets and scope are valid.
3. Dedupe answers real-world identity only.
4. `SAME` enriches one canonical Experience.
5. `NEW` creates/preserves another canonical Experience.
6. `AMBIGUOUS` must not be silently merged.
7. Component overlap alone cannot force `SAME`.
8. Semantic similarity alone cannot force `SAME`.
9. User preferences never influence identity.
10. Planner diversity never deletes or merges catalog knowledge.
11. Provider ordering must not change the final identity decision/state.
12. Evidence can resolve ambiguity later; catalog decisions remain auditable.
13. Shared GeoEntity membership between a standalone Experience and a composite is not, by itself, a SAME or AMBIGUOUS identity signal.
14. Lexical/semantic text similarity alone never decides SAME, AMBIGUOUS or NEW; a source-defined sub-composition is never SAME with the composition that contains it.
15. Resolving or unresolving a source member (automatic resolution, admin confirm, admin revoke, PARTIAL ↔ COMPLETE) may change knowledge about the member, but never the source-defined composition identity of the Experience or its structural relation to another composition, unless new identity evidence actually establishes that two differently worded members correspond.

---

## 12. Mandatory Postgres gate before B6

These semantics must be proven against the real persistence/dedupe path before B6 changes extraction authority.

The required integration matrix is defined in:

`docs/superpowers/plans/2026-09-12-experience-identity-postgres-integration-gate.md`

B6 must not begin until the gate proves at minimum:
- Case 1 SAME converges to one canonical Experience with enriched evidence;
- Case 2 NEW preserves two distinct Experiences despite identical/similar facets and geography;
- Case 3 AMBIGUOUS does not merge rows;
- results survive re-read from Postgres and are not artifacts of mocks/in-memory fixtures;
- provider/input ordering does not change the outcome.
