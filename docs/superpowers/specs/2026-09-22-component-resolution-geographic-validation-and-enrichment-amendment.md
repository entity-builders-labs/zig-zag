# Component Resolution, Geographic Validation and Enrichment — Amendment

Status: **canonical architecture amendment; docs-only; not implementation authorization.**
Written: 2026-09-22.
Branch: `feat/preference-first-selection`.
Evidence baseline: remote HEAD `a07cbe683ef651619613bda9bd3ed587a951bb77`, especially
`spikes/rw1-san-telmo-historical-walk/forensic-rerun-2026-09-22/`.

Related:
- `docs/superpowers/specs/2026-09-12-living-tourism-knowledge-base-design.md`
- `docs/architecture/activity-discovery-and-tour-generation.md`
- `docs/superpowers/plans/2026-09-12-real-world-tourism-research-spike-gate.md`
- `docs/superpowers/plans/2026-09-17-cross-source-confirmation-and-tripadvisor-volume.md`
- `docs/superpowers/plans/2026-09-11-agentic-deep-research-and-experience-enrichment-roadmap.md`

This amendment supersedes only the conflicting rules identified below. Historical
plans remain useful as implementation history and must not be silently rewritten
as if the earlier evidence never existed.

---

## 1. Why this amendment exists

The corrected RW1 forensic campaign of 2026-09-22 changed the empirical picture.

The live system now reaches real grounded discovery, extracts real multi-component
walk candidates, invokes real Entity Resolution, and records detailed provider
attempts. The dominant failure is no longer "the system cannot find a walk".
Instead, source-backed composites are frequently discarded before meaningful
composite geographic validation because one component that the extraction LLM
marked `required=true` remains unresolved.

Observed examples include:

- a 3/4 required-component San Telmo walk discarded;
- a 6/8 required-component San Telmo walk discarded;
- a 4/5 required-component self-guided walk discarded;
- a real Freetour City Tour route with 4/6 components resolved and two precise
  identity deficits discarded as a whole.

The same campaign also exposed three policy problems:

1. `required` is LLM-authored and not semantically stable across runs.
2. candidate acquisition/corroboration evidence can be stronger than the
   current IdentityVerifier policy admits, as in El Zanjón de Granados.
3. area membership for a walk cannot mean "every component point is strictly
   inside the requested polygon", because legitimate evidence-backed routes may
   begin near the area or cross its boundary.

These are architecture issues, not San-Telmo-specific exceptions.

---

## 2. Evidence-backed composition remains non-negotiable

Nothing in this amendment weakens the rule that a composite Experience must
exist in real evidence.

The system MUST NOT do this:

```text
several nearby POIs
+ semantic similarity
→ invented walking Experience
```

A multi-component candidate remains valid research input only when source
evidence establishes that the components belong to the same real walk, tour,
route, itinerary or visiting sequence.

The 2026-09-22 artifacts also show that this source boundary needs further
hardening:

- Google AI Mode synthesis may be useful discovery hypothesis, but is not by
  itself equivalent to an independent product/source proving an Experience.
- extractor output must not merge stops from unrelated tours/articles into one
  new Experience merely because all evidence concerns the same neighborhood.
- a component absent from the cited evidence is an extraction authority
  violation, not a geographic-resolution problem.

Partial resolution is worth preserving only after the Experience/composition
has legitimate evidence authority.

---

## 3. Remove LLM-owned `required` from geographic truth

The extraction LLM must not decide which geographic component is allowed to
kill a real Experience.

Target contract:

```ts
interface GeoEntityHint {
  key: string;
  name: string;
  role: 'area' | 'waypoint' | 'route' | 'venue';
  expectedKind: 'PLACE' | 'AREA' | 'ROUTE';
  evidenceKeys: string[];
  addressHint?: string;
}
```

Every evidence-backed component is attempted.

`MULTI_COMPONENT_EXPERIENCE` should express source-backed composition, not a
count of LLM-authored `required=true` flags. Conceptually, the evidence must
support at least two meaningful non-area real geographic components belonging
to the same Experience.

This amendment does **not** define a new percentage threshold or minimum count
for accepting a partial composite. Those values require characterization data
after the new resolution/validation flow is observable.

