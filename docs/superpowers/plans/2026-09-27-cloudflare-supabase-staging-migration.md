# Cloudflare + Supabase Free Staging Migration — Implementation Plan

Status: **approved for implementation; AWS cutover remains gated by remote validation.**
Written: 2026-09-27.
Branch: `feat/cloudflare-supabase-staging`.
Canonical repository: `git@github.com:entity-builders-labs/zig-zag.git`.

## Goal

Replace the dormant AWS staging deployment with a low-volume test environment
built from Cloudflare and Supabase Free, while preserving the current NestJS,
Prisma, transactional-outbox, SSE, Push, and provider-neutral application
boundaries.

AWS resources are disposable and no data is migrated. A new Supabase project
starts empty from the current Prisma migrations and seed. AWS is not destroyed
until the remote Cloudflare gate below passes.

## Decisions already made

- GitHub remains the source repository and PR provider. Cloudflare Workers
  Builds replaces GitHub Actions for application build/test/deploy.
- Merges to `main` deploy the application automatically. PRs build and test,
  but do not deploy staging.
- One ordered deployment pipeline runs: test/build, `prisma migrate deploy`,
  Worker deploy, then Pages deploy.
- Cloudflare build/runtime secrets are the operational secret store. GitHub
  Actions remains possible later through provider-neutral scripts, but has no
  active deployment role.
- Terraform has a separate Cloudflare Build. A relevant change runs
  `fmt -check`, `validate`, and `plan`; `apply` is only a manual build over a
  reviewed commit. A documented equivalent local script is reserved for
  bootstrap and recovery.
- Terraform state lives in Cloudflare R2. New Cloudflare/Supabase state and
  AWS-legacy state use distinct keys. R2 bucket bootstrap is a one-time manual
  step, followed by Terraform import.
- Queue production implementation is Cloudflare Queues; in-memory is local
  and test only. Quota exhaustion becomes an explicit terminal operational
  failure, without an automatic next-day retry.
- SSE remains supported through one Durable Object per `tour:<id>` or
  `experience:<id>` channel. Existing Push remains the terminal fallback.
- Embeddings use Cloudflare Workers AI
  `@cf/google/embeddinggemma-300m`, stored at 768 dimensions. The provider is
  explicitly `cloudflare`, never disguised as OpenAI.
- No custom domain is needed; Cloudflare Pages and Workers provider domains
  are sufficient for staging.

## Architecture and implementation sequence

### 1. Isolated infrastructure foundation

Create a dedicated Cloudflare/Supabase Terraform root and preserve the current
AWS root solely as `aws-legacy` until destruction. Provision a new Supabase
project, R2 state configuration, Cloudflare Pages project, Worker, Queues and
DLQ, Hyperdrive, Durable Object namespace, Cron trigger, Workers AI binding,
and least-privilege secrets/references.

Pin Terraform providers. Keep Supabase-provider concerns isolated because its
Terraform provider is public Alpha. Do not put passwords, access keys, or
connection strings in `.tf`, Git, build artifacts, or frontend configuration.

Hyperdrive is the runtime PostgreSQL connection path. Prisma migrations use a
separate direct Supabase connection only in the protected build environment.
Use a cache-disabled Hyperdrive binding for all ORM traffic until an explicit,
consistent read cache policy exists.

### 2. Worker-compatible application entrypoint

Keep the NestJS/Express HTTP application and introduce a Worker entrypoint
under `nodejs_compat`; do not duplicate controllers or route policy. Bind the
Hyperdrive connection string before Prisma application bootstrap. Preserve
existing CORS, JWT authentication, Swagger policy where practical, and HTTP
response contracts.

The production Worker must not start long-lived Node timers. Move outbox
polling to the scheduled Worker handler and explicitly disable the current
interval lifecycle in the Worker runtime.

### 3. Durable queue and notification cutover

Replace the production semantics of `IMessageQueueService.subscribe()` with:

- a typed `IMessagePublisher` that enqueues domain-event envelopes;
- a typed consumer dispatcher that maps envelope type to existing handlers;
- Cloudflare Queue consumers that invoke the dispatcher;
- a DLQ consumer that translates exhausted consumer delivery into the current
  terminal tour failure state.

Outbox publication completes when Cloudflare accepts a message; generation
completion remains owned by its consumer. Preserve current idempotency checks.
Transient delivery errors follow bounded Queue retries. Quota exhaustion and
Workers AI quota failure are classified as terminal operational failures and
shown in trace/UI rather than becoming an apparent partial success.

