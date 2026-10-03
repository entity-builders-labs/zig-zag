# Experience Curation & Review — Design

Status: **canonical design record. Docs-only. NON-BINDING future capability.**
Branch of record: `feat/experience-domain-v2`.
Written: 2026-09-09. HEAD when written: `4ca11b6d3b2514c6de350f83d865e296ac8804f8`.

> **This document does not authorize implementation.** It defines a conceptual
> model so future sessions do not re-derive it, and so that Phase 7 / Checkpoint
> G / cold-start discovery characterization do not accidentally bake human-review
> semantics into `ExperienceStatus.VERIFIED`. It changes **no code**, **no
> Prisma schema**, **no migration**, **no enum**. It does not start Checkpoint G
> or H and does not touch `feat/agentic-travel-planning`.

Related canonical docs (real paths in this repo):

- `docs/superpowers/specs/2026-09-06-multi-source-acquisition-design.md` — the
  acquisition engine that produces `Experience` rows.
- `docs/superpowers/plans/2026-09-08-multi-source-acquisition-implementation.md`
  — the phase plan (Phases 1–7).
- `docs/superpowers/progress/2026-09-06-multi-source-acquisition-progress.md` —
  live status (Phase 7 A–F complete; G/H not started).
- `docs/architecture/activity-discovery-and-tour-generation.md` — target flow &
  invariants (filename predates the V2 rename; content is current).
- `docs/superpowers/specs/2026-08-28-pr10-deterministic-daily-planning-design.md`
  — the deterministic solver that consumes the catalog.
- `docs/superpowers/specs/2026-09-06-tour-materialization-exposure-design.md` —
  how a persisted `Experience` reaches a `Tour`.
- `docs/superpowers/specs/2026-09-09-travel-content-agentic-planning-target-architecture.md`
  — the agentic convergence architecture (a `TRUSTED_AGENT` reviewer, §16 here,
  is a seam onto that track, not a coupling to it).
- `docs/superpowers/plans/2026-09-02-experience-domain-v2-recovery-completion-plan.md`
  — checkpoint-by-checkpoint recovery status of the V2 domain.

---

## 0. One sentence

> **Verified means the system believes the Experience is real, grounded and
> geographically resolved. Curated means a trusted reviewer believes it is
> worth recommending and/or is correctly represented.** These are different
> claims, made by different actors, and must never be collapsed into one
> boolean or one score.

---

## 1. Context — what the repo does today

A row in the `experience` table (`be/prisma/schema.prisma`, model `Experience`)
is produced by the multi-source acquisition pipeline:

```
discovery / acquisition (Wikivoyage / OSM / Google Places / web SourcePlan)
  → grounded evidence  (ExperienceEvidence: source, url, title, snippet, discoveredAt)
  → entity resolution  (ExperienceProposalResolverService.resolve → resolveCandidate:
                        component hints resolved against OSM / Nominatim / Places only,
                        never against LLM-claimed coordinates)
  → geographic validation  (CompositeGeographicValidationService.validate → GEO_VERIFIED)
  → SAME / NEW / AMBIGUOUS  (experience-dedupe.util.ts: decideExperienceDedupe)
  → dedupe / evidence merge
  → persistence  (ExperienceCatalogService.persistVerifiedExperience →
                 Prisma write with status = VERIFIED, metadata.source =
                 'grounded_experience_discovery')
```

`ExperienceStatus` is a four-value enum (`be/prisma/schema.prisma`):

```
enum ExperienceStatus { PENDING  VERIFIED  REJECTED  ARCHIVED }
```

Only `status = VERIFIED` rows are ever returned by
`ExperienceCatalogService.findVerifiedWithin` and are the only rows the
deterministic planner (`GreedyDailyPlanningSolver`) can schedule.

