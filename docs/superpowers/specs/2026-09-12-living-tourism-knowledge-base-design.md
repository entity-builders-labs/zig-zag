# Living Tourism Knowledge Base — Design

Status: **canonical product/architecture direction. Docs-only. Not authorization to implement.**
Written: 2026-09-12.
Branch: `feat/preference-first-selection`.

Related:
- `docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md`
- `docs/superpowers/specs/2026-09-12-experience-identity-dedupe-and-diversity-design.md`
- `docs/superpowers/plans/2026-09-12-experience-identity-postgres-integration-gate.md`

---

## 1. Product north star

Zig-Zag is a **Tourism AI Research Agent** that continuously builds, corroborates and maintains a living tourism knowledge base. Personalized tour generation is one application of that knowledge; it is not the only mechanism that creates or improves it.

The agent should behave like a careful tourism researcher:

```text
public/structured/local sources
        ↓
discover what appears to exist
        ↓
resolve identity + geography
        ↓
corroborate observations
        ↓
classify from evidence
        ↓
persist canonical tourism knowledge
        ↓
revisit / enrich / revalidate over time
        ↓
retrieve + rank + plan for a traveler
```

The catalog is therefore **not a cache of search results** and an Experience is not "finished" when first persisted.

---

## 2. Core model

Keep three concepts separate:

```text
Experience
= relatively stable canonical tourism identity

SourceObservation / Evidence
= what a particular source said, at a particular time

Derived current state
= what the system currently believes after deterministic corroboration,
  resolution, classification and merge
```

A canonical Experience can accumulate new observations without changing identity.

Example:

```text
Experience X: "San Telmo Historical Walk"
    ├─ observation A: official/local tourism source
    ├─ observation B: Wikivoyage / structured source
    ├─ observation C: grounded web article
    ├─ observation D: OSM / Places component verification
    └─ ... future observations
                  ↓
       deterministic current knowledge
```

New evidence may strengthen, correct, expand or contradict what was previously known.

---

## 3. Experience lifecycle

Canonical lifecycle:

```text
discover
  ↓
validate
  ↓
canonicalize / dedupe
  ↓
persist
  ↓
enrich
  ↓
corroborate
  ↓
revalidate
  ↓
refresh / repair stale facts
  ↓
continue reusing
```

Persisting is the start of the long-lived knowledge lifecycle, not its end.

A valid Experience may evolve from thin knowledge to rich knowledge while keeping the same canonical id.

Example:

```text
initial state
- 3 resolved stops
- 1 grounded source
- unknown order
- medium confidence

later state
- 5 corroborated stops
- 4 independent observations
- cited real sequence
- richer duration / quality / media evidence
- higher confidence
```

The opposite is also possible: closures, stale schedules, changed composition, source disappearance or conflicting evidence can lower confidence or mark individual facts stale without automatically deleting canonical identity.

---

## 4. Research modes

The knowledge base is fed through three complementary modes.

### 4.1 Demand-driven research

A user request exposes a real knowledge deficit:

```text
preference / anchor request
  ↓
insufficient strong catalog coverage
  ↓
targeted research
  ↓
validated knowledge persists for future users
```

### 4.2 Opportunistic enrichment

While researching one request, the agent encounters trustworthy evidence about already-known Experiences. That evidence may enrich those canonical Experiences even when they are not selected for the current tour.

### 4.3 Proactive maintenance

A background research policy may revisit knowledge that is stale, weak, contradictory or strategically important.

This MUST be priority-driven rather than indiscriminate crawling.

Conceptually:

```text
researchPriority =
    demand/popularity
  + evidence age
  + low confidence
  + conflicting observations
  + missing important facts
  + source/fact volatility
  + relevance to upcoming/current requests
```

The exact scoring policy is a future implementation decision.

---

## 5. Freshness is fact-specific

A single `experience.updatedAt` is not sufficient to express knowledge freshness.

Different facts have different volatility:

```text
canonical identity / stable geography     very slow-changing
museum / landmark existence               slow-changing
themes / intents                          relatively stable
route composition                         medium
images / editorial metadata               medium
opening hours                              volatile
price                                      very volatile
temporary closure                         very volatile
ratings / reviews                          volatile
events / seasonal availability            highly time-sensitive
```

Future enrichment/maintenance work should therefore model freshness at the observation/fact level or another equivalently precise boundary, not assume every property has the same TTL.

Unknown freshness is not equivalent to fresh and not equivalent to false.

---

## 6. Confidence and conflict

The system should be able to answer:

```text
What do we know about this Experience?
Which sources support it?
When was each relevant fact observed?
How strong is the corroboration?
Are sources disagreeing?
What important information is still missing?
Does anything need to be researched again?
```

Conflicting evidence is retained as evidence; it is not silently erased by provider order.

Derived canonical state remains deterministic and auditable.

---

## 7. Identity is independent from classification

A canonical Experience is not identified by its themes, intents or traits.

Multiple real Experiences may share:

```text
same destination
same AREA
same intent
same themes
similar names
some overlapping components
```

and still be different canonical Experiences.

Identity/dedupe, classification, traveler matching, ranking and diversity are separate concerns. The detailed rules live in:

