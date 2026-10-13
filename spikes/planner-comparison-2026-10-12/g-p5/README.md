# Gate G-P5 — OR-Tools Routing runtime integration (P-D5) — 2026-10-12

OpenSpec change `gap-driven-destination-knowledge`, design P-D5 / P12, task 32.0.
Bounded gate on top of the planner comparison (`../README.md`, P11). Evidence only: no production code,
no Prisma change, no objective calibration (P-D7). It does not reopen the optimizer comparison:
CP-SAT and the current greedy are already excluded; the question is only whether OR-Tools Routing
can run behind the NestJS backend with acceptable operational complexity, determinism, latency,
failure behaviour and maintainability, or whether greedy best-insertion wins.

**Verdict: G-P5 PASSES → P-D5 = OR-Tools Routing, behind a provider-neutral `PlanningOptimizer`
contract, executed in a colocated Python sidecar, stopped by a solution-count limit
(`routing-gls-sl1000-v1`).** One operational requirement comes with it (sustained CPU, below).

## Layout

| Path | What |
|---|---|
| `sidecar/adapter.py` | OR-Tools Routing adapter: neutral request → model → neutral result (P11 model, see "Model") |
| `sidecar/server.py` | HTTP/JSON sidecar (`GET /healthz`, `POST /v1/plan`), typed errors, TEST-ONLY fault injection |
| `sidecar/stdio_worker.py` | option C: long-lived child process speaking JSON lines |
| `sidecar/requirements.txt`, `Dockerfile`, `compose.planner.yml` | pinned runtime, image, local development |
| `client/problem.mjs` | domain-side problem preparation (stands in for NestJS; port of P11 preparation) |
| `client/optimizer.mjs` | `PlanningOptimizer` port, HTTP and stdio adapters, outcome mapping |
| `client/validate.mjs` | domain-side hard-constraint validation of every returned plan |
| `client/bench.mjs`, `cold.mjs`, `container.mjs`, `failures.mjs` | latency, cold start, CPU quotas, failure semantics |
| `experiments/build_request.py`, `bench_cases.py` | P11 Problem → request; benchmark cases + Node/Python parity |
| `experiments/stop_policies.py`, `summarize.py`, `stress_determinism.py` | stop-policy experiments on all 39 P11 scenarios |
| `runs/` | raw outputs: `stop_policies.json` (+ summary, log), `bench/*.json`, `failures.json`, `bench_quality.json`, `stress_determinism.json` |

## Environment

Developer laptop: Apple M1 Pro (10 cores, 32 GB), macOS, Node v24.3.0, Python 3.14.6, OR-Tools
**9.15.6755** (the P11 version). Containers: Docker 28.2.2, image `python:3.14-slim` + pinned
OR-Tools (linux/arm64 native, linux/amd64 emulated). Production today (`terraform/compute.tf`): one
`t3.micro` EC2 host (2 vCPU burstable, standard CPU credits, 1 GiB) running the backend container
from `node:22.23.1-alpine`. Objective: the P11 TEST-ONLY weights (`p11-test-weights-2026-10-12`), not
P-D7. Fixtures: P11 `fixtures/` (recorded Geoapify walk/drive matrices), unchanged.

## 1. Integration options investigated

**B. Native Node.js binding — not credible; rejected.** OR-Tools officially supports C++, Python,
Java and .NET only. npm (2026-10-12):

| package | status |
|---|---|
| `node_or_tools` (Mapbox) | OR-Tools v5.1-era API, prebuilt binaries for Node 4/6 only, repository points to a private Mapbox repo; abandoned |
| `ts-ortools` | 0.0.20 (2024-09), one maintainer |
| `or-tools-wasm` | 1.0.0, first published 2026-05, one maintainer, 345 MB unpacked, claims Routing; too young for a core dependency |
| `@rescomms/or-tools-wasm` | 0.0.7, two maintainers |
| `@ortools-node/cp-sat`, `cpsat-js` | CP-SAT only (excluded by P11) |

