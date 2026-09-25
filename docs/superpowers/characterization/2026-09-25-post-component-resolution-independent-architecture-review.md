# Post-Component-Resolution Independent Architecture Review

Status: **external independent architecture review — reference only**  
Reviewer: **Cline / DeepSeek 4 Pro**  
Reviewed HEAD: `de99eaf1b34616165c59ef4d58f6e1c803667f2f`  
Date: **2026-09-25**

## Authority and source-integrity note

This document preserves the recovered second-pass independent review record
after reconciliation against the current branch state, canonical Progress, and
Stage 3/4/5 evidence.

It is **historical/reference evidence**. It does **not** override:

- current HEAD code;
- canonical specs;
- canonical Progress;
- later roadmap decisions.

The original full reviewer transcript is not available to this continuation
context. The material below is therefore the fullest recoverable second-pass
record from the preserved handoff and conversation conclusions. It is kept
deliberately detailed and close to the recovered wording, but passages are not
claimed to be a literal verbatim transcript unless they are shown as exact
code/data excerpts. If the original transcript is recovered later, append or
replace this recovery copy rather than silently presenting reconstructed prose
as verbatim reviewer output.

The value of this file is to preserve what the independent reviewer actually
raised — including findings that may later be rejected, superseded, or
reprioritized.

---

## Reconciliation context used by the second pass

The first review mixed historical and current-state facts. The second pass was
explicitly reconciled against:

- HEAD `de99eaf1b34616165c59ef4d58f6e1c803667f2f`;
- the canonical component-resolution Progress;
- Stage 3 catalog-first/verified-hint evidence;
- Stage 4 geographic + partial-composite evidence;
- Stage 5 trace + RW1 evidence;
- current code rather than old spike assumptions.

Important corrections carried into the second pass:

- the identity/geography milestone was not overengineering; it proved
  foundational correctness and observability;
- the corpus is not only San Telmo — Mendoza SIMPLE/COMPOSITE/MIXED evidence
  exists;
- generation already runs through outbox/processor asynchronously;
- San Martín references are harness debt, not evidence of production
  destination hardcoding;
- historical provider/routing findings must not automatically be promoted to
  current bugs after the architecture changed.

---

## 1. Main deterministic product bug: Experience dedupe

The strongest current bug is Experience dedupe, not component resolution.

Current utility:

`be/src/modules/tours/utils/experience-dedupe.util.ts`

uses:

```text
setOverlap =
intersection / Math.max(left.size, right.size)
```

and the ambiguous-candidate gate includes:

```text
componentOverlap >= 0.5
```

Therefore:

```text
standalone: [A]
composite:  [A,B]

componentOverlap = 1 / 2 = 0.5
→ AMBIGUOUS
→ fail closed
```

Stage 5 produced both orderings live:

```text
COLD 1:
composite persisted first
standalone lost

COLD 4:
standalone existed first
complete CGV-accepted composite lost
```

A three-component composite does not hit the same threshold:

```text
[A] vs [A,B,C]
→ 1/3
```

So the outcome is driven by component cardinality plus persistence order,
rather than Experience identity.

This conflicts with the domain model:

```text
GeoEntity != Experience
GeoEntity existence != Experience existence
component membership != standalone Experience authority
```

Core reviewer conclusion:

```text
A GeoEntity can legitimately participate in many Experiences.

Shared GeoEntity membership != same Experience identity.
```

The correction should not be a threshold tweak such as `0.5 → 0.6`.
Partial component-set containment must not by itself imply `SAME` or
`AMBIGUOUS`.

Expected coexistence example:

```text
Experience("Visit Plaza Dorrego")
components = [Plaza Dorrego]

Experience("San Telmo Historical Walk")
components = [Plaza Dorrego, Mercado]
```

Important invariant:

```text
Persistence order must not change the final catalog result.
```

Suggested regression characterization:

```text
[A] then [A,B]       → both coexist
[A,B] then [A]       → same final result

[A] vs [A,B,C]       → same semantics

same [A] vs same [A]
→ existing duplicate logic preserved

same [A,B] vs same [A,B]
→ existing duplicate logic preserved

partial overlap between two genuine composites
→ preserve current policy unless real evidence requires change
```

