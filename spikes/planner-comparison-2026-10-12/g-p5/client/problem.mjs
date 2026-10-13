// Domain-side preparation of the provider-neutral planning problem (G-P5 spike; stands in for NestJS).
// Port of the P11 Problem preparation (scripts/common.py) + request builder (experiments/build_request.py).
// Knows opening hours, composite timelines, utilities and travel recordings; knows nothing about OR-Tools.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SPIKE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FX = (f) => JSON.parse(fs.readFileSync(path.join(SPIKE, 'fixtures', f), 'utf8'));
const DATES = ['2026-11-10', '2026-11-11', '2026-11-12'];
const WD = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
export const TEST_WEIGHTS = { // TEST-ONLY (P11 experiment objective), not P-D7
  desirabilityPerUnit: 1000, walkPerMinute: 10, drivePerMinute: 20, driveLeg: 100, openingHoursUncertaintyPenalty: 100,
};
const LIMITS = { maxContinuousWalkMinutes: 30, dailyWalkBudgetMinutes: 150 };

const weekday = (date) => WD[new Date(`${date}T00:00:00Z`).getUTCDay()];
// Python round() parity (half to even) so utilities are identical to the recorded runs.
const roundHalfEven = (x) => {
  const f = Math.floor(x); const d = x - f;
  if (d > 0.5) return f + 1; if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
};

export function loadCity(city) {
  const walk = FX(`${city}_matrix_walk.json`); const drive = FX(`${city}_matrix_drive.json`);
  const legFile = path.join(SPIKE, 'fixtures', `${city}_composite_internal_leg.json`);
  return { fx: FX(`${city}.json`), matrices: { walk, drive }, internalLeg: fs.existsSync(legFile) ? FX(`${city}_composite_internal_leg.json`) : null };
}

export function buildRequest(data, cfg, policy = 'routing-gls-sl1000-v1') {
  const { fx, matrices, internalLeg } = data;
  const window = cfg.window ?? [540, 1140];
  const modes = cfg.modes ?? ['walk', 'drive'];
  const dates = DATES.slice(0, cfg.days);
  const ranked = [...fx.candidates].sort((a, b) => (b.desirability - a.desirability) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const comp = ranked.filter((c) => c.kind === 'COMPOSITE');
  let pool = ranked.slice(0, cfg.poolSize);
  if (comp.length && !pool.includes(comp[0])) pool = [...pool.slice(0, -1), ...comp];
  const pidx = new Map(matrices.walk.points.map((p, i) => [p.pid, i]));
  const visits = (c) => c.components.filter((k) => k.participation === 'VISIT');
  const timeline = (c) => {
    if (c.kind === 'SINGLE') { const k = c.components[0]; return [[[0, k.duration_min, k]], k.duration_min]; }
    const t = c.components.find((k) => k.participation === 'TRAVERSE'); const v = visits(c)[0];
    const off = t.traverse_min + internalLeg.time_s / 60;
    return [[[off, v.duration_min, v]], off + v.duration_min];
  };
  const startIntervals = (c, date) => {
    const [tl, total] = timeline(c); const wd = weekday(date);
    let ivs = [[window[0], window[1] - total]];
    for (const [off, dur, k] of tl) {
      if (k.hours.status !== 'KNOWN') continue;
      const next = [];
      for (const [a, b] of ivs) for (const [o, cl] of k.hours.weekly[wd]) {
        const lo = Math.max(a, o - off); const hi = Math.min(b, cl - off - dur);
        if (lo <= hi) next.push([lo, hi]);
      }
      ivs = next;
    }
    return ivs.map(([a, b]) => [Math.ceil(a), Math.floor(b)]).filter(([a, b]) => a <= b);
  };
  const point = (c, end) => (c.kind === 'SINGLE' ? pidx.get(c.id) : pidx.get(`${c.id}${end ? '#end' : '#start'}`));
  const hotel = pidx.get('HOTEL');
  const must = new Set(cfg.must ?? []);
  const W = { ...TEST_WEIGHTS, ...(cfg.weights ?? {}) };
  return {
    contractVersion: 'planning-problem-v1',
    requestId: cfg.requestId,
    days: dates.map((d) => ({ date: d, window: { start: window[0], end: window[1] },
      startPoint: cfg.startAnchor ? hotel : null, endPoint: cfg.endAnchor ? hotel : null })),
    travel: { points: matrices.walk.points.map((p) => p.pid), modes: modes.map((m) => m.toUpperCase()),
      seconds: Object.fromEntries(modes.map((m) => [m.toUpperCase(), matrices[m].time_s])) },
    candidates: pool.map((c) => ({
      id: c.id, startPoint: point(c, false), endPoint: point(c, true),
      serviceMinutes: Math.ceil(timeline(c)[1] - 1e-9), utility: roundHalfEven(W.desirabilityPerUnit * c.desirability),
      uncertainVisitComponents: visits(c).filter((k) => k.hours.status !== 'KNOWN').length, mustInclude: must.has(c.id),
      startWindowsByDay: dates.map((d) => startIntervals(c, d)),
    })),
    limits: { ...LIMITS },
    objective: { policyVersion: 'p11-test-weights-2026-10-12', openingHoursUncertaintyPenalty: W.openingHoursUncertaintyPenalty,
      travelCost: { WALK: { perMinute: W.walkPerMinute, perLeg: 0 }, DRIVE: { perMinute: W.drivePerMinute, perLeg: W.driveLeg } } },
    optimizerPolicyVersion: policy,
  };
}
