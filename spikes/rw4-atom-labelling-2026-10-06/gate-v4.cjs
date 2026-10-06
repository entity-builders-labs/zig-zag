// Mechanical evaluator of the frozen milestone A v4 gate
// (milestone-a-gate-v4.json). Evaluation only.
//   node gate-v4.cjs runs/<main-batch> [runs/<regression-batch>]
'use strict';
const fs = require('fs');
const path = require('path');
const { fold } = require('./atom-labelling.cjs');
const { oracleItems } = require('./score.cjs');

const gate = JSON.parse(fs.readFileSync(path.join(__dirname, 'milestone-a-gate-v4.json'), 'utf8'));
const extra = JSON.parse(fs.readFileSync(path.join(__dirname, 'milestone-a-gate.json'), 'utf8')).extraWordings;
const SOURCE = { SOB_UNIT: 'secretsofbuenosaires-day1', AG_UNIT: 'agusyornet-san-telmo' };
const bare = (s) => fold(s).replace(/^(the|el|la|los|las) /u, '').replace(/^street /u, '').replace(/ street$/u, '');

function wordingsFor(sourceId, name) {
  const item = oracleItems(sourceId).find((i) => i.name === name);
  return [name, ...(item ? item.wordings : []), ...(extra[name] ?? [])];
}
const is = (sourceId, name, sourceName) => wordingsFor(sourceId, name).some((w) => bare(w) === bare(sourceName));

function load(dir) {
  const full = path.join(__dirname, dir);
  const summary = JSON.parse(fs.readFileSync(path.join(full, 'results.MEMBERSHIP.json'), 'utf8'));
  return summary.map((row) => (row.validity === 'VALID' ? JSON.parse(fs.readFileSync(path.join(full, `${row.input}-${row.run}.result.MEMBERSHIP.json`), 'utf8')) : row));
}

