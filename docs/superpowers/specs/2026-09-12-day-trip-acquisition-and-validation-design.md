# Day Trip / Escapada Acquisition & Validation — Preference-First Design

Status: **draft, pending design review. Docs-only. Not authorization to implement.**
Branch of record: `feat/preference-first-selection`
Written: 2026-09-12

Related:
- `docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md`
- `docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md`
- `docs/superpowers/specs/2026-09-12-day-trip-acquisition-and-validation-design.md` (this document)
- D5 / B5 area-route walk acquisition remains separate.
- B6 narrow web extraction remains the evidence-to-composition authority for discovered composite Experiences.

---

## 1. Purpose

Define the canonical semantics for `intent:day_trip` / escapadas inside the
Preference-First architecture.

A day trip is not the same problem as an area walk or a named route:

```text
walk / route
  known geographic scope or route
  -> find/reuse an Experience in that scope

open-destination day trip
  known origin/base
  -> discover a plausible destination
  -> prove it is a real tourism choice
  -> prove outbound + useful destination time + return fit in the day
  -> retrieve/acquire real Experiences there
```

The key distinction is that a day trip is **origin-bound and open-destination**.
Tigre may be a valid day trip from Buenos Aires while the same destination is
not a valid day trip from Mendoza. The destination and its Experiences are
reusable catalog knowledge; day-trip feasibility is request/origin specific.

---

## 2. Non-negotiable invariants

1. `day_trip` remains an **intent**, never a structural Experience/GeoEntity
   type. Do not add `DAY_TRIP`, `EXCURSION`, `ESCAPADE`, `TourStop`, or another
   parallel domain model solely for this feature.
2. Day-trip discovery is **origin-bound**. A destination is never globally
   labelled "day-trip feasible" without reference to an origin and travel
   window.
3. Open-destination day-trip discovery is **not radius-only discovery**. Nearby
   POIs do not automatically imply a meaningful day trip.
4. **No invented day-trip composition.** Three attractions near one another do
   not authorize synthesizing "Tigre Day Trip" or any other composite
   Experience unless grounded evidence establishes that Experience.
5. Destination geography and every Experience component remain provider-grounded
   (OSM / Places / trusted geography); an LLM never establishes coordinates or
   identity.
6. **Reuse first.** Reuse persisted destination/Experience knowledge before
   provider acquisition. Recompute travel feasibility for the current origin /
   date / transport context rather than treating old feasibility as universal
   truth.
7. Travel feasibility is a hard eligibility gate. Preference strength, quality,
   embeddings or exploration style cannot make an infeasible excursion feasible.
8. The normal catalog stays cumulative: valid destinations/evidence and valid
   Experiences discovered during a day-trip request are reusable by later
   requests even when not selected now.
9. `ExperienceComponent.order` is non-null only when evidence explicitly proves
   a visiting sequence. Travel from/to the origin is logistics, not fabricated
   component order.
10. B5 area/route semantics must not be reused blindly for day trips. A day-trip
    destination is not required to lie inside the origin boundary.

---

## 3. Terminology

### Origin / base

The currently selected trip destination or base from which the traveler leaves
and to which the traveler must return during the same planning day.

Examples:
- Buenos Aires for a Tigre excursion;
- Paris for Versailles;
- Lisbon for Sintra.

### Day-trip destination

A real resolved place/area outside (or meaningfully separate from) the normal
local planning scope that is a plausible excursion target from the origin.

Examples:
- Tigre from Buenos Aires;
- San Antonio de Areco from Buenos Aires;
- Colonia del Sacramento from Buenos Aires when ferry/border feasibility is
  supported;
- Versailles from Paris.

A destination is discovery scope, not automatically a schedulable Experience.

### Destination-local Experience

A normal canonical `Experience` located at / associated with the day-trip
candidate destination.

Examples for Tigre could include a real Delta boat experience or another
provider/evidence-backed tourism Experience. They are not invented merely to
fill the day.

### Published day-trip Experience

A source may itself describe a real composite day-trip Experience, for example a
specific evidence-backed excursion with named components. Such a result may be
persisted as a normal multi-component `Experience` with `intent:day_trip`, using
all normal resolution/evidence/order rules.

This is distinct from the planner assembling unrelated nearby POIs into a fake
composite day trip.

---

## 4. Canonical high-level flow

```text
PreferenceSpec contains intent:day_trip
        |
        v
resolve origin/base deterministically
        |
        v
reuse known day-trip destination / Experience knowledge for this origin context
        |
        | insufficient
        v
discover real candidate destinations from grounded sources
        |
        v
resolve each destination to trusted geography
        |
        v
estimate outbound + return travel for current request
        |
        v
reject infeasible candidates
        |
        v
for feasible candidates:
retrieve catalog Experiences by user facets within destination scope
        |
        | insufficient
        v
acquire real Experiences for missing knowledge
        |
        v
re-retrieve canonical persisted Experiences
        |
        v
rank feasible day-trip alternatives preference-first
        |
        v
deterministic planner schedules travel + selected Experiences + return
```

Discovery and feasibility are separate concerns:

```text
"Is Tigre a real excursion candidate?"      -> discovery / evidence
"Can this user go and return this day?"     -> travel feasibility
"What should they actually do there?"       -> canonical Experience retrieval
```

---

## 5. Destination discovery

### 5.1 Reuse first

Before web/provider discovery, reuse any existing grounded knowledge that can
produce candidate destinations/Experiences for the origin and `day_trip`
request.

The implementation should reuse the canonical catalog/evidence boundaries. Do
not add a second arbitrary raw-Prisma search window or a new opaque day-trip
cache.

A persisted Experience discovered previously may be reusable content, but its
current trip feasibility must still be recalculated from the new request's
origin/time context.

### 5.2 Open-destination acquisition

When the user has not named a destination, acquire candidate destinations from
sources that can establish a meaningful tourism excursion, for example:
- official tourism / transport information;
- Wikivoyage `Get out` / day-trip style content when present;
- structured destination evidence;
- grounded web discovery for long-tail cases.

Do not infer a day-trip destination solely because:
- it is within N kilometers;
- several POIs exist there;
- an embedding is similar;
- an LLM says it "sounds like a good excursion" without grounded evidence.

### 5.3 Explicit destination request

If the traveler explicitly names the destination, e.g.:

```text
"Quiero hacer una escapada a Tigre"
```

the named destination itself is sufficient reason to evaluate that destination.
External evidence still grounds identity/geography and the Experiences there,
but B7 does not need an article saying "Tigre is a day trip" merely to respect
an explicit user destination request.

---

## 6. Travel feasibility

Day-trip feasibility is evaluated for the **current request**, never persisted as
an unconditional Experience property.

Conceptually:

```text
usableDestinationMinutes =
  planningDayWindowMinutes
  - outboundTravelMinutes
  - returnTravelMinutes
  - requiredTransferOrBorderBuffers
```

A candidate is feasible only when enough usable time remains to schedule at
least one meaningful matching Experience (or a grounded published day-trip
Experience) plus the required planner/travel buffers.

Do not invent one universal maximum distance. Time and transport mode are the
actual constraints.

Examples:

```text
Buenos Aires -> Tigre
short outbound + return
meaningful usable time remains
-> may be feasible

Buenos Aires -> a destination requiring ~4.5h each way
little/no useful destination time remains
-> reject as day trip even if destination itself is excellent
```

### 6.1 Transport support

Use the existing deterministic travel-estimation boundary where it supports the
required transport mode.

Unsupported transport must not be silently approximated as driving/walking.
Examples such as Buenos Aires -> Colonia require ferry and border/terminal
semantics. Until the travel provider/policy can model that path credibly, the
candidate must remain unknown/not selectable rather than being declared feasible
from straight-line distance.

### 6.2 Hard feasibility wins

A highly preferred candidate cannot override:
- inability to return within the day;
- impossible/unsupported transport;
- insufficient destination time;
- planner hard constraints.

---

## 7. Experience retrieval inside the candidate destination

Once a destination is geographically resolved and travel-feasible:

1. retrieve canonical Experiences inside/associated with that destination per
   the user's real requested facets;
2. apply the normal strong/weak match contract;
3. if preference coverage / usable candidate breadth is insufficient, acquire
   only the missing knowledge;
4. resolve, validate, classify and persist via the normal pipeline;
5. re-retrieve canonical persisted state before composition.

This preserves the Preference-First invariant:

```text
find where a day trip can work
        +
find what THIS user would value there
```

A destination with many irrelevant Experiences should not outrank a destination
with fewer but much stronger preference matches merely because it has more POIs.

---

## 8. Persistence and reuse semantics

Persist/reuse **facts and Experiences**, not request-specific feasibility as
universal truth.

Reusable:
- resolved destination identity/geography;
- source evidence that a destination is a known excursion/day-trip option;
- canonical destination-local Experiences;
- a real published composite day-trip Experience, when evidence supports it;
- semantic classification / quality / evidence under normal catalog contracts.

Recompute per request:
- origin -> destination travel time;
- destination -> origin travel time;
- transport availability/mode;
- border/terminal buffers where relevant;
- available planning-day window;
- opening-hours feasibility;
- final schedule.

Therefore:

```text
request #1: Buenos Aires -> Tigre
  discover / persist reusable knowledge
  calculate Buenos-Aires-specific feasibility

request #2: Buenos Aires -> Tigre
  reuse destination + Experiences
  recalculate current travel/day feasibility
  no unnecessary content reacquisition

request #3: Mendoza -> Tigre
  may reuse Tigre knowledge
  must calculate Mendoza-specific feasibility
  likely reject as a day trip
```

---

## 9. Representation: no fake composite requirement

Two valid representations must remain distinct.

### A. Real published composite day trip

If evidence explicitly defines a real excursion and its real named components:

```text
"Full-day Tigre Delta excursion"
  -> component A
  -> component B
  -> component C
```

it may become a normal multi-component `Experience` with normal evidence,
resolution and optional explicit order.

### B. Destination-local planning without a published composite

