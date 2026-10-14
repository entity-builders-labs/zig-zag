# Synthetic Tours + OpenSpec — CURRENT PROGRESS

<!-- agent-track: id=synthetic-tours-openspec; status=ACTIVE; branch=feat/synthetic-tours-openspec; integration=main; base=16f41e89eb238431b339dfccc22473f791ed4908; plan=docs/superpowers/plans/2026-10-09-openspec-documentation-governance-cutover.md -->

Updated: 2026-10-14  
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
  soft costs); coefficients OPEN behind gate G-P7-U (task 33.0). The
  experimental `p-d7/` spike is non-production evidence.
- G-P7-U part A (owner, 2026-10-14): RESOLVED. Part B: OPEN. P-D7: OPEN.
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
- The change must not be archived until groups 24-43 are complete.

## Next authorized action

1. Owner resolves the remaining decisions in design.md (task 24.2), each
   before the group that needs it:
   - gate G-P7-U part B (task 33.0) (preference-vs-travel / friction / uncertainty
     calibration) before 41;
   - the G1 Geoapify
   storage-terms check (task 28.6, before
   41; Valhalla-first if persistence is not permitted), and the P-D2-F
   calibration gate approving `fallback-v1` (task 40.2, before 41).
   Resolved: P-D2, R4-D4, P-D3, P-D6, R4-D2 (2026-10-11); R4-D1, P-D4
   (default PENALIZE), P-D2-F (global calibrated fallback; catalog-first
   maintenance, design C15), P-D1 (Geoapify initially, Valhalla scale-up;
   G2 closed with `traversal-validator-v1`, design C16), P-D5 (OR-Tools
   Routing, gate G-P5) (2026-10-12).
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
- Open after R4-D1: persistence of L2 assertions, L3 ledger and research
  evidence memory (prerequisite of task 41.0 and corridor products, not of
  the single-place path); area-scope participation (task 43 audit).
- Open: provider-backed mechanism for path-constrained timing of a required
  bounded ROUTE traversal (design C0); needed before TRAVERSE-bearing
  Experiences are planned in production, not for the single-place cutover.
- Task 31.1 (P-D6 routing recordings) needs a Geoapify API key configured in
  this worktree's environment (none is present here); recording source is
  experimental and does not decide P-D1.
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