`docs/superpowers/specs/2026-09-12-experience-identity-dedupe-and-diversity-design.md`

---

## 8. Relationship to tour generation

Tour generation consumes canonical knowledge; it does not own the knowledge lifecycle.

```text
living knowledge base
       ↓
preference-first retrieval
       ↓
strong-match / sufficiency
       ↓
ranking + diversity
       ↓
planner feasibility
       ↓
Tour
```

A valid Experience that is not selected for one request stays in the catalog.

A valid Experience can also be temporarily unusable for a specific request because of feasibility, freshness or insufficient current evidence without losing canonical identity.

---

## 9. Architectural invariants

1. **Catalog != search cache.**
2. **Persisted != finished.** Experiences are living knowledge objects.
3. **Observations are historical evidence; canonical state is derived.**
4. **Provider order never defines truth.**
5. **Identity is separate from themes/intents/traits.**
6. **User preferences never become evidence about the Experience itself.**
7. **No invented tourism composition.** Enrichment may add facts only when supported by real evidence.
8. **Refresh is targeted.** Staleness/conflict/gaps/demand drive future research; the system is not a blind crawler.
9. **Freshness is fact-specific.** Different facts may have different research cadence.
10. **Catalog knowledge is reusable across requests.** Request-specific feasibility remains request-specific.

---

## 10. 2026-09-22 amendment — partial component knowledge and enrichment

The RW1 forensic rerun on 2026-09-22 proved that source-backed composite
Experiences can be valuable research objects even while some geographic
components remain unresolved.

The canonical lifecycle is therefore refined:

```text
source-backed Experience/composition
        ↓
resolve every evidenced component
        ↓
per-component identity + geographic facts
        ↓
complete?
   ┌────┴────┐
  yes       no
   │         │
   │         └→ preserve research deficits / continue targeted research
   ↓
composite geographic validation
        ↓
verified canonical knowledge
        ↓
enrichment / refresh
```

"Partial" does not mean planner-eligible. The planner still consumes only
Experiences admitted by the canonical verification policy.

The system must preserve the distinction between:

- a hallucinated/unsupported composition, which is rejected;
- a source-backed composition with open component questions, which is useful
  research state;
- a verified Experience, which may still have thin traveler-facing content.

Open research deficits should be precise and auditable, for example
"identity ambiguous for Solar de French" rather than "rerun San Telmo
discovery".

Verification and enrichment are also separate knowledge dimensions. Wikidata,
Wikipedia, Wikimedia, Places reviews/photos/hours, TripAdvisor and official
sources may progressively make a verified Experience richer and more useful to
a traveler without becoming universal prerequisites for its geographic
identity.

Provider observations remain historical evidence. A failed corroboration is
not automatically contradictory evidence, and provider order or provider count
never defines canonical truth.

See:
`docs/superpowers/specs/2026-09-22-component-resolution-geographic-validation-and-enrichment-amendment.md`.

---

## 11. Future work intentionally not designed here

This document does not yet define:
- background scheduler technology;
- exact freshness schema / TTL values;
- exact confidence formula;
- source reliability scoring;
- observation supersession schema;
- conflict-resolution UI;
- proactive research budgets;
- automatic event/closure monitoring.

Those should be designed only after the current Preference-First / acquisition / identity boundaries are proven against the real database.

---

## 12. Product test for future milestones

Every future milestone should answer:

> **What new research capability does the Tourism AI Research Agent gain?**

If the only answer is "another internal abstraction" and the agent does not become better at discovering, validating, remembering, refreshing or applying real tourism knowledge, the milestone should be challenged before implementation.

## 2026-09-22 refinement — the catalog is the first research memory

The Living Tourism Knowledge Base must be reused before repeating external
identity research.

For a component of a newly discovered Experience:

```text
component hint
→ look for canonical GeoEntity already known by Zig-Zag
→ reuse when identity/context are sufficient
→ otherwise research only the missing/ambiguous fact externally
→ reconcile new observations into the canonical GeoEntity
```

This is not blind trust in cached rows. A stale, ambiguous or contradicted
canonical fact opens a targeted research deficit. The key invariant is that
each Tour request does not restart world knowledge from zero.

The two catalog identities remain separate:

```text
GeoEntity = physical reality
Experience = source-backed tourism/scheduling unit
```

Resolving a composite component grows/reuses GeoEntity knowledge. It does not
automatically create a standalone Experience. A standalone Experience appears
only when acquisition/discovery independently supplies tourism evidence for
that Experience, even if it references a GeoEntity that was already learned as
part of another composite.

The same GeoEntity may therefore support many independently discovered
Experiences over time.

Semantic embeddings belong to canonical Experiences after verification. They
personalize composition/planning against `PreferenceSpec.semanticQuery`; they
are not identity or geographic evidence. When the canonical Experience semantic
document changes materially — including removal of component
`required/optional` tokens — its document version must change and stale
embeddings must be rebuilt.

Planner capacity repair also remains catalog-first: reuse verified Experiences
and the ranked reservoir before external acquisition. Nearby/proximity may help
find candidates, but cannot establish membership in a source-backed composite.

