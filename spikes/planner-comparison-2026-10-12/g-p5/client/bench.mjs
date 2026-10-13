// End-to-end latency benchmark (G-P5): domain preparation -> serialization -> IPC -> sidecar
// (parse, adapter prepare, model build, solve, extract, serialize) -> parse -> validation.
// Usage: node bench.mjs --transport http|stdio --policy <id> --case <name> [--warmup 3] [--trials 30]
//        [--url http://127.0.0.1:8090] [--python <path>] [--out file]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCity, buildRequest } from './problem.mjs';
import { HttpPlanningOptimizer, StdioPlanningOptimizer } from './optimizer.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const transport = arg('transport', 'http'); const policy = arg('policy', 'routing-gls-sl1000-v1');
const caseName = arg('case', 'BA-G5-full'); const warmup = Number(arg('warmup', 3)); const trials = Number(arg('trials', 30));
const cases = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'runs', 'bench_cases.json'), 'utf8'));
const bc = cases.find((c) => c.name === caseName);
const data = loadCity(bc.city);

// Parity: the Node-built request must equal the Python-built one used for the quality experiments.
const parity = buildRequest(data, bc.cfg, bc.pythonRequest.optimizerPolicyVersion);
assert.deepStrictEqual(parity, bc.pythonRequest, 'Node and Python planning requests differ');

const opt = transport === 'http'
  ? new HttpPlanningOptimizer({ baseUrl: arg('url', 'http://127.0.0.1:8090'), deadlineMs: 20000 })
  : new StdioPlanningOptimizer({ python: arg('python'), cwd: path.join(HERE, '..', 'sidecar'), deadlineMs: 20000 });
if (transport === 'stdio') await opt.start();

const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const r2 = (x) => Math.round(x * 100) / 100;
const runs = []; const signatures = new Set();
for (let k = 0; k < warmup + trials; k++) {
  const t0 = performance.now();
  const req = buildRequest(data, bc.cfg, policy);
  const tPrep = performance.now() - t0;
  const r = await opt.plan(req);
  const total = performance.now() - t0;
  if (r.outcome.kind === 'OPTIMIZER_FAILED') throw new Error(`trial ${k}: ${r.outcome.reason} ${r.outcome.detail}`);
  const st = r.body.timings;
  const ipc = r.timings.roundTripMs - st.serverHandlerMs - (r.serverSerializeMs || 0);
  const row = { trial: k, warm: k >= warmup, prepMs: tPrep, ...r.timings, server: st, serverSerializeMs: r.serverSerializeMs,
    ipcOverheadMs: ipc, totalMs: total, outcome: r.outcome.kind, objective: r.body.objectiveValue,
    requestBytes: r.requestBytes, responseBytes: r.responseBytes };
  runs.push(row);
  if (row.warm) signatures.add(JSON.stringify(r.body.days ?? r.body.conflicts));
}
opt.stop?.();
const warm = runs.filter((r) => r.warm);
const stat = (f) => { const xs = warm.map(f); return { median: r2(q(xs, 0.5)), p95: r2(q(xs, 0.95)), max: r2(Math.max(...xs)), min: r2(Math.min(...xs)) }; };
const summary = {
  case: caseName, transport, policy, trials, warmup, node: process.version, parityWithPythonRequest: true,
  requestBytes: warm[0].requestBytes, responseBytes: warm[0].responseBytes, distinctPlans: signatures.size,
  outcome: warm[0].outcome, objective: warm[0].objective,
  firstRequestMs: r2(runs[0].totalMs), firstRequestSolveMs: runs[0].server.solveMs,
  phases: {
    prepMs: stat((r) => r.prepMs), serializeMs: stat((r) => r.serializeMs), ipcOverheadMs: stat((r) => r.ipcOverheadMs),
    serverParseMs: stat((r) => r.server.parseMs ?? 0), adapterPrepareMs: stat((r) => r.server.prepareMs),
    modelBuildMs: stat((r) => r.server.modelBuildMs), solveMs: stat((r) => r.server.solveMs), extractMs: stat((r) => r.server.extractMs),
    serverSerializeMs: stat((r) => r.serverSerializeMs || 0), clientParseMs: stat((r) => r.parseMs), validateMs: stat((r) => r.validateMs),
    totalMs: stat((r) => r.totalMs), nonSolveOverheadMs: stat((r) => r.totalMs - r.server.solveMs),
  },
};
const out = arg('out');
if (out) fs.writeFileSync(out, JSON.stringify({ summary, runs }, null, 1));
console.log(JSON.stringify(summary));
