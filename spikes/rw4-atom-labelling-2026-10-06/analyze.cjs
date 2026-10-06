// Cross-run evidence for the README: per oracle MANDATORY item, the atom
// decisions in every valid run; alternative roles; ACCEPTABLE promotions;
// non-oracle mandatory names; mixing/boundaries.
//   node analyze.cjs runs/<dir> ...
'use strict';
const fs = require('fs');
const path = require('path');

for (const dir of process.argv.slice(2)) {
  const results = JSON.parse(fs.readFileSync(path.join(__dirname, dir, 'results.MEMBERSHIP.json'), 'utf8')).filter((r) => r.validity === 'VALID');
  console.log(`\n## ${path.basename(dir)} (${results.length} valid runs)`);
  for (const input of [...new Set(results.map((r) => r.input))]) {
    const rs = results.filter((r) => r.input === input);
    console.log(`\n### ${input}`);
    const items = Object.keys(rs[0].mandatoryDecisions);
    console.log('| Oracle MANDATORY item | ' + rs.map((r) => `run ${r.run} (${r.outcome === 'ASSEMBLED' ? 'A' : 'FC'})`).join(' | ') + ' |');
    console.log('|---|' + rs.map(() => '---|').join(''));
    for (const item of items) {
      const cells = rs.map((r) => {
        const ds = r.mandatoryDecisions[item];
        const stop = ds.filter((d) => d.entityRole === 'ITINERARY_STOP').map((d) => d.atomId);
        return stop.length ? `STOP@${stop[0]}` : ds.map((d) => `${d.atomId}:${d.entityRole ?? d.classification}`).join(' ') || 'no atom';
      });
      console.log(`| ${item} | ${cells.join(' | ')} |`);
    }
    console.log('\nAlternatives (oracle ALTERNATIVE → emitted role per run):');
    for (const a of rs[0].alternatives.map((x) => x.name)) console.log(`- ${a}: ${rs.map((r) => r.alternatives.find((x) => x.name === a).emittedRole ?? 'none').join(', ')}`);
    console.log('\nPer run: ACCEPTABLE promoted to mandatory / non-oracle mandatory names / segment openers:');
    for (const r of rs) {
      console.log(`- run ${r.run}: promoted [${r.verdicts.flatMap((v) => v.acceptablePromoted).join(', ')}]; not-in-oracle [${r.verdicts.flatMap((v) => v.notInOracleMandatory).join(', ')}]; segments ${r.segments.map((s) => `{${s.openedBy.join('+') || 'start'}: ${s.mandatory.length}m}`).join(' ')}; reasons ${r.verdicts.map((v) => v.reasons.join(',') || 'OK').join(' / ')}`);
    }
  }
}
