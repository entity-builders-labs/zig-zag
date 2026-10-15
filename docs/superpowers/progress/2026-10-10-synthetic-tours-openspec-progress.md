# Synthetic Tours + OpenSpec — CURRENT PROGRESS

<!-- agent-track: id=synthetic-tours-openspec; status=ACTIVE; branch=feat/synthetic-tours-openspec; integration=main; base=16f41e89eb238431b339dfccc22473f791ed4908; plan=docs/superpowers/plans/2026-10-09-openspec-documentation-governance-cutover.md -->

Updated: 2026-10-15\
Branch: `feat/synthetic-tours-openspec`  
Repository: `entity-builders-labs/zig-zag`

> Bootstrap authority only. This current-format progress file exists to satisfy
> Zig-Zag collaboration governance while OpenSpec is characterized and adopted.
> It must not become a second permanent source of product/change truth once the
> OpenSpec cutover is accepted.

## Current execution verdict

**ACTIVE — `gap-driven-destination-knowledge` spike 3 ACCEPTED; revision 4
(production cutover contract) planned in the same change.**

- Spike 1 (`spikes/gap-driven-destination-knowledge-2026-10-10/`): web-first
  discovery, 0 grounded (preserved).
- Spike 2 (`spikes/structured-world-first-2026-10-10/`): structured discovery
  proven; ordinary admission was incorrectly coupled to tourism evidence
  (preserved, with dated reinterpretation).
- Spike 3 (`spikes/structured-places-baseline-2026-10-11/`): 2,571 admitted
  places composed as single-place Experiences and a 3-day Buenos Aires Tour from OSM + Wikidata with zero
  LLM/web/research calls and zero L2; reuse run identical with zero discovery
  calls.
- Planner: P11 comparison + gate G-P5 (`spikes/planner-comparison-2026-10-12/`,
  `g-p5/`) resolved P-D5 = OR-Tools Routing in a colocated Python sidecar
  behind a provider-neutral `PlanningOptimizer`, count-based stop
  `routing-gls-sl1000-v1` (2026-10-12).
- P-D7 (2026-10-14): structure resolved — preference-first objective
  (preference utility derived upstream; explicit facets authoritative,
  semantic affinity within tier and UNKNOWN when missing, quality
  secondary; travel burden / mode friction / UNKNOWN-hours uncertainty as
  soft costs); coefficients resolved by gate G-P7-U (task 33.0) on
  2026-10-15. The experimental `p-d7/` spike is non-production evidence.
- G-P7-U part A (owner, 2026-10-14): RESOLVED. Part B (owner,
  2026-10-15): RESOLVED. P-D7: RESOLVED.
  - **Provenance.** A deterministic validator, not the LLM, derives
    `DIRECT` (a wizard pick, or an excerpt that maps through the versioned
    vocabulary or its aliases) or `INFERRED`.
  - **Order.** `DIRECT` → `INFERRED` → soft anchor → semantic → generic
    quality → id.
    - `DIRECT` is weighed by stated importance; confidence never discounts
      it, and the channel is neutral.
    - `INFERRED` is weighed by importance × confidence.
    - UNKNOWN takes the tier-median position for ordering only; the
      assessment stays `UNKNOWN`.
    - Dedupe is by provenance, then weight.
  - **Boundary and authority.** The planner boundary is structured, and
    the duplicate scoring authority is removed.
  - **Evidence.** 46/46 scenario checks and 19/19 provenance cases on the
    live vocabulary, in `spikes/planner-comparison-2026-10-12/g-p7-u-a/`.
  - **Open gap POLARITY-1 (task 25.6).** Polarity must be established
    before `DIRECT` evidence participates.
  - Implementation is tasks 25.2, 25.4 and 25.6.