None is official, maintained against current OR-Tools and production-proven for Routing with
disjunctions, dimensions and time windows. Not forced.

**A. Python sidecar — selected.** NestJS → one typed `planning-problem-v1` request → sidecar →
OR-Tools Routing → typed `planning-result-v1`. Measured below.

**C. Other embeddings — measured, not preferred.**
- *Long-lived child process (stdio JSON lines)*: IPC 0.4 ms instead of 1.5 ms (irrelevant next to a
  2 s solve), but OR-Tools ships manylinux wheels only (no musllinux), so it cannot be installed in
  the backend's `node:22-alpine` image: this option means rebasing the backend image on glibc, adding
  Python to it and making Node supervise the worker. No latency gain worth that coupling.
- *Spawn a planner process per request*: +117-151 ms process start/import per plan; no benefit.

## 2. Provider-neutral boundary

```text
DailyPlanningSolver (DAILY_PLANNING_SOLVER, domain)          feasibility windows, utilities, diagnostics, readiness
   └─ PlanningOptimizer.plan(planning-problem-v1)             provider-neutral port
        └─ OrToolsRoutingSidecarOptimizer (adapter)           HTTP, deadline, outcome mapping, validation
             └─ sidecar adapter.py                            RoutingModel, RoutingIndexManager, dimensions, protobuf
```

`OptimizerOutcome` = `PLANNED(result)` | `INFEASIBLE(conflicts)` | `OPTIMIZER_FAILED(reason)`.
The domain prepares everything optimizer-independent: per-candidate per-day **feasible start windows**
(opening hours incl. composite internal timelines, day window), service minutes, utility, uncertain
VISIT component count, must-include, optional per-day anchors, per-mode travel seconds between
travel points (one matrix per mode; `null` = unavailable), walking limits and the objective policy
terms. The request names `optimizerPolicyVersion`; stop parameters are adapter-owned configuration.
No RoutingModel, index manager, dimension, disjunction or protobuf crosses the boundary; replacing the
optimizer means a new adapter, not a Tour-domain change.

Request (abridged):

```json
{ "contractVersion": "planning-problem-v1", "requestId": "…",
  "days": [{ "date": "2026-11-10", "window": { "start": 540, "end": 1140 }, "startPoint": 30, "endPoint": 30 }],
  "travel": { "points": ["BA:way:23633911", "…", "HOTEL"], "modes": ["WALK", "DRIVE"],
              "seconds": { "WALK": [[0, 1566, 1264, "…"]], "DRIVE": [["…"]] } },
  "candidates": [{ "id": "BA:composite:san-telmo-walk", "startPoint": 28, "endPoint": 29, "serviceMinutes": 55,
                   "utility": 850, "uncertainVisitComponents": 0, "mustInclude": false,
                   "startWindowsByDay": [[[540, 1085]], [[540, 1085]], [[540, 1085]]] }],
  "limits": { "maxContinuousWalkMinutes": 30, "dailyWalkBudgetMinutes": 150 },
  "objective": { "policyVersion": "p11-test-weights-2026-10-12", "openingHoursUncertaintyPenalty": 100,
                 "travelCost": { "WALK": { "perMinute": 10, "perLeg": 0 }, "DRIVE": { "perMinute": 20, "perLeg": 100 } } },
  "optimizerPolicyVersion": "routing-gls-sl1000-v1" }
```

Result: per day ordered items `{experienceId, start, end, incoming {mode, seconds}}` and
`outgoingToEnd`; `unscheduled`; `mustIncludeUnplaced` (`proven: false`); `objectiveValue`;
`optimizer {optimizer, optimizerVersion, optimizerPolicyVersion, adapterVersion, solverStatus,
stopReason, reproducible, solutionsGenerated}`; `timings`. Typed rejection reasons (P10) stay
domain-derived from the request + result; the optimizer only reports selection and schedule.

Parity: the Node builder and the Python builder emit **identical** requests for all five benchmark
cases (`bench.mjs` asserts it), so the quality experiments (Python) and the end-to-end path (Node)
plan the same problem.

