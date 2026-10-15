# Task 40.2 — global visit-duration fallback calibration (P-D2-F) — 2026-10-14

OpenSpec change `gap-driven-destination-knowledge`, design P4 ("Fallback (P-D2-F RESOLVED)"), task
40.2. Evidence only: no production code.

**Status: OPEN, numeric calibration only.** The owner decided the statistic (p75) and the sufficiency
and robustness rule on 2026-10-15 (below). The evidence-backed sample is still empty, so no
`fallback-v1` value is proposed. Everything else about the fallback is defined below, so the gate can
close mechanically once a sample exists.

## 3A. Dataset: no evidence-backed RESOLVED typical durations exist

Searched on 2026-10-14:

| Place | Result | Why it is excluded |
|---|---|---|
| Prisma schema (`be/prisma/schema.prisma`) | no `GeoEntityVisitDuration` or duration-knowledge model; R4-D1 maps it, task 39.0 implements it | — |
| `Experience.durationMinutes` | opaque, no provenance | design C11 |
| P11 fixtures | BA = spike 3 flat `FALLBACK_POLICY 60`; Paris / LA = `FIXTURE_CLASS_RULE` by feature class | fallback-generated or synthetic class rule |
| Spike 3 (`structured-places-baseline-2026-10-11`) | uniform 60 min "policy placeholder" | fallback |
| Spike 1 (`gap-driven-destination-knowledge-2026-10-10`) | `placeVisitDwellMinutes = 60` "explicit product assumption" | assumption |
| Task 27.3 evidence-availability probe | the designated source of evidence-backed typical durations; **not yet run** | — |

Sample size: **0**. Destination mix, source mix, median, quantiles and spread cannot be computed. No
durations were gathered by reading web prose with an LLM: that is the known failure mode of the
earlier spikes, and the C15 / 27.3 path exists to replace it.

## 3C. Under- vs over-estimation (structural, `scripts/fallback_loss.py` → `runs/fallback_loss.json`)

What each direction of error costs was measured without a truth distribution:
- **Plans.** Every VISIT component is planned at F ∈ {30, 45, 60, 75, 90, 120} min with OR-Tools
  (`routing-gls-sl1000-v1`), under the G-P7-U.B check-point objective with test-only preferences,
  WALK+DRIVE, BA/PA/LA, S1 (3 days) and S5 (1-day oversupply).
- **Underestimation tolerance e\*.** The same plan is replayed with every visit taking F·(1 + e).
  e\* is the largest uniform error at which every KNOWN opening window, the day window and the
  anchors still hold.
- **Validation.** 36 runs, 0 violations.

| F (min) | Experiences scheduled S5 1-day BA / PA / LA | e\* S5 BA / PA / LA | e\* S1 BA / PA / LA |
|---|---|---|---|
| 30 | 16 / 15 / 15 | 0.024 / 0.06 / 0.04 | 0.12 / 0.85 / 0.54 |
| 45 | 12 / 12 / 11 | 0.002 / 0.024 / 0.011 | 0.049 / 0.84 / 0.015 |
| 60 | 9 / 9 / 8 | 0.014 / 0.033 / 0.005 | 0.017 / 0.029 / 0.175 |
| 75 | 7 / 7 / 7 | 0.048 / 0.078 / 0.053 | 0.04 / 0.08 / 0.15 |
| 90 | 6 / 6 / 6 | 0.022 / 0.019 / 0.033 | 0.015 / 0.075 / 0.022 |
| 120 | 4 / 4 / 4 | 0.22 / 0.21 / 0.058 | 0.067 / 0.092 / 0.044 |

Findings:
1. **The optimizer leaves almost no slack, whatever F is.** e\* is mostly below 0.1 (a few minutes per
   visit) at every value. The exceptions are pools whose opening hours, not the day, bind (Paris and
   LA S1 at small F). A plan therefore breaks as soon as fallback visits really run longer than F. A
   larger F does not buy slack; it buys safety only to the extent that F is at least the true
   duration.
2. **Overestimation costs utilization roughly in proportion:** 15-16 → 4 Experiences on a saturated
   day as F goes 30 → 120. The relationship is the same in every city.
3. **So the safety bias has to come from the statistic.** With no slack, a median fallback
   underestimates about half of the places it is used for, and each of those can break the rest of
   that day's plan. An upper quantile underestimates fewer places and costs utilization only on the
   exceptional fallback visits.

Design P4 currently says "median typical duration" for 40.2. Choosing an upper quantile changes that
text, so it is an owner decision (below), not a silent percentile choice.

## Definition ready for approval (value pending)

`GLOBAL_DEFAULT` rule of planner fallback policy `fallback-v1`:
- **Minutes:** _pending calibration_.
- **Calibration evidence:** evidence-backed typical durations only:
  - RESOLVED `GeoEntityVisitDuration` typical values, or typical values found by the 27.3 probe with a
    cited authority class and the right subject;
  - each keeps the GeoEntity id, destination, authority class, source citation and resolver version.
  - Excluded: fallback-generated values, CONFLICTING records not projected by the P4 range rule,
    fixture class rules, assumptions and uncited model output.
- **Sufficiency (owner, 2026-10-15):**
  - at least 30 values;
  - at least 8 per P-D6 destination (BA, Paris, LA);
  - at least 2 source types (authority classes);
  - no destination above 50 % of the sample.
- **Robustness:**
  - report the statistic per destination and with each destination left out;
  - the global value must stay within the leave-one-destination-out range;
  - otherwise report the destination dependence instead of approving a value.
- **Statistic:** p75 of typical duration (owner decision Q-40.2-a, 2026-10-15). Report sample size, destination mix, source mix,
  median, mean (context only), p25 / p75 / p90 and IQR.
- **Exceptional use, unchanged from P-D2-F:**
  - applies per VISIT component without usable duration knowledge;
  - never to TRAVERSE time, which comes from routing, nor to composite internal travel;
  - the composite duration remains its component timeline;
  - no category, destination, popularity, opening-hours or distance dependence, and no LLM value;
  - never written to `GeoEntityVisitDuration`;
  - each use emits VISIT_DURATION_ENRICHMENT_REQUIRED demand (C15).
- **Snapshot:** `durationSource = FALLBACK_POLICY`, policy `fallback-v1`, rule `GLOBAL_DEFAULT` and
  its version, and the minutes used.

## Owner decisions (2026-10-15)

- **Q-40.2-a: statistic = p75.** The optimizer leaves effectively no slack (finding 1), so a median
  would systematically expose plans to underestimation. Design P4 now says p75.
- **Q-40.2-b: sufficiency accepted as proposed**, plus the leave-one-destination-out robustness check,
  which must pass before the numeric calibration closes.

## Acceptance (40.2)

| # | criterion | status |
|---|---|---|
| 1 | evidence-backed sample sufficient | **no — sample is 0** (27.3 not run) |
| 2 | one global value defensible | pending 1 |
| 3 | robust to destination mix | pending 1 (leave-one-destination-out rule defined) |
| 4 | safety bias explicit | yes: p75 (owner, 2026-10-15) |
| 5 | not a category/destination heuristic | yes (definition) |
| 6 | composite semantics correct | yes (VISIT components only; TRAVERSE never) |
| 7 | fallback exceptional | yes (unchanged P-D2-F) |
| 8 | provenance and policy version recorded | yes (snapshot fields defined) |

Prerequisite for closing: run task 27.3 (or obtain RESOLVED catalog records) before 40.2. Task 27.3
is already ordered before the resolver; 40.2 now names it as a hard input.