- Pre-/apply gates analysed 2026-10-14 and decided by the owner
  2026-10-15 (uncommitted, awaiting owner review):
  - **G-P7-U.B: RESOLVED; P-D7: RESOLVED** (`g-p7-u-b/`).
    - The 25 PROPOSED judgments are accepted as the initial versioned
      set. D1 and D2: a drive or cycling minute equals a walking minute,
      with separate per-leg friction. D3: a hard request cycling limit
      with no universal default. D4: the order-preserving repair, limited
      to projection ties.
    - Adopted `preference-objective-v1` (EVIDENCE_BACKED_INITIAL_POLICY):
      K 100, β 0.20, γ 0.12, A_DRIVE 11, A_BICYCLE 4.5, ρ 0.15.
    - Rerun at that policy: all 32 judgments hold. B-O4 is the tightest
      (margin 0.098), so a bicycle cost/friction change reruns B-O4, the
      full judgment suite and the Tour/cross-evaluation set (provenance,
      not a gate);
      732/732 planned, 0 violations; SL1000 gap 17/60 > 1 %, max 6.9 %.
  - **G-P7-B: CLOSED** (`g-p7-b/`). Factual side resolved 2026-10-14;
    cost c_BICYCLE 1 / A_BICYCLE 4.5; long rides bounded by the D3 limit.
  - **40.2: OPEN (numeric value only).** Statistic p75 and the
    sufficiency rule (≥ 30 observations, ≥ 8 per destination, ≥ 2 source
    types, no destination > 50 %, leave-one-destination-out) decided; the
    evidence-backed sample is 0 until 27.3 runs (`p-d2-f-40-2/`).
  - **41.0 persistence prerequisite: RESOLVED.** One planning-evidence
    persistence model (L2 assertions, research evidence, L3 ledger,
    enrichment demand/attempts) in the existing database, separate from
    the generation trace (design C14).
  - **G1 / 28.6: CLOSED 2026-10-15, GO_WITH_REQUIREMENTS.** Geoapify
    explicitly confirmed (relayed by the owner) that its API results may
    be cached, stored and redistributed without retention restrictions;
    this supersedes the 2026-10-14 NEEDS_VENDOR_CONFIRMATION desk review
    (`routing-provider-evaluation-2026-10-12/g1/`). Attribution,
    provenance, plan sizing and no exposure of internal matrices/cache
    are implementation work in task 28.7, not gates.

## Current checkpoint

**OS6 — revision 4 cutover contract planned, including the planning
amendment (2026-10-11); no production code yet.**

- Spike 3 ACCEPT recorded in proposal, design (C1-C13), specs and the
  canonical section; spike 3 README/runs unchanged.
- Planning amendment: design P1-P13, new `tour-planning` spec, revised
  `planning-travel-estimation` (per-mode provider-backed estimates, explicit
  failure when routing is unavailable), readiness/composition/admission
  deltas, canonical "Multi-day tour planning" paragraph. R4-D5 withdrawn.
- V2 alignment (design C0): no PLACE_VISIT / CORRIDOR_WALK / Experience kind;
  GeoEntity + Experience + ExperienceComponent (VISIT / TRAVERSE, bounded
  ROUTE traversal) + Tour snapshot; composite internal timeline; R4-D1 is now
  resolved (2026-10-12, design C14): GeoEntity-keyed admission / relation /
  opening-hours / visit-duration structures plus typed additions to
  Experience, ExperienceComponent, GeoEntityIdentity and the Tour snapshot;
  schema implemented by task 39.0.
- tasks.md groups 24-43: planning track 25-34, admission/identity track
  35-38, wiring 39-41, validation 42, retirement 43 (24.1, 24.3-24.10, 31.1-31.2,
  32.0-32.1 done; 33.2 added for the planner sidecar runtime; 24.11 done,
  25.2 and 33.0 (G-P7-U) added).
- P-D7 reframed (2026-10-14) in design ("P-D7 preference-first
  objective"), `tour-planning` spec (objective, preference-utility
  boundary, accessibility need vs preference, allowed modes hard), tasks
  24.2/25.2/25.3/33.0/33.1/41.1 and the
  canonical planning paragraph; the experimental objective numbers stay in
  the spike only. Committed in 609a829e.
- G-P7-U part A resolution (2026-10-14, committed as the
  `docs(planning): resolve preference utility encoding` checkpoint):
  - spike `g-p7-u-a/`;
  - design (defects 1-8 confirmed, provenance audit, structured planner
    boundary, gate status);
  - `tour-planning` preference-utility requirement scenarios;
  - tasks 24.2/25.2/25.3/33.0, plus new 25.4 (PROVENANCE-1) and 25.5
    (soft avoidances / constraints) and 25.6 (POLARITY-1);
  - the owner's provenance rule recorded (design "Facet provenance",
    precedence, gate A RESOLVED), the scenarios rerun with provenance, and
    the live-vocabulary provenance characterization.
