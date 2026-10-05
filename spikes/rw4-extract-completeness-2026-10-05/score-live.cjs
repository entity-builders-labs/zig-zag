// RW4-EXTRACT-COMPLETENESS-1 live acceptance scorer (read-only).
// For every persisted Experience whose evidence URL is one of the oracle
// sources, compare its ordered components with the frozen oracle, and list
// the deep-source scan decisions the run's trace recorded for that source.
//   node spikes/rw4-extract-completeness-2026-10-05/score-live.cjs <runDir> <db>
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const HERE = __dirname;
const [runDir, db] = process.argv.slice(2);
const oracle = JSON.parse(fs.readFileSync(path.join(HERE, 'oracle.json'), 'utf8'));
const trace = JSON.parse(fs.readFileSync(path.join(runDir, 'generation-trace.json'), 'utf8'));

const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const bare = (s) => fold(s).replace(/^(the|el|la|los|las) /, '');
const matches = (item, label) => !!label && [item.name, ...(item.aliases ?? [])].some((n) => bare(n) === bare(label));

const sql = `SELECT coalesce(json_agg(x), '[]') FROM (
  SELECT e.id, e."canonicalName" AS name, e.status,
    (SELECT json_agg(DISTINCT ev.url) FROM experience_evidence ev WHERE ev."experienceId" = e.id) AS urls,
    (SELECT json_agg(json_build_object('order', c."order", 'role', c.role, 'geoEntityId', g.id, 'name', g.name, 'kind', g.kind) ORDER BY c."order" NULLS LAST, g.name)
       FROM experience_component c JOIN geo_entity g ON g.id = c."geoEntityId" WHERE c."experienceId" = e.id) AS components
  FROM experience e) x`;
const experiences = JSON.parse(
  execFileSync('docker', ['exec', 'zigzag-postgres', 'psql', '-U', 'postgres', '-d', db, '-t', '-A', '-c', sql], { encoding: 'utf8' }),
);

const out = {};
for (const [sourceId, source] of Object.entries(oracle.sources)) {
  const items = source.segments.flatMap((seg) => seg.orderGroups.flatMap((g, gi) => g.map((i) => ({ ...i, segment: seg.id, group: gi }))));
  const persisted = experiences.filter((e) => (e.urls ?? []).includes(source.url));
  const scan = trace.steps
    .filter((s) => s.name === 'acquisition.deep_source_window' && s.facts.sourceUrl === source.url)
    .map((s) => {
      let raw;
      try {
        raw = JSON.parse(s.facts.rawOutput);
      } catch {
        raw = undefined;
      }
      return {
        pass: String(s.parentId).replace('acquisition-pass-1-', ''),
        window: s.facts.windowing.windowOrdinal,
        strategy: s.facts.windowing.selectionStrategy,
        sectionComplete: s.facts.windowing.sectionComplete,
        chars: s.facts.windowing.retainedContentChars,
        decision: s.facts.scanDecision,
        status: s.facts.status,
        emitted: (raw?.candidates ?? []).map((c) => `${c.name} [${c.componentHints.map((h) => h.name).join(' > ')}]`),
        validationErrors: (s.facts.validationErrors ?? []).map((v) => String(v).slice(0, 200)),
      };
    });
  out[sourceId] = {
    scan,
    persisted: persisted.map((e) => {
      const comps = (e.components ?? []).map((c) => {
        const item = items.find((i) => matches(i, c.name));
        return { ...c, oracle: item ? `${item.segment}:${item.name}:${item.role}` : 'NOT_IN_ORACLE' };
      });
      const segs = [...new Set(comps.map((c) => c.oracle.split(':')[0]).filter((s) => s !== 'NOT_IN_ORACLE'))];
      return {
        id: e.id,
        name: e.name,
        status: e.status,
        componentCount: comps.length,
        components: comps.map((c) => `${c.order ?? '-'}. ${c.name} (${c.geoEntityId.slice(0, 8)}) -> ${c.oracle}`),
        perSegment: segs.map((segId) => {
          const mandatory = items.filter((i) => i.segment === segId && i.role === 'MANDATORY');
          const present = mandatory.filter((m) => comps.some((c) => matches(m, c.name)));
          const groups = comps.filter((c) => c.oracle.startsWith(`${segId}:`)).map((c) => items.find((i) => matches(i, c.name)).group);
          return {
            segment: segId,
            mandatory: `${present.length}/${mandatory.length}`,
            missing: mandatory.filter((m) => !present.includes(m)).map((m) => m.name),
            ordered: groups.every((g, i) => i === 0 || g >= groups[i - 1]),
          };
        }),
        mixedSegments: segs.length > 1,
      };
    }),
  };
}
fs.writeFileSync(path.join(runDir, 'completeness-score.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
