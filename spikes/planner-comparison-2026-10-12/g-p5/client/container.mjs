// Containerized sidecar under CPU quotas (G-P5): docker run -> healthy, request latency, memory, and plan
// identity for the count-based policy vs a wall-clock policy. --cpus 0.2 approximates a t3.micro at its
// CPU-credit baseline (2 vCPU x 10 %). Usage: node container.mjs [--cpus 2,0.5,0.2] [--reps 3] [--out file]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCity, buildRequest } from './problem.mjs';
import { HttpPlanningOptimizer } from './optimizer.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const quotas = arg('cpus', '2,0.5,0.2').split(','); const reps = Number(arg('reps', 3));
const cases = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'runs', 'bench_cases.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docker = (...a) => execFileSync('docker', a, { encoding: 'utf8' }).trim();
const rows = [];
for (const cpus of quotas) {
  try { docker('rm', '-f', 'g5-planner'); } catch { /* absent */ }
  const t0 = performance.now();
  docker('run', '-d', '--name', 'g5-planner', `--cpus=${cpus}`, '--memory=512m', '-e', 'PLANNER_FAULT_INJECTION=1',
    '-p', '127.0.0.1:8095:8090', 'zigzag-planner:g-p5');
  let healthyMs = null;
  while (healthyMs === null) {
    try { if ((await fetch('http://127.0.0.1:8095/healthz')).ok) healthyMs = performance.now() - t0; } catch { await sleep(20); }
  }
  const opt = new HttpPlanningOptimizer({ baseUrl: 'http://127.0.0.1:8095', deadlineMs: 60000 });
  for (const name of ['BA-G5-full', 'LA-S1-normal-pall']) {
    const bc = cases.find((c) => c.name === name); const data = loadCity(bc.city);
    for (const policy of ['routing-gls-sl1000-v1', 'test-only-wallclock-1000ms']) {
      const trials = [];
      for (let k = 0; k < reps; k++) {
        const r = await opt.plan(buildRequest(data, bc.cfg, policy));
        trials.push({ outcome: r.outcome.kind, totalMs: Math.round(r.timings.totalClientMs), solveMs: r.body?.timings?.solveMs,
          solutions: r.body?.optimizer?.solutionsGenerated, stopReason: r.body?.optimizer?.stopReason,
          objective: r.body?.objectiveValue, sig: JSON.stringify(r.body?.days) });
      }
      const row = { cpus, healthyMs: Math.round(healthyMs), case: name, policy, distinctPlans: new Set(trials.map((t) => t.sig)).size,
        trials: trials.map(({ sig, ...t }) => t), planSig: trials[0].sig };
      rows.push(row); console.log(JSON.stringify({ ...row, planSig: undefined }));
    }
  }
  const mem = docker('stats', '--no-stream', '--format', '{{.MemUsage}}', 'g5-planner');
  rows.push({ cpus, memUsage: mem }); console.log(JSON.stringify({ cpus, memUsage: mem }));
  docker('rm', '-f', 'g5-planner');
}
// Cross-quota identity: one plan per (case, policy) across all quotas means machine-independent output.
const cross = {};
for (const r of rows.filter((x) => x.planSig)) (cross[`${r.case} ${r.policy}`] ??= new Set()).add(r.planSig);
const crossQuota = Object.fromEntries(Object.entries(cross).map(([k, s]) => [k, s.size]));
console.log(JSON.stringify({ distinctPlansAcrossQuotas: crossQuota }));
const out = arg('out');
if (out) fs.writeFileSync(out, JSON.stringify({ rows: rows.map(({ planSig, ...r }) => r), distinctPlansAcrossQuotas: crossQuota }, null, 1));
