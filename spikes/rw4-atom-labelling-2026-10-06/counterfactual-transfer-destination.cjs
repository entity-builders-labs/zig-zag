// OFFLINE COUNTERFACTUAL (no provider calls, not a gate result): re-assemble
// recorded labels under a representation change in which entities on a
// TRANSFER atom are destination provenance only and never membership
// (ITINERARY_STOP on a TRANSFER atom becomes ROUTE_LEG before assembly).
// Membership must then come from a non-TRANSFER atom.
//   node counterfactual-transfer-destination.cjs runs/<batch> ...
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./atom-labelling.cjs');
const { scoreSource } = require('./score.cjs');
const { SOURCES } = require('./units.cjs');

for (const dir of process.argv.slice(2)) {
  const full = path.join(__dirname, dir);
  console.log(`\n## ${dir}`);
  for (const f of fs.readdirSync(full).filter((x) => /^(SOB|AG)_UNIT-\d+\.result\.MEMBERSHIP\.json$/.test(x)).sort()) {
    const r = JSON.parse(fs.readFileSync(path.join(full, f), 'utf8'));
    const input = f.split('-')[0];
    const atoms = JSON.parse(fs.readFileSync(path.join(full, `${input}.atoms.json`), 'utf8')).atoms;
    const labels = new Map();
    let demoted = [];
    for (const l of r.labels) {
      if (l.classification === 'UNLABELLED') continue;
      const entities = (l.entities ?? []).map((e) => {
        if (l.classification === 'TRANSFER' && e.role === 'ITINERARY_STOP') {
          demoted.push(`${l.atomId}:${e.sourceName}`);
          return { ...e, role: 'ROUTE_LEG' };
        }
        return e;
      });
      labels.set(l.atomId, { ...l, entities });
    }
    // Same fail-closed status as the recorded run: only the representation changes.
    const segments = L.assemble(atoms, { valid: true, issues: [], labels });
    const score = scoreSource(SOURCES[input].sourceId, segments, atoms, labels);
    console.log(
      `- ${f.replace('.result.MEMBERSHIP.json', '')} (${r.outcome}): demoted [${demoted.join(', ')}]; ${score.verdicts.map((v) => `${v.segment} ${v.mandatoryRecall}${v.success ? ' OK' : ' ' + v.reasons.join(',')}`).join(' | ')}; route/area promoted [${score.routeAreaPromoted.join(', ')}]; conflicts [${segments.flatMap((s) => s.conflicts.map((c) => c.sourceName)).join(', ')}]`,
    );
  }
}