function evaluate(mainDir, regressionDir) {
  const main = load(mainDir);
  const valid = main.filter((r) => r.validity === 'VALID');
  const bySource = (input) => valid.filter((r) => r.input === input);
  const mandatoryCount = (input, name) => bySource(input).filter((r) => r.segments.some((s) => s.mandatory.some((m) => is(SOURCE[input], name, m)))).length;
  const out = {};

  // 1. Streets.
  const sob = bySource('SOB_UNIT');
  const c1 = Object.fromEntries(gate.criteria['1_streets'].entities['secretsofbuenosaires-day1'].map((n) => [n, mandatoryCount('SOB_UNIT', n)]));
  out['1_streets'] = { pass: sob.length >= 4 && Object.values(c1).every((n) => n <= 1), mandatoryRuns: c1, validSobRuns: sob.length };

  // 2. Areas used only as direction/entry.
  const c2 = { atomLevel: {}, notMandatory: {} };
  let pass2 = true;
  for (const [input, sourceId] of Object.entries(SOURCE)) {
    const atoms = gate.criteria['2_areas_as_direction'].directionOrEntryAtoms[sourceId];
    const prefixes = gate.criteria['2_areas_as_direction'].atomTextPrefixes[sourceId];
    const runs = bySource(input);
    const violating = runs.map((r) => {
      const hits = [];
      for (const [atomId, names] of Object.entries(atoms)) {
        const label = r.labels.find((l) => l.atomId === atomId);
        if (!label.text.startsWith(prefixes[atomId].replace(/\*\*/g, '**'))) throw new Error(`${input} ${atomId}: atom text drifted`);
        for (const e of label.entities ?? []) if (e.role === 'ITINERARY_STOP' && names.some((n) => bare(n) === bare(e.sourceName))) hits.push(`${atomId}:${e.sourceName}`);
      }
      return hits;
    });
    c2.atomLevel[input] = violating;
    if (runs.length - violating.filter((h) => h.length).length < Math.min(4, runs.length) || runs.length < 4) pass2 = false;
    for (const name of gate.criteria['2_areas_as_direction'].notMandatory[sourceId] ?? []) {
      const n = mandatoryCount(input, name);
      c2.notMandatory[`${input}:${name}`] = n;
      if (n > 1) pass2 = false;
    }
  }
  out['2_areas_as_direction'] = { pass: pass2, ...c2 };

  // 3. Street seen as a sight.
  const caseros = mandatoryCount('SOB_UNIT', 'Avenida Caseros');
  out['3_sight_street'] = { pass: caseros <= 1, mandatoryRuns: caseros };

  // 4. ROLE_CONFLICT on criterion 1-3 entities.
  const gateEntities = ['Defensa', 'Estados Unidos', 'Avenida Caseros', 'La Boca', 'Puerto Madero', 'San Telmo'];
  const conflicts = valid.flatMap((r) => r.segments.flatMap((s) => (s.conflicts ?? []).map((c) => ({ run: `${r.input}#${r.run}`, ...c }))));
  const onGate = conflicts.filter((c) => gateEntities.some((n) => is(SOURCE[c.run.split('#')[0]], n, c.sourceName)));
  out['4_role_conflict'] = { pass: onGate.length <= 1, onGateEntities: onGate.length, all: conflicts };

  // 5. Recall.
  let hits = 0;
  let total = 0;
  const segFull = {};
  for (const r of valid) {
    for (const v of r.verdicts) {
      const [h, t] = v.mandatoryRecall.split('/').map(Number);
      hits += h;
      total += t;
      segFull[`${r.input}:${v.segment}`] = (segFull[`${r.input}:${v.segment}`] ?? 0) + (h === t ? 0 : 1);
    }
  }
  out['5_recall'] = { pass: total > 0 && hits / total >= 0.99 && total - hits <= 1 && Object.values(segFull).every((n) => n <= 1), hits, total, segmentsNotFull: segFull };

  // 6. RW3 regression.
  if (regressionDir) {
    const reg = load(regressionDir);
    const per = {};
    for (const input of ['RW3_EV3', 'ROUTE_EXPERIENCE']) {
      const rv = reg.filter((r) => r.input === input && r.validity === 'VALID');
      per[input] = { valid: rv.length, success: rv.filter((r) => r.verdicts.every((v) => v.success)).length, outcomes: rv.map((r) => r.outcome) };
    }
    out['6_rw3'] = { pass: Object.values(per).every((p) => p.valid >= 3 && p.success === p.valid), ...per };
  }

  // 7/8. Transfers, mixing, alternatives.
  const reasons = valid.flatMap((r) => r.verdicts.flatMap((v) => v.reasons.map((x) => `${r.input}#${r.run}:${v.segment}:${x}`)));
  const t7 = reasons.filter((x) => /SEGMENT_MIXED|TRANSFER_BOUNDARY_MISSED|SEGMENT_NOT_EMITTED/.test(x));
  out['7_transfers'] = { pass: t7.length === 0, violations: t7 };
  const t8 = reasons.filter((x) => /ALTERNATIVE_PROMOTED/.test(x));
  out['8_alternatives'] = { pass: t8.length === 0, violations: t8 };

  // 9. Contract fail-closed.
  const contract = valid.filter((r) => r.outcome !== 'ASSEMBLED').length;
  out['9_contract'] = { pass: valid.length > 0 && contract / valid.length <= 0.125, contractFailClosed: contract, valid: valid.length };

  // 10. Operational.
  const invalid = main.filter((r) => r.validity !== 'VALID').length;
  out['10_operational'] = { pass: invalid <= 1 && valid.length / main.length >= 0.9, invalidRuns: invalid, validRunRate: `${valid.length}/${main.length}` };

  // Semantic success over valid runs (reported, not a criterion by itself).
  out.semanticSuccess = `${valid.filter((r) => r.verdicts.every((v) => v.success)).length}/${valid.length} valid runs oracle-exact on every segment`;
  out.verdict = Object.entries(out).filter(([k]) => /^\d/.test(k)).every(([, v]) => v.pass) ? 'PASS' : 'FAIL';
  return out;
}

const [mainDir, regressionDir] = process.argv.slice(2);
console.log(JSON.stringify(evaluate(mainDir, regressionDir), null, 2));