`Experience.qualityScore` (`Float?`) exists in the schema **today** but is a
raw value written at persist/seed time (or left `null`); it is *not* the output
of any review workflow. `findVerifiedWithin`'s own doc comment already keeps
*source/evidence confidence ≠ quality ≠ user relevance* as three separate
things and deliberately does **not** pre-rank the catalog by quality.

There is **no** review, curation, reviewer, or approval concept anywhere in the
schema or code today: no `ExperienceReview`, no `ExperienceCurationState`, no
`curationStatus`, no reviewer role beyond `AuthProvider` on `User`.

### What `VERIFIED` means today (and must keep meaning)

> The system could sufficiently establish that this Experience corresponds to a
> real place / area / route, that its components resolved against trusted geo
> providers, that it passed geographic validation, and that it is admissible to
> the plannable catalog.

It must **not** be reinterpreted as *"a human certified this Experience is
excellent / worth recommending."*

---

## 2. Problem

As Zig-Zag runs cold-start discovery in cities with no prior catalog, it will
automatically surface Experiences. Buenos Aires examples: historic walking
routes, architecture walks, tango shows, milongas, tango classes, bodegones,
craft-beer crawls, specialty-coffee routes, street art, historic bookshops.

An Experience can be **real, correctly grounded, correctly located, and
technically `VERIFIED`** — and still be mediocre, uninteresting, over-commercial,
a tourist trap, out of date, badly described, badly classified, or simply not
recommendable.

We want an eventual workflow where an **administrator**, a **tourism
expert/agent**, an **authorized automated agent**, and eventually **end users**
can review catalog Experiences — without any of that changing what `VERIFIED`
means and without making human review a synchronous precondition for a city to
work (see §12).

---

## 3. Central principle — four distinct dimensions

| Dimension | Question it answers | Who answers it | Where it lives (concept) |
| --- | --- | --- | --- |
| **System verification** | Does the Experience exist and is it correctly grounded / geographically resolved? | the acquisition + resolver pipeline (deterministic) | `Experience.status` (existence / grounding / technical lifecycle) |
| **Curation** | Does a trusted person or authority consider this Experience worth recommending and/or correctly represented? | admin / tourism expert / trusted agent / (aggregated) users | a **separate** curation concept — reviews and a derived/stored curation state |
| **Quality** | How good / recommendable does the Experience appear, per evidence? | an independent quality assessment (future; not this spec) | `Experience.qualityScore` and/or a future quality model |
| **User fit** | How appropriate is it for *this* traveler / *this* request? | the ranking + preference layer, per request | not persisted on the Experience — computed per request (`experience-preference-evaluator.util.ts`, semantic ranking) |

Rules:

- Do **not** collapse these into one boolean or one score.
- Do **not** overload `Experience.status` with curation meaning.
- Do **not** overload `qualityScore` with curation meaning (a human can approve
  a niche low-score Experience; a high-score Experience can be curation-rejected
  for stale data / tourist-trap policy / duplication).
- User fit is per-request and never written back onto the shared Experience.

---

## 4. Why not reuse `VERIFIED` / a single `verified = true`

The naive idea is *"a person validates the Experience and it becomes
`verified = true`."* We reject reusing the current `VERIFIED` for that because:

1. `VERIFIED` today is a **factual/grounding** claim made by a deterministic
   pipeline. Human recommendation is a **different** claim. One row can be in
   very different states on the two axes at once.
2. Cold-start (§12) needs `VERIFIED` rows to be plannable **immediately**,
   before any human looks at them. If `VERIFIED` implied "human-approved", a new
   city could not generate a Tour until someone reviewed its catalog.
3. A curation **rejection** must not destroy factual knowledge. A tourist-trap
   or a closed venue is still a real entity we may want to keep (for dedupe,
   for history, for "why was this not offered?" explainability), just not
   offer.

### Illustrative states (conceptual, not schema)

