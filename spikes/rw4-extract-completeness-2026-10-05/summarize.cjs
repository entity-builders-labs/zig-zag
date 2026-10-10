// Summarize replay batches: per run, per oracle segment, the raw proposal
// recall, the brief's success verdict and normalization violations.
//   node summarize.cjs <replay-dir> [...]
'use strict';
const path = require('path');
for (const dir of process.argv.slice(2)) {
  const rows = require(path.resolve(__dirname, 'replays', dir, 'results.json'));
  const valid = rows.filter((r) => r.validity === 'VALID');
  console.log(`== ${dir}: valid ${valid.length}, invalid ${rows.length - valid.length}`);
  for (const r of valid) {
    const segs = r.segmentVerdicts.map((v) => `${v.segment}:${v.mandatoryRecall}${v.success ? ' OK' : ' FAIL(' + v.reasons.map((x) => x.split(':')[0]).join(',') + ')'}`);
    const missing = r.segmentVerdicts.flatMap((v) => v.reasons.filter((x) => x.startsWith('MISSING')).map((x) => x.slice(17)));
    console.log(`  ${r.input}#${r.run} norm=${r.normalizationViolations.length} ${segs.join('  ')}${missing.length ? '  missing=' + missing.join('|') : ''}`);
  }
}
