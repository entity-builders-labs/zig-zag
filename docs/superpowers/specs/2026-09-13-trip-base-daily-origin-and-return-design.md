# Trip Base / Daily Origin & Return — Planning Design Checkpoint

Status: **required design checkpoint before Checkpoint C; no B5/B6 implementation changes authorized.**
Written: 2026-09-13.
Branch: `feat/preference-first-selection`.

Related:
- `docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md`
- `docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md`
- `docs/superpowers/plans/2026-09-12-real-world-tourism-research-spike-gate.md`

---

## 1. Problem

The current preference-first model has a trip destination, requested facets, anchors, dates and pace, but it does not yet model the physical location from which the traveler starts a day.

That means a planner can optimize only:

```text
Experience A -> Experience B -> Experience C
```

while the traveler actually experiences:

```text
trip base / hotel
  -> Experience A
  -> Experience B
  -> Experience C
  -> trip base / hotel
```

The first and last legs can materially change feasibility, travel cost, usable day capacity and the best ordering. A plan that ignores them may look internally optimal while being poor in reality.

This is especially important for:
- large cities;
- lodging far from the main tourism cluster;
- early/late opening constraints;
- mobility/accessibility constraints;
- day trips and excursions that must leave from and return to an origin;
- multi-day trips where daily usable time depends on the accommodation location.

Therefore **Checkpoint C planning must not be considered complete until daily origin/return semantics are resolved and included in travel/feasibility calculations.**

This is not a blocker for B5 or B6. B5/B6 concern whether Zig-Zag can research, validate, classify and persist real tourism Experiences; the traveler's daily base is not part of Experience truth.

---

## 2. Canonical conceptual distinction

Three concepts must remain separate:

```text
Destination
= geographic scope of the trip / research

Tourism anchor
= a place/area/route the traveler explicitly wants or prefers

Trip base / daily origin
= where the traveler physically starts the day's itinerary
```

They are not interchangeable.

In particular:

```text
AnchoredPlace != TripBase
```

A tourism anchor expresses traveler intent such as:

```text
"quiero visitar Teatro Colon"
```

A trip base expresses operational geography such as:

```text
"estoy alojado en Hotel Madero"
```

The trip base MUST NOT:
- satisfy a requested tourism facet;
- enter Experience semantic classification;
- become catalog tourism knowledge merely because the traveler is staying there;
- create acquisition coverage;
- be treated as a `must` tourism Experience;
- alter Experience identity/dedupe.

It is planning/feasibility context.

---

## 3. Product requirement

The wizard needs a way, at an appropriate point after destination selection, to capture the location from which the traveler expects to begin daily touring.

Product concept, wording still open:

```text
Where will you start your daily outings?

- My accommodation
- Choose another place
- I don't know yet
```

The user should be able to identify an accommodation/place by normal place search rather than entering coordinates manually.

The exact UI, copy and screen placement are intentionally NOT finalized by this document. They must be resolved before live Checkpoint D cutover.

### Unknown must remain valid

Not knowing the accommodation yet must not block tour creation.

The system may plan with an explicitly unknown/approximate origin, but the output/trace must not pretend that first/last-mile routing is exact. When a concrete base later becomes available, the itinerary may need replanning.

---

## 4. Minimum planning semantics

Before Checkpoint C is accepted, the planner must have a canonical concept equivalent to a daily origin.

The final type/name is deliberately open, but conceptually:

```ts
interface TripBase {
  resolvedPlaceId?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  precision: 'exact' | 'approximate' | 'unknown';
}
```

This is illustrative, not an implementation contract yet.

For a normal tourism day with a known base, feasibility must account for:

```text
base -> first scheduled Experience
Experience -> Experience travel
last scheduled Experience -> required end location
```

The first leg is never free merely because the first Experience is inside the destination.

Likewise, when return-to-base applies, the last Experience cannot consume the full remaining day while ignoring the trip back.

---

## 5. Daily return policy — decision still open

A common default is likely:

```text
start at trip base
end at trip base
```

but this document does NOT prematurely make `return_to_base` universal.

Before Checkpoint C implementation, decide explicitly whether v1 supports:

```text
RETURN_TO_BASE
OPEN_END
CUSTOM_END
```

or only a smaller subset.

The important invariant is that the chosen policy be explicit and that feasibility include the corresponding final leg. Do not silently assume a zero-cost end-of-day location.

A future model may also support per-day overrides, for example:
- moving hotels;
- a day ending at an airport/station;
- an overnight excursion;
- a day trip beginning at a pickup point.

Do not implement those extensions unless required by the Checkpoint C decision.

---

## 6. Why destination centroid is not an acceptable substitute