This was the review's highest-confidence immediate correction.

---

## 2. Extractor reliability remains an important evidence gap

Stage 5 observed:

```text
2 / 9 web extraction passes emitted candidates
```

The review explicitly treated this as a small observed sample, **not** as a
statistical extractor success rate.

Do not rewrite it as:

```text
extractor success rate = 22%
```

The next corpus should distinguish:

```text
usable evidence available?
extractor candidate produced?
well-formed empty response?
unrecognized envelope?
candidate component set?
candidate quality?
```

And keep separate:

- no composite produced;
- components varied;
- partial composite;
- candidate quality variance;
- provider-evidence variance.

The important question is not merely whether a candidate appeared, but where
useful evidence was lost, transformed, rejected, or correctly produced no
candidate.

---

## 3. Verified is not automatically a good tour

The deterministic core is strong at correctness:

- evidence;
- identity;
- geography;
- admission;
- planner eligibility;
- traceability.

That does not establish product quality.

Key strategic distinction:

```text
verified != good recommendation
verified != good tour
```

The review recommended beginning explicit evaluation of:

- relevance;
- touristic value;
- preference satisfaction;
- shape correctness;
- diversity;
- redundancy;
- feasibility.

A small human-reviewed representative corpus is enough to start. Roughly
20–30 requests is a reasonable characterization size. The review did not
require a complicated feedback system or a mandatory single numeric score.

---

## 4. Generalization must now move beyond RW1

The existing roadmap already calls for RW2–RW6. Use that corpus instead of
inventing a new parallel generalization program.

Especially important shapes:

- multi-area / cross-neighborhood;
- route-like geography;
- wine/regional route;
- foreign city;
- negative anti-fabrication.

Mendoza evidence already exists under:

`spikes/stage3-simple-composite-mixed-2026-09-23/`

Historical observations included items such as:

- Google Places radius behavior above 50 km;
- route-like routing behavior;
- a route candidate ending in `NO_OSM_MATCH`.

The review corrected an important interpretation error: current HEAD changed
since those spikes. Those findings are historical evidence and test ideas, not
automatically current bugs. Re-run against the current architecture before
promoting them.

---

## 5. Performance: separate structural from environmental

Current COLD runs in the roughly `260–374s` / `~400s` range are genuine
development/spike observations.

They are **not** demonstrated production-latency predictions because the
environment combines:

- free-tier providers;
- development quotas;
- public/shared endpoints;
- local Docker;
- local Postgres;
- local Nominatim/Overpass;
- cache-disabled test configurations;
- timeouts/retries.

The review's useful framing is:

```text
STRUCTURAL
ENVIRONMENTAL
UNKNOWN UNTIL PRODUCTION-SHAPED BENCHMARK
```

Structural examples:

- provider/component fanout;
- sequential dependencies;
- repeated resolution work;
- routing-call volume.

Environmental examples:

- free-tier limits;
- public APIs;
- local Docker;
- local DB/OSM;
- test instrumentation/config.

A notable observed characterization candidate was roughly:

```text
~124 Geoapify routing calls per run
```

The review did not treat that number as an automatic optimization mandate.
Questions to establish first:

```text
are they actual HTTP calls?
batching?
parallel/sequential?
cacheability by OD pair + mode?
cost?
latency contribution?
```

Production performance remains unknown until a production-shaped benchmark.

---

## 6. Repeated failed-resolution work on WARM runs

The review observed that some unresolved hints are acquired/resolved again on
WARM requests.

This is a real characterization finding, but it does **not** justify generic
negative caching.

Failure classes have different epistemic meaning:

```text
PROVIDER_FAILURE
→ never negative knowledge

NO_CANDIDATE_ACQUIRED
→ may be temporary

AMBIGUOUS
→ may improve with new evidence

IDENTITY_REJECTED
→ may have stronger negative value but still needs policy
```

If failure-memory is introduced later, it should be:

```text
typed
reason-aware
TTL/expiry-aware
```

---

## 7. Permanently red baseline suites degrade test signal

The milestone closed with known baseline failures:

```text
unit:
preference-first-architecture

integration:
2x acquisition-degradation
canonical-orchestration
```

The source-text/regex-based
`preference-first-architecture.spec.ts` still catches
`destinationBoundary` in the resolver.

The review's operational point was simple: a suite that is permanently expected
to be red weakens CI meaning.

Near-term cleanup should either make the architecture assertion meaningful and
green, or replace/remove the stale assertion. Apply the same standard to stale
integration baselines.

Goal:

```text
green means green
```

---

## 8. Catalog freshness and correction lifecycle

A persistent shared tourism catalog eventually needs more than successful
reuse.

Medium-term knowledge-base concerns include:

- provenance;
- freshness;
- reverification;
- identity correction;
- merge;
- supersession;
- stale fact lifecycle.

Specific corrected observation:

`verifiedHintNames` is append-only after an externally VERIFIED identity, but
it does **not** grow per request.

The real risk is stale/wrong learned names and correction lifecycle, not
request-count explosion.

---

## 9. Lifecycle state in metadata is typed-boundary debt

Current operational behavior depends on fields such as:

```text
metadata.generationStatus
metadata.generationFailureKind
metadata.generationRetryCount
```

Because lifecycle state influences behavior, the review classified this as
legitimate typed-boundary debt.

A future direction could move authoritative lifecycle state into typed Tour
columns/state while keeping audit material such as:

```text
generationTrace
executionSummary
```

in JSON.

Not urgent.

---

## 10. Geography/geometry observations

The independent review noted that `representativePoint` averages coordinates
and, for MultiPolygon, uses only the first polygon.

That is worth preserving as a known geometry simplification, but there was no
evidence requiring immediate change.

Likewise, the review did not promote the following automatically into active
work:

- NEAR threshold;
- POINT_RADIUS ROUTE/AREA relation;
- MultiLineString planner footprint;
- representativePoint MultiPolygon refinement;
- required-column migration;
- San Martín hardening;
- anchor Nominatim namespace.

These remain deferred until real product evidence justifies them.

---

## 11. San Martín and provider plurality corrections

The review corrected two earlier overstatements:

1. **San Martín is harness debt, not production hardcoding.** It should not be
   "fixed" merely because it appears in a spike/test harness.
2. **Grounded provider plurality is acceptable while characterizing
   providers.** Multiple grounded providers are not inherently architectural
   pollution when identity/geography authority remains centralized and
   auditable.

---

## 12. Maintainability debt is real but not the current frontier

The review called out very large services, approximately:

```text
ExperienceProposalResolverService ~2820 lines
ExperienceGenerationService ~2150 lines
```

This is a maintainability signal.

It is **not** a reason for a broad refactor now. The preferred sequencing is to
let dedupe semantics, generalization, extractor behavior, and product-quality
evidence stabilize first, then revisit service decomposition with behavior
already pinned down.

---

## 13. Architectural assessment after reconciliation

The corrected second-pass assessment was materially more favorable to the
current direction than the first review.

Important conclusions:

- identity/geography work was foundational, not gratuitous overengineering;
- the deterministic core now explains failure states with much higher fidelity;
- the main concrete current product bug is Experience dedupe;
- extractor reliability needs broader characterization;
- factual verification and product/tour quality are separate evaluation axes;
- development spike timings cannot be extrapolated directly to production;
- broader real-world generalization should happen before agentic convergence;
- large-service and geometry simplifications are debts to track, not reasons
  to derail the current product sequence.

The desired direction remains:

```text
personal travel research agent
catalog = persistent shared tourism knowledge base
agent decides what trip still needs
deterministic core owns truth/validation/ranking/planning
feedback and replanning eventually close the loop
```

---

## 14. Recommended execution order from the review reconciliation

```text
1. preserve this review as reference
2. update canonical roadmap with adopted findings
3. correct Experience dedupe policy
4. focused deterministic + live regression
5. RW2–RW6 generalization
6. extractor reliability characterization
7. tour-quality evaluation
8. production-shaped performance characterization later
```

Do not use post-milestone cleanup as a reason to reopen or extend the completed
component-resolution milestone.