## 3. Model

The P11 Routing formulation (days = vehicles, one node copy per candidate × day with a feasible start
window, time + walking dimensions, GLS), with two deliberate changes:
1. **Must-include = optional node with a dominant drop penalty** (Σ utilities + 1) instead of a
   mandatory disjunction. A solution therefore always exists; a dropped must-include is reported
   (`mustIncludeUnplaced`, `proven: false`) instead of surfacing as an ambiguous "no solution". A
   must-include with no feasible start window on any day is a proven conflict (`INFEASIBLE`) found
   before solving. No fixture case produced an unproven drop.
2. **Transit costs registered as matrices** (`RegisterTransitMatrix`) instead of Python callbacks:
   ~480 GLS solutions/s on the laptop (the 1 s run already reaches the recorded P11 5 s objective on BA S1);
   identical arc values, so plans equal P11's where both converge.

## 4. Deterministic stopping (all 39 P11 scenarios, `runs/stop_policies*.json`)

`SLn` = GLS stopped by `solution_limit = n` (count-based, with a 30 s safety cap that never fired);
`T…` = wall-clock only (P11 style); `GD` = greedy descent to the first local optimum. Quality is the
P11 test-weight objective scored by the P11 checker/metrics; "Routing 5 s" is the recorded P11 run.

| policy | violations | identical repeats | vs Routing 5 s (mean / worst) | vs greedy best-insertion (all / constrained) | solve ms, ~30-pool (median / max) | scenarios > 1 % below Routing 5 s |
|---|---|---|---|---|---|---|
| T1000 | 0 | **36/39** | -0.00 % / -0.67 % | +3.67 % / +5.91 % | 1000 / 1001 | 0 |
| T5000 | 0 | 39/39 | +0.92 % / -0.54 % | +4.63 % / +6.68 % | 5001 / 5003 | 0 |
| GD | 0 | 39/39 | -2.19 % / -8.69 % | +1.37 % / +2.93 % | 16 / 29 | 20 |
| SL100 | 0 | 39/39 | -1.53 % / -8.50 % | +2.06 % / +3.80 % | 195 / 298 | 15 |
| SL250 | 0 | 39/39 | -0.74 % / -3.02 % | +2.89 % / +5.23 % | 510 / 761 | 11 |
| SL500 | 0 | 39/39 | -0.26 % / -3.02 % | +3.40 % / +5.64 % | 1131 / 1514 | 3 |
| **SL1000** | **0** | **39/39** | **+0.10 % / -0.67 %** | **+3.77 % / +5.95 %** | **2262 / 2831** | **0** |
| SL2000 | 0 | 39/39 | +0.27 % / -0.54 % | +3.95 % / +6.11 % | 4503 / 5843 | 0 |

- Even in-process on one idle machine, the 1 s wall-clock stop returned different plans on repeat
  (BA S3, LA S1, LA S3). Count-based stops never did.
- The improvement-rate limit (`improvement_limit_parameters`, coefficients 1 and 10 over 100
  solutions) did not stop GLS before the 30 s cap: not usable as the primary criterion.
- 4 runs per policy are explicit `INFEASIBLE` (BA/PA/LA S8 closed must-include, LA S4 must-include open
  only Fr-Su on a Tue-Thu trip) — the same conflicts P11 reported.

**Selected stop policy `routing-gls-sl1000-v1`:** first solution PATH_CHEAPEST_ARC, GUIDED_LOCAL_SEARCH,
`solution_limit = 1000` (quality control), `time_limit = 10 s` (operational safety guard only). The
adapter reports `stopReason` = SOLUTION_LIMIT | SEARCH_EXHAUSTED | TIME_CAP; a TIME_CAP plan is valid
but `reproducible: false` and must be recorded as such. SL1000 is the smallest tested limit with no
scenario more than 1 % below the recorded 5 s runs.

**Output stability** (same request, same optimizer/adapter/policy versions):
- in-process: 39/39 scenarios × 3 repeats identical; 20 warm HTTP trials per case → 1 distinct plan;
- CPU contention (20 busy processes on the laptop): identical (`stress_determinism.json`; the laptop
  absorbed the load, so this test alone is weak);