---

## 4. Per-component resolution becomes a first-class result

Each component should produce an auditable result instead of disappearing into
one proposal-level pass/fail decision.

Target flow:

```text
source-backed component hint
        ↓
candidate acquisition
        ↓
candidate correlation
        ↓
identity evidence + decision
        ↓
component geographic relation
        ↓
ComponentResolution
```

A component result should preserve, as typed facts where they affect canonical
decisions:

- every acquisition attempt that actually ran;
- provider-native identity and external id;
- canonical cross-reference when a provider exposes one;
- normalized name/alias/address facts used by identity;
- coordinates/geometry actually returned;
- identity decision and supporting evidence;
- geographic relation to the request scope;
- ambiguity/conflict and open research deficit when unresolved.

Provider order never defines truth.

---

## 5. Candidate convergence is evidence; provider voting is not policy

The system must distinguish:

```text
three provider labels
```

from:

```text
three acquisition paths converging on one canonical geographic object
```

For El Zanjón de Granados, the forensic trace recorded:

```text
hint:
El Zanjón de Granados

LOCAL_OSM_POOL
→ osm:node:9953027884
→ El Zanjón de Granados (historic ruins)

Nominatim
→ the same osm:node:9953027884

configured Places path in the trace
→ a result carrying the same underlying OpenStreetMap venue/node reference
```

OSM, Nominatim and an OSM-backed Places result are not necessarily three
independent databases. Nevertheless, repeated convergence onto exactly the same
canonical object is real, useful evidence and MUST remain visible.

The core must not implement:

```text
2 of 3 providers agree → winner
```

Instead, it should correlate candidate observations into real-world candidate
clusters. Multiple provider-specific ids may represent one real entity when
supported by compatible identity/geographic facts.

A provider divergence may mean:

- a bad/irrelevant search result;
- a second provider-specific identity for the same real entity;
- a genuine identity conflict.

Only the last case is contradictory evidence.

---

## 6. Corroboration is additive; absence is not contradiction

The 2026-09-17 cross-source plan required Wikidata confirmation for every
non-exact fuzzy match. The forensic rerun shows that rule is too strong as a
general identity gate.

Canonical distinction:

```text
CORROBORATED
additional evidence confirms the candidate

NOT_CORROBORATED
the additional source could not establish the candidate

CONTRADICTED
positive evidence establishes an incompatible identity
```

`NOT_CORROBORATED` must not be collapsed into `CONTRADICTED`.

A single strong geographic source may be sufficient when it produces a unique,
structurally compatible, non-ambiguous identity with strong name/address/
canonical-id evidence and compatible geography. Additional sources increase
auditability/confidence but are not automatically mandatory.

Wikidata remains valuable for:

- QID/alias/cross-reference corroboration;
- structured facts and relationships;
- Wikipedia/Commons links;
- historical/contextual enrichment.

Missing Wikidata evidence is not proof that a real entity is invalid.

Exact policy for which identity-evidence combinations are sufficient belongs to
the canonical IdentityVerifier and must be characterized by generic tests. Do
not add destination-specific exceptions.

---

## 7. No new closed tourism-type taxonomy for identity

This amendment does not introduce a new `EntitySemanticType` mega-enum.

The hard structural physical domain remains:

```text
PLACE | AREA | ROUTE
```

Provider-native types may be retained as provenance, diagnostics and enrichment
evidence. They can signal that a result deserves investigation, but this
milestone must not create a second closed tourism taxonomy whose pairwise
compatibility becomes an identity authority.

Structural incompatibility remains meaningful: a point-like venue cannot
satisfy a real ROUTE geometry requirement, and a café point cannot satisfy an
AREA polygon requirement merely because names overlap.

---

## 8. Component geography and composite geography are different decisions

Geographic validation must be split conceptually into two levels.

### 8.1 Component geographic relation

After a candidate identity is selected/resolved, compute how that physical
entity relates to the requested scope.

For AREA scopes, the target semantics are relations rather than a single
containment boolean. Exact names are implementation decisions, but the domain
must express at least the equivalent of:

