# B7 — Day Trip / Escapada Acquisition & Validation — Implementation Plan

Status: **planned, blocked on design decisions in the canonical day-trip spec. Do not implement yet.**
Branch of record: `feat/preference-first-selection`
Written: 2026-09-12

Canonical design:
- `docs/superpowers/specs/2026-09-12-day-trip-acquisition-and-validation-design.md`

Related:
- `docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md`
- `docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md`
- B5 area/route walk acquisition
- B6 narrow web extraction contract

This is the future **B7** task for the Preference-First roadmap. It is kept
separate from B5 because `day_trip` is an origin-bound/open-destination problem,
not area/route-scoped walk validation.

---

## 0. Execution gate

Do not implement B7 until the day-trip design spec resolves at least:

1. how `intent:day_trip` is satisfied when the final day is composed from normal
   destination-local Experiences rather than a real published composite day-trip
   Experience;
2. the minimum-useful-destination-time policy;
3. the supported travel modes / fail-closed behavior for unsupported transport;
4. the provider-neutral reusable destination-evidence shape.

B7 must not invent answers to these during coding.

---

## 1. Characterize current `day_trip` behavior

Before code changes:
- identify every current `day_trip` routing/matching call site;
- characterize whether it is treated as a normal Experience intent, an
  acquisition query modifier, or both;
- identify current FROM-base query behavior;
- identify what current travel estimator(s) can prove for car/transit/walk and
  what they cannot prove (ferry/border cases especially);
- document existing persistence/reuse behavior for day-trip discoveries;
- add characterization tests before changing semantics.

Output:
- `docs/superpowers/characterization/...day-trip-current-semantics.md`

---

## 2. Resolve the `day_trip` fulfillment contract

Amend the canonical Preference-First design after review of the B7 spec.

Must distinguish:

```text
A. real published day-trip Experience
   -> normal Experience may carry intent:day_trip

B. feasible destination-local day plan
   -> normal Experiences + travel logistics
   -> MUST NOT require fabricating a fake composite Experience
```

Do not proceed until the canonical strong-match/sufficiency semantics for case B
are explicit.

---

## 3. Add provider-neutral day-trip request/candidate shapes

Introduce only transient planning/acquisition shapes needed for origin-bound
processing. Do not add a persistent structural `DAY_TRIP` domain type.

Conceptually:

```ts
interface DayTripDiscoveryContext {
  origin: ResolvedDestination;
  planningDayWindowMinutes: number;
  preferenceSpec: PreferenceSpec;
  travelConstraints: unknown;
}

interface DayTripDestinationCandidate {
  destination: ResolvedDestination;
  evidenceKeys: string[];
  sourceReasons: string[];
}

interface DayTripFeasibility {
  feasible: boolean;
  outboundMinutes?: number;
  returnMinutes?: number;
  requiredBufferMinutes?: number;
  usableDestinationMinutes?: number;
  reasonCodes: string[];
}
```

Exact interfaces must follow existing project boundaries discovered in task 1.

---

## 4. Reuse-first destination / Experience knowledge

Before provider discovery:
- reuse existing grounded destination/day-trip evidence when available;
- reuse canonical Experiences already persisted for candidate destinations;
- never use previous travel feasibility as universal truth;
- recalculate origin/time feasibility for every request.

Required convergence test:

```text
request #1 Buenos Aires -> Tigre
  content miss -> acquisition -> persistence

request #2 same request
  reuse content knowledge
  no repeated content acquisition
  travel feasibility recalculated
```

No opaque day-trip cache table.

---

## 5. Open-destination acquisition

For `intent:day_trip` without a named destination:
- discover real candidate destinations from grounded tourism sources;
- prefer structured/official evidence where available;
- use grounded web discovery for long-tail gaps;
- do not turn radius-near POIs into a destination/day-trip proposition;
- resolve every candidate destination to trusted geography before use.

For an explicit destination request (e.g. "escapada a Tigre"), evaluate the
named destination directly rather than requiring an article to justify that the
user meant Tigre.

Tests:
- open destination returns grounded candidates only;
- explicit destination is evaluated directly;
- arbitrary nearby POIs do not create a candidate excursion;
- provider failure degrades locally, never fabricates a destination.

---

## 6. Round-trip travel feasibility

Add a deterministic service/pure policy over the existing travel-estimation
boundary.

Conceptually:

```text
usableDestinationMinutes =
  dayWindow
  - outbound
  - return
  - mandatory transfer/border/terminal buffers
```

A candidate is eligible only when enough usable time remains for meaningful
Experience scheduling under the canonical policy resolved in the spec.