Replace in-memory SSE fanout only in the deployed Worker with the Durable
Object stream adapter. The HTTP edge must perform the existing authentication
and ownership checks before joining a channel. Queue consumers send progress
to the channel; terminal Push delivery stays in the notification workflow.

### 4. Cloudflare embeddings

Add `cloudflare` to the typed embedding-provider configuration and factory.
Implement the Workers AI adapter at that boundary, returning a typed vector
and canonical provider/model/dimension identity. Do not introduce Cloudflare
provider branches into ranking, catalog, composition, identity, or planning.

Migrate `Experience.embedding` from `vector(256)` to `vector(768)`, rebuild
its HNSW index, remove Nomic-specific truncate/renormalize behavior from the
Cloudflare path, and bump `EXPERIENCE_EMBEDDING_DOCUMENT_VERSION`. The
version-aware indexer reindexes stale verified Experiences; the fresh Supabase
project has no historical data but must still execute the real migration.

### 5. Application and infrastructure builds

Create provider-neutral scripts for Worker deploy, Pages deploy, database
migration, Terraform plan, and Terraform apply. Configure the main Cloudflare
Build to execute tests before migrations and deploy the Worker before Pages.

Configure the infrastructure Build to calculate the changed path set. If no
Terraform files changed, it exits without Terraform initialization. If they
did, it runs validation and emits the plan. A protected manual execution is
the sole normal `apply` path. The local recovery command must use the same R2
state key and reviewed commit, never a separate state or parallel pipeline.

### 6. Remote gate, then AWS retirement

Deploy the isolated staging environment and run the remote checks below. Only
after every check passes:

1. export and back up `aws-legacy` state;
2. use its protected manual Terraform apply/destroy path;
3. verify RDS, EC2/ASG, ALB, ECR, S3/CloudFront, IAM, CloudWatch and network
   resources are gone;
4. verify AWS cost and service dashboards after the billing delay;
5. delete AWS CI workflows, configuration, templates and obsolete adapters.

Do not remove the AWS state, credentials required for destruction, or legacy
Terraform root before the corresponding resources are confirmed gone.

## Required tests and remote acceptance gate

Add focused tests before each behavior change:

- Worker entrypoint boot, HTTP health/auth, and Prisma connection adapter.
- Outbox-to-Queue envelope serialization, dispatcher mapping, duplicate
  delivery idempotency, retry behavior, and DLQ-to-terminal-failure mapping.
- SSE authorization and channel isolation, progress event delivery through a
  Durable Object adapter, and existing Push fallback behavior.
- Cloudflare embedding provider request/response normalization, 768-dimension
  validation, embedding identity persistence, document-version reindexing,
  and cosine-query compatibility.
- Terraform plan path filtering and refusal to apply without the explicit
  manual-build control.

The remote gate uses a disposable Supabase project and must prove:

1. Worker boot, health check, authentication, and a real Prisma query through
   Hyperdrive.
2. Prisma migrations plus `pgvector` and PostGIS availability.
3. A representative tour generation through Queue, progress over SSE, and
   terminal Push behavior.
4. Duplicate event handling, an intentional retry, and an intentional DLQ
   delivery.
5. One Workers AI embedding plus a persisted vector similarity query.
6. Small concurrent load while monitoring Hyperdrive connections and Worker
   memory.
7. No recurring Worker CPU-limit (`1102`), startup, Queue, or quota failures
   in Cloudflare logs.

Cloudflare Workers Free permits 10 ms CPU per invocation; Queue consumers share
that execution model. Network waits do not count as CPU, but NestJS/Prisma
startup and active JavaScript do. This gate decides feasibility; it must not be
assumed from local tests. Cloudflare Free Queues allow 10,000 operations/day
and 24-hour retention. Hyperdrive Free allows 100,000 database statements/day
and roughly 20 origin connections. See the official limits:

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/queues/platform/limits/
- https://developers.cloudflare.com/queues/platform/pricing/
- https://developers.cloudflare.com/hyperdrive/platform/pricing/
- https://developers.cloudflare.com/hyperdrive/platform/limits/

If the remote gate fails, stop before AWS retirement and record measured
failure evidence. Select the next action only after reviewing that evidence;
do not silently introduce a paid service, drop generation, or create a second
runtime architecture.

## Explicit non-goals

- No production-scale deployment, custom domain, data migration, or AWS-to-
  Supabase data sync.
- No standalone Experience creation from a component, no tourism-domain or
  planner policy change, and no GeoEntity embeddings.
- No Supabase Realtime replacement for the existing SSE/Push model.
- No automatic Terraform apply and no active dual AWS/Cloudflare deployment
  pipeline after the eventual cutover.