```text
INSIDE
INTERSECTS
NEAR
OUTSIDE
```

Important rules:

- PLACE + AREA: polygon containment is strong membership evidence.
- a PLACE outside the polygon may be near the area boundary; measure against
  the boundary, not the area's centroid.
- `NEAR` alone never authorizes inclusion in a composite.
- ROUTE + AREA: evaluate real LineString/geometry intersection/corridor
  semantics. Do not reduce the route to one representative point.
- POINT_RADIUS remains a legitimate center+radius scope and is not replaced by
  AREA semantics.

The existing `AREA_ANCHORED_ROUTE` policy is a useful foundation and should be
evolved as the single area-membership authority rather than duplicated.

### 8.2 Composite geographic validation

After per-component results exist, evaluate the Experience as a set:

- route/area anchoring;
- component coherence;
- pairwise/radius metrics where appropriate;
- evidence-backed sequence/order;
- route corridor membership;
- whether outside-but-near components are coherently connected to the anchored
  Experience.

A component can be geographically plausible while the whole composition is
geographically incoherent, and vice versa.

---

## 9. San Telmo acceptance examples

### El Zanjón de Granados

The desired policy outcome is not "accept all fuzzy strings". It is:

```text
source-backed component
+ unique/stable candidate identity
+ repeated acquisition-path convergence on the same canonical object
+ strongly compatible identity evidence
+ compatible component geography
+ no positive contradictory evidence
→ identity/geography can be VERIFIED without mandatory Wikidata veto
```

If providers produce genuinely incompatible candidate clusters, the result is
AMBIGUOUS / NEEDS_RESEARCH, never silent majority voting.

### Plaza de Mayo

A real source-backed San Telmo walk may start near Plaza de Mayo and then enter
San Telmo via Calle Defensa.

```text
Plaza de Mayo: outside San Telmo polygon but plausibly NEAR
Calle Defensa: route geometry INTERSECTS / connects into San Telmo
later stops: INSIDE
```

Strict "every point inside San Telmo" would be a false rejection. `NEAR`
still requires composite evidence/coherence; it does not make arbitrary nearby
places valid.

### Calle Defensa

A street is a ROUTE/linear geographic entity. Its relationship to San Telmo is
defined by its geometry/intersection/corridor, not by whether one centroid or
representative coordinate falls inside the neighborhood polygon.

---

## 10. Partial composite lifecycle and research deficits

Failure to resolve one component must not erase all knowledge about a
source-backed Experience.

Target research result:

```text
Experience evidence
components: 6

A VERIFIED
B VERIFIED
C UNRESOLVED
D VERIFIED
E AMBIGUOUS
F VERIFIED

resolvedCount = 4
totalCount = 6
resolutionRatio = 0.667
openResearchDeficits = [C, E]
```

This amendment intentionally does not decide the final storage schema or exact
status names. The implementation must preserve the distinction between:

- a schedulable, fully verified canonical Experience;
- a source-backed partial research object that still has open questions;
- a rejected/hallucinated composition.

Partial research state must never become planner-eligible merely because it
crosses an arbitrary percentage.

The future Researcher loop should target the precise deficits instead of
restarting broad discovery:

```text
partial research result
→ identify exact missing fact
→ targeted source/provider research
→ append observations
→ deterministic re-evaluation
→ verified or explicitly exhausted/manual-review state
```

---

## 11. Verification and enrichment are separate

Verification answers:

> Is this the real entity / Experience, and is its geography/composition valid?

Enrichment answers:

> What useful, current, traveler-facing knowledge do we have so a user can
> decide KEEP / REMOVE / REPLACE?

A verified Experience may initially have thin enrichment.

Potential enrichment sources include:

- Wikidata structured facts / aliases / links;
- Wikipedia historical/contextual narrative;
- Wikimedia Commons media;
- configured Places ratings, reviews, hours, photos and operational facts;
- TripAdvisor product/review evidence where available;
- official sites for tickets, restrictions, hours and authoritative content;
- other bounded specialist/editorial sources.

Enrichment evidence must preserve source/provenance and fact-specific freshness.
It must not become an implicit identity prerequisite.

