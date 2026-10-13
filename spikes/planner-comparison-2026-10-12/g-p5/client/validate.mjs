// Domain-side validation of a planning-result-v1 against the request (G-P5 spike).
// Optimizer-independent: a result that violates a hard constraint is an optimizer failure, never a Tour.
const ceilMin = (s) => Math.ceil(s / 60 - 1e-9);

export function validatePlan(req, res) {
  const v = [];
  if (!Array.isArray(res.days) || res.days.length !== req.days.length) return ['days: wrong shape'];
  const byId = new Map(req.candidates.map((c) => [c.id, c]));
  const seen = new Set();
  const legOk = (leg, from, to, label) => {
    if (!leg || typeof leg.mode !== 'string') { v.push(`${label}: missing leg`); return null; }
    if (!req.travel.modes.includes(leg.mode)) { v.push(`${label}: mode ${leg.mode} not allowed`); return null; }
    const s = req.travel.seconds[leg.mode][from][to];
    if (s === null || s !== leg.seconds) { v.push(`${label}: leg not backed by the request's ${leg.mode} estimate`); return null; }
    if (leg.mode === 'WALK' && s / 60 > req.limits.maxContinuousWalkMinutes + 1e-9) v.push(`${label}: continuous walking exceeded`);
    return s;
  };
  res.days.forEach((day, d) => {
    const rd = req.days[d]; let walk = 0; let prev = null;
    if (day.date !== rd.date) v.push(`d${d}: date mismatch`);
    for (const [k, it] of (day.items ?? []).entries()) {
      const c = byId.get(it.experienceId);
      if (!c) { v.push(`d${d}: unknown experience ${it.experienceId}`); continue; }
      if (seen.has(c.id)) v.push(`duplicate ${c.id}`); seen.add(c.id);
      if (!Number.isInteger(it.start) || it.end !== it.start + c.serviceMinutes) v.push(`${c.id}: start/end inconsistent with service`);
      if (!c.startWindowsByDay[d].some(([a, b]) => a <= it.start && it.start <= b)) v.push(`${c.id}: start ${it.start} outside feasible windows`);
      let earliest = rd.window.start;
      if (prev) {
        const s = legOk(it.incoming, prev.endPoint, c.startPoint, `${prev.id}->${c.id}`);
        if (s !== null) { earliest = prev.end + ceilMin(s); if (it.incoming.mode === 'WALK') walk += s / 60; }
      } else if (rd.startPoint !== null && rd.startPoint !== undefined) {
        const s = legOk(it.incoming, rd.startPoint, c.startPoint, `start->${c.id}`);
        if (s !== null) { earliest += ceilMin(s); if (it.incoming.mode === 'WALK') walk += s / 60; }
      }
      if (it.start < earliest) v.push(`${c.id}: starts before arrival (${it.start} < ${earliest})`);
      prev = { id: c.id, endPoint: c.endPoint, end: it.end };
      if (k === day.items.length - 1 && rd.endPoint !== null && rd.endPoint !== undefined) {
        const s = legOk(day.outgoingToEnd, c.endPoint, rd.endPoint, `${c.id}->end`);
        if (s !== null) {
          if (it.end + ceilMin(s) > rd.window.end) v.push(`${c.id}: end anchor unreachable in window`);
          if (day.outgoingToEnd.mode === 'WALK') walk += s / 60;
        }
      }
    }
    if (walk > req.limits.dailyWalkBudgetMinutes + 1e-9) v.push(`d${d}: daily walking budget exceeded`);
  });
  const reported = new Set((res.mustIncludeUnplaced ?? []).map((m) => m.experienceId));
  for (const c of req.candidates) if (c.mustInclude && !seen.has(c.id) && !reported.has(c.id)) v.push(`mustInclude ${c.id} silently dropped`);
  return v;
}
