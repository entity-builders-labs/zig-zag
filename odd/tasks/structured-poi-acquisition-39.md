# Structured POI acquisition and C14 persistence
Objective: complete only OpenSpec tasks 39.0 and 39.1 on `feat/synthetic-tours-openspec`.
Delivery: `feature-branch-chain` (user specified the existing feature-branch push); forecast 700–1,100 authored lines. Runner: Prisma CLI, Jest, and disposable PostgreSQL integration tests from `be/`.

## Specs

### S1 — OpenSpec task 39.0 (verbatim)

> 39.0 Implement the design C14 schema in one Prisma migration: `GeoEntityAdmission`, `GeoEntityRelation`, `GeoEntityOpeningHours`, `GeoEntityVisitDuration` (GeoEntity-keyed, cascade on GeoEntity delete), `Experience.compositionSignature` (nullable unique), ExperienceComponent `participation` + traversal columns, GeoEntityIdentity link evidence, Tour `readinessVerdict`/`timezone`/`planningContext`/`planningDiagnostics`, TourExperience `endTime`, TourExperienceComponent `participation`/`plannedStart`/`plannedEnd`/`planningEvidence`, with the C14 enums and SQL CHECK constraints; no backfill of legacy `role`, `Experience.openingHours` or `durationMinutes`; verify migration applies on the test database, `prisma:generate`, typecheck, a CHECK-constraint test per table (traversal fields only on TRAVERSE, opening-hours KNOWN completeness, duration range/status, relation self-reference), and that no new place/schedulable identity table exists

Acceptance: one additive Prisma migration matching C14, with no legacy backfill or parallel place/schedulable identity table; migration application, Prisma generation, typecheck, and direct database checks for every specified invariant must pass on a disposable database.

### S2 — OpenSpec task 39.1 (verbatim)

> 39.1 Wire destination-scope structured POI discovery through the acquisition router (STRUCTURED_POI, existing OSM/Wikidata integrations, provider failure = FAILED never empty), identity reconciliation, the parent/child visit-unit policy and structured admission persisting admission evaluations in `GeoEntityAdmission` (destination-independent outcomes only), PART_OF relations with visit-unit classification in `GeoEntityRelation`, merge rule/evidence on `GeoEntityIdentity`, and opening hours in `GeoEntityOpeningHours` (design C14); possible duplicates only in the trace; verify integration tests against the test database: typed outcomes for every candidate, provenance enumerable, zero LLM/search/fetch calls

Acceptance: the ordinary structured-POI route is destination-bounded and uses existing providers; provider failures remain typed failures; every candidate's typed decisions and enumerable provenance are persisted; identity and visit-unit policies are canonical; hours/relation/link evidence persistence is wired; candidate duplicates stay trace-only; ordinary flow proves zero LLM/search/fetch calls.

Scope guard: implement only S1 and S2. Do not start tasks 40.x, 41.x, 42.x, 43.x, or 25.8. Duration storage is required in S1; S2 does not require duration acquisition or writes (those are later projection/maintenance work).

## Tasks

- T39.0 — S1 — inline — in progress; inherited schema/migration checkpoint `bc83614f`, acceptance checks pending.
- T39.1 — S2 — inline — in progress; inherited persistence service/resolver checkpoint `bc83614f`, router/provider and database integration coverage pending.

Risk: item 1 (additive database schema migration and C14 persisted contracts).

## Log

### L1 — Original request (verbatim)

I explicitly authorize creating a checkpoint commit of the inherited uncommitted work from the previous Cline session, solely to formalize the agent handoff and restore a clean worktree for the repository preflight.

Before committing:

1. Inspect `git status`, `git diff`, `git diff --staged`, and all untracked files.
2. Confirm every file included in the checkpoint belongs to the existing partial implementation of OpenSpec tasks 39.0/39.1.
3. Do NOT include `.atl/`, tool caches, editor files, generated local artifacts, secrets, temporary DB files, or unrelated changes.
4. Do NOT modify the inherited implementation merely to prepare the checkpoint.
5. Report the exact files that will be included.

If and only if the changes are exclusively the inherited 39.0/39.1 work, create one checkpoint commit:

`wip(openspec): checkpoint 39.0/39.1 agent handoff`

Do not push that checkpoint yet.

Then:

- confirm the worktree is clean except for known ignored/untracked tooling that is not part of the repository;
- run `git fetch origin --prune` again;
- rerun `scripts/agent-preflight`.

For the merge-tree check, the Git worktree uses the common object store at:

`/Users/jiseruk/projects/zig-zag/.git`

If the sandbox blocks Git from writing required temporary/object-store state there, request/use the repository-approved execution mode with write access to that Git common directory. Do not modify product code or weaken the preflight script to bypass this.

Once preflight reports WRITE AUTHORIZED and INTEGRATION READY, resume only tasks 39.0 and 39.1 from the checkpoint.

Do not start 40.x or later tasks.

When 39.0/39.1 are actually complete and validated, create the normal bounded completion commit(s), push the full branch to `origin/feat/synthetic-tours-openspec`, and stop.

### L2 — Checkpoint and environment resolution (2026-10-19)

- Created checkpoint `bc83614f` with exactly six inherited 39.0/39.1 implementation files; `.atl/` remains local tooling and is excluded by clone-local Git info/exclude.
- Escalated preflight passed with `WRITE AUTHORIZED` and `INTEGRATION READY`; integration target is `main`, push target remains the feature-branch upstream.
- Explorer audit found no visit-duration writes required by 39.1: that task covers schema in 39.0; projection and lazy maintenance are later tasks, out of scope here.
- CodeGraph still points at the parent checkout; do not rely on it for this worktree.
- Prior checkpoint commit introduced a database migration; run the named item-1 independent verification after the implementation's own checks.

### L3 — Disposable database preflight (2026-10-19)

- `be/test/support/assert-disposable-database.ts` accepts names ending in `_test`, `-test`, `_integration`, `_e2e`, or `_ci` (case-insensitive), plus the documented spike DB; no bypass flag is used.
- The local-only Compose Postgres service exposes localhost:5432 and defaults to postgres/postgres with initial database `zigzag`; `.env.example` points at that non-disposable DB and was not used.
- Existing `zigzag_test` had tables, so created a fresh `zigzag_39_test` database in the running `zigzag-postgres` container. The helper accepts it and a host connection confirmed zero public tables.
- A fresh `scripts/agent-preflight` now blocks only because this required ODD task document is untracked. No product code has been modified. Track document must be committed as its own ODD planning checkpoint before source writes, then rerun preflight.