- G-P5 recorded in design (P-D5 RESOLVED, "G-P5 results", P12),
  `tour-planning` spec (OPTIMIZER_FAILED, provider-neutral optimizer
  boundary, reproducibility/safety guard, optimizer identity in the plan),
  tasks 30.2/33/41.1/43.1 and the canonical planning paragraph.
- Pre-/apply gate analysis and owner decisions (2026-10-14 / 2026-10-15,
  uncommitted until owner review):
  - spikes `g-p7-u-b/`, `g-p7-b/` (recorded bicycle matrices),
    `p-d2-f-40-2/` and `routing-provider-evaluation-2026-10-12/g1/`;
  - design (part B resolution and `preference-objective-v1`, BICYCLE,
    P7 cycling limit, P10 CYCLING_LIMIT, P4 fallback p75 and sufficiency,
    C14 planning-evidence persistence, C16 G1 closure, decision list);
  - specs: `tour-planning` (an UNKNOWN Experience is never erased by the
    cost alone; cycling limit; order-preserving repair),
    `planning-travel-estimation` (bicycle traversal validity; routing data
    attribution and provider terms) and `destination-knowledge-catalog`
    (evidence memory is its own record type in shared persistence);
  - tasks 24.2, 25.1, 28.6 (closed), new 28.7, 29.1, 33.0 (closed), 40.2,
    41.0 and 41.1;
  - the canonical planning and routing paragraphs.
- `/opsx:apply` started (2026-10-15) after the docs checkpoint 20500504:
  task 25.1 (planning input/output contract) implemented, uncommitted until
  owner review (design P2 "Implemented contract").
- The change must not be archived until groups 24-43 are complete.

## Next authorized action