- CPU quotas in the container (`bench/container.json`): SL1000 gives the **same plan at 2 and
  0.5 vCPU** (3.2-3.4 s and 7.0-7.8 s); the 1 s wall-clock policy changes plan with the quota
  (BA: 2 plans, LA: 3 plans across quotas, quality falling as CPU shrinks);
- architectures (`bench/cross-arch.json`): linux/amd64 (emulated) vs linux/arm64 vs native macOS
  arm64 — **identical plans for all 4 cases**.

At **0.2 vCPU** (a `t3.micro` at its CPU-credit baseline) SL1000 needs > 10 s, hits the safety cap
(TIME_CAP, `reproducible: false`; LA returned 2 different plans) — see "Operational requirement".

## 5. End-to-end latency (`runs/bench/`, warm; laptop; HTTP sidecar on localhost)

Phases measured separately (ms). Warm-up 2-3 requests, then 20-30 trials.

| case | requests | total median / p95 / max | solve median / p95 / max | non-solve overhead median / p95 / max |
|---|---|---|---|---|
| BA-G5-full (29 cand. incl. composite, 3 days, 2 must-include, start+end hotel anchors, walk+drive) | 30 | 2085 / 2306 / 2356 | 2070 / 2291 / 2332 | 13.3 / 18.8 / 24.3 |
| BA-S1 pool ~30 | 20 | 2163 / 2240 / 2251 | 2152 / 2228 / 2238 | 12.2 / 13.6 / 14.9 |
| PA-S1 pool 30 | 20 | 2584 / 2674 / 2684 | 2567 / 2660 / 2668 | 14.8 / 19.9 / 21.9 |
| LA-S1 pool 30 | 20 | 2104 / 2183 / 2342 | 2093 / 2171 / 2326 | 12.4 / 15.5 / 16.4 |
| BA-G5-full over stdio (option C) | 20 | 2065 / 2197 / 2232 | 2052 / 2181 / 2212 | 11.5 / 16.6 / 19.3 |

BA-G5-full phase medians: domain preparation 0.19, request serialization 0.05, HTTP/IPC overhead
1.73 (p95 4.39), sidecar parse 0.18, adapter preparation 3.03, model construction 6.27, solve 2070,
extraction 0.18, response serialization 0.06, client parse 0.04, result validation 0.06.

**Request / response size:** 15.8-16.5 KB / 3.1-3.7 KB (812-870 pair edges per mode, whole problem
in one request). HTTP/JSON handles it trivially; no per-candidate or per-edge calls.

**Cold start** (`bench/cold.json`): sidecar process start → healthy 176-241 ms; the first request
after start is as fast as a warm one (1964-2122 ms; no warm-up penalty); container start → healthy
1.3 s (2 vCPU), 1.8 s (0.5), 2.9 s (0.2). Image 115 MB; container memory 41-58 MiB.

**Container latency** (SL1000, BA-G5-full / LA-S1): 3.2-3.4 s at 2 vCPU, 7.0-7.8 s at 0.5 vCPU,
~10.4 s (cap) at 0.2 vCPU. Emulated amd64 at 2 vCPU: 3.6-4.5 s.

Acceptability: Tour generation is already a background job (`POST generate-tour` returns at once;
`TourGenerationProcessorService` runs and retries generation), so a 2-4 s planner step sits inside an
asynchronous pipeline, not on an interactive request path.

## 6. Quality retention (`runs/stop_policies.json`, `runs/bench_quality.json`)

- SL1000 vs recorded Routing 5 s: mean +0.10 %, worst -0.67 %; it reproduces the recorded objective
  exactly in 26 of 35 planned scenarios, and the rest differ by a swap of one or two Experiences of
  similar value (e.g. PA S1 SL1000 17463.3 > recorded 5 s 17080.0).