| | system status | curation | quality |
| --- | --- | --- | --- |
| **A** — real, nobody looked yet | `VERIFIED` | `UNREVIEWED` | `UNKNOWN` |
| **B** — reviewed and recommended | `VERIFIED` | `APPROVED` | `HIGH` |
| **C** — real entity, not recommendable under current policy | `VERIFIED` | `REJECTED` / `NOT_RECOMMENDED` | (any) |

In case **C** the Experience remains a real-world entity and a real catalog
row; it simply should not be offered to the planner under the current policy.
Factual knowledge is preserved.

---

## 5. Conceptual model of curation

A future `ExperienceCurationStatus` (names illustrative — adjust to the domain
if a better term exists; do **not** add to the schema now):

- `UNREVIEWED` — default for a freshly system-verified Experience.
- `NEEDS_REVIEW` — flagged (by a signal, a conflict, a user report, high
  usage, stale data …) as worth a reviewer's time.
- `APPROVED` — a trusted reviewer considers it worth recommending and correctly
  represented.
- `REJECTED` — a trusted reviewer considers it not recommendable (and/or
  materially misrepresented) under current policy.

**Open design choice (§21):** this status may be **stored** as a column, or
**derived** as a read model from the review history (§6). Deriving keeps a
single source of truth (the append-only reviews) and makes "why is it in this
state?" trivially auditable; storing is cheaper to query and rank against. A
likely compromise is a derived-then-materialized read model
(`ExperienceCurationState`), recomputed on each new review. This spec does not
decide it.

---

## 6. Review history (not a checkbox)

Curation must retain an audit trail. Conceptually, an append-only
`ExperienceReview`:

- `id`
- `experienceId`
- `reviewerType` — e.g. `ADMIN` · `TOURISM_EXPERT` · `TRUSTED_AGENT` · `USER`
- `reviewerId` (optional)
- `verdict` — e.g. `APPROVE` · `REJECT` · `FLAG` · `NEEDS_CHANGES`
- `reasonCodes` (optional; a small controlled vocabulary — `TOURIST_TRAP`,
  `PERMANENTLY_CLOSED`, `DUPLICATE`, `BAD_GEOGRAPHY`, `STALE_HOURS`,
  `MISCLASSIFIED`, `POOR_DESCRIPTION`, …)
- `notes` (optional free text)
- `createdAt`
- `supersedesReviewId` (optional — a later review by the same or higher
  authority replacing an earlier one, without deleting it)
