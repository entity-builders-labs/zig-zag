// RW4-EXTRACT-COMPLETENESS-1 forensic loss table (offline, read-only).
// For every oracle stop of both C3 editorial sources, trace
//   retrieved source content -> extractor input window -> extractor output
//   -> persisted Experience components
// using ONLY recorded evidence: the frozen oracle, the Tavily fixtures (which
// reproduce the C3 planner-capacity retrieval byte for byte apart from the
// trace's apikey redaction), the C3 COLD/WARM generation traces and the
// db-after snapshots.
//   node spikes/rw4-extract-completeness-2026-10-05/forensic.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const CAMPAIGN = path.join(HERE, '../rw4-functional-composite-campaign-2026-10-05');
const oracle = JSON.parse(fs.readFileSync(path.join(HERE, 'oracle.json'), 'utf8'));

const fold = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const names = (item) => [item.name, ...(item.aliases ?? [])].map(fold);
const inText = (item, text) => {
  const t = fold(text);
  return names(item).some((n) => n && t.includes(n)) || (item.span && t.includes(fold(item.span)));
};
// Exact identity match on the oracle name or one of its aliases, ignoring a
// leading article. Containment is NOT a match: "Museo Histórico Nacional"
// must not match "Museo Histórico Nacional del Cabildo …".
const bare = (s) => fold(s).replace(/^(the|el|la|los|las) /, '');
const sameEntity = (item, label) => {
  if (!label) return false;
  const l = bare(label);
  return l.length > 0 && [item.name, ...(item.aliases ?? [])].some((n) => bare(n) === l);
};

function attemptsFor(run, urlPart) {
  const trace = JSON.parse(fs.readFileSync(path.join(CAMPAIGN, run, 'generation-trace.json'), 'utf8'));
  const out = [];
  for (const s of trace.steps) {
    if (s.name !== 'acquisition.deep_source_window') continue;
    if (!String(s.facts.sourceUrl).includes(urlPart)) continue;
    let raw;
    try {
      raw = JSON.parse(s.facts.rawOutput);
    } catch {
      raw = undefined;
    }
    out.push({
      run,
      pass: s.parentId.replace('acquisition-pass-1-', ''),
      window: s.facts.windowing.windowOrdinal,
      excerpts: s.facts.windowing.selectedExcerpts.map((e) => `${e.start}-${e.end}`).join(','),
      status: s.facts.status,
      scanDecision: s.facts.scanDecision,
      content: s.facts.content,
      emitted: (raw?.candidates ?? []).flatMap((c) =>
        c.componentHints.map((h) => ({ candidate: c.name, name: h.name, sourceName: h.sourceName })),
      ),
    });
  }
  return out;
}

function persisted(run, urlPart) {
  const db = JSON.parse(fs.readFileSync(path.join(CAMPAIGN, run, 'db-after.json'), 'utf8'));
  const ids = { secrets: 'ca18c700-7434-4f1a-99bd-31690846e290', agusyornet: '177a2ae7-654f-4568-bc26-3138c2b727fb' };
  const key = urlPart.includes('secrets') ? 'secrets' : 'agusyornet';
  const e = db.experiences.find((x) => x.id === ids[key]);
  return (e?.componentset ?? e?.componentSet ?? []).map((c) => c.geoEntity);
}

const report = {};
for (const [sourceId, source] of Object.entries(oracle.sources)) {
  const urlPart = sourceId.startsWith('secrets') ? 'secretsofbuenosaires' : 'agusyornet';
  const fixture = fs.readFileSync(path.join(HERE, source.fixture), 'utf8');
  const attempts = [...attemptsFor('c3-cold', urlPart), ...attemptsFor('c3-warm', urlPart)];
  const persistedNames = persisted('c3-cold', urlPart);
  const rows = [];
  for (const segment of source.segments) {
    for (const group of segment.orderGroups) {
      for (const item of group) {
        const perAttempt = attempts.map((a) => {
          const inInput = inText(item, a.content);
          const emitted = a.emitted.some((h) => sameEntity(item, h.name) || sameEntity(item, h.sourceName));
          return `${a.run}/${a.pass}/w${a.window}:${inInput ? 'IN' : '--'}${emitted ? '+EMIT' : ''}`;
        });
        const inRetrieved = inText(item, fixture);
        const isPersisted = persistedNames.some((n) => sameEntity(item, n));
        const inAnyInput = attempts.some((a) => inText(item, a.content));
        const emittedAny = attempts.some((a) => a.emitted.some((h) => sameEntity(item, h.name) || sameEntity(item, h.sourceName)));
        let lostAt;
        if (!inRetrieved) lostAt = 'NOT_IN_RETRIEVED_CONTENT';
        else if (isPersisted) lostAt = 'EMITTED_VERIFIED_PERSISTED';
        else if (!inAnyInput) lostAt = 'RETRIEVED_BUT_EXCLUDED_BY_WINDOW';
        else if (!emittedAny) lostAt = 'IN_EXTRACTOR_INPUT_NOT_EMITTED';
        else lostAt = 'EMITTED_NOT_PERSISTED';
        rows.push({ segment: segment.id, item: item.name, role: item.role, lostAt, perAttempt });
      }
    }
  }
  report[sourceId] = {
    attempts: attempts.map(({ content, emitted, ...a }) => ({
      ...a,
      emitted: emitted.map((h) => h.name),
    })),
    persistedComponents: persistedNames,
    rows,
  };
}
fs.writeFileSync(path.join(HERE, 'forensic.out.json'), JSON.stringify(report, null, 2) + '\n');
for (const [sourceId, r] of Object.entries(report)) {
  console.log(`\n## ${sourceId}`);
  for (const a of r.attempts) console.log(`  attempt ${a.run}/${a.pass}/w${a.window} [${a.excerpts}] ${a.status} ${a.scanDecision ?? ''} -> ${a.emitted.join(' > ') || '(none)'}`);
  console.log('  persisted:', r.persistedComponents.join(' | '));
  for (const row of r.rows.filter((x) => x.role === 'MANDATORY')) {
    console.log(`  ${row.segment.padEnd(18)} ${row.item.padEnd(26)} ${row.lostAt.padEnd(34)} ${row.perAttempt.join(' ')}`);
  }
}
