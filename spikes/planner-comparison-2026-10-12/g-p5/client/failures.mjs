// Failure-semantics tests (G-P5). Requires a sidecar started with PLANNER_FAULT_INJECTION=1 at --url,
// and the stdio worker python at --python. Every failure must map to OPTIMIZER_FAILED with a typed
// reason; only a proven constraint conflict maps to PLANNER_INFEASIBLE.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCity, buildRequest } from './problem.mjs';
import { HttpPlanningOptimizer, StdioPlanningOptimizer, generationOutcome } from './optimizer.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('url', 'http://127.0.0.1:8091');
const cases = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'runs', 'bench_cases.json'), 'utf8'));
const req = (name, policy = 'routing-gls-sl1000-v1') => { const bc = cases.find((c) => c.name === name); return buildRequest(loadCity(bc.city), bc.cfg, policy); };
const POL = arg('policy', 'routing-gls-sl1000-v1');

const results = [];
const record = async (name, expect, fn) => {
  const t = performance.now(); const r = await fn(); const ms = Math.round(performance.now() - t);
  const o = r.outcome;
  const row = { test: name, outcome: o.kind, reason: o.reason, detail: o.detail, generation: generationOutcome(o), elapsedMs: ms,
    pass: generationOutcome(o) === expect.generation && (!expect.reason || o.reason === expect.reason) };
  results.push(row); console.log(JSON.stringify(row));
};

// Production rule: client deadline (15 s) > adapter safety cap (10 s), so the sidecar always answers first.
const http = new HttpPlanningOptimizer({ baseUrl: url, deadlineMs: 15000 });
const impatient = new HttpPlanningOptimizer({ baseUrl: url, deadlineMs: 3000 });
await record('baseline planned', { generation: 'TOUR_PLANNED' }, () => http.plan(req('BA-G5-full', POL)));
await record('proven must-include conflict (closed all trip)', { generation: 'PLANNER_INFEASIBLE' }, () => http.plan(req('BA-S8-infeasible-must-closed', POL)));
// Safety cap: either no solution before the cap (OPTIMIZER_FAILED) or a valid plan explicitly flagged
// TIME_CAP / reproducible=false. Which one occurs depends on timing, so both are accepted and recorded.
{
  const t = performance.now(); const r = await http.plan(req('BA-G5-full', 'test-only-cap-1ms')); const o = r.outcome;
  const flagged = o.kind === 'PLANNED' && r.body.optimizer.stopReason === 'TIME_CAP' && r.body.optimizer.reproducible === false;
  const row = { test: 'safety cap (1 ms) fires', outcome: o.kind, reason: o.reason ?? (flagged ? 'TIME_CAP plan, reproducible=false' : undefined),
    generation: generationOutcome(o), elapsedMs: Math.round(performance.now() - t),
    pass: (o.kind === 'OPTIMIZER_FAILED' && o.reason === 'NO_SOLUTION_WITHIN_BUDGET') || flagged };
  results.push(row); console.log(JSON.stringify(row));
}
await record('malformed response body', { generation: 'OPTIMIZER_FAILED', reason: 'MALFORMED_RESPONSE' }, () => http.plan(req('BA-G5-full', POL), { 'x-fault': 'malformed' }));
await record('plan violating hard constraints', { generation: 'OPTIMIZER_FAILED', reason: 'INVALID_RESULT' }, () => http.plan(req('BA-G5-full', POL), { 'x-fault': 'bad-plan' }));
await record('contract violation rejected', { generation: 'OPTIMIZER_FAILED', reason: 'REQUEST_REJECTED' }, () => http.plan({ ...req('BA-G5-full', POL), contractVersion: 'planning-problem-v0' }));
await record('unknown optimizer policy rejected', { generation: 'OPTIMIZER_FAILED', reason: 'REQUEST_REJECTED' }, () => http.plan(req('BA-G5-full', 'no-such-policy')));
await record('sidecar slower than deadline', { generation: 'OPTIMIZER_FAILED', reason: 'TIMEOUT' }, () => impatient.plan(req('BA-G5-full', POL), { 'x-fault': 'sleep:5000' }));
await new Promise((r) => setTimeout(r, 8000));   // let the orphaned server-side solve finish (no cancellation)
await record('sidecar crash mid-request', { generation: 'OPTIMIZER_FAILED', reason: 'TRANSPORT_ERROR' }, () => http.plan(req('BA-G5-full', POL), { 'x-fault': 'crash' }));
await record('sidecar down', { generation: 'OPTIMIZER_FAILED', reason: 'UNAVAILABLE' }, () => http.plan(req('BA-G5-full', POL)));

// Option C: worker process killed while solving.
const w = new StdioPlanningOptimizer({ python: arg('python'), cwd: path.join(HERE, '..', 'sidecar'), deadlineMs: 20000 });
await w.start();
await record('stdio worker killed mid-solve', { generation: 'OPTIMIZER_FAILED', reason: 'WORKER_EXITED' }, () => {
  const p = w.plan(req('BA-G5-full', POL)); setTimeout(() => w.proc.kill('SIGKILL'), 300); return p;
});
const out = arg('out');
if (out) fs.writeFileSync(out, JSON.stringify(results, null, 1));
console.log(`PASS ${results.filter((r) => r.pass).length}/${results.length}`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