---

## 12. Resolution coverage: measure first, threshold later

The next implementation must record at least:

```text
totalComponents
identityResolvedComponents
geoAcceptedComponents
unresolvedComponents
ambiguousComponents
resolutionRatio
```

The architecture expects a future policy using a combination of minimum
resolved components and a resolution ratio, but **no X/Y values are canonical
yet**.

Likewise, no generic `NEAR` meter threshold is introduced by this amendment
unless an existing canonical geographic primitive already provides the exact
semantics required.

RW1 must be rerun after observability and component/composite separation exist.
Only then should thresholds be proposed from evidence.

---

## 13. Bitácora and provenance requirements

For every composite component the forensic trace should make it possible to
answer:

- which source evidence named this component;
- which provider/acquisition paths ran;
- which candidate identities each path returned;
- whether paths converged on a shared canonical reference;
- what identity evidence was decisive;
- whether evidence was absent or positively contradictory;
- component geographic relation to the request scope;
- final component status;
- unresolved research question, if any.

At proposal level it should show:

- source/composition authority;
- total/resolved/geo-accepted counts;
- coverage ratio;
- composite geographic decision;
- whether the object is planner-eligible or still research-only.

Do not log raw provider noise as canonical truth. Preserve the minimum evidence
needed to explain decisions.

---

## 14. Explicit non-goals / open decisions

Not decided by this amendment:

- exact partial-resolution percentage X;
- exact minimum resolved component count Y;
- exact generic `NEAR` distance threshold;
- final persistent schema for partial research objects;
- source reliability score formula;
- provider voting/weights (explicitly not desired);
- a new tourism semantic-type enum (explicitly not desired);
- TripAdvisor integration timing;
- full targeted deep-research implementation;
- manual backoffice workflow for unresolved components.

Those decisions require either further characterization or a dedicated design.

---

## 15. Catalog-first component resolution

The Living Tourism Knowledge Base is not merely the place where resolution
results are written after external research. It is the **first reusable
resolution boundary** for component identity.

For every source-backed component hint, the target order is:

```text
component hint
        ↓
canonical catalog / GeoEntity lookup
        ↓
   sufficient, unambiguous,
   structurally compatible?
      ┌───────────┴───────────┐
     yes                      no
      ↓                        ↓
reuse canonical          bounded external acquisition
GeoEntity                OSM / Nominatim / Places /
      │                   other applicable evidence
      │                        ↓
      │                  correlate new observations
      │                  with canonical knowledge
      └───────────┬────────────┘
                  ↓
          identity decision
                  ↓
       persist/reconcile GeoEntity
                  ↓
      component geographic relation
```

This is **catalog-first**, not **catalog-always-wins**.

A reusable catalog match must still be:

- unambiguous for the requested hint/context;
- structurally compatible with the physical kind required by the component;
- free of known positive contradiction;
- sufficiently current for the facts being reused.

If the catalog is ambiguous, stale for the relevant fact, internally
conflicted, or simply lacks the entity, resolution opens a precise external
research deficit. External providers then add observations to the same
canonical identity problem; they do not reset knowledge as if Zig-Zag had
never seen the entity before.

The catalog is not another provider vote. It is the system's canonical
accumulated conclusion backed by historical observations/provenance.

A later request therefore must not re-prove an already established GeoEntity
from scratch merely because the same place appears as a component of a new
Experience. This is especially relevant to the RW1 El Zanjón shape: once the
canonical GeoEntity and its provider identities are established, a later
component hint should first attempt to reuse that knowledge before opening the
same OSM/Nominatim/Places/Wikidata investigation again.

Implementation must centralize this lookup/reuse policy. Do not scatter
ad-hoc "find by similar name" catalog checks across providers or resolver
strategies.

---

## 16. GeoEntity and Experience remain different catalog identities

The catalog has two related but distinct reusable concepts:

```text
GeoEntity
= canonical physical/geographic reality

Experience
= source-backed tourism unit that can be offered/scheduled
```

A single- or multi-component Experience continues to use:

```text
Experience
  → ExperienceComponent
  → GeoEntity
```

A multi-component Experience does **not** become a tree of child Experiences.

