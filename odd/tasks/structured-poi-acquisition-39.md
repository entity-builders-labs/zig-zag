# Structured POI acquisition and C14 persistence
Objective: complete only OpenSpec tasks 39.0 and 39.1 on `feat/synthetic-tours-openspec`.
Delivery: `feature-branch-chain` (user specified the existing feature-branch push); forecast 700–1,100 authored lines. Runner: Prisma CLI, Jest, and disposable PostgreSQL integration tests from `be/`.

## Specs

### S1 — OpenSpec task 39.0 (verbatim)

> 39.0 Implement the design C14 schema in one Prisma migration: `GeoEntityAdmission`, `GeoEntityRelation`, `GeoEntityOpeningHours`, `GeoEntityVisitDuration` (GeoEntity-keyed, cascade on GeoEntity delete), `Experience.compositionSignature` (nullable unique), ExperienceComponent `participation` + traversal columns, GeoEntityIdentity link evidence, Tour `readinessVerdict`/`timezone`/`planningContext`/`planningDiagnostics`, TourExperience `endTime`, TourExperienceComponent `participation`/`plannedStart`/`plannedEnd`/`planningEvidence`, with the C14 enums and SQL CHECK constraints; no backfill of legacy `role`, `Experience.openingHours` or `durationMinutes`; verify migration applies on the test database, `prisma:generate`, typecheck, a CHECK-constraint test per table (traversal fields only on TRAVERSE, opening-hours KNOWN completeness, duration range/status, relation self-reference), and that no new place/schedulable identity table exists

Acceptance: one additive Prisma migration matching C14, with no legacy backfill or parallel place/schedulable identity table; migration application, Prisma generation, typecheck, and direct database checks for every specified invariant must pass on a disposable database.

### S2 — OpenSpec task 39.1 (verbatim)

> 39.1 Wire destination-scope structured POI discovery through the acquisition router (STRUCTURED_POI, existing OSM/Wikidata integrations, provider failure = FAILED never empty), identity reconciliation, the parent/child visit-unit policy and structured admission persisting admission evaluations in `GeoEntityAdmission` (destination-independent outcomes only), PART_OF relations with visit-unit classification in `GeoEntityRelation`, merge rule/evidence on `GeoEntityIdentity`, and opening hours in `GeoEntityOpeningHours` (design C14); possible duplicates only in the trace; verify integration tests against the test database: typed outcomes for every candidate, provenance enumerable, zero LLM/search/fetch calls

Acceptance: the ordinary structured-POI route is destination-bounded and uses existing providers; provider failures remain typed failures; every candidate's typed decisions and enumerable provenance are persisted; identity and visit-unit policies are canonical; hours/relation/link evidence persistence is wired; visit-duration knowledge is persisted only when explicit canonical evidence is available (no inferred durations or new provider acquisition); candidate duplicates stay trace-only; ordinary flow proves zero LLM/search/fetch calls.

Scope guard: implement only S1 and S2. Do not start tasks 40.x, 41.x, 42.x, 43.x, or 25.8. Duration storage is required in S1; S2 adds persistence only for explicit canonical duration evidence already available to this path and does not acquire durations from new providers.

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

### L4 — User clarification on database setup and duration persistence (2026-10-19; verbatim)

The handoff checkpoint is accepted:

```text
bc83614f
```

Do not rewrite or squash it.

The current blocker is only the disposable PostgreSQL test database required by task 39.

Before changing product code, inspect the repository's existing integration-test database helper, test-safety guard, Docker/Compose configuration, package scripts, and example env files to determine the **repo-approved disposable database setup**.

Do not guess the required database name.

## 1. Determine the exact DB safety contract

Report first:

```text
- helper/script that validates DATABASE_URL
- exact database-name rule used to prove the DB is disposable
- expected PostgreSQL host/port/user/password/database
- existing repo script or compose service intended for integration tests
- whether an already-running local PostgreSQL container can safely be used
```