- SL1000 vs greedy best-insertion, 35 planned scenarios: > 1 % better in 23, within ±1 % in 11,
  > 1 % worse in 1 (BA 10-candidate pool, -3.7 %); +16 scheduled Experiences in 15 scenarios, -2 in 2.
  Largest gains are the constrained cases: LA start+end anchors +13.5 %, LA 20-pool +12.8 %, Paris
  tight hours +11.7 %, Paris 1-day oversupply +10.1 %, Paris walk-only 1-day +7.4 %.
- Benchmark cases: BA-S1 +5.2 % (27 vs 26 Experiences), LA-S1 +3.5 % (less travel: 106 vs 147 min),
  PA-S1 +0.3 %, BA-G5-full -0.12 % (same 26 Experiences count, 2 swapped; greedy marginally ahead).
- Hard constraints: 0 violations for every policy (P11 checker) and every end-to-end result
  (domain validator).

## 7. Failure semantics (`runs/failures.json`: 11/11 pass)

| test | outcome | generation outcome |
|---|---|---|
| normal request | PLANNED | Tour |
| must-include known closed all trip | INFEASIBLE (proven, before solving) | PLANNER_INFEASIBLE |
| safety cap before first solution (1 ms test policy) | OPTIMIZER_FAILED `NO_SOLUTION_WITHIN_BUDGET` (observed), or a valid plan flagged TIME_CAP / reproducible=false (timing-dependent; both accepted) | OPTIMIZER_FAILED / Tour |
| sidecar slower than client deadline | OPTIMIZER_FAILED `TIMEOUT` | OPTIMIZER_FAILED |
| malformed response body | OPTIMIZER_FAILED `MALFORMED_RESPONSE` | OPTIMIZER_FAILED |
| plan violating hard constraints (injected) | OPTIMIZER_FAILED `INVALID_RESULT` (domain validator) | OPTIMIZER_FAILED |
| contract violation / unknown policy | OPTIMIZER_FAILED `REQUEST_REJECTED` (422) | OPTIMIZER_FAILED |
| sidecar crash mid-request | OPTIMIZER_FAILED `TRANSPORT_ERROR` | OPTIMIZER_FAILED |
| sidecar down | OPTIMIZER_FAILED `UNAVAILABLE` | OPTIMIZER_FAILED |
| stdio worker killed mid-solve | OPTIMIZER_FAILED `WORKER_EXITED` | OPTIMIZER_FAILED |

No failure maps to PLANNER_INFEASIBLE, NEEDS_ACQUISITION or INSUFFICIENT_KNOWLEDGE; no Tour is
persisted on OPTIMIZER_FAILED. With every node optional, "no solution" can only happen when the
safety cap fires before the first solution (~10 ms of search), i.e. under extreme CPU starvation.

Finding: a client-side timeout does **not** cancel the solve in the sidecar (it finishes and holds the
solve slot; the next request queued behind it timed out in the first run). Rule: the client deadline
must exceed the adapter safety cap (15 s > 10 s) so the sidecar always answers first; transport
failures and timeouts are retryable at the generation level, REQUEST_REJECTED / INVALID_RESULT are not.

## 8. Deployment topology

**Colocated sidecar container in the same deployment unit.** On the backend host, the release starts
`zigzag-planner` (pinned image, same release tag as the backend) before `zigzag-backend` on a private
Docker network; the backend calls `http://zigzag-planner:8090` (no host port); readiness = `/healthz`;
both containers roll back together; `--restart unless-stopped` restarts a crashed sidecar. Same
scaling unit as the backend; no service discovery, no independent autoscaling (no concrete reason
for an independent planner service). Solves are CPU-bound and serialized per process; concurrency =
sidecar worker processes ≤ vCPUs reserved for planning, decided with the production server choice
(the spike uses the stdlib HTTP server).

**Operational requirement (measured, not a blocker):** one SL1000 solve consumes ~2-3.5 s of one
full vCPU. The current production host (`t3.micro`, standard credits, 0.2 vCPU sustained baseline)
reaches the 10 s safety cap and loses reproducibility once credits are exhausted. Production needs
sustained CPU for planning — e.g. `t3` unlimited credits or a non-burstable instance — sized with the
deploy change of group 39-41. Greedy best-insertion (~30 ms) would not have this requirement.

