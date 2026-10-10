// The frozen RW4 editorial units, reproduced exactly as the production
// windowing policy (be/dist) emits them for the recorded C3 COLD pass:
// window 1, `SECTION_UNIT`, `sectionComplete=true`. Same derivation as
// ../rw4-extract-completeness-2026-10-05/replay-extract.cjs (`unitWindow`).
'use strict';
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const REPO = path.resolve(HERE, '../..');
const DIST = path.join(REPO, 'be/dist/src');
const FROZEN = path.join(HERE, '../rw4-extract-completeness-2026-10-05');
const CAMPAIGN = path.join(HERE, '../rw4-functional-composite-campaign-2026-10-05');

const oracle = JSON.parse(fs.readFileSync(path.join(FROZEN, 'oracle.json'), 'utf8'));
const SOURCES = {
  SOB_UNIT: { sourceId: 'secretsofbuenosaires-day1', url: 'https://secretsofbuenosaires.com/day-1-self-guided-walking-tour-in-buenos-aires/' },
  AG_UNIT: { sourceId: 'agusyornet-san-telmo', url: 'http://www.agusyornet.com/2020/03/self-guided-walking-tour-san-telmo.html' },
};

// Milestone A regression fixtures (frozen files, see milestone-a-gate.json).
const REGRESSION = JSON.parse(fs.readFileSync(path.join(HERE, 'milestone-a-gate.json'), 'utf8')).regressionFixtures;

function unitText(input) {
  if (REGRESSION[input]) return fs.readFileSync(path.join(HERE, REGRESSION[input].file), 'utf8');
  const { sourceId, url } = SOURCES[input];
  const windowing = require(`${DIST}/modules/tours/utils/source-content-windowing.util`);
  const { DEFAULT_WEB_SOURCE_CONTENT_MAX_CHARS, DEFAULT_WEB_SOURCE_UNIT_MAX_CHARS } = require(`${DIST}/modules/tours/interfaces/web-source-content.interface`);
  const trace = JSON.parse(fs.readFileSync(path.join(CAMPAIGN, 'c3-cold/generation-trace.json'), 'utf8'));
  const request = JSON.parse(fs.readFileSync(path.join(CAMPAIGN, 'requests/c3-buenos-aires-san-telmo-self-guided.json'), 'utf8'));
  const search = trace.steps.find((s) => s.name === 'acquisition.web_search' && String(s.parentId ?? s.id).includes('planner_capacity'));
  const same = search.facts.groundedEvidence.filter((e) => e.url === url);
  const ctx = {
    titles: same.map((e) => e.title).filter(Boolean),
    snippets: same.map((e) => e.snippet).filter(Boolean),
    queries: [request.intent.additionalPreferences],
  };
  const fixture = fs.readFileSync(path.join(FROZEN, oracle.sources[sourceId].fixture), 'utf8');
  const [first] = windowing.windowSourceContentSequence(fixture, ctx, DEFAULT_WEB_SOURCE_CONTENT_MAX_CHARS, DEFAULT_WEB_SOURCE_UNIT_MAX_CHARS);
  if (first.audit.selectionStrategy !== 'SECTION_UNIT' || !first.audit.sectionComplete) throw new Error(`${input}: window 1 is not a complete unit`);
  return first.content;
}

module.exports = { oracle, SOURCES, REGRESSION, unitText, FROZEN };