The database must be isolated from development/production data.

Do not point tests at any existing non-disposable application database.

## 2. Configure a disposable DB

If the repository already defines an approved test PostgreSQL service/setup, use it.

Otherwise, create only the minimal local disposable database required by the existing repo conventions.

Prefer:

```text
existing repo Docker/Compose PostgreSQL
+ separate test database name accepted by the safety guard
```

Do not modify production deployment configuration merely to run tests.

Do not commit secrets or machine-specific credentials.

If a local env file is required and is ignored by git, configure only the required `DATABASE_URL` there or export it for the test commands.

Before any destructive migration/reset, show that the safety helper positively identifies the database as disposable.

## 3. Resume 39.0/39.1

Once the disposable DB is available and safety checks pass:

### 39.0
Finish and verify the C14 Prisma schema/migration.

Run the migration against the disposable DB and verify:

```text
prisma generate
migration applies from a clean database
required SQL CHECK constraints
unique/cascade constraints
no unintended legacy backfill
no second place/schedulable identity model
```

### 39.1
Finish the production structured acquisition/admission persistence wiring.

The prior remap already identified at least:

```text
visit-duration persistence is missing
database integration evidence is missing
```

Verify all task 39.1 requirements against the current OpenSpec before editing.

Do not infer that visit duration must be populated from Geoapify or another provider if the spec does not supply evidence. Persist only actual canonical knowledge available to this path.

## 4. Required DB integration evidence

Add/run integration coverage demonstrating the persisted path:

```text
structured discovery
→ identity reconciliation
→ parent/child visit-unit classification
→ structured admission
→ GeoEntityAdmission persistence
→ GeoEntityRelation persistence
→ GeoEntityIdentity evidence persistence
→ GeoEntityOpeningHours persistence where evidence exists
→ GeoEntityVisitDuration persistence where evidence exists
```

Provider failure must remain typed FAILED, never empty truth.

Assert zero LLM/search/web-fetch calls on this structured path.

## 5. Gates

Run:

```text
relevant DB integration tests
migration/constraint tests
targeted unit tests
yarn typecheck
eslint changed files
openspec validate --changes --strict
git diff --check
scripts/agent-preflight
```

If any gate fails, stop and report the actual failure rather than broadening scope.

## Completion

If 39.0 and 39.1 are complete:

- mark only 39.0 and 39.1 complete;
- update progress/evidence;
- create bounded completion commit(s) after checkpoint `bc83614f`;
- push to `origin/feat/synthetic-tours-openspec`;
- stop.

Do not start task 40.

Report:

```text
disposable DB configuration used
why the safety guard accepts it
migration results
DB integration results
missing/implemented persistence paths
commit SHAs
remaining blockers before task 40
```

### L5 — Resume implementation verification (2026-10-19)

- Re-ran `scripts/agent-preflight`: WRITE AUTHORIZED and INTEGRATION READY.
- Verified `zigzag_39_test` with the repository disposable-name guard; Prisma
  reset applied the full migration chain, including C14, from an empty schema.
- `prisma:generate` passed. Added real-Postgres C14 CHECK/uniqueness/cascade
  coverage; its three tests pass. Targeted structured-POI and persistence unit
  tests pass, and `yarn typecheck` passed before the latest integration rerun.
- Began task 39.1 by adding a destination-bounded `structured_poi` source plan,
  OSM adapter provider, typed failure handling, admission provenance, and raw
  opening-hours evidence persistence. Task 39.1 remains incomplete: the
  production path still needs direct candidate-level identity/visit-unit/
  admission persistence and its required end-to-end DB integration matrix.
- The last combined integration run exposed a failing canonical orchestration
  fixture after routing was enabled; the fixture was then updated to provide a
  structured OSM feature, but that update has not yet been verified.
- No completion commit or push was created; 39.0 and 39.1 remain unchecked.
