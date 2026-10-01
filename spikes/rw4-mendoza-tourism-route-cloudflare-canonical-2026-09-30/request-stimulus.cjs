#!/usr/bin/env node
// RW4 canonical request-stimulus gate.
//
// The RW4 Mendoza scenario semantically requests theme:wine, intent:route_like
// and intent:visit. COLD #7 only obtained intent:visit from stochastic
// free-text interpretation; COLD #8 did not, so its generic acquisition plan
// differed. The fixture therefore states all three as explicit wizard
// semantics. This gate checks the INPUT only -- it never asserts on search
// results, selected sources, extracted candidates or any named place.
//
//   node request-stimulus.cjs request <request.json>         (pre-run)
//   node request-stimulus.cjs trace <generation-trace.json>  (post-run)
//
// Prints a JSON verdict; exits 1 on FAIL.
'use strict';
const fs = require('fs');

const REQUIRED_THEMES = ['wine'];
const REQUIRED_INTENTS = ['route_like', 'visit'];
// Expected acquisition partition for this request shape: the anchored
// route_like deficit goes to area_route_walk, the rest stays generic.
const EXPECTED_AREA_ROUTE_WALK = ['intent:route_like'];
const EXPECTED_GENERIC = ['theme:wine', 'intent:visit'];

function checkRequestIntent(intent, failures, label) {
  const interests = intent?.interests ?? [];
  const intents = intent?.intents ?? [];
  for (const t of REQUIRED_THEMES)
    if (!interests.includes(t)) failures.push(`${label} interests missing ${t}`);
  for (const i of REQUIRED_INTENTS)
    if (!intents.includes(i)) failures.push(`${label} intents missing ${i}`);
  return { interests, intents };
}

function sameSet(actual, expected) {
  return (
    actual.length === expected.length &&
    expected.every((value) => actual.includes(value))
  );
}

function checkTrace(trace, failures) {
  const request = checkRequestIntent(
    trace.canonicalRequest?.intent,
    failures,
    'canonicalRequest',
  );
  const steps = trace.steps ?? [];
  const facets =
    steps.find((s) => s.name === 'request.intent')?.facts?.facets ?? [];
  const facetKeys = facets.map((f) => `${f.dimension}:${f.key}:${f.source}`);
  for (const key of [
    ...REQUIRED_THEMES.map((t) => `theme:${t}`),
    ...REQUIRED_INTENTS.map((i) => `intent:${i}`),
  ]) {
    if (!facets.some((f) => `${f.dimension}:${f.key}` === key && f.source === 'wizard'))
      failures.push(`PreferenceSpec missing wizard facet ${key}`);
  }
  const routing = steps.find((s) => s.name === 'acquisition.routing')?.output;
  const generic = (routing?.generic ?? []).map((d) => `${d.dimension}:${d.key}`);
  const areaRouteWalk = (routing?.areaRouteWalk ?? []).map(
    (r) => `${(r.deficit ?? r).dimension}:${(r.deficit ?? r).key}`,
  );
  if (!routing) failures.push('no acquisition.routing step');
  else {
    if (!sameSet(areaRouteWalk, EXPECTED_AREA_ROUTE_WALK))
      failures.push(`area_route_walk partition ${JSON.stringify(areaRouteWalk)}`);
    if (!sameSet(generic, EXPECTED_GENERIC))
      failures.push(`generic partition ${JSON.stringify(generic)}`);
  }
  return { request, facets: facetKeys, partition: { areaRouteWalk, generic } };
}

const [mode, file] = process.argv.slice(2);
if (!['request', 'trace'].includes(mode) || !file) {
  console.error('usage: request-stimulus.cjs request|trace <file>');
  process.exit(2);
}
const failures = [];
const json = JSON.parse(fs.readFileSync(file, 'utf8'));
const observed =
  mode === 'request'
    ? checkRequestIntent(json.intent, failures, 'request')
    : checkTrace(json, failures);
const verdict = failures.length === 0 ? 'PASS' : 'FAIL';
console.log(JSON.stringify({ mode, verdict, observed, failures }, null, 2));
process.exit(verdict === 'PASS' ? 0 : 1);
