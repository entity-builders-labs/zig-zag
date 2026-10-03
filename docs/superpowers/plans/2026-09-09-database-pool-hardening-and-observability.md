# Plan: PostgreSQL pool hardening and observability

Status: future implementation plan; documentation only  
Date: 2026-09-09  
Branch: `feat/experience-domain-v2`

## Repository reality at plan time

- Verified HEAD before this documentation change: `87b1b1d3186fc3cedc53d91791f7465132d70b30`.
- The reported fix is present as commit `9aa2b94`:
  `fix(tours): bound candidate concurrency in experience resolution`.
- `ExperienceProposalResolverService` exports
  `RESOLVER_CANDIDATE_CONCURRENCY = 4` and uses bounded worker lanes around the
  candidate-level resolution/persistence work. The resolver still uses a small
  `Promise.all` for two independent OSM lookups; that is not the candidate fan-out
  fixed by `9aa2b94`.
- `PrismaService` currently constructs `new Pool({ connectionString: databaseUrl })`
  and passes it to `PrismaPg`; pool capacity, idle timeout, and connection
  acquisition timeout are not explicitly configured in the application layer.
- `database.config.ts` currently exposes only `database.url` and
  `database.directUrl`; it does not parse pool settings.
- `be/test/integration/support/test-db.ts` connects using `DATABASE_URL` and its
  reset helper executes an interpolated `TRUNCATE ... RESTART IDENTITY CASCADE`
  over the configured database. It currently has no database-name safety guard.
- The app has a simple `/health` endpoint. The dedicated HealthModule is commented
  out. There is no generic pool-stats or metrics adapter. The outbox has its own
  domain metrics interface, but that is not a database-pool observability seam.

This plan records the operational work that remains. It does not reopen or replace
the resolver fix, and it is intentionally separate from Experience acquisition,
ranking, curation, Engine Quality Gate G, and Argentina Live Smoke H.

## 1. Incident and motivation

The Buenos Aires cold-start characterization produced a large candidate batch. The
resolver previously used an unbounded candidate-level `Promise.all(...)`. Each
candidate could start an interactive Prisma transaction, and each transaction held
a connection from the `pg.Pool`. With the pool relying on library defaults, the
fan-out exhausted available connections; Prisma then could not begin additional
transactions within `maxWait` and reported “Unable to start a transaction in the
given time”.

Commit `9aa2b94` is the immediate correction: candidate resolution and persistence
now use bounded concurrency (`RESOLVER_CANDIDATE_CONCURRENCY = 4`). The real Buenos
Aires repro completed after that change.

The distinction must remain explicit:

- **Resolver concurrency** limits one workload's candidate fan-out.
- **Database pool capacity** limits connections consumed by the whole backend
  instance across API requests, resolver transactions, catalog reads, jobs, and
  persistence.

The latter is defense-in-depth and production readiness. The incident was not
caused by “pool max being too low” alone: unlimited workload concurrency faced a
finite resource. A larger pool could delay the failure but would not remove that
defect.

## 2. Remaining problem

`PrismaService` currently owns a `pg.Pool` whose operational choices are implicit.
The service does not make max connections, idle timeout, or connection acquisition
timeout explicit, configurable, or startup-validated. Other modules cannot ask the
core database layer how many clients are active or waiting.

The future implementation should make these decisions explicit and inspectable
without leaking the raw `pg.Pool` into business modules.

## 3. Goals

Future increments should:

1. configure the `pg.Pool` explicitly;
2. expose pool capacity through validated application configuration;
3. fail fast on explicitly invalid values;
4. provide a small provider-neutral pool-stats seam;
5. make contention and saturation observable;
6. leave room for OpenTelemetry, CloudWatch, Prometheus, Datadog, or another
   eventual observability backend without rewriting `PrismaService`;
7. document connection budgeting across replicas and workers;
8. make destructive integration resets safe by default;
9. add durable tests for configuration, stats mapping, and DB-reset safety;
10. preserve independent workload-level concurrency controls.

## 4. Non-goals

The first implementation must not:

- change `RESOLVER_CANDIDATE_CONCURRENCY` or make it dynamic from pool size;
- raise Prisma `maxWait` as the primary remedy;
- hide overload by arbitrarily increasing connection counts;
- implement PgBouncer, RDS Proxy, AWS infrastructure, autoscaling, or distributed
  admission control;
