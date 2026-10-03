# Multi-source Experience acquisition — progress

Original plan: `docs/superpowers/specs/2026-09-06-multi-source-acquisition-design.md`

# Current State

- Branch: `feat/experience-domain-v2`
- HEAD commit: `69e3e9ffcb1122e4470278569308218cee2bb2a0`
- Current milestone: Rollout 1 — Wikivoyage adapter (initial implementation not started)
- Last verified test state: backend Jest `107/107` suites and `721/721` tests passing at this HEAD on 2026-09-08. `yarn run check` is not green because of pre-existing acceptance-fixture type errors listed under Verification.

# Completed

No rollout milestone from the original plan is complete at this checkpoint.

Repository audit confirmed that the current code has no `SourceObservation`, Wikivoyage acquisition adapter, corroboration merge, `ExperienceAcquisitionPlan`/source-routing table, proactive OSM acquisition source, or downstream `explorationStyle` preference facet. The direct `ExperienceCatalogService.acquireNearbyAsExperiences` Places-to-Experience shortcut still exists.

# In Progress

- Define the smallest coherent Rollout 1 slice from the original plan: Wikivoyage API boundary, structured observation parsing, mechanical candidate synthesis, and module wiring.
- Add fixture-backed unit/contract tests for successful parsing and provider-local graceful failure.
- Verify the milestone against its tests and the original plan before marking it complete.

# Not Started

- Complete Rollout 1 live verification against characterized Wikivoyage articles and integration into gap-driven acquisition.
- Shared deterministic cross-provider corroboration merge.
- Dimension-aware weighted preference facets and deficit-to-source routing.
- Rollout 2 — replace direct Google Places-to-Experience persistence with the shared candidate/resolver path.
- Rollout 3 — proactive OSM gap-filling source.
- Rollout 4 — make Tavily walk/route queries theme-aware and route `explorationStyle` through weighted downstream preferences.
- End-to-end proof that a Wikivoyage-covered destination produces a richer verified multi-component Experience than the web-only path.

# Verification

- `yarn test --runInBand` (`be/`): PASS — 107 suites, 721 tests.
- `yarn run check` (`be/`): FAIL before milestone changes. Existing TypeScript errors are confined to `be/test/acceptance`: planning fixtures/builders omit required `startFootprint`/`endFootprint`, and one completeness-validator assertion accesses `dayNumber` without narrowing the issue union.
- No multi-source milestone acceptance tests exist yet.
- A plain `yarn check` invokes Yarn 1's built-in network command instead of the package script; use `yarn run check`.

# Important Decisions / Invariants

- The original plan is authoritative; this checkpoint is only a verified execution index.
- `ExperienceCandidate` remains the unchanged downstream boundary. Structured providers map mechanically into it; web providers keep their existing grounded-search plus LLM extraction path.
- Wikivoyage may provide structured tourism evidence, coordinates, or a QID, but persisted `GeoEntity` identity and geography must still be resolved/authorized by the existing trusted resolver and geographic validation pipeline.
- One source failure degrades only that provider and must not fail acquisition globally.
- Do not change resolver, validator, dedupe, embeddings, coverage, ranking, solver, planner, UI, or schema as part of Rollout 1.
- Do not trust completion claims without checking current code and rerunning the cited tests.

# Next Action

Inspect the current discovery/acquisition interfaces and Nest module wiring, then implement fixture-backed tests for the smallest Wikivoyage adapter slice before production code. Do not mark Rollout 1 complete until its adapter tests, relevant backend tests, and required live API verification pass.
