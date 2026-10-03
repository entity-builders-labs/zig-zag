# Zig-Zag — Tour Generation Engine

Zig-Zag turns a user's destination, preferences, and mobility constraints into a scheduled, multi-day Tour built entirely from real, verified places and experiences — never LLM-invented ones. This context covers the engine that acquires, verifies, ranks, and schedules that content. It is mid-migration from an `Activity`/`ActivityKind` model to the **Experience Domain V2** model described below (branch `feat/experience-domain-v2`); terms here describe the V2 target/current model, not the legacy one still live on `main`.

## Language

**GeoEntity**:
Physical reality only — a `PLACE`, `AREA`, or `ROUTE` resolved from a trusted provider (Google Places, OSM/Overpass, Nominatim). Never itself schedulable, never itself carries tourism meaning.
_Avoid_: Activity, POI (POI is not a structural kind here — a visitable place is a GeoEntity PLACE plus a separate visit Experience)

**Experience**:
The only schedulable tourism unit — the thing a Tour actually contains. Made of one or more ordered `ExperienceComponent`s, each pointing at a GeoEntity. A single-PLACE visit is still an Experience (one component); a neighborhood walk or route is a multi-component Experience.
_Avoid_: Activity, ActivityKind (both are the legacy model being replaced)

**ExperienceComponent**:
One GeoEntity's participation in an Experience: `order` (nullable — null means no intrinsic sequence, not "unspecified"), `role`, `required`. A component's `required: true` means the Experience is not the same Experience without it — planning may never silently drop it.

**Trait**:
A soft, extensible descriptor on an Experience (theme, mobility style, activity style, environment, spatial pattern, discovery style — e.g. `history`, `walking`, `guided`, `outdoor`, `multi_stop`, `hidden_gem`). Backed by dynamic `TraitDefinition` lookup data, not a closed Prisma enum — new traits don't require a migration.
_Avoid_: ExperienceFormat, ActivityKind (legacy, structural, closed — traits are open and soft)

**TourExperience**:
A frozen per-Tour snapshot of a selected Experience (with `TourExperienceComponent` snapshotting its components), so a Tour stays stable even if the shared Experience is edited or re-enriched later.

**DestinationScope**:
How a request's geography is bounded — either a `PolygonScope` (a real administrative/neighborhood boundary) or a `PointRadiusScope` (a synthetic point+radius, used when no boundary resolves — e.g. a bare address). Both are valid, first-class scopes; point-radius is not a degraded fallback that skips validation.

**ExperienceCandidate**:
An unverified, LLM-extracted proposal from grounded search evidence — `themes`, `traits`, `componentHints[]` (each hint citing the evidence that supports it), no structural `kind`. Becomes a real Experience only after Evidence Validation → GeoEntity Resolution → Geographic Validation → Dedupe all pass.

**Dedupe decision**:
The outcome of comparing a candidate/rediscovered Experience against the catalog — one of `SAME` (enrich the existing Experience, never fabricate a duplicate), `NEW` (persist), or `AMBIGUOUS` (keep both; never auto-merge on a guess — a false-positive merge is worse than a temporary duplicate).

**Coverage deficit**:
A gap the engine records between what the request asked for and what the catalog/pool currently offers (a missing theme, trait, or the pool being too thin/irrelevant). **Domain rule:** a deficit over a *preference* (theme/trait) may lower satisfaction or trigger discovery, but must never by itself hard-fail Tour generation while the pool is non-empty — only a genuinely infeasible (empty/unusable) pool may fail generation. ⚠️ *Currently violated in code as of 2026-09-04 — see below.*

**Internal routing** vs **External routing**:
Internal routing connects an Experience's own components to each other (e.g. the stops of one neighborhood walk). External (Tour) routing connects consecutive selected Experiences across a day. Routing is never proof that an Experience exists — a routing-provider outage must never flip a verified Experience back to unverified.

**Acquisition trigger**:
What caused an Experience acquisition pipeline run — `TOUR_COVERAGE` (a live Tour request found a deficit), `ADMIN_POPULATION` (bulk backfill for a destination, no Tour created), or `MANUAL`. All triggers share one acquisition pipeline; catalog growth is a side effect of any of them, not a separate product domain.

**day_trip**:
A soft Experience intent/facet like `visit` or `walk` — *not* a separate entity, Tour type, planner, or origin-bound/open-destination abstraction. It only changes discovery query phrasing (e.g. "day trips from Buenos Aires") when local coverage is insufficient.

**Bitácora (V3)**:
The persisted, per-Tour step-by-step trace of every generation decision — exact prompts/raw responses/queries/evidence/rejections per stage, centrally secret-redacted — readable after the fact for any past Tour, not just live. The debugger of every non-deterministic boundary in the pipeline.

## Known drift between documented intent and current code (2026-09-04, HEAD `b57e8a0`)

- **Coverage-deficit severity regression (critical)**: commit `b8bb80e` reverted `missing_requested_theme` back to a hard-blocking severity and added two new hard-blocking deficit reasons (`missing_requested_trait`, `missing_requested_intent`). Confirmed by direct code read: `coverage-analyzer.service.ts`'s blocking branch never checks `relevantCandidates.length`, so it throws in `experience-generation.service.ts:1311-1321` on deficit presence alone — a pool of hundreds of good candidates with one unmatched theme still aborts the whole generation. Directly contradicts the "Coverage deficit" rule above (invariant #11 of the binding V2 plan; execution rule #10, "Do not hard-fail because a preferred trait/theme is absent"). Root mechanism: `theme-matching.util.ts` still does `JSON.stringify(candidate.metadata).includes(...)` — the exact "not a rules engine" anti-pattern CP7 explicitly bans — and it sits directly on this fatal path. The correct pattern already exists in the same file for hard-exclusion relaxation (`hardExclusionRelaxed` falls back to the unfiltered pool instead of throwing) — it just isn't applied here.
- **`ExperienceComponent.order` is never really null**: every resolution path (`experience-proposal-resolver.service.ts`) assigns sequential order by array position regardless of whether real intrinsic-order evidence exists, even though the schema and stated rule treat `null` as the correct "genuinely unordered" representation.
- **Route-specific geographic validation is dead code**: `CompositeGeographicValidationService`'s `validateCanonical`/`validateNeighborhoodWalk`/`validateRoute` methods (with a `canonical_geometry` strategy) are fully written but have zero call sites — every candidate actually validates through the generic `validateExperience` path instead.
- **`traitDefinitionIds` relation is wired but never populated**: `persistVerifiedExperience` will write `ExperienceTrait` rows if given `traitDefinitionIds`, but no real caller (acquisition or proposal resolution) ever sets it — the relation is silently always empty.
- **Planner still centroid-routes multi-component Experiences**: the solver's inter-candidate travel/ordering/opening-hours checks still use one generic `spatialFootprint` per Experience rather than derived start/end component footprints, so a multi-stop walk or route can still be scheduled/ordered as if it were a single point. (Internal continuous-walking-limit enforcement and internal-walking computation were fixed separately and do work correctly.)
- **Docs are dangerously stale**: `docs/architecture/activity-discovery-and-tour-generation.md` (the file every session is told to read before touching this engine) and `be/prisma/README.md` still document `Activity`/`ActivityFamily`/`ActivityWaypoint`/`TourActivity` as live — none exist in the schema anymore. Both this worktree's `CLAUDE.md` and the main worktree's describe the same stale model. Any session (human or agent) reading these first will build a wrong mental model before touching real code.
- Full audit trail with file:line evidence for all of the above: `~/.claude/plans/ejecutas-el-plan-agile-river.md`.