Rules:
- no universal max-km shortcut;
- unsupported mode => UNKNOWN/not selectable, never guessed;
- preference/quality/embedding/exploration signals cannot override infeasibility;
- opening-hours/final schedule remain planner authority.

Required cases:
- Buenos Aires -> Tigre feasible fixture;
- attractive but too-far destination rejected;
- unsupported ferry/border path fails closed;
- same destination from a different origin recalculates and may reject.

---

## 7. Destination-scoped Preference-First retrieval/acquisition

For each feasible candidate destination:
- retrieve canonical Experiences by requested facets inside/associated with that
  destination;
- apply the normal strong/weak contract;
- acquire only for real missing coverage/capacity;
- resolve/classify/persist through canonical paths;
- re-retrieve persisted state before ranking/composition.

Do not rank a destination highly simply because it has many generic POIs.
Preference fit and Experience quality remain primary after hard feasibility.

---

## 8. Published composite day-trip Experiences

When evidence explicitly establishes a real composite excursion:
- extract its real named component hints under B6 rules;
- resolve every required component;
- no invented coordinates;
- order only from explicit sequence evidence;
- persist as a normal multi-component Experience;
- allow `intent:day_trip` only from canonical evidence/classification authority.

Do not synthesize such an Experience from a generic list like:

```text
"10 things to do in Tigre"
```

The deterministic planner may still schedule individually valid Experiences in
Tigre without persisting a fake composite.

---

## 9. Deterministic candidate ranking

After hard feasibility passes, rank day-trip alternatives deterministically
using documented signals such as:
- requested facet coverage / strength;
- Experience quality/grounding;
- usable destination time;
- travel burden;
- evidence-backed exploration tilt;
- stable tie-breakers.

Embeddings/exploration remain ranking-only. They cannot establish destination
truth, day-trip suitability, Experience truth or feasibility.

---

## 10. Planner handoff

Planner input must clearly separate:
- outbound travel;
- destination-local Experiences;
- local travel between scheduled Experiences;
- return travel.

Outbound/return legs are logistics, not fake Experience components.

Hard return-to-origin feasibility must survive final scheduling. If later
opening-hours/routing calculations make the excursion infeasible, reject/backfill
rather than violating the return constraint.

---

## 11. Trace / Bitacora

Expose concise product-level decisions:

```text
Tigre considered as day trip
  -> destination grounded
  -> round trip feasible
  -> 5h 10m usable in destination
  -> strong matches: delta / food
  -> selected
```

Rejected example:

```text
Destination X considered
  -> real destination
  -> round trip leaves insufficient usable time
  -> rejected as day trip
```

Technical provider payloads remain expandable in Trace v4; they must not be
required to understand the decision.

---

## 12. Real integration/e2e acceptance matrix

Use real Postgres. Mock only external providers/travel transports as needed for
determinism.

Required scenarios:

1. Buenos Aires -> Tigre: feasible, strong matching Experiences -> selectable.
2. Buenos Aires -> San Antonio de Areco: feasible only when full-day window
   leaves enough useful time.
3. Buenos Aires -> Colonia: unsupported ferry/border estimator -> fail closed,
   not straight-line approximation.
4. Too-far candidate with excellent content -> rejected by round-trip
   feasibility.
5. Nearby POIs without day-trip/destination evidence -> no invented excursion.
6. Real published composite day trip -> normal Experience persistence.
7. Generic destination list -> no fake composite Experience.
8. Cold request persists reusable content; second identical request does not
   reacquire content.
9. Same destination from a different origin reuses content but recomputes and
   may fail feasibility.
10. Preference-first ranking chooses stronger user-fit destination over a larger
    but irrelevant POI pool.

---

## 13. Non-goals

- no `DAY_TRIP` structural enum/domain model;
- no generic B5 walk/route changes;
- no B6 evidence-authority rewrite inside B7;
- no global `dayTripFeasible` persisted flag;
- no straight-line-distance feasibility fallback posing as travel time;
- no fake composite Experience to satisfy facet accounting;
- no provider-specific ferry/border hacks hidden in generic logic;
- no LLM authority over geography, travel feasibility or planner hard
  constraints.

---

## 14. Definition of done

B7 is complete only when:

```text
origin-bound open-destination discovery is explicit
reuse-first content knowledge works
round-trip feasibility is deterministic and hard
unsupported transport fails closed
destination-local retrieval is preference-first
no nearby-POI day trip is fabricated
published composites use normal Experience grounding rules
second identical request avoids unnecessary content acquisition
same content can be re-evaluated from a different origin
planner can guarantee return-to-origin within the day
```

Until the design-gate decisions in section 0 are resolved, keep B7 status
**BLOCKED / PLANNED**, not IN PROGRESS.