When discovery originates a source-backed composite and component resolution
succeeds:

- reuse an existing canonical GeoEntity when possible;
- otherwise create/reconcile the new GeoEntity after identity verification;
- do **not** automatically create a standalone Experience for that component.

Standalone Experience persistence requires independent Experience origination
authority: acquisition/discovery must itself produce evidence that the entity
is a tourism unit worth offering independently.

Example:

```text
walk discovery
→ "San Telmo City Tour"
→ Plaza Dorrego + Calle Defensa + Mercado + ...

component resolution
→ canonical GeoEntities are reused/created

NO automatic side effect:
→ Experience("Plaza Dorrego")
→ Experience("Calle Defensa")
→ Experience("Mercado")
```

If the same request or a later request independently discovers
"Visit Plaza Dorrego" as a valid Experience, that standalone Experience may
then be persisted and point to the **same** Plaza Dorrego GeoEntity.

Therefore:

```text
GeoEntity existence != Experience existence
component membership != standalone Experience authority
```

This prevents catalog pollution while still allowing the Knowledge Base to
compound over time.

---

## 17. Composite membership is not planner augmentation

Geographic proximity can discover or help resolve entities. It cannot establish
membership in a composite Experience.

Canonical invariant:

> **Composite membership requires tourism-source evidence. Nearby/proximity
> never creates, replaces or inserts a component into canonical composition.**

Planner backfill is a separate concern.

After a verified Experience portfolio reaches the deterministic planner, the
planner may discover meaningful residual capacity for a concrete day. The
correct sequence is:

```text
planner residual-capacity gap
        ↓
existing verified catalog / ranked reservoir first
        ↓
still insufficient?
        ↓
bounded targeted acquisition
        ↓
normal evidence → resolution → validation → persistence
        ↓
recompose + replan
```

A newly acquired standalone Experience may be scheduled geographically between
stops/components of another Experience in a future execution model **without
becoming a component of that Experience**. Canonical membership and Tour
execution order are different facts.

However, source-backed order/continuity constraints of the composite must be
preserved. The current component-resolution milestone does not authorize an
unbounded planner rewrite or invent a new interleaving schema. If planner
interleaving requires new Tour-step representation, precedence/adjacency facts
or snapshot semantics, that is a separate planner design.

---

## 18. Embeddings personalize verified Experiences; they never validate reality

Embeddings operate on canonical Experiences, not on GeoEntity identity.

Target semantic pipeline:

```text
verified Experience
        ↓
canonical semantic document
(name, description, themes, intents, traits, component GeoEntity facts, ...)
        ↓
Experience.embedding in pgvector

PreferenceSpec.semanticQuery
        ↓
query embedding
        ↓
cosine similarity against compatible Experience embeddings
        ↓
semanticSimilarity
        ↓
deterministic composition / ranked reservoir
        ↓
planner soft relevance
```

The current pgvector query uses cosine distance (`<=>`) and converts it to
similarity as `1 - distance`.

Semantic similarity is useful twice:

1. **composition/ranking** — among already eligible Experiences, to prefer
   candidates closer to the user's free-text intent;
2. **daily planning soft relevance** — the same raw semantic score may
   contribute alongside explicit preference weight and quality.

It never:

- proves Experience existence;
- proves component membership;
- validates a GeoEntity;
- creates a strong facet match;
- satisfies coverage by itself;
- bypasses geography, source evidence, hard exclusions, opening hours or
  mobility feasibility.

The semantic document currently serializes component `required/optional`
state. Removing the LLM-owned `required` contract therefore changes the
canonical embedding document materially.

The implementation cutover MUST:

- remove `required/optional` tokens from the Experience semantic document;
- bump `EXPERIENCE_EMBEDDING_DOCUMENT_VERSION` from the current v2 contract
  to a new version;
- reindex stale VERIFIED Experiences through the existing versioned embedding
  indexer;
- keep candidate/query embedding identity compatibility checks intact;
- never synchronously invent missing candidate embeddings in Tour generation.

Partial research objects that are not planner-eligible canonical Experiences
must not gain semantic-ranking authority merely because some components are
known.


