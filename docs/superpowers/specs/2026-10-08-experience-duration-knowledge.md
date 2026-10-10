# Experience Duration Knowledge

Status: **PROPOSED / DEFERRED**  
Track candidate: experience-duration-knowledge  
Canonical placement: **Planner Product Acceptance — duration feasibility**  
Start condition: **Preference-First integrated into main and a separate track explicitly authorized**

This document is a durable product/domain specification for a future feature.
It is **not** an active implementation plan and does not authorize changes to
the current Preference-First track.

---

## 1. Problem

The planner needs a temporal cost for an Experience in order to decide whether
it fits in a day and how much capacity remains.

Today an Experience may have no factual durationMinutes. Composite Experiences
commonly fall back to a configured planning assumption. The current code also
contains a separate catalog projection fallback, so an unknown duration can
acquire different planning values depending on the path used.

A policy fallback is useful for degraded planning, but it is not factual
Experience knowledge.

The product must distinguish:

~~~text
USER TIME BUDGET
how much time the traveler wants to spend

EXPERIENCE DURATION KNOWLEDGE
how much time the Experience actually / typically requires

PLANNING FALLBACK
a policy assumption used only when duration knowledge is unavailable
~~~

These concepts must never be conflated.

---

## 2. Product intent

Duration should become evidence-backed reusable catalog knowledge.

When web/source acquisition encounters an explicit duration claim, the system
should be able to preserve that observation with provenance and later reuse it
without reacquiring the same fact.

Examples include:

- an article stating that a walking route takes approximately three hours;
- an official attraction page recommending 60–90 minutes;
- a source describing a stop as a brief pass-by rather than a full visit.

The planner consumes reconciled canonical knowledge. It should not invent a
factual duration merely because scheduling requires a number.

---

## 3. Evidence acquisition

Duration evidence may be discovered opportunistically during:

1. initial search/source acquisition;
2. deep/source-content examination;
3. a future targeted enrichment pass when duration knowledge is materially
   missing.

Acquisition must remain bounded by the owning track's provider/cost policy.

A duration observation is accepted only when the source actually supports the
claim. Search-result text, extracted source content or normalized provider facts
must retain enough support/provenance to audit the observation.

No provider-specific downstream branch may become duration authority.

---

## 4. Duration observations

Persist the observation and its provenance, not only a final scalar.

The eventual typed contract should be able to represent at least:

- the observed duration or range;
- what the duration applies to:
  - whole Experience;
  - source member / POI;
  - route leg when explicitly stated;
- source/evidence identity;
- support text or equivalent evidence reference;
- observation time;
- acquisition/extraction provenance;
- whether the value is source-declared or system-derived.

Exact storage shape is an implementation decision for the future track.

Canonical behavior must not depend on undocumented metadata keys.

---

## 5. Evidence authority

Prefer direct evidence over derivation.

Conceptual precedence:

~~~text
explicit duration for the whole source-defined Experience
        ↓
explicit visit/dwell evidence for source members
        ↓
other grounded duration observations
        ↓
derived composite duration
        ↓
typed planning fallback while knowledge remains unknown
~~~

This is not permission to overwrite older observations using last-write-wins.

Multiple observations may agree, provide a range, or conflict. Reconciliation
must preserve the evidence needed to explain the canonical result.

The future track must define deterministic conflict/range policy before such
observations become authoritative planning facts.

---

## 6. Composite Experience duration

When authoritative whole-Experience duration is known, consume it directly.

When it is not known but sufficient member knowledge exists, a composite may be
derived conceptually as:

~~~text
member visit/dwell time
+
internal travel between relevant consecutive members
~~~

This is not a blind sum over every source member.

Source-member role matters. Examples:

- ITINERARY_STOP: may contribute visit/dwell time;
- PASS_BY: normally must not be treated as a full visit;
- TRANSFER_DESTINATION: travel semantics may dominate;
- AREA: must not automatically become a fixed POI dwell;
- optional/alternative members must respect the accepted source-composition
  semantics.

The exact role-to-duration policy belongs to the future implementation plan and
must be evidence/policy explicit.

---

## 7. Internal travel

Internal travel is distinct from dwell/visit time.

The planner already has mobility concepts for internal walking/travel and
inter-Experience routing. The future duration feature must reuse the canonical
routing/mobility authority instead of introducing a second travel-time
calculation.

A derived composite duration must not silently double-count travel already
represented by another canonical planning field.

---

## 8. Catalog and WARM behavior

Evidence-backed duration is catalog knowledge.

Expected lifecycle:

~~~text
COLD acquisition
→ source exposes duration evidence
→ normalize observation
→ validate/reconcile
→ persist canonical knowledge + evidence

later WARM generation
→ catalog supplies duration knowledge
→ no web lookup is required merely to recover the same duration fact
~~~

Later stronger or conflicting evidence may enrich/reconcile the canonical
knowledge for future Tours.

Existing Tour snapshots remain historical snapshots according to the existing
Tour materialization contract.

---

## 9. Unknown duration and fallback policy

Unknown must remain unknown as catalog knowledge.

A planner may still require a fallback to schedule an Experience whose factual
duration is unavailable. That fallback must be:

- owned by one canonical planning policy;
- explicitly marked/traceable as a fallback;
- configurable where appropriate;
- never persisted or exposed as though it were factual source knowledge.

Current implementation debt discovered during Preference-First:

- dailyPlanningPolicy.compositeDefaultDurationMinutes currently defaults to
  90 minutes. This is a centralized but **uncalibrated product-policy
  heuristic**, not factual duration.
- catalog projection paths currently contain an independent hardcoded
  120-minute fallback. That value is **not canonical duration authority** and
  must not create path-dependent planning behavior.

Preference-First should only remove the path inconsistency by using one
canonical fallback policy. Calibrating/replacing the fallback belongs to this
future feature/quality work.

---

## 10. Planner / user semantics

The user's requested available time is a constraint on the plan, not a source
of Experience duration truth.

For example, "I have four hours" means the Tour has a four-hour budget. It does
not mean every candidate Experience should be stretched or truncated to four
hours.

Conversely, evidence that a source-defined Experience takes three hours affects
whether it fits inside that user budget.

---

## 11. Traceability

Planner/Bitácora output must eventually distinguish at least:

- evidence-backed duration;
- derived duration;
- planning fallback.

When material, it should expose the provenance/reason without leaking
provider-specific raw payloads into domain logic.

A fallback value must never appear indistinguishable from a factual observation.

---

## 12. Non-goals

This spec does not authorize:

- hardcoded category assumptions such as museum = 60 minutes without an
  explicitly accepted evidence/policy model;
- provider-name branching in planner/catalog logic;
- a new routing implementation;
- changes to source-composition identity;
- unioning distinct Experiences merely to calculate duration;
- changing user time-budget semantics;
- implementation inside feat/preference-first-selection beyond eliminating
  duplicate/path-dependent fallback authority.

---

## 13. Future track bootstrap

When the owner explicitly authorizes this feature after Preference-First is
integrated, governance should create a separate track:

~~~text
track id: experience-duration-knowledge
integration target: main
spec: docs/superpowers/specs/2026-10-08-experience-duration-knowledge.md
~~~

The track bootstrap should then create its own implementation plan, progress
document, branch, registered worktree and Draft PR according to the repository
governance workflow.

Until then this spec remains PROPOSED / DEFERRED and should not appear as an
ACTIVE track.