If evidence only establishes that Tigre is a legitimate excursion destination,
B7 must NOT manufacture a single composite Experience from arbitrary local
POIs.

The deterministic planner may schedule independently valid canonical
Experiences at that destination, with origin/destination travel as logistics.

This is planning composition, not invention of Experience identity.

---

## 10. Relationship to the `day_trip` facet — design decision still required

The existing Preference-First model treats intents as Experience facets. Open-
destination day trips expose a legitimate edge case:

- a real published day-trip Experience can directly carry `intent:day_trip`;
- a feasible excursion may instead consist of normal destination-local
  Experiences plus day-level travel logistics, with no honest composite
  Experience that should be tagged `day_trip`.

Before B7 implementation, the main Preference-First contract must explicitly
resolve whether `intent:day_trip` can be satisfied at the **day-plan/bundle
level** in this second case, rather than fabricating `day_trip` onto unrelated
Experiences.

Until that decision is made:
- do not tag arbitrary Experiences `day_trip` merely because they are reachable
  from an origin;
- do not manufacture a composite Experience solely to satisfy facet accounting;
- do not weaken canonical per-Experience facet matching silently.

This is the main semantic decision B7 needs before implementation.

---

## 11. B6 boundary

B6 remains authoritative for evidence-to-composition extraction.

Example:

```text
source: "10 things to do in Tigre"
```

is NOT enough to create:

```text
"Tigre Day Trip"
stop 1 -> stop 2 -> stop 3
```

A real composite requires source evidence that the composite Experience exists.
B7 may still use individually verified Experiences in deterministic day
planning, without persisting the invented composite.

---

## 12. Acceptance examples

### Example A — Buenos Aires -> Tigre

```text
origin: Buenos Aires
intent: day_trip
candidate: Tigre

real destination evidence             yes
trusted geography                     yes
round-trip feasible                   yes
usable destination time               sufficient
matching real Experiences             yes

=> eligible day-trip alternative
```

### Example B — Buenos Aires -> San Antonio de Areco

```text
origin: Buenos Aires
candidate: San Antonio de Areco

resolve real destination
estimate round trip
retrieve/acquire real gaucho/history/food Experiences by preference
ensure enough usable time remains

=> eligible only if full-day feasibility passes
```

### Example C — Buenos Aires -> Colonia

```text
origin: Buenos Aires
candidate: Colonia del Sacramento

real destination                      yes
potentially meaningful tourism        yes
transport requires ferry/border logic

if ferry/terminal/border feasibility supported -> evaluate normally
if unsupported -> UNKNOWN / not selectable

NEVER approximate as straight-line/driving feasibility
```

### Example D — attractive but too far

```text
excellent destination
excellent Experience matches
outbound + return consumes most of day

=> reject as day trip
```

The destination remains valid catalog knowledge; only the current day-trip
feasibility fails.

### Example E — nearby POIs are not enough

```text
3 attractions discovered 90 km from origin
no destination/day-trip evidence
no real composite Experience evidence

=> do not invent "90 km Day Trip"
```

### Example F — second identical request

```text
first Buenos Aires -> Tigre request
  content miss -> discover + persist

second request
  reuse destination/Experiences
  recalculate current travel feasibility
  no repeated content acquisition unless knowledge is actually missing/stale
```

---

## 13. Suggested B7 implementation boundaries

B7 should eventually own:
- origin-aware day-trip candidate discovery/routing;
- reusable destination/day-trip evidence lookup;
- candidate destination resolution;
- round-trip feasibility evaluation;
- destination-scoped Preference-First retrieval/acquisition;
- deterministic ranking of feasible alternatives;
- trace/Bitacora reason codes for discovery, rejection and selection;
- real integration tests with external transports mocked and persistence real.

B7 should NOT own:
- generic B5 area/route walk acquisition;
- B6 extraction authority;
- a new scheduler/domain object family;
- provider-specific travel hacks;
- invented travel times;
- global persisted `dayTripFeasible=true` flags.

---

## 14. Open decisions before implementation

1. **Facet fulfillment:** how `intent:day_trip` is marked satisfied when the day
   is composed from normal destination-local Experiences rather than one real
   published composite day-trip Experience.
2. **Minimum useful destination time:** derive from scheduled Experience duration
   + planner policy, or introduce an explicit named minimum policy; do not bury a
   magic constant in acquisition code.
3. **Supported transport modes:** define what the active travel estimator can
   prove in v1 and fail closed for unsupported ferry/border cases.
4. **Reusable destination evidence shape:** prefer existing provider-neutral
   observation/catalog metadata; add no new table unless existing boundaries are
   demonstrably insufficient.
5. **Ranking trade-off:** document the deterministic balance among preference
   coverage/quality, travel burden and usable destination time. Travel burden is
   a ranking signal only after feasibility passes.

---

## 15. Canonical summary

```text
day_trip = origin-bound excursion intent

destination discovery != Experience invention
travel feasibility != persisted destination truth
nearby POIs != day-trip evidence
published day-trip composite != planner-created day schedule
reuse content knowledge; recompute origin/time feasibility
hard round-trip feasibility wins
```