1. Owner reviews the uncommitted task 25.1 implementation and authorizes
   its commit; then `/opsx:apply` continues with task 25.2 (preference-
   utility boundary). The only remaining pre-41 gate
   is 40.2's numeric value: run task 27.3 to obtain an evidence-backed
   sample that meets the sufficiency rule, compute p75, pass the
   leave-one-destination-out check, then approve `fallback-v1`.
   Resolved: P-D2, R4-D4, P-D3, P-D6, R4-D2 (2026-10-11); R4-D1, P-D4
   (default PENALIZE), P-D2-F (global calibrated fallback; catalog-first
   maintenance, design C15), P-D1 (Geoapify initially, Valhalla scale-up;
   G2 closed with `traversal-validator-v1`, design C16), P-D5 (OR-Tools
   Routing, gate G-P5) (2026-10-12); G1 (task 28.6, GO_WITH_REQUIREMENTS
   on Geoapify's vendor confirmation), G-P7-U part B / P-D7
   (`preference-objective-v1`), G-P7-B, the 40.2 statistic and
   sufficiency rule, and the 41.0 persistence prerequisite (2026-10-15).
2. Then `/opsx:apply gap-driven-destination-knowledge` starting at group 25
   (planning input/output contract); groups 35-38 may run in parallel on a
   separate sub-branch.

## Open findings / blockers

- P11 / G-P5 evidence: `spikes/planner-comparison-2026-10-12/` and `g-p5/`.
  P-D5 resolved (OR-Tools Routing). Operational requirement for task 33.2 /
  41: sustained CPU for planning (~2-3.5 vCPU-s per Tour); the current
  `t3.micro` standard-credit baseline reaches the 10 s safety cap and loses
  reproducibility. A client timeout does not cancel a sidecar solve, so the
  client deadline must exceed the safety cap.
- P-D7 code findings, confirmed on the live code by the G-P7-U.A
  characterization (design defects 1-8; fix in tasks 25.2-25.5):
  - **Duplicate scoring authority.** The additive `plannerRelevanceScore`
    lets semantic similarity, and quality, outweigh explicit evidence.
  - **Missing embedding = 0.** Composition and the normalizer coerce it to
    0; in the live `composeSet` this pushes an equal-evidence,
    best-quality candidate into the reservoir.
  - **Dead paths:** `rankCandidatesByRelevance` and
    `evaluateExperiencePreferences`.
  - **Unused soft fields.** Soft avoidances and constraints have no
    consumer.
  - **Accessibility.** Need and preference are merged and unenforced, the
    fallback files "wheelchair" as a preference, and no canonical
    accessibility fact exists.
  - **Minor.** `groundingStrength` is a no-op and `qualityBonus` is
    mislabelled.
  - **Soft anchors** are applied last (the spec says "strong").
  - **Provenance.** `PreferenceSpec` cannot distinguish direct from
    inferred facets (PROVENANCE-1). The rule is now decided, and its
    implementation is task 25.4.
  - **Interpreter evidence.** The evidence-support check is a substring
    match ("arte" from "martes"). The fallback duplicates the vocabulary
    aliases in its own substring-matched keyword table. The facet
    vocabulary has no version (task 25.4).
  - **Polarity (POLARITY-1, task 25.6).** No deterministic check keeps a
    negated mention out of positive facets.
- Solver finding for P-D5 follow-up (not reopened): single-start GLS at
  SL1000 is > 1 % below the best known plan in 13/28 P-D7 scenarios (max
  8.7 %); larger budgets barely help; same pattern under the P11 weights.
- P-D1 evidence: `spikes/routing-provider-evaluation-2026-10-12/`. Mapbox
  traversal not executed (no token; not economically competitive). Public
  transport has no matrix-capable provider except Google.
- Open after R4-D1: area-scope participation (task 43 audit). The L2 /
  L3 / research-evidence / enrichment persistence was resolved on
  2026-10-15 (design C14).
- Open: provider-backed mechanism for path-constrained timing of a required
  bounded ROUTE traversal (design C0); needed before TRAVERSE-bearing
  Experiences are planned in production, not for the single-place cutover.
- Task 31.1 (P-D6 routing recordings) needs a Geoapify API key configured in
  this worktree's environment (none is present here); recording source is
  experimental and does not decide P-D1. The 2026-10-14 bicycle recording
  read the key from the main checkout's `.env` for that one call; the key
  is not stored anywhere.
- Cycling limit (owner D3): the planning contract carries it since task
  25.1, but no input adapter resolves one yet, so live requests that allow
  cycling fail with UNRESOLVED_CYCLING_LIMIT until an adapter or a named
  mobility profile supplies it.
- No task resolves the destination timezone (41.1 only persists
  `Tour.timezone`); the planning input carries it explicitly UNRESOLVED.
- Planning readiness (task 25.1): most spike catalogs have no Experience
  durations (e.g. pf_final 0/20, rw4_final_rerun 1/20 planning-ready), so
  they plan little or nothing until duration knowledge is enriched; local
  `zigzag` 8/8 ready. Missing enrichment, not a planner failure.
- Pre-existing, outside 25.1: `test/characterization/shared-component-
  identity` CHAR-7 expects AMBIGUOUS for one shared component out of two,
  the dedupe now returns NEW (stale since the dedupe commits).
- The characterization DB suites need `DATABASE_URL` at `zigzag_test`.
- Decide which existing `zig-zag-track-*` skills remain unchanged, which need
  OpenSpec awareness, and which become redundant after cutover.
- Decide how active OpenSpec change identity and `tasks.md` replace the
  execution-state responsibility currently carried by progress/plan without
  creating permanent dual authority.
- Narrative/media generation is intentionally downstream of proving
  grounded knowledge, composition and validation.
- Spike findings F1-F10 (README): D8 corroboration/publisher bar blocks all
  single-publisher evidence; verifier precision; OSM barrio vocabulary vs
  tourism areas; WALKING_CORRIDOR emitted before areas exist and keyed without
  area context; capacity gaps re-ask suppressed questions; READY with only
  limitations yields an empty Tour; no route correspondence basis.
- Preflight reports WRITE BLOCKED while this session's uncommitted work is in
  the tree (dirty-tree gate); all other gates pass with `--allow-dirty`.
