// PlanningOptimizer port + OR-Tools sidecar adapters (G-P5 spike; stands in for the NestJS adapter).
//
//   interface PlanningOptimizer { plan(problem: PlanningProblemV1): Promise<OptimizerOutcome> }
//   OptimizerOutcome =
//     | { kind: 'PLANNED', result }                    -> domain builds the Tour + diagnostics
//     | { kind: 'INFEASIBLE', conflicts }              -> PLANNER_INFEASIBLE (proven/explicit conflicts only)
//     | { kind: 'OPTIMIZER_FAILED', reason, detail }   -> planner failure; never PLANNER_INFEASIBLE,
//                                                         NEEDS_ACQUISITION or INSUFFICIENT_KNOWLEDGE
// The domain sees only this outcome and the neutral result; transport, process and solver details stay here.
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { validatePlan } from './validate.mjs';

const failed = (reason, detail) => ({ kind: 'OPTIMIZER_FAILED', reason, detail });

/** Map a decoded sidecar body to an outcome; validates shape and hard constraints. */
export function toOutcome(req, body) {
  if (!body || body.contractVersion !== 'planning-result-v1') return failed('MALFORMED_RESPONSE', 'contractVersion');
  if (body.requestId !== req.requestId) return failed('MALFORMED_RESPONSE', 'requestId mismatch');
  if (body.status === 'OPTIMIZER_FAILED') return failed(body.failure?.reason ?? 'UNSPECIFIED', body.failure?.detail);
  if (body.status === 'INFEASIBLE') {
    const ok = Array.isArray(body.conflicts) && body.conflicts.length > 0 && body.conflicts.every(
      (c) => c.proven === true && req.candidates.some((x) => x.id === c.experienceId && x.mustInclude));
    return ok ? { kind: 'INFEASIBLE', conflicts: body.conflicts, optimizer: body.optimizer } : failed('MALFORMED_RESPONSE', 'unproven INFEASIBLE');
  }
  if (body.status !== 'PLANNED') return failed('MALFORMED_RESPONSE', `status ${body.status}`);
  const violations = validatePlan(req, body);
  return violations.length ? failed('INVALID_RESULT', violations.slice(0, 3).join('; ')) : { kind: 'PLANNED', result: body };
}

export class HttpPlanningOptimizer {
  constructor({ baseUrl, deadlineMs = 15000 }) { this.baseUrl = baseUrl; this.deadlineMs = deadlineMs; }

  async plan(req, extraHeaders = {}) {
    const t = { start: performance.now() };
    const payload = JSON.stringify(req); t.serialized = performance.now();
    let resp; let text;
    try {
      resp = await fetch(`${this.baseUrl}/v1/plan`, { method: 'POST', body: payload, signal: AbortSignal.timeout(this.deadlineMs),
        headers: { 'content-type': 'application/json', ...extraHeaders } });
      text = await resp.text();
    } catch (e) {
      const code = e?.cause?.code ?? e?.name;
      const reason = e?.name === 'TimeoutError' ? 'TIMEOUT' : code === 'ECONNREFUSED' ? 'UNAVAILABLE' : 'TRANSPORT_ERROR';
      return { outcome: failed(reason, String(code)), timings: { totalClientMs: performance.now() - t.start } };
    }
    t.received = performance.now();
    let body = null;
    try { body = JSON.parse(text); } catch { /* typed below */ }
    t.parsed = performance.now();
    let outcome;
    if (resp.status === 400 || resp.status === 422) outcome = failed('REQUEST_REJECTED', body?.detail ?? body?.error);
    else if (resp.status >= 500) outcome = failed('INTERNAL_ERROR', body?.detail ?? String(resp.status));
    else if (body === null) outcome = failed('MALFORMED_RESPONSE', 'invalid JSON');
    else outcome = toOutcome(req, body);
    t.validated = performance.now();
    return { outcome, body, requestBytes: Buffer.byteLength(payload), responseBytes: Buffer.byteLength(text),
      serverSerializeMs: Number(resp.headers.get('x-serialize-ms')),
      timings: { serializeMs: t.serialized - t.start, roundTripMs: t.received - t.serialized, parseMs: t.parsed - t.received,
        validateMs: t.validated - t.parsed, totalClientMs: t.validated - t.start } };
  }
}

/** Option C: long-lived child process speaking JSON lines (one in-flight request; restart on exit). */
export class StdioPlanningOptimizer {
  constructor({ python, cwd, deadlineMs = 15000 }) { Object.assign(this, { python, cwd, deadlineMs }); }

  async start() {
    this.proc = spawn(this.python, ['-I', 'stdio_worker.py'], { cwd: this.cwd, stdio: ['pipe', 'pipe', 'inherit'] });
    this.lines = readline.createInterface({ input: this.proc.stdout });
    this.waiters = [];
    this.lines.on('line', (l) => this.waiters.shift()?.resolve(l));
    this.proc.on('exit', (code) => { for (const w of this.waiters.splice(0)) w.reject(new Error(`WORKER_EXITED:${code}`)); });
    await this.#next();   // ready line
  }

  #next() { return new Promise((resolve, reject) => this.waiters.push({ resolve, reject })); }

  async plan(req) {
    const t0 = performance.now();
    const payload = JSON.stringify(req); const t1 = performance.now();
    let line;
    try {
      const p = this.#next(); this.proc.stdin.write(`${payload}\n`);
      line = await Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), this.deadlineMs))]);
    } catch (e) {
      return { outcome: failed(e.message.startsWith('WORKER_EXITED') ? 'WORKER_EXITED' : 'TIMEOUT', e.message), timings: {} };
    }
    const t2 = performance.now();
    let body = null; try { body = JSON.parse(line); } catch { /* typed */ }
    const t3 = performance.now();
    const outcome = body?.error ? failed(body.error === 'CONTRACT_VIOLATION' ? 'REQUEST_REJECTED' : 'INTERNAL_ERROR', body.detail)
      : body ? toOutcome(req, body) : failed('MALFORMED_RESPONSE', 'invalid JSON');
    const t4 = performance.now();
    return { outcome, body, requestBytes: Buffer.byteLength(payload), responseBytes: Buffer.byteLength(line),
      timings: { serializeMs: t1 - t0, roundTripMs: t2 - t1, parseMs: t3 - t2, validateMs: t4 - t3, totalClientMs: t4 - t0 } };
  }

  stop() { this.proc?.kill(); }
}

/** Generation-level mapping (what NestJS would report). */
export const generationOutcome = (o) => ({ PLANNED: 'TOUR_PLANNED', INFEASIBLE: 'PLANNER_INFEASIBLE', OPTIMIZER_FAILED: 'OPTIMIZER_FAILED' }[o.kind]);