- `evidence` / `provenance` (optional — what the reviewer looked at: URLs, a
  trusted-agent's evidence summary, a screenshot reference)

Enums above are **conceptual**; do not freeze them prematurely. The derived
curation status (§5) is a pure function of the review set + the authority
policy (§7).

---

## 7. Different levels of reviewer authority

Not every reviewer's verdict is authoritative on its own.

- **`ADMIN`** — may approve/reject directly (authoritative).
- **`TOURISM_EXPERT`** — likely equivalent authority, or high-trust; a
  configurable policy decision.
- **`TRUSTED_AGENT`** — produces a *recommendation to review* (proposed
  verdict + evidence summary + detected issues) that a human later confirms, or
  holds a configurable, bounded authority in the future. Not authoritative by
  default (see §16).
- **`USER`** — a user's opinion must **not** automatically move an Experience to
  `APPROVED` or `REJECTED`. Users produce **signals / reviews**; a separate
  aggregation policy decides what those signals do.

### User-signal aggregation seam (not an algorithm here)

- 1 user says "it closed" → do **not** auto-remove; record the signal.
- Many independent, sufficiently-trusted users report "permanently closed" →
  raise `NEEDS_REVIEW` and/or trigger revalidation (a re-run of grounding for
  that Experience).

Do not design the reputation / weighting algorithm now. Document that the seam
exists and that it is a **policy** distinct from admin/expert verdicts.

---

## 8. What a backoffice could inspect

A future backoffice review screen should be able to show, per Experience
(no UI is designed here):

- **Identity** — canonical name, description.
- **Geography** — components, their `GeoEntity`s, coordinates,
  place/area/route identity, provider identity (`GeoEntityIdentity`).
- **Semantics** — themes, traits, intents, dimensioned traits
  (`TraitDefinition` / `ExperienceTrait`).
- **Operational info (when present)** — opening hours, price, source freshness.
- **Evidence** — each `ExperienceEvidence` (source, URL, title/snippet,
  `discoveredAt`), and which sources corroborate each other.
- **Discovery provenance** — which provider found it, which query, which
  extractor, the relevant `generationTrace` step(s).
- **Quality signals (when they exist)** — rating, review count, editorial
  mentions, cross-source corroboration, a future quality assessment.
- **Usage** — count of `Tour`s where it was selected (`TourExperience`),
  possibly aggregated user feedback.
- **Media** — existing `ExperienceMedia`.

---

## 9. Possible curation actions

A future backoffice could allow: approve · reject-for-recommendation · flag
needs-review · edit/correct the canonical description · fix facets · correct
components · merge duplicates · flag incorrect geography · flag
closed/no-longer-operational · request re-discovery/re-validation · add trusted
evidence · remove/mark bad evidence · annotate quality.

**Separate two categories of action:**

- **Changing factual identity** (description, facets, components, geography,
  evidence) — these edit the shared `Experience` and its relations; they need
  their own guardrails, provenance stamping, and possibly re-validation.
- **Changing recommendation / curation state** (approve / reject / flag) —
  these produce `ExperienceReview` rows and move the derived curation status;
  they do not alter facts.

Some actions (e.g. "merge duplicates", "request re-validation") are workflows
of their own, not single writes.

---

## 10. Relationship with quality (they are not synonyms)

Do not design a full quality subsystem here. But state explicitly that curation
≠ quality:

- `qualityScore = 0.95`, `curationStatus = UNREVIEWED` — valid (nobody looked
  yet).
- `qualityScore = 0.65`, `curationStatus = APPROVED` — valid (a legitimate
  niche pick a human vouched for).
- `qualityScore = 0.90`, `curationStatus = REJECTED` — valid (bad data,
  tourist-trap policy, permanent closure, duplicate).

Therefore **quality ≠ curation**, and neither is `status`.

---

## 11. Relationship with ranking

Future options, **not** a fixed policy and **not** numeric weights:

- `APPROVED` — could contribute a positive trust signal.
- `UNREVIEWED` — remains fully eligible (this is the cold-start default).
- `NEEDS_REVIEW` — could be de-prioritized or avoided depending on context.
- `REJECTED` — normally **not offered to the planner**, while the row is kept
  in the catalog for factual/historical/dedupe purposes.

Do **not** define things like `APPROVED = +0.3` now. When implemented, the
curation→ranking policy must be **deterministic, observable, and testable**,
consistent with the existing ranking discipline (no LLM in ranking; every
contribution explainable in the `candidate_pool` trace step).

The **governing invariant still holds**: a missing *positive* preference never
fails a Tour (`isCoverageFatal`, `coverage-decision.util.ts`). Curation state
must not become a new way to hard-fail generation; a thin *approved* pool is a
soft signal, not a fatal condition.

---

## 12. Relationship with cold-start discovery — curation is asynchronous

**Manual curation must never be a synchronous precondition for a new city to
work.**

Keep this possible:

```
catalog empty
  → acquisition / discovery
  → system verification
  → catalog (VERIFIED rows)
  → ranking / planner
  → Tour
```

Never this:

```
catalog empty → discover → WAIT FOR HUMAN → Tour
```

Curation is a **later, asynchronous layer** that improves the catalog over
time:

```
catalog empty
  → discover + system verify
  → Tour can already work
  → review queue is fed
  → catalog improves over time
```

This preserves the global / on-demand capability of the product.

---

## 13. Review queue (future capability)

A future **Review Queue** concentrates human effort where it is worth most. It
could prioritize Experiences that are: newly discovered · low grounding
confidence · in conflict between sources · highly used in Tours · reported by
users · backed by stale data · subject to an operational change · high tourism
importance · likely duplicates · quality-uncertain.

Do not design the exact prioritization scoring now — document that the queue
exists and what feeds it.

---

## 14. Human-in-the-loop flywheel

```
cold-start discovery
        ↓
system-verified Experiences
        ↓
Tours
        ↓
usage / feedback / reports
        ↓
review queue
        ↓
admin / tourism expert / trusted-agent curation
        ↓
better catalog
        ↓
better Tours
        ↓
more feedback  ──┐
        ↑        │
        └────────┘
```

The curated catalog can become a durable product asset (a differentiator), not
just an internal cleanup process.

---

## 15. Backoffice & B2B seam

The same review workflow could later serve actors beyond the Zig-Zag team:
tour operators, destination experts, hotels, agencies, tourism boards, B2B
partners — curating the catalog for a region they know.

Do **not** design permissions / multi-tenancy / regional ownership now. Only
record that `reviewerType` + `reviewerId` + a future authority policy is the
seam where regional/partner ownership would attach.

---

## 16. Trusted-agent review

Given the future agentic architecture
(`docs/superpowers/specs/2026-09-09-travel-content-agentic-planning-target-architecture.md`),
a specialized agent could act as a reviewer. Same principle as discovery:

> **AI discovery ≠ automatic AI review authority.**

A `TRUSTED_AGENT` reviewer produces: a recommendation · an evidence summary ·
detected issues · a proposed verdict. The **authority policy** (§7) then decides
whether that:

- stays pending a human,
- carries sufficient (bounded, configurable) authority on its own, or
- requires corroboration (another reviewer / a re-validation).

Do **not** couple this design to `feat/agentic-travel-planning` now — it is a
seam, described in terms of `reviewerType = TRUSTED_AGENT` and a verdict that
flows through the same `ExperienceReview` shape as any other reviewer.

---

## 17. End users

Users could eventually: confirm "I was there" · report it closed · report
incorrect info · recommend / not recommend · correct hours · flag a tourist
trap · rate an Experience. All of that produces **feedback / reviews /
signals**.

Explicitly not allowed:

- `user click → Experience.status = VERIFIED`
- `single bad review → Experience REJECTED`

User input flows into the aggregation policy (§7), never directly onto
`status` or the authoritative curation state.

---

## 18. Auditability

Every material curation action must be explainable. We must be able to answer:
who changed what · when · why · with what evidence · what the previous state
was. No opaque overwrites.

The final model will likely need an **append-only** review/action history (or
at minimum a fully auditable one, with `supersedesReviewId` chains rather than
in-place edits). Factual edits to the shared `Experience` (§9) must also stamp
provenance (who / when / source). Implementation shape is left open (§21).

---

## 19. Two lifecycle axes (conceptual)

**System axis** (`Experience.status`, exists today):

```
PENDING ──► VERIFIED ──► ARCHIVED
   │
   └──────► REJECTED
```

**Curation axis** (conceptual, does not exist today):

```
UNREVIEWED ──► NEEDS_REVIEW ──► APPROVED
     │
     └────────────────────────► REJECTED
```

These are **independent axes**. A single Experience can be
`system = VERIFIED` **and** `curation = REJECTED` at the same time (a real
place we choose not to recommend). The system axis is about *existence and
grounding*; the curation axis is about *recommendation and representation*.

---

## 20. Possible future persistence shape — NON-BINDING / illustrative

> The following is illustrative pseudo-model only. It is **not** a Prisma
> schema, **not** a migration, and **not** a commitment to field names, enum
> values, or even to storing (vs deriving) the curation state. It exists to
> make the conceptual model concrete.

```
Experience {
  status  ExperienceStatus          // unchanged: PENDING | VERIFIED | REJECTED | ARCHIVED
  // ... all current fields unchanged ...
}

ExperienceReview {                   // append-only history
  id                  String
  experienceId        String
  reviewerType        String         // ADMIN | TOURISM_EXPERT | TRUSTED_AGENT | USER
  reviewerId          String?        // User.id, agent id, or null
  verdict             String         // APPROVE | REJECT | FLAG | NEEDS_CHANGES
  reasonCodes         String[]?      // controlled vocabulary
  notes               String?
  evidence            Json?          // what the reviewer looked at
  supersedesReviewId  String?
  createdAt           DateTime
}

// OPTIONAL — only if a materialized read model is justified for querying/ranking.
ExperienceCurationState {            // derived from the review set + authority policy
  experienceId        String @id
  status              String         // UNREVIEWED | NEEDS_REVIEW | APPROVED | REJECTED
  lastReviewId        String?
  updatedAt           DateTime
}
```

Factual edits made through curation (§9) would likely need their own
provenance-stamped audit records; that shape is also left open.

---

## 21. Open questions (deliberately unresolved)

1. Is `curationStatus` **persisted** as a column, or **derived** from the
   review history (or derived-then-materialized as a read model)?
2. Which `reviewerType`s can produce an **authoritative** decision on their own,
   and is that configurable per region / per partner?
3. How exactly are **user signals aggregated** (trust weighting, thresholds,
   decay) before they raise `NEEDS_REVIEW` or trigger revalidation?
4. When (if ever) does a curation-`REJECTED` Experience become reviewable again
   — automatically after re-validation, on a schedule, or only on explicit
   request?
5. How do we distinguish **temporary** closures (renovation, season) from
   **permanent** ones, and what state does each imply?
6. What conditions **trigger re-validation** (re-running grounding) for an
   existing Experience — user reports, evidence age, source conflict, planner
   usage?
7. How does curation state feed **ranking** — as a deterministic, observable,
   testable contribution — without turning it into a hard-fail path?
8. What is the future role of `qualityScore`, and where does a real quality
   assessment live relative to curation?
9. Which **factual fields** may a human edit directly (description, facets,
   components, geography, evidence), and which require a workflow /
   re-validation?
10. How are **conflicts between experts** resolved (last-writer, authority
    tiers, explicit escalation, `supersedesReviewId` chains)?
11. Do we need **regional ownership / tenancy** for partner curation, and when?
12. What decisions, if any, may a `TRUSTED_AGENT` make **without** human
    approval, and how is that boundary configured and audited?

Do not answer these prematurely. Each is an implementation-time decision.

---

## 22. Relationship with Phase 7 (explicit)

- **Phase 7 does not change** because of this spec.
- `ExperienceStatus.VERIFIED` keeps its **current technical meaning**
  (real / grounded / geographically resolved / admissible to the plannable
  catalog).
- **Checkpoint F** remains *orchestration correctness* (coverage → acquisition
  → resolver → persistence → re-query → ranking → planner → feasibility →
  materialization), proven by the `test:integration` suite. Curation is not
  part of it.
- **Checkpoint G** remains *engine-quality evaluation* of the deterministic
  selection/planning engine.
- **Cold-start discovery characterization** (a later effort) evaluates real
  retrieval quality (did we actually find the good bodegones / tango classes).
- **Curation / backoffice** is a **later catalog capability**, layered on top
  of a working, system-verified catalog — asynchronous, never a precondition
  (§12).

Do not fold this feature into F, G, or H.

---

## 23. Final principle

> **Verified** means we believe the Experience is real.
> **Curated** means a trusted reviewer believes it is worth recommending and/or
> correctly represented.
> **Quality** is an independent assessment of how good it appears.
> **User fit** is per-request relevance and is never written back onto the
> shared Experience.

Keep these four separate. Everything else in this document follows from that.
