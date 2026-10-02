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
// Expected acquisition work units for this request shape (geographic
// authorization contract, docs/superpowers/specs/2026-10-02-geographic-
// validation-authorization-review.md): the anchored route_like deficit is
// owned by its own AREA_ROUTE_WALK unit; theme:wine + intent:visit form the
// one GENERIC unit. A free-text intent:walk is a VALID additional request
// need: it must be owned by its own unit, never by GENERIC.
const EXPECTED_OWNED = ['AREA_ROUTE_WALK:intent:route_like'];
const OPTIONAL_OWNED_KEYS = ['intent:walk'];
const EXPECTED_GENERIC = ['theme:wine', 'intent:visit'];
const POLICY_KEYS = ['intent:walk', 'intent:route_like'];

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
  const units = routing?.workUnits ?? [];
  const keyOf = (d) => `${d.dimension}:${d.key}`;
  const generic = units
    .filter((u) => u.kind === 'GENERIC')
    .flatMap((u) => (u.deficits ?? []).map(keyOf));
  const owned = units
    .filter((u) => u.kind === 'AREA_ROUTE_WALK' || u.kind === 'DEDICATED_INTENT')
    .map((u) => `${u.kind}:${keyOf(u.deficit)}`);
  if (!routing) failures.push('no acquisition.routing step');
  else {
    for (const expected of EXPECTED_OWNED)
      if (!owned.includes(expected))
        failures.push(`missing owning work unit ${expected} in ${JSON.stringify(owned)}`);
    for (const unit of owned) {
      const key = unit.split(':').slice(1).join(':');
      if (!EXPECTED_OWNED.includes(unit) && !OPTIONAL_OWNED_KEYS.includes(key))
        failures.push(`unexpected owning work unit ${unit}`);
    }
    if (!sameSet(generic, EXPECTED_GENERIC))
      failures.push(`generic work unit ${JSON.stringify(generic)}`);
    if (generic.some((key) => POLICY_KEYS.includes(key)))
      failures.push('policy-bearing deficit coalesced into GENERIC');
    for (const unit of units) {
      const grant = unit.geographicGrant;
      const ownsPolicy = unit.kind === 'AREA_ROUTE_WALK' || unit.kind === 'DEDICATED_INTENT';
      if (ownsPolicy && !(grant?.kind === 'OWNED_INTENT' && grant.intent === unit.deficit?.key))
        failures.push(`work unit ${unit.kind}:${unit.deficit?.key} grant ${JSON.stringify(grant)}`);
      if (!ownsPolicy && grant?.kind !== 'NONE')
        failures.push(`work unit ${unit.kind} grants ${JSON.stringify(grant)}`);
    }
  }
  return { request, facets: facetKeys, workUnits: { owned, generic } };
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
