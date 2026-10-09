# City GeoEntity Catalog Bootstrap — Proposed Track

Status: **PROPOSED / NON-BLOCKING / NOT YET ACTIVE**  
Created: 2026-10-09  
Roadmap owner: `docs/superpowers/plans/2026-09-09-travel-content-agentic-planning-convergence-roadmap.md`

This document defines a future knowledge-bootstrap track. It is **not** an
ACTIVE execution track and therefore intentionally has no `progress/` file or
`agent-track` header yet.

It does not block the current Preference-First merge reconciliation or
RW4-ID-FALSE-VERIFY-2 correction.

## 1. Product intent

When a destination/city is onboarded, Zig-Zag should build enough canonical
place knowledge that normal tour generation primarily **matches source mentions
against an existing GeoEntity catalog** instead of rediscovering place identity
from the open web on every request.

The target split is:

```text
GeoEntities
  → aggressively bootstrapped from destination supply

Simple Experiences
  → conservatively bootstrapped from tourism-relevant GeoEntities

Composite / source-defined Experiences
  → primarily learned demand-first during real acquisition
     and accumulated/reconciled in the Experience catalog
```

Canonical distinction:

```text
GeoEntity = what place/entity exists

Experience = what a traveler can do, visit or consume there
```

A GeoEntity may support zero, one or many Experiences. Do not collapse these
domains.

## 2. City onboarding target flow

```text
CITY ONBOARDING
      ↓
provider sweep / destination discovery
      ↓
cross-provider entity resolution
      ↓
canonical GeoEntities
      ↓
enrichment
  - canonical name
  - aliases
  - multilingual/source-name variants
  - provider identifiers
  - Wikidata / OSM links
  - location/address
  - kind/category
  - provenance/confidence
      ↓
automatic high-confidence acceptance
      OR
backoffice review
      ↓
CITY GEOENTITY CATALOG
      ↓
conservative simple-Experience bootstrap
```

The bootstrap must preserve the existing identity principle:

```text
retrieval similarity may find a candidate;
it does not by itself prove identity.
```

Generated translations or aliases are proposals until supported by evidence or
human confirmation. Do not let an LLM-generated alias become canonical truth by
construction.

## 3. Runtime target flow

Tour generation remains catalog-first and demand-driven:

```text
source member
      ↓
GeoEntity catalog lookup
      ├─ confirmed canonical name / alias / translation
      │      ↓
      │   resolved identity
      │
      └─ miss / insufficient evidence
             ↓
        runtime resolver
             ↓
      VERIFIED / INSUFFICIENT_EVIDENCE
             ↓
       catalog learning proposal
             ↓
   auto-accept only under canonical strong evidence
   otherwise backoffice
```

Unknown must remain unknown. An unresolved source member is not silently
dropped or rebound to a merely plausible place.

## 4. GeoEntity bootstrap scope

The initial destination sweep should favor breadth of **identity-bearing place
knowledge**, not only places that are already known to be tourist attractions.

Potential provider inputs include existing supported geographic/catalog
providers such as OSM/Overture/Wikidata/Geoapify and any later approved
destination data sources.

The track must define, from evidence rather than arbitrary thresholds:

- destination geographic boundary;
- provider coverage roles;
- cross-provider correspondence;
- canonical identifier selection;
- alias and translation evidence;
- duplicate/merge rules;
- freshness/reverification;
- provenance and confidence;
- backoffice review queue eligibility;
- correction/revocation semantics.

Do not assume every discovered record becomes a GeoEntity. Provider records are
evidence about candidate entities.

## 5. Alias and translation model

Aliases are durable catalog knowledge and require provenance.

At minimum distinguish:

```text
OBSERVED_ALIAS
AUTOMATICALLY_CONFIRMED_ALIAS
HUMAN_CONFIRMED_ALIAS
REVOKED_ALIAS
```

Future implementation should retain enough provenance to answer:

- where did this alias come from?
- which rule/evidence established it?
- was it human-confirmed?
- can it be revoked without deleting the GeoEntity?
- which locale/language does it represent?
- is it a translation, historical name, abbreviation, informal name or source
  wording?

This track is the long-term home for the current verified-hint memory provenance
debt. It must not retroactively justify weak automatic identity decisions.

## 6. Simple Experience bootstrap

A city should not start with an empty Experience catalog.

Bootstrap a conservative set of simple Experiences from tourism-relevant
GeoEntities where product semantics are clear enough.

Examples of likely eligible classes:

```text
museum
landmark
park
market
viewpoint
tourist attraction
historic site
```

Illustrative mapping:

```text
GeoEntity: Museo del Cabildo
→ Experience: visit Museo del Cabildo
```

This is **not** a blanket `GeoEntity → Experience` conversion.

A GeoEntity such as an ATM, office, utility, random building or transport
infrastructure may be valid catalog knowledge without being a traveler-facing
Experience.

The bootstrap policy must define experience-worthiness separately from entity
existence.

## 7. Composite Experience strategy

Do not attempt to precompute the combinatorial universe of walking tours,
routes, themed itineraries and source-defined compositions during city
onboarding.

Composite Experiences remain primarily:

```text
demand-driven discovery
→ source-defined composition
→ member identity against canonical GeoEntities
→ Experience validation
→ dedupe/reconciliation
→ durable Experience catalog
```

Over time, WARM/catalog-first behavior makes frequently discovered composites
reusable without rebuilding them from scratch.

Preloading a bounded set of externally authoritative composite Experiences can
be considered later, but it is not a prerequisite for this track.

## 8. Backoffice / knowledge lifecycle

Backoffice is part of the catalog knowledge lifecycle, not merely an exception
handler for failed tours.

Target actions include:

```text
CONFIRM identity
REVOKE identity
MERGE duplicate GeoEntities
SPLIT incorrectly merged entities
ADD / CONFIRM alias
REVOKE alias
correct canonical fields
review unresolved catalog-learning proposals
```

A human-confirmed mapping must become durable reusable catalog knowledge with
stronger authority than runtime heuristic correspondence.

The current existence of domain-level confirmation/revocation concepts does not
prove the operational backoffice surface is complete; that surface must be
designed and accepted in this track.

## 9. Relationship to current identity work

RW4-ID-FALSE-VERIFY-2 remains a current Preference-First blocker and must be
fixed independently.

This future track is **not** a reason to preserve weak runtime verification such
as OVERLAP-grade convergence.

Correct behavior today remains:

```text
insufficient automatic evidence
→ INSUFFICIENT_EVIDENCE
```

Later city bootstrap/backoffice can turn correct-but-unproven cases into
catalog-known aliases and canonical identities.

Examples motivating the track include:

- El Zanjón de Granados;
- Farmacia la Estrella;
- Museo Nacional del Cabildo;
- translated or source-specific names such as National Bank.

These examples motivate the architecture; no name-specific rule is authorized.

## 10. Proposed gates

### CB1 — Discovery and boundary characterization

Choose representative cities and measure provider coverage, overlap, missing
classes and destination-boundary semantics.

No bulk persistence until identity/merge rules are explicit.

### CB2 — Canonical GeoEntity upsert/reconciliation

Implement idempotent cross-provider reconciliation with provenance, no
fabricated aliases, correction support and deterministic reruns.

### CB3 — Alias / translation evidence

Add typed alias knowledge, locale/source semantics, provenance and revocation.
Calibrate automatic vs human-confirmed acceptance.

### CB4 — Backoffice knowledge lifecycle

Expose review/confirm/revoke/merge/split/alias workflows with audit history.

### CB5 — Simple Experience bootstrap

Derive a conservative traveler-facing simple-Experience seed set from
tourism-relevant GeoEntities. Prove that non-tourism GeoEntities do not become
Experiences by default.

### CB6 — Runtime learning loop

Catalog miss → runtime resolver → typed learning proposal → canonical acceptance
or backoffice. Prove WARM reuse and correction.

### CB7 — City onboarding acceptance

For at least one representative city, prove:

- repeatable GeoEntity bootstrap;
- aliases/translations resolve known source wordings;
- manual corrections survive reruns;
- simple Experiences are useful and conservative;
- composite Experiences remain demand-driven;
- runtime misses fail closed;
- catalog knowledge reduces repeated online identity work.

## 11. Explicit non-goals

This track does not authorize:

- weakening current automatic identity verification;
- name/destination-specific exceptions;
- generating aliases with an LLM and trusting them without evidence;
- treating every GeoEntity as an Experience;
- precomputing all composite Experiences;
- replacing current Experience acquisition/reconciliation;
- making this work a blocker for the current Preference-First merge.

## 12. Activation rule

Do not create an ACTIVE progress track, branch or worktree from this document
alone.

When the owner authorizes execution, create a dedicated implementation branch
from the then-accepted tour-engine base, create its `progress/` document with
an `agent-track` header, and narrow CB1 into the first authorized milestone.