## 9. Versions and pinning

`optimizer = OR_TOOLS_ROUTING`, `optimizerVersion = 9.15.6755` (pinned in `requirements.txt`; image
digest pinned at deploy; production adds `--require-hashes`), `optimizerPolicyVersion =
routing-gls-sl1000-v1` (first solution, metaheuristic, solution limit, safety cap), `adapterVersion`
(model formulation). Every result reports them; the R4-D1 planning context records them in the Tour
snapshot (no persistence design reopened). Any change to OR-Tools, the policy or the formulation is a
new version and re-runs the regression replays (task 34) on the production image/architecture.

## 10. Local development

`docker compose -f sidecar/compose.planner.yml up -d planner` (or `pip install -r
sidecar/requirements.txt && python -I sidecar/server.py`), backend `PLANNER_URL=http://127.0.0.1:8090`.
Unit tests use a fake `PlanningOptimizer` (no Python); adapter/contract tests run the sidecar locally
(compose service in the repo `docker-compose.yml`, CI service container). No external infrastructure.

## 11. Operational comparison against greedy best-insertion

| | OR-Tools Routing (sidecar, SL1000) | greedy best-insertion |
|---|---|---|
| quality (test weights) | best; +3.8 % mean, up to +13.5 % in constrained cases; +16 Experiences over 15 scenarios | -3.8 % mean; -10 to -13.5 % in constrained cases |
| determinism | count-based stop: identical across repeats, CPU quotas ≥ 0.5 vCPU and architectures | identical (no search) |
| latency | ~2.1-2.6 s laptop, ~3.3 s at 2 vCPU container, inside a background job | ~30 ms |
| CPU | ~2-3.5 vCPU-s per Tour; needs sustained CPU on the host | negligible |
| runtime dependency | Python 3.14 + OR-Tools 9.15 container (115 MB, ~50 MiB RAM) | none (TypeScript in-process) |
| failure modes | explicit, typed, tested (11/11) | in-process exceptions only |
| modelling complexity | moderate (per-day node copies, dimensions, disjunctions) in one adapter | low, but every new constraint is custom insertion/repair code |
| TourStop extensibility | native: optional nodes with time windows, vehicle breaks, extra dimensions | custom |

The quality gain is concentrated where the product needs it (hotel anchors, tight hours, oversupply,
dispersed cities) and costs one colocated container plus sustained CPU; the integration itself adds
~13 ms and ~1.7 ms IPC. This is judged worth it.

## 12. Future TourStop (not implemented)

Meals, breaks and fixed/optional temporal stops map to native Routing constructs: optional nodes with
time windows and a prize (optional stops), mandatory nodes / pinned cumul ranges (fixed stops), and
vehicle break intervals on the Time dimension (breaks). The neutral contract would gain a typed
`temporalStops` input; no optimizer change is forced. Greedy would need custom insertion logic per
stop type. Secondary consideration only.

## For P-D7 (unchanged scope)

The weights above remain TEST-ONLY. P-D7 still owns the desirability-vs-travel scale, WALK vs DRIVE
cost, the per-drive-leg overhead and `openingHoursUncertaintyPenalty`. Changing them later changes
`objective.policyVersion` only; the adapter consumes the terms as given. Note for calibration: the
solution limit was tuned at these test weights; re-check SL1000 retention when P-D7 changes the scale.

## Limitations

- One laptop; the production-like numbers are container CPU quotas, not a real `t3` host. amd64 was
  emulated (identity verified, latency only indicative).
- CPU-contention on the laptop did not slow the solver noticeably; the CPU-quota runs are the
  meaningful machine-dependence evidence.
- The spike server is the Python stdlib HTTP server with one solve slot; the production server
  choice and worker count belong to the implementation (group 33).
- Mode choice remains pre-pruned per arc (as in P11); the daily walking budget is a hard dimension.
