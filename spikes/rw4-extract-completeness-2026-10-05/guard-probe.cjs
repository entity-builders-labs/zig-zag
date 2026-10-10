// RW4-EXTRACT-COMPLETENESS-1, Part C: what can a DETERMINISTIC guard detect?
//
// Applies generic, source-agnostic structural-marker rules to
//  (1) the oracle-correct emission of every source (all MANDATORY stops at
//      their oracle spans): any flag here is FALSE incompleteness, and
//  (2) every observed raw extractor proposal in the given replay batches:
//      a flag is a catch only when the proposal really missed a MANDATORY.
// No provider call, no production code.
//
//   node guard-probe.cjs head-8981-gemini head-8981b-gemini ...
'use strict';
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const oracle = JSON.parse(fs.readFileSync(path.join(HERE, 'oracle.json'), 'utf8'));

const UNITS = {
  SOB_UNIT: 'secretsofbuenosaires-day1',
  AG_UNIT: 'agusyornet-san-telmo',
};
const unitText = (id) => {
  const src = oracle.sources[id];
  const [start, end] = src.unit.match(/(\d+)–(\d+)/).slice(1).map(Number);
  return fs.readFileSync(path.join(HERE, src.fixture), 'utf8').slice(start, end);
};
const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}+/gu, '').replace(/[*_“”"]/g, '').replace(/\s+/g, ' ').toLowerCase();
// Position of a span in the unit, on a folded copy (markdown emphasis and
// quotes removed, whitespace collapsed), mapped back to a raw offset.
function locate(text, span) {
  const map = [];
  let folded = '';
  for (let i = 0; i < text.length; i++) {
    const f = fold(text[i]);
    if (f === ' ' && folded.endsWith(' ')) continue;
    for (const ch of f) {
      folded += ch;
      map.push(i);
    }
  }
  const at = folded.indexOf(fold(span).trim());
  return at < 0 ? -1 : map[at];
}

// Generic marker classes. Each marker opens a section that runs to the next
// marker of the same class.
const MARKERS = {
  NUMBERED_STOP: /\bstop\s*(\d{1,2})\b/gi,
  SCHEDULE_HEADING: /\*\*\s*(\d{1,2})\s*(?:am|pm|hs)\b[^*]*\*\*/gi,
  START_END_BANNER: /\*\*\s*(?:start|end|finish)\b[^*]*\*\*/gi,
};
function markers(text) {
  const out = {};
  for (const [cls, re] of Object.entries(MARKERS)) {
    const found = [...text.matchAll(re)].map((m) => ({ cls, at: m.index, label: m[0].replace(/\s+/g, ' ').slice(0, 60), n: m[1] ? Number(m[1]) : null }));
    out[cls] = found.map((m, i) => ({ ...m, end: found[i + 1]?.at ?? text.length }));
  }
  return out;
}

// Rules over emitted span offsets of ALL candidates of one extraction.
//  R1 every marker section of a class with at least one covered section must
//     itself be covered (any gap: leading, interior or trailing);
//  R2 same, but only sections BEFORE the last covered section (no trailing);
//  R3 numbered stops only: every number between the smallest and largest
//     covered number must be covered by some section carrying that number.
function evaluate(text, offsets) {
  const ms = markers(text);
  const flags = { R1: [], R2: [], R3: [] };
  for (const [cls, list] of Object.entries(ms)) {
    if (!list.length) continue;
    const covered = list.map((m) => offsets.some((o) => o >= m.at && o < m.end));
    if (!covered.some(Boolean)) continue;
    const lastCovered = covered.lastIndexOf(true);
    list.forEach((m, i) => {
      if (covered[i]) return;
      flags.R1.push(`${cls}:${m.label}`);
      if (i < lastCovered) flags.R2.push(`${cls}:${m.label}`);
    });
    if (cls === 'NUMBERED_STOP') {
      const nums = list.filter((m, i) => covered[i]).map((m) => m.n);
      const coveredNums = new Set(nums);
      for (let n = Math.min(...nums); n <= Math.max(...nums); n++) if (!coveredNums.has(n)) flags.R3.push(`stop ${n}`);
    }
  }
  return flags;
}

function oracleOffsets(sourceId, text) {
  return oracle.sources[sourceId].segments.flatMap((s) => s.orderGroups.flat().filter((i) => i.role === 'MANDATORY').map((i) => ({ name: i.name, at: locate(text, i.span) })));
}

const report = { markers: {}, oracleCorrect: {}, observed: [] };
for (const [unit, sourceId] of Object.entries(UNITS)) {
  const text = unitText(sourceId);
  report.markers[unit] = Object.fromEntries(Object.entries(markers(text)).map(([k, v]) => [k, v.map((m) => m.label)]));
  const ideal = oracleOffsets(sourceId, text);
  const unlocated = ideal.filter((x) => x.at < 0).map((x) => x.name);
  report.oracleCorrect[unit] = { unlocatedOracleSpans: unlocated, flags: evaluate(text, ideal.map((x) => x.at).filter((x) => x >= 0)) };
}
for (const dir of process.argv.slice(2)) {
  const rows = JSON.parse(fs.readFileSync(path.join(HERE, 'replays', dir, 'results.json'), 'utf8'));
  for (const r of rows.filter((x) => x.validity === 'VALID' && UNITS[x.input])) {
    const text = unitText(UNITS[r.input]);
    const raw = fs.readFileSync(path.join(HERE, 'replays', dir, `${r.input}-${r.run}.raw.txt`), 'utf8');
    let cands = [];
    try {
      const p = JSON.parse(raw);
      cands = Array.isArray(p) ? p : p.candidates ?? [];
    } catch {}
    const spans = cands.flatMap((c) => (c.componentHints ?? []).map((h) => h.supportSpan));
    const offsets = spans.map((s) => locate(text, s)).filter((x) => x >= 0);
    const missing = r.segmentVerdicts.flatMap((v) => v.reasons.filter((x) => x.startsWith('MISSING_MANDATORY')).flatMap((x) => x.slice(18).split('|')));
    const notEmitted = r.segmentVerdicts.filter((v) => v.reasons.includes('SEGMENT_NOT_EMITTED')).map((v) => v.segment);
    const flags = evaluate(text, offsets);
    report.observed.push({ batch: dir, input: r.input, run: r.run, actuallyIncomplete: missing.length > 0 || notEmitted.length > 0, missing, notEmitted, flagged: { R1: flags.R1.length > 0, R2: flags.R2.length > 0, R3: flags.R3.length > 0 }, flags });
  }
}
const tally = {};
for (const o of report.observed) {
  for (const rule of ['R1', 'R2', 'R3']) {
    const k = `${o.input}:${rule}`;
    tally[k] ??= { incompleteCaught: 0, incompleteMissed: 0, completeFlagged: 0, completePassed: 0 };
    const t = tally[k];
    if (o.actuallyIncomplete) o.flagged[rule] ? t.incompleteCaught++ : t.incompleteMissed++;
    else o.flagged[rule] ? t.completeFlagged++ : t.completePassed++;
  }
}
report.tally = tally;
fs.writeFileSync(path.join(HERE, 'guard-probe.out.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ markers: report.markers, oracleCorrect: report.oracleCorrect, tally }, null, 1));
