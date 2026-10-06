// Markdown tables from probe results.
//   node summarize.cjs runs/<dir>[:CONSISTENCY] ...
'use strict';
const fs = require('fs');
const path = require('path');

const rows = [];
for (const arg of process.argv.slice(2)) {
  const [dir, consistency = 'MEMBERSHIP'] = arg.split(':');
  const file = path.join(__dirname, dir, `results.${consistency}.json`);
  for (const r of JSON.parse(fs.readFileSync(file, 'utf8'))) rows.push({ batch: path.basename(dir), consistency, ...r });
}

console.log('| Batch | Rule | Unit | Run | Outcome | Atoms classified | 1st-pass issues | Relabel | Final issues | Per-segment mandatory recall (shadow if FAIL_CLOSED) | Segment verdicts |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  if (r.validity === 'INVALID_RUN') {
    console.log(`| ${r.batch} | ${r.consistency} | ${r.input} | ${r.run} | INVALID_RUN | – | – | – | – | – | ${r.error.slice(0, 60)} |`);
    continue;
  }
  const final = [...r.malformed, ...r.spanIssues, ...r.missingAtomIds.map((id) => ({ code: 'MISSING_ATOM', atomId: id })), ...r.duplicateAtomIds.map((id) => ({ code: 'DUPLICATE_ATOM', atomId: id })), ...r.unknownAtomIds.map((id) => ({ code: 'UNKNOWN_ATOM', atomId: id }))];
  const relabel = r.relabel ? (r.relabel.scope ? `${r.relabel.scope.length} atoms` : 'not repairable') : '–';
  console.log(
    `| ${r.batch} | ${r.consistency} | ${r.input} | ${r.run} | ${r.outcome} | ${r.classified}/${r.atoms} | ${r.firstPassIssueCount} | ${relabel} | ${final.map((x) => `${x.code} ${x.atomId ?? ''}`).join('; ') || 'none'} | ${r.verdicts.map((v) => `${v.segment} ${v.mandatoryRecall}`).join(', ')} | ${r.verdicts.map((v) => (v.success ? 'OK' : v.reasons.join(','))).join(' / ')} |`,
  );
}