- change acquisition breadth, discovery, ranking, planner, curation, or agentic
  travel planning;
- add Prometheus/Grafana merely because pool settings are being hardened;
- introduce a database health score or a new quality subsystem.

PgBouncer/RDS Proxy remain deployment decisions for a later stage.

## 5. Explicit pool configuration

Evaluate configuration keys equivalent to:

- `DATABASE_POOL_MAX`
- `DATABASE_POOL_IDLE_TIMEOUT_MS`
- `DATABASE_POOL_CONNECTION_TIMEOUT_MS`

The exact names should follow existing configuration conventions after inspection.
The future implementation should pass the parsed values explicitly to the actual
`pg`/`@prisma/adapter-pg` APIs, conceptually:

```ts
new Pool({
  connectionString: databaseUrl,
  max: poolMax,
  idleTimeoutMillis: poolIdleTimeoutMs,
  connectionTimeoutMillis: poolConnectionTimeoutMs,
});
```

This is a non-binding sketch. Verify the installed package versions and adapter API
before coding. Do not encode pool parameters into `DATABASE_URL` unless the current
adapter demonstrably supports the desired semantics.

Initial hypotheses to load-test, not architecture constants:

- local/development: `max = 10`;
- first production deployment: perhaps around `max = 20` per backend instance;
- idle timeout around 30 seconds;
- connection timeout around 5 seconds.

Production values depend on the database's real capacity, replica count, workers,
and safety headroom.

## 6. Parsing and startup validation

Extend the real configuration layer (`database.config.ts` or its successor) with
numeric parsing. Distinguish the following behaviors:

- env absent → documented default;
- env present and valid → parsed number;
- env present but invalid (`0`, `-1`, `banana`, malformed numeric text) → fail fast
  with a safe, actionable startup error.

Define lower/upper bounds only when justified by `pg`, deployment constraints, or
load evidence. Do not invent an arbitrary `max = 100` policy. Error messages must
identify the setting and validation rule without printing credentials or a full
connection URL.

## 7. Pool-stats seam

Keep the raw pool private to the core database layer. Design a small interface such
as:

```ts
interface DatabasePoolStats {
  max: number;
  total: number;
  idle: number;
  active: number;
  waiting: number;
}
```

`active` is derived as `total - idle` (with a defensive non-negative clamp if the
actual adapter requires it). A future `PrismaService.getPoolStats()` or a dedicated
database-layer provider may implement the seam. Business modules must not receive
or depend on `pg.Pool`.

The first observable signals are conceptually:

- `db_pool_max`
- `db_pool_total`
- `db_pool_idle`
- `db_pool_active`
- `db_pool_waiting`
- optional derived `db_pool_utilization = active / max`

`waiting > 0` is the clearest contention signal. Connection-acquisition wait
latency can be a later increment if measuring it requires invasive instrumentation.

## 8. Observability integration

The intended boundary is:

```text
pg.Pool → DatabasePoolStats → future observability adapter
```

First implement the stable stats seam, not a vendor-specific exporter. Reuse an
existing observability abstraction if one is discovered; current inspection found
no generic metrics backend. The outbox's `OutboxMetrics` is domain-specific and
should not become a second, unrelated pool abstraction.

At startup, a redacted configuration log may report:

```text
Database pool configured: max=10 idleTimeoutMs=30000 connectionTimeoutMs=5000
```

Never log `DATABASE_URL`, passwords, or secrets. Avoid polling every second. If a
warning is added for contention, throttle/coalesce it and include max, total,
active, idle, and waiting; do not emit one warning per query.

## 9. Health and saturation

The current `/health` endpoint is a basic process/provider response, and the
dedicated HealthModule is not active. Future work should decide whether pool stats
belong in a debug/admin endpoint or a readiness/status contract.

Keep these meanings separate:

- **Liveness:** the process is alive.
- **Readiness:** the database is available for normal work.
- **Saturation:** the pool is under pressure.

Do not mark an instance unhealthy merely because `waiting > 0` for a few
milliseconds. A sustained saturation signal may feed diagnostics or future alerts,
but contention is not automatically a hard health failure.

## 10. Resolver concurrency versus pool size

This separation is mandatory. Do not implement:

```text
RESOLVER_CANDIDATE_CONCURRENCY = DATABASE_POOL_MAX - 1
```

For example, `RESOLVER_CANDIDATE_CONCURRENCY = 4` and
`DATABASE_POOL_MAX = 20` means only that the resolver has at most four candidate
workers. It does not reserve the other sixteen connections. The shared pool serves
resolver transactions, API traffic, catalog reads, jobs, and tour persistence.
Every workload that introduces fan-out needs its own deliberate bound.

## 11. Future workload-concurrency audit

After the pool seam exists, audit likely database fan-out sites using `Promise.all`,
`Promise.allSettled`, concurrent maps, and batch processors. Review them
individually for transaction lifetime and pool impact. Do not replace every
`Promise.all` in the repository mechanically. The resolver fix is the known
incident regression; this audit is a targeted follow-up.

## 12. Production connection budget

Document the deployment calculation, with safety headroom:

```text
usableConnections = postgresMaxConnections - reservedConnections
poolBudgetPerInstance ≈ usableConnections / maximumExpectedInstances
```

Illustrative example only:

```text
Postgres max_connections = 200
reserved connections    = 40
usable app connections  = 160
maximum backend replicas = 8
160 / 8 ≈ 20 per backend instance
```

The real budget must also account for migrations, admin access, monitoring,
workers, queue consumers, background jobs, and other services sharing the database.
Do not spend the entire theoretical division; preserve emergency and operational
headroom.

## 13. Autoscaling implications

Pool capacity and maximum replica count are coupled operationally even though
resolver concurrency and pool size remain independent in code. `max = 20` yields
160 potential connections at eight pods but 320 at sixteen pods, which can exceed a
Postgres limit of 200. Any future autoscaling change should validate the connection
budget. No Kubernetes/ECS policy is part of this plan.

## 14. RDS Proxy / PgBouncer decision

Evaluate RDS Proxy or PgBouncer later if replica count, burst autoscaling, worker
count, connection churn, or RDS capacity make pooling a deployment constraint.
Neither is mandatory now. A proxy does not remove the need for bounded workload
concurrency, explicit pool sizing, or pool metrics; it cannot make an infinite
`Promise.all` safe.

## 15. Integration DB safety

This is a high-priority safety item. The current integration helper can run
`TRUNCATE ... RESTART IDENTITY CASCADE` against whatever `DATABASE_URL` points to.
During this workstream that behavior already destroyed data in a shared local dev
database. The default must become fail-safe: when the target cannot be proven to be
disposable, do not truncate.

Preferred design:

1. require a dedicated integration database (for example `zigzag_test` or
   `zigzag_integration`);
2. validate the parsed database name before destructive reset;
3. reject names that look like the shared `zigzag` dev database, production-like
   names, or otherwise fail the allow-list/guard;
4. optionally support a highly visible explicit override only if a later design
   proves it necessary;
5. never rely on `NODE_ENV` alone, because a development process can still point at
   the wrong database.

The guard must not print passwords or a full rejected URL. A safe diagnostic may
include a redacted host and database name.

## 16. Integration DB acceptance cases

Future durable tests should demonstrate:

| Target | Expected destructive reset |
| --- | --- |
| `zigzag_test` | allowed |
| `zigzag_integration` | allowed |
| shared `zigzag` | rejected |
| production-like database name | rejected |
| explicit override, if retained | allowed only with conspicuous opt-in and documentation |

The local/CI experience should make the dedicated database straightforward:

```text
normal backend development: DATABASE_URL=.../zigzag
integration tests:          DATABASE_URL=.../zigzag_integration
```

Docker Compose provisioning of a separate database is an option to evaluate, not
an implementation requirement in this document.

## 17. Test strategy

Future increments should add focused tests without coupling to node-postgres
internals:

### Configuration unit tests

- absent env → documented defaults;
- `DATABASE_POOL_MAX=20` → numeric config `20`;
- `0`, `-1`, and `abc` → startup/config validation failure.

### Stats mapping tests

- `total = 8`, `idle = 3` → `active = 5`;
- waiting count is preserved;
- configured max is reported consistently.

### Integration DB safety tests

Exercise the allow/reject cases above using a redacted URL/parser seam, without
requiring a destructive operation against an actual shared database.

## 18. Pool interaction regression