The trip destination or its centroid may be useful as a fallback approximation when origin is unknown, but it is not equivalent to a real base.

Example:

```text
Destination: Buenos Aires
Trip base: Puerto Madero

Walk A: excellent preference match, far west
Walk B: slightly weaker match, close to base
```

The planner needs the real travel costs before deciding whether A, B, or a different order creates the best feasible itinerary.

A destination-level radius/centroid can still be used for acquisition/geographic validation. It must not masquerade as the traveler's exact daily origin.

---

## 7. Interaction with walks and composite Experiences

A composite walk remains one canonical Experience with real components.

For planning purposes, however, travel must connect to the effective entry/exit geography of that Experience rather than treating it as a point with zero internal structure.

Example:

```text
Hotel
  -> POI 1
  -> Walk X
       POI 2 -> POI 3 -> POI 4
  -> POI 5
  -> Hotel
```

The traveler experiences a continuous route even though catalog identity may be:

```text
Experience A = POI 1
Experience B = Walk X (components POI 2,3,4)
Experience C = POI 5
```

The trip-base design must therefore compose cleanly with future Checkpoint C decisions about complementary Experiences and walk entry/exit points. This document does not decide complementary-filler policy.

---

## 8. Day trips

Trip origin is even more important for day trips.

A candidate day trip is not feasible merely because the destination Experience exists. The planner must evaluate the complete day envelope from the current origin:

```text
trip base
  -> outbound travel
  -> destination Experiences
  -> return travel (when required)
  -> trip base / configured end
```

This aligns with the separate day-trip design: reusable destination knowledge does not make origin-bound feasibility reusable. Feasibility must be recalculated for the actual traveler/origin/time window.

---

## 9. Trace / Bitácora requirement

When origin is known, Generation Trace / Bitácora must make the operational assumption visible without confusing it with a preference.

At minimum retain:
- resolved base identity/name;
- precision (`exact` / `approximate` / `unknown` or final equivalent);
- start/end policy;
- first-leg travel estimate;
- final-leg travel estimate when applicable;
- feasibility failures caused by origin/return travel;
- whether planning used an approximation because the user had not supplied a base.

The product-facing Bitácora should say this in human language, e.g.:

```text
Start of day: your accommodation in Puerto Madero
First transfer: 22 min
Return to accommodation: 31 min
```

Technical provider/routing details remain expandable.

---

## 10. Required characterization before implementation

Do not design this only from types. Before or at the start of Checkpoint C, characterize realistic cases using the actual deterministic planner/travel-estimator boundaries:

1. **Known central hotel** — short first/last legs.
2. **Known peripheral hotel** — origin materially changes ordering/feasibility.
3. **Unknown accommodation** — explicit approximation/unknown behavior.
4. **One-day itinerary** — prove first and last travel consume the day budget.
5. **Multi-day same base** — every day starts from the base independently.
6. **Composite walk** — route to the correct walk entry and from its exit when order is known.
7. **Day trip** — outbound + destination content + return all fit the day window.
8. **Hard failure** — a seemingly attractive Experience becomes infeasible only after origin/return travel is included.

These are characterization scenarios, not authorization to retrofit B5/B6.

---

## 11. Gate before Checkpoint C completion

Checkpoint C cannot be declared complete if the planner still optimizes only inter-Experience travel while treating day start/end as free.

Before implementation begins, resolve these v1 decisions:

1. canonical field/type name (`tripBase`, `dailyOrigin`, or equivalent);
2. where it lives: `PreferenceSpec.trip`, separate planning context, or another canonical request structure;
3. wizard UX and place-resolution boundary;
4. exact vs approximate vs unknown semantics;
5. end-of-day policy (`return_to_base` / open end / supported subset);
6. multi-day default semantics;
7. composite Experience entry/exit semantics when ordered components are known;
8. travel-estimator integration and cache/key implications;
9. trace/Bitácora shape;
10. acceptance tests against real planning calculations.

Only then should the implementation plan for Checkpoint C be amended.

---

## 12. Non-goals now

This checkpoint does NOT authorize:
- changes to B5 walk/route acquisition;
- changes to B6 extraction;
- changes to Experience identity/dedupe;
- turning accommodations into tourism Experiences;
- implementing complementary POI filler policy;
- per-day moving-hotel support unless the C design explicitly requires it;
- inventing an origin from user GPS without an explicit product/privacy decision;
- silently using precise device location as the trip base.

---

## 13. Product invariant

> **A generated Tour is not geographically feasible unless travel is evaluated from where the traveler actually begins the day, through the scheduled Experiences, and to the required end-of-day location.**

This invariant belongs to planning, not Experience research, and becomes mandatory at Checkpoint C.