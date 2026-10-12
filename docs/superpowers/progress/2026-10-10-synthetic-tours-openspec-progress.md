# Synthetic Tours + OpenSpec — CURRENT PROGRESS

<!-- agent-track: id=synthetic-tours-openspec; status=ACTIVE; branch=feat/synthetic-tours-openspec; integration=main; base=16f41e89eb238431b339dfccc22473f791ed4908; plan=docs/superpowers/plans/2026-10-09-openspec-documentation-governance-cutover.md -->

Updated: 2026-10-11  
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
  35-38, wiring 39-41, validation 42, retirement 43 (24.1, 24.3-24.10, 31.1-31.2 done).
- The change must not be archived until groups 24-43 are complete.

## Next authorized action

1. Owner resolves the remaining decisions in design.md (task 24.2), each
   before the group that needs it: P-D5 optimizer — evaluated 2026-10-12,
   gate G-P5 (Routing runtime integration + deterministic stop, task 32.0);
   P-D7 objective v1 (33, P11 findings recorded), the G1 Geoapify storage-terms check (task 28.6, before
   41; Valhalla-first if persistence is not permitted), and the P-D2-F
   calibration gate approving `fallback-v1` (task 40.2, before 41).
   Resolved: P-D2, R4-D4, P-D3, P-D6, R4-D2 (2026-10-11); R4-D1, P-D4
   (default PENALIZE), P-D2-F (global calibrated fallback; catalog-first
   maintenance, design C15), P-D1 (Geoapify initially, Valhalla scale-up;
   G2 closed with `traversal-validator-v1`, design C16) (2026-10-12).
2. Then `/opsx:apply gap-driven-destination-knowledge` starting at group 25
   (planning input/output contract); groups 35-38 may run in parallel on a
   separate sub-branch.

## Open findings / blockers

- P11 evidence: `spikes/planner-comparison-2026-10-12/`. Current greedy must
  be replaced; CP-SAT (this formulation) excluded; Routing vs greedy
  best-insertion decided by gate G-P5.
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
