// Cold-start measurements (G-P5): sidecar process start -> ready, first request after ready, second request;
// and spawn-per-request (option C variant: start a planner process for each plan).
// Usage: node cold.mjs --python <path> [--reps 5] [--policy <id>] [--out file]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCity, buildRequest } from './problem.mjs';
import { HttpPlanningOptimizer, StdioPlanningOptimizer } from './optimizer.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)); const SIDE = path.join(HERE, '..', 'sidecar');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const python = arg('python'); const reps = Number(arg('reps', 5)); const policy = arg('policy', 'routing-gls-sl1000-v1');
const bc = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'runs', 'bench_cases.json'), 'utf8')).find((c) => c.name === 'BA-G5-full');
const data = loadCity(bc.city);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];

for (let k = 0; k < reps; k++) {   // HTTP sidecar process cold start
  const port = 8190 + k; const t0 = performance.now();
  const proc = spawn(python, ['-I', 'server.py'], { cwd: SIDE, env: { ...process.env, PLANNER_PORT: String(port) }, stdio: 'ignore' });
  let ready = null;
  while (ready === null) {
    try { const r = await fetch(`http://127.0.0.1:${port}/healthz`); if (r.ok) ready = performance.now() - t0; } catch { await sleep(5); }
  }
  const opt = new HttpPlanningOptimizer({ baseUrl: `http://127.0.0.1:${port}`, deadlineMs: 20000 });
  const first = await opt.plan(buildRequest(data, bc.cfg, policy));
  const second = await opt.plan(buildRequest(data, bc.cfg, policy));
  proc.kill(); await sleep(100);
  rows.push({ mode: 'http-sidecar-process', rep: k, readyMs: Math.round(ready), firstRequestMs: Math.round(first.timings.totalClientMs),
    firstSolveMs: first.body.timings.solveMs, firstModelBuildMs: first.body.timings.modelBuildMs,
    secondRequestMs: Math.round(second.timings.totalClientMs), secondSolveMs: second.body.timings.solveMs,
    samePlan: JSON.stringify(first.body.days) === JSON.stringify(second.body.days) });
  console.log(JSON.stringify(rows.at(-1)));
}
for (let k = 0; k < reps; k++) {   // spawn-per-request: process start + import + one plan
  const t0 = performance.now();
  const w = new StdioPlanningOptimizer({ python, cwd: SIDE, deadlineMs: 20000 });
  await w.start(); const ready = performance.now() - t0;
  const r = await w.plan(buildRequest(data, bc.cfg, policy)); w.stop();
  rows.push({ mode: 'spawn-per-request', rep: k, readyMs: Math.round(ready), perRequestTotalMs: Math.round(performance.now() - t0), solveMs: r.body.timings.solveMs });
  console.log(JSON.stringify(rows.at(-1)));
}
const out = arg('out'); if (out) fs.writeFileSync(out, JSON.stringify(rows, null, 1));