Plan one future integration/load regression with a deliberately small pool (for
example `max = 4`), bounded resolver concurrency, and a batch of roughly 25–50
candidates. It should complete without transaction-acquisition timeout and process
all candidates. Avoid fragile sleep-based assertions; use deterministic fakes or
controlled barriers where possible. The existing resolver concurrency regression
remains the first defense; this test verifies interaction with real pool capacity.

## 19. Load characterization before production sizing

Before choosing production numbers, run representative workloads:

- normal Tour reads;
- catalog reuse;
- empty-catalog city acquisition;
- multiple simultaneous Tour generations;
- API traffic concurrent with generation;
- large acquisition batches.

Capture pool max, total, active, idle, waiting, request latency, transaction
failures, generation latency, database CPU, and database connection count. The
objective is to size `DATABASE_POOL_MAX` from evidence, not merely prove that one
scenario no longer crashes.

## 20. Future alerting

Do not implement alerts in this documentation task. Candidate future signals are:

- sustained `db_pool_waiting > 0` over a defined window;
- high pool utilization over a defined window;
- connection-acquisition timeout;
- Prisma transaction startup timeout;
- Postgres approaching `max_connections`.

Thresholds should follow load evidence and deployment SLOs, not arbitrary initial
constants.

## 21. Proposed implementation sequence

Each increment should be independently reviewable:

### A. Explicit pool configuration

Add config parsing, validation, explicit `Pool` construction, and focused tests.

### B. Pool stats seam

Add `DatabasePoolStats`, a core-layer accessor, mapping tests, and no raw-pool
leakage.

### C. Contention observability

Add the safe startup configuration log and throttled saturation signal; connect to
an existing/future observability adapter only after its boundary is known.

### D. Integration DB safety

Require/validate a dedicated DB, protect destructive reset, and test rejection of
shared or production-like names.

### E. Pool saturation regression

Exercise a small real pool with a sufficiently large bounded batch and no
transaction-start timeout.

### F. Production sizing documentation

Record the real connection budget, replica/workers assumptions, and safety headroom.

### G. Load characterization

Run only when the deployment/runtime and representative workload are available.

## 22. Priority and boundaries

Suggested priority:

- **HIGH:** integration DB destructive-reset guard;
- **BEFORE PRODUCTION:** explicit pool configuration, stats seam, connection-budget
  sizing;
- **BEFORE SCALE:** exported metrics, load testing, proxy evaluation.

The existing bounded resolver fix remains usable for cold-start characterization and
must not block G/H unnecessarily. This plan is transversal backend infrastructure,
not Phase 7 G, Phase 8, or an Experience Domain feature.

## 23. Open questions

Do not resolve these without deployment and load evidence:

- Which AWS runtime will be used: ECS, EKS, or another option?
- What initial PostgreSQL/RDS instance class and real `max_connections` will apply?
- What maximum backend replica count is expected?
- Will workers have independent processes and pools?
- Which observability backend will be standard?
- Will OpenTelemetry be the common seam?
- Is connection-acquisition latency instrumentation necessary?
- Should API and worker pool settings differ?
- When does RDS Proxy or PgBouncer become worthwhile?
- How will a dedicated integration database be provisioned locally and in CI?
- Will any destructive integration reset ever be permitted through an explicit
  override?
- Which additional workloads require bounded concurrency?

## 24. Related documents

- [Multi-source acquisition progress](../progress/2026-09-06-multi-source-acquisition-progress.md)
- [Multi-source acquisition implementation plan](2026-09-08-multi-source-acquisition-implementation.md)
- [Activity discovery and tour-generation architecture](../../architecture/activity-discovery-and-tour-generation.md)
- [Buenos Aires cold-start characterization](../characterization/2026-09-09-buenos-aires-cold-start-discovery-characterization.md)
- [Experience curation and review design](../specs/2026-09-09-experience-curation-and-review-design.md) — referenced only to keep future curation separate from infrastructure hardening.

## 25. Delivery boundary

This document is a future plan. In the session that created it:

- no production code was changed;
- no Prisma or `pg.Pool` configuration was changed;
- no environment variable was added or changed;
- no metrics stack, health endpoint, or alert was added;
- no tests were modified or executed for this plan;
- no characterization, G, or H work was started;
- `feat/agentic-travel-planning` was not touched.
