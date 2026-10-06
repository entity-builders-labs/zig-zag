// Deterministic contract tests for the atom-labelling spike.
//   node --test spikes/rw4-atom-labelling-2026-10-06/
// They prove structure (coverage, exhaustiveness, assembly), never LLM
// semantic recall: every label below is hand-written. Fixture text is
// neutral and invented; the frozen RW4 units are used only for structural
// coverage/stability.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const L = require('./atom-labelling.cjs');

const FROZEN = path.join(__dirname, '../rw4-extract-completeness-2026-10-05/sources');
const frozen = fs.readdirSync(FROZEN).map((f) => fs.readFileSync(path.join(FROZEN, f), 'utf8'));

const WALK = [
  '## A harbour day',
  '',
  'Start at the Old Square. In front you will see the Town Hall.',
  'Walk along Harbour Road and cross Mill Street.',
  '- Stop 2: the Fish Market. Have lunch at Café One or Café Two.',
  '| Take the number 7 bus to the Lighthouse. | ![](https://img.example/x.png) |',
  '| --- | --- |',
  'Arrive at the Lighthouse. If you have time, visit the Shell Museum.',
  'Prices are low.',
].join('\n');

const setup = (text = WALK) => {
  const z = L.atomize(text);
  return { z, atoms: z.atoms, byId: new Map(z.atoms.map((a) => [a.atomId, a])) };
};
const idOf = (atoms, needle) => atoms.find((a) => a.text.includes(needle)).atomId;
const ent = (sourceName, supportSpan, role) => ({ sourceName, supportSpan, role });

// Hand-written labelling of WALK (stand-in for an LLM response).
function walkResponse(atoms) {
  const by = (needle, classification, entities = [], extra = {}) => ({ atomId: idOf(atoms, needle), classification, entities, ...extra });
  const labels = [
    by('## A harbour day', 'NON_ITINERARY'),
    by('Start at the Old Square', 'ITINERARY_STOP', [ent('Old Square', 'Start at the Old Square', 'ITINERARY_STOP')]),
    by('Town Hall', 'ITINERARY_STOP', [ent('Town Hall', 'you will see the Town Hall', 'ITINERARY_STOP')]),
    by('Harbour Road', 'PASS_BY', [ent('Harbour Road', 'Walk along Harbour Road', 'PASS_BY'), ent('Mill Street', 'cross Mill Street', 'PASS_BY')]),
    by('Fish Market', 'ITINERARY_STOP', [ent('Fish Market', 'Stop 2: the Fish Market', 'ITINERARY_STOP')]),
    by('Café One', 'ALTERNATIVE', [ent('Café One', 'lunch at Café One', 'ALTERNATIVE'), ent('Café Two', 'or Café Two', 'ALTERNATIVE')]),
    by('number 7 bus', 'TRANSFER', [ent('Lighthouse', 'bus to the Lighthouse', 'ITINERARY_STOP')], { transferMode: 'BUS' }),
    by('Arrive at the Lighthouse', 'ITINERARY_STOP', [ent('Lighthouse', 'Arrive at the Lighthouse', 'ITINERARY_STOP')]),
    by('Shell Museum', 'OPTIONAL_STOP', [ent('Shell Museum', 'visit the Shell Museum', 'OPTIONAL_STOP')]),
    by('Prices are low', 'NON_ITINERARY'),
  ];
  return { atoms: labels };
}

test('1. atomization is stable: same input, same atoms, IDs, order and offsets', () => {
  for (const text of [WALK, ...frozen]) {
    assert.deepEqual(L.atomize(text), L.atomize(text));
    const ids = L.atomize(text).atoms.map((a) => a.atomId);
    assert.deepEqual(ids, ids.map((_, i) => `a-${String(i + 1).padStart(Math.max(3, String(ids.length).length), '0')}`));
  }
});

test('2. atoms and documented separators partition the whole unit', () => {
  for (const text of [WALK, ...frozen]) {
    const z = L.atomize(text);
    assert.deepEqual(L.checkCoverage(text, z), { ok: true, problems: [] });
  }
  // A coverage hole is detected.
  const z = L.atomize(WALK);
  const broken = { ...z, atoms: z.atoms.slice(1) };
  assert.equal(L.checkCoverage(WALK, broken).ok, false);
});

test('3. no atom loss: every letter/number of the unit lies inside some atom', () => {
  for (const text of [WALK, ...frozen]) {
    const z = L.atomize(text);
    const covered = new Uint8Array(text.length);
    for (const a of z.atoms) covered.fill(1, a.sourceStart, a.sourceEnd);
    for (const s of z.separators) assert.ok(!/[\p{L}\p{N}]/u.test(L.present(text.slice(s.start, s.end)).text), `separator has content: ${JSON.stringify(text.slice(s.start, s.end))}`);
    for (const a of z.atoms) assert.equal(text.slice(a.sourceStart, a.sourceEnd), a.text);
    assert.ok(z.atoms.every((a, i) => i === 0 || a.sourceStart >= z.atoms[i - 1].sourceEnd), 'atoms are in source order');
  }
  // Over-long text is split into traceable fragments, never truncated.
  const long = 'word '.repeat(400).trim() + '.';
  const z = L.atomize(long, { maxAtomChars: 200 });
  assert.ok(z.atoms.length > 1 && z.atoms.every((a) => a.fragment && a.text.length <= 200));
  assert.equal(z.atoms.map((a) => a.text).join(' '), long);
});

test('splitting is structural: lines, table cells, sentences; abbreviations by token length only', () => {
  const { atoms } = setup();
  assert.ok(atoms.some((a) => a.text === 'Start at the Old Square.'));
  assert.ok(atoms.some((a) => a.blockKind === 'TABLE_CELL' && a.text === 'Take the number 7 bus to the Lighthouse.'));
  assert.ok(!atoms.some((a) => a.text.includes('https://')), 'an image-only cell is a markup separator');
  assert.deepEqual(L.atomize('Walk to Av. Central and rest. Then go on.').atoms.map((a) => a.text), ['Walk to Av. Central and rest.', 'Then go on.']);
});

test('4. exactly one result per atom validates', () => {
  const { atoms, byId } = setup();
  const v = L.validateLabelling(atoms.map((a) => a.atomId), byId, walkResponse(atoms));
  assert.deepEqual(v.issues, []);
  assert.equal(v.valid, true);
  assert.equal(v.labels.size, atoms.length);
});

test('5. missing, duplicate and unknown atoms fail closed', () => {
  const { atoms, byId } = setup();
  const scope = atoms.map((a) => a.atomId);
  const good = walkResponse(atoms).atoms;
  const codes = (resp) => L.validateLabelling(scope, byId, resp).issues.map((x) => x.code);

  assert.deepEqual(codes({ atoms: good.slice(1) }), ['MISSING_ATOM']);
  assert.deepEqual(codes({ atoms: [...good, good[3]] }), ['DUPLICATE_ATOM']);
  assert.deepEqual(codes({ atoms: [...good, { atomId: 'a-999', classification: 'NON_ITINERARY', entities: [] }] }), ['UNKNOWN_ATOM']);
  assert.deepEqual(codes({ atoms: good.map((l, i) => (i === 0 ? { ...l, atomId: '[a-001]' } : l)) }), ['UNKNOWN_ATOM', 'MISSING_ATOM']);
  assert.deepEqual(codes({ atoms: good.map((l, i) => (i === 0 ? { ...l, classification: 'STOP' } : l)) }), ['MALFORMED_LABEL']);
  assert.deepEqual(codes(null), ['MALFORMED_RESPONSE']);
  assert.deepEqual(codes({ labels: good }), ['MALFORMED_RESPONSE']);
  assert.throws(() => L.assemble(atoms, L.validateLabelling(scope, byId, { atoms: good.slice(1) })), /ASSEMBLY_REFUSED/);
});

test('6. supportSpan must be inside its atom and sourceName inside its span', () => {
  const { atoms, byId } = setup();
  const scope = atoms.map((a) => a.atomId);
  const swap = (needle, entities) => walkResponse(atoms).atoms.map((l) => (l.atomId === idOf(atoms, needle) ? { ...l, entities } : l));
  const codes = (resp) => L.validateLabelling(scope, byId, { atoms: resp }).issues.map((x) => x.code);

  // Span copied from a different atom.
  assert.deepEqual(codes(swap('Fish Market', [ent('Fish Market', 'Arrive at the Lighthouse', 'ITINERARY_STOP')])), ['SPAN_NOT_IN_ATOM']);
  // Name not in the source wording (translated/expanded or invented).
  assert.deepEqual(codes(swap('Fish Market', [ent('Central Fish Market of the City', 'Stop 2: the Fish Market', 'ITINERARY_STOP')])), ['NAME_NOT_IN_SPAN']);
  // Case, accents, emphasis and quotes are not content.
  const z = L.atomize('Visit **"Café Été"** today.');
  const a = z.atoms[0];
  const loc = L.locateSpan(a, 'visit "cafe ete"');
  assert.ok(loc);
  assert.equal(z.atoms[0].text.slice(loc.sourceStart, loc.sourceEnd), 'Visit **"Café Été');
  // A span cannot cite an elided URL target.
  const link = L.atomize('See [the pier](https://example.org/pier-guide).').atoms[0];
  assert.equal(L.locateSpan(link, 'pier-guide'), null);
  assert.ok(L.locateSpan(link, 'the pier'));
});

test('role consistency is structural', () => {
  const { atoms, byId } = setup();
  const scope = atoms.map((a) => a.atomId);
  const set = (needle, patch) => walkResponse(atoms).atoms.map((l) => (l.atomId === idOf(atoms, needle) ? { ...l, ...patch } : l));
  const codes = (resp) => L.validateLabelling(scope, byId, { atoms: resp }).issues.map((x) => x.code);
  assert.deepEqual(codes(set('Prices are low', { entities: [ent('Prices', 'Prices are low', 'PASS_BY')] })), ['ROLE_INCONSISTENT']);
  // A stop claim must name what is visited.
  assert.deepEqual(codes(set('Harbour Road', { classification: 'ITINERARY_STOP' })), ['STOP_WITHOUT_ENTITY']);
  assert.deepEqual(codes(set('Fish Market', { entities: [] })), ['STOP_WITHOUT_ENTITY']);
  // An entity role may not exceed its atom's classification.
  assert.deepEqual(codes(set('Café One', { entities: [ent('Café One', 'lunch at Café One', 'ITINERARY_STOP')] })), ['ROLE_INCONSISTENT']);
  assert.deepEqual(codes(set('Prices are low', { transferMode: 'BUS' })), ['MALFORMED_LABEL']);
  // An unnamed option adds no membership: audit note, not a failure.
  const unnamed = L.validateLabelling(scope, byId, { atoms: set('Prices are low', { classification: 'ALTERNATIVE' }) });
  assert.equal(unnamed.valid, true);
  assert.deepEqual(unnamed.notes, [{ code: 'UNNAMED_ALTERNATIVE', atomId: idOf(atoms, 'Prices are low') }]);
  // The first (STRICT) rule rejected it.
  const strict = L.validateLabelling(scope, byId, { atoms: set('Prices are low', { classification: 'ALTERNATIVE' }) }, { consistency: 'STRICT' });
  assert.deepEqual(strict.issues.map((x) => x.code), ['ROLE_INCONSISTENT']);
});

test('bounded relabel: only rejected atoms are relabelled, then the whole result is re-validated', () => {
  const { atoms, byId } = setup();
  const scope = atoms.map((a) => a.atomId);
  const good = walkResponse(atoms).atoms;
  const fishId = idOf(atoms, 'Fish Market');
  const bad = good.map((l) => (l.atomId === fishId ? { ...l, entities: [] } : l));
  const first = L.validateLabelling(scope, byId, { atoms: bad });
  assert.deepEqual(L.relabelScope(first), [fishId]);
  const batch = L.relabelBatch(atoms, [fishId], { contextAtoms: 2 });
  assert.deepEqual(batch.atomIds, [fishId]);
  assert.ok(batch.contextAtomIds.length === 2 && !batch.contextAtomIds.includes(fishId));
  const prompt = L.buildRelabelPrompt(batch, byId, first.issues);
  assert.ok(prompt.includes(`[${fishId}] STOP_WITHOUT_ENTITY`));
  // A correct relabel makes the unit valid and equal to the clean labelling.
  const second = L.validateLabelling(batch.atomIds, byId, { atoms: good.filter((l) => l.atomId === fishId) });
  const repaired = L.applyRelabel(atoms, first, [fishId], second);
  assert.equal(repaired.valid, true);
  assert.deepEqual(L.assemble(atoms, repaired), L.assemble(atoms, L.validateLabelling(scope, byId, { atoms: good })));
  // A second invalid answer fails closed; so does a relabel that skips the atom.
  assert.equal(L.applyRelabel(atoms, first, [fishId], L.validateLabelling(batch.atomIds, byId, { atoms: bad.filter((l) => l.atomId === fishId) })).valid, false);
  assert.equal(L.applyRelabel(atoms, first, [fishId], L.validateLabelling(batch.atomIds, byId, { atoms: [] })).valid, false);
  // Unknown atoms and malformed responses are not repairable.
  assert.equal(L.relabelScope(L.validateLabelling(scope, byId, { atoms: [...good, { atomId: 'a-999', classification: 'NON_ITINERARY', entities: [] }] })), null);
  assert.equal(L.relabelScope(L.validateLabelling(scope, byId, null)), null);
});

test('7/11/12. assembly: source order, TRANSFER boundary, transfer destination opens the next segment', () => {
  const { atoms, byId } = setup();
  const v = L.validateLabelling(atoms.map((a) => a.atomId), byId, walkResponse(atoms));
  const segs = L.assemble(atoms, v);
  assert.equal(segs.length, 2);
  assert.deepEqual(segs[0].mandatory, ['Old Square', 'Town Hall', 'Fish Market']);
  assert.deepEqual(segs[1].mandatory, ['Lighthouse']);
  assert.deepEqual(segs[1].openedBy, [{ atomId: idOf(atoms, 'number 7 bus'), transferMode: 'BUS' }]);
  // The repeated destination is one member with both provenances.
  assert.equal(segs[1].members.find((m) => m.sourceName === 'Lighthouse').provenance.length, 2);
  // Order comes from atoms, not from response order.
  const reversed = L.validateLabelling(atoms.map((a) => a.atomId), byId, { atoms: [...walkResponse(atoms).atoms].reverse() });
  assert.deepEqual(L.assemble(atoms, reversed), segs);
});

test('anaphora: an entity may name a place written in an earlier atom, verified there', () => {
  const z = L.atomize('You pass the Grain Market.\nJump inside.\nRest here.');
  const byId = new Map(z.atoms.map((a) => [a.atomId, a]));
  const ids = z.atoms.map((a) => a.atomId);
  const resp = (mention) => ({
    atoms: [
      { atomId: ids[0], classification: 'PASS_BY', entities: [ent('Grain Market', 'pass the Grain Market', 'PASS_BY')] },
      { atomId: ids[1], classification: 'ITINERARY_STOP', entities: [{ ...ent('Grain Market', 'Jump inside', 'ITINERARY_STOP'), ...mention }] },
      { atomId: ids[2], classification: 'NON_ITINERARY', entities: [] },
    ],
  });
  const ok = L.validateLabelling(ids, byId, resp({ mentionAtomId: ids[0] }));
  assert.equal(ok.valid, true);
  const [seg] = L.assemble(z.atoms, ok);
  // The earlier PASS_BY mention is upgraded in place, keeping source order.
  assert.deepEqual(seg.mandatory, ['Grain Market']);
  assert.deepEqual(seg.passBy, []);
  assert.deepEqual(seg.members[0].provenance.map((p) => p.atomId), [ids[0], ids[1]]);
  const codes = (r) => L.validateLabelling(ids, byId, r).issues.map((x) => x.code);
  assert.deepEqual(codes(resp({})), ['NAME_NOT_IN_SPAN']);
  assert.deepEqual(codes(resp({ mentionAtomId: ids[2] })), ['BAD_MENTION_ATOM']);
  assert.deepEqual(codes(resp({ mentionAtomId: ids[1] })), ['BAD_MENTION_ATOM']);
  const wrong = resp({ mentionAtomId: ids[0] });
  wrong.atoms[1].entities[0].sourceName = 'Wool Market';
  assert.deepEqual(codes(wrong), ['NAME_NOT_IN_MENTION_ATOM']);
});

test('ROUTE_LEG is route provenance, never mandatory membership, and does not hold a segment open', () => {
  const text = ['Start at the Old Square.', 'Walk along Harbour Road to the Fish Market.', 'Take the tram.', 'Ride along the Coast Avenue.', 'Then take a ferry.', 'Arrive at the Island.'].join('\n');
  const z = L.atomize(text);
  const ids = z.atoms.map((a) => a.atomId);
  const v = L.validateLabelling(ids, new Map(z.atoms.map((a) => [a.atomId, a])), {
    atoms: [
      { atomId: ids[0], classification: 'ITINERARY_STOP', entities: [ent('Old Square', 'Start at the Old Square', 'ITINERARY_STOP')] },
      { atomId: ids[1], classification: 'ITINERARY_STOP', entities: [ent('Harbour Road', 'Walk along Harbour Road', 'ROUTE_LEG'), ent('Fish Market', 'to the Fish Market', 'ITINERARY_STOP')] },
      { atomId: ids[2], classification: 'TRANSFER', entities: [], transferMode: 'TRAM' },
      { atomId: ids[3], classification: 'ROUTE_LEG', entities: [ent('Coast Avenue', 'Ride along the Coast Avenue', 'ROUTE_LEG')] },
      { atomId: ids[4], classification: 'TRANSFER', entities: [], transferMode: 'FERRY' },
      { atomId: ids[5], classification: 'ITINERARY_STOP', entities: [ent('Island', 'Arrive at the Island', 'ITINERARY_STOP')] },
    ],
  });
  assert.equal(v.valid, true);
  const segs = L.assemble(z.atoms, v);
  // A route-leg-only stretch between two transfers is not an empty segment.
  assert.deepEqual(segs.map((s) => s.mandatory), [['Old Square', 'Fish Market'], ['Island']]);
  assert.deepEqual(segs.map((s) => s.routeLegs), [['Harbour Road'], ['Coast Avenue']]);
  assert.deepEqual(segs[1].openedBy.map((o) => o.transferMode), ['TRAM', 'FERRY']);
  // A ROUTE_LEG entity cannot sit in a weaker-classified atom.
  const bad = L.validateLabelling([ids[3]], new Map(z.atoms.map((a) => [a.atomId, a])), {
    atoms: [{ atomId: ids[3], classification: 'PASS_BY', entities: [ent('Coast Avenue', 'Ride along the Coast Avenue', 'ROUTE_LEG')] }],
  });
  assert.deepEqual(bad.issues.map((x) => x.code), ['ROLE_INCONSISTENT']);
});

test('ROLE_CONFLICT: ROUTE_LEG and ITINERARY_STOP for one name stays mandatory and is made visible', () => {
  const text = ['Go to Long Street.', 'Visit the Fort.', 'Walk back along Long Street.', 'You pass the Mill.', 'Jump inside.'].join('\n');
  const z = L.atomize(text);
  const ids = z.atoms.map((a) => a.atomId);
  const v = L.validateLabelling(ids, new Map(z.atoms.map((a) => [a.atomId, a])), {
    atoms: [
      { atomId: ids[0], classification: 'ITINERARY_STOP', entities: [ent('Long Street', 'Go to Long Street', 'ITINERARY_STOP')] },
      { atomId: ids[1], classification: 'ITINERARY_STOP', entities: [ent('Fort', 'Visit the Fort', 'ITINERARY_STOP')] },
      { atomId: ids[2], classification: 'ROUTE_LEG', entities: [ent('Long Street', 'along Long Street', 'ROUTE_LEG')] },
      { atomId: ids[3], classification: 'PASS_BY', entities: [ent('Mill', 'pass the Mill', 'PASS_BY')] },
      { atomId: ids[4], classification: 'ITINERARY_STOP', entities: [{ ...ent('Mill', 'Jump inside', 'ITINERARY_STOP'), mentionAtomId: ids[3] }] },
    ],
  });
  const [seg] = L.assemble(z.atoms, v);
  assert.deepEqual(seg.mandatory, ['Long Street', 'Fort', 'Mill']);
  // Anaphoric PASS_BY -> ITINERARY_STOP is not a conflict.
  assert.deepEqual(seg.conflicts, [{ code: 'ROLE_CONFLICT', sourceName: 'Long Street', routeLegAtoms: [ids[2]], stopAtoms: [ids[0]] }]);
});

test('v5 R1: a TRANSFER entity is TRANSFER_DESTINATION provenance; a later stop label still counts', () => {
  const text = ['Visit the Fort.', 'Take the bus to the Harbour District.', 'Take a taxi to the Lighthouse.', 'Arrive at the Lighthouse.'].join('\n');
  const z = L.atomize(text);
  const ids = z.atoms.map((a) => a.atomId);
  const v = L.validateLabelling(ids, new Map(z.atoms.map((a) => [a.atomId, a])), {
    atoms: [
      { atomId: ids[0], classification: 'ITINERARY_STOP', entities: [ent('Fort', 'Visit the Fort', 'ITINERARY_STOP')] },
      { atomId: ids[1], classification: 'TRANSFER', entities: [ent('Harbour District', 'bus to the Harbour District', 'ITINERARY_STOP')], transferMode: 'BUS' },
      { atomId: ids[2], classification: 'TRANSFER', entities: [ent('Lighthouse', 'taxi to the Lighthouse', 'ROUTE_LEG')], transferMode: 'TAXI' },
      { atomId: ids[3], classification: 'ITINERARY_STOP', entities: [ent('Lighthouse', 'Arrive at the Lighthouse', 'ITINERARY_STOP')] },
    ],
  }, { consistency: 'ENTITY_ROLES' });
  assert.equal(v.valid, true);
  assert.deepEqual(v.labels.get(ids[1]).entities.map((e) => [e.role, e.modelRole]), [['TRANSFER_DESTINATION', 'ITINERARY_STOP']]);
  const segs = L.assemble(z.atoms, v);
  assert.deepEqual(segs.map((s) => s.mandatory), [['Fort'], ['Lighthouse']]);
  assert.deepEqual(segs[1].transferDestinations.map((d) => d.sourceName), ['Harbour District', 'Lighthouse']);
  assert.ok(!segs.some((s) => s.mandatory.includes('Harbour District')));
  // A destination is never a party to ROLE_CONFLICT.
  assert.deepEqual(segs[1].conflicts, []);
});

test('v5 R2: entity roles are the role authority; the stop-without-entity signal stays fail-closed', () => {
  const z = L.atomize(['Walk down Mill Street to reach the Painted Lane.', 'Make a stop at the city museum.', 'It is free.'].join('\n'));
  const ids = z.atoms.map((a) => a.atomId);
  const byId = new Map(z.atoms.map((a) => [a.atomId, a]));
  const resp = (museumEntities) => ({
    atoms: [
      { atomId: ids[0], classification: 'ROUTE_LEG', entities: [ent('Mill Street', 'Walk down Mill Street', 'ROUTE_LEG'), ent('Painted Lane', 'reach the Painted Lane', 'ITINERARY_STOP')] },
      { atomId: ids[1], classification: 'ITINERARY_STOP', entities: museumEntities },
      { atomId: ids[2], classification: 'NON_ITINERARY', entities: [] },
    ],
  });
  // Under MEMBERSHIP the duplicated role authority rejects a correct labelling.
  assert.deepEqual(L.validateLabelling(ids, byId, resp([ent('city museum', 'stop at the city museum', 'ITINERARY_STOP')])).issues.map((x) => x.code), ['ROLE_INCONSISTENT']);
  const ok = L.validateLabelling(ids, byId, resp([ent('city museum', 'stop at the city museum', 'ITINERARY_STOP')]), { consistency: 'ENTITY_ROLES' });
  assert.equal(ok.valid, true);
  assert.equal(ok.labels.get(ids[0]).kind, 'CONTENT');
  assert.deepEqual(L.assemble(z.atoms, ok)[0].mandatory, ['Painted Lane', 'city museum']);
  assert.deepEqual(L.assemble(z.atoms, ok)[0].routeLegs, ['Mill Street']);
  // The museum signal: a stop claim without a stop entity fails closed.
  assert.deepEqual(L.validateLabelling(ids, byId, resp([]), { consistency: 'ENTITY_ROLES' }).issues.map((x) => x.code), ['STOP_WITHOUT_ENTITY']);
  // A NON_ITINERARY atom still may not carry entities.
  const bad = resp([ent('city museum', 'stop at the city museum', 'ITINERARY_STOP')]);
  bad.atoms[2].entities = [ent('free', 'It is free', 'PASS_BY')];
  assert.deepEqual(L.validateLabelling(ids, byId, bad, { consistency: 'ENTITY_ROLES' }).issues.map((x) => x.code), ['ROLE_INCONSISTENT']);
});

test('a corridor that is itself the experience stays mandatory when labelled ITINERARY_STOP', () => {
  const z = L.atomize('Walk the whole Painted Lane, the most famous pedestrian street of the port.');
  const v = L.validateLabelling(['a-001'], new Map(z.atoms.map((a) => [a.atomId, a])), {
    atoms: [{ atomId: 'a-001', classification: 'ITINERARY_STOP', entities: [ent('Painted Lane', 'Walk the whole Painted Lane', 'ITINERARY_STOP')] }],
  });
  const [seg] = L.assemble(z.atoms, v);
  assert.deepEqual(seg.mandatory, ['Painted Lane']);
  assert.deepEqual(seg.routeLegs, []);
});

test('8. one atom may carry several entities with distinct roles', () => {
  const z = L.atomize('Visit the Old Mill, then walk down Long Lane to the Clock Tower.');
  const byId = new Map(z.atoms.map((a) => [a.atomId, a]));
  const v = L.validateLabelling(['a-001'], byId, {
    atoms: [
      {
        atomId: 'a-001',
        classification: 'ITINERARY_STOP',
        entities: [ent('Old Mill', 'Visit the Old Mill', 'ITINERARY_STOP'), ent('Long Lane', 'walk down Long Lane', 'PASS_BY'), ent('Clock Tower', 'to the Clock Tower', 'ITINERARY_STOP')],
      },
    ],
  });
  assert.equal(v.valid, true);
  const [seg] = L.assemble(z.atoms, v);
  assert.deepEqual(seg.mandatory, ['Old Mill', 'Clock Tower']);
  assert.deepEqual(seg.passBy, ['Long Lane']);
});

test('9/10. alternatives stay a choice group, optional and pass-by are never mandatory', () => {
  const { atoms, byId } = setup();
  const [first, second] = L.assemble(atoms, L.validateLabelling(atoms.map((a) => a.atomId), byId, walkResponse(atoms)));
  assert.deepEqual(first.alternativeGroups, [['Café One', 'Café Two']]);
  assert.ok(!first.mandatory.includes('Café One') && !first.mandatory.includes('Café Two'));
  assert.deepEqual(first.passBy, ['Harbour Road', 'Mill Street']);
  assert.deepEqual(second.optional, ['Shell Museum']);
  assert.ok(!second.mandatory.includes('Shell Museum'));

  // Alternatives across consecutive atoms (entity-less atoms between them)
  // are one group; a stop between them starts a new group.
  const text = 'For lunch try Alpha Grill.\nIt is cheap.\nOr try Beta Bistro.\nVisit the Fort.\nOr try Gamma Bar.';
  const z = L.atomize(text);
  const ids = z.atoms.map((a) => a.atomId);
  const v = L.validateLabelling(ids, new Map(z.atoms.map((a) => [a.atomId, a])), {
    atoms: [
      { atomId: ids[0], classification: 'ALTERNATIVE', entities: [ent('Alpha Grill', 'try Alpha Grill', 'ALTERNATIVE')] },
      { atomId: ids[1], classification: 'NON_ITINERARY', entities: [] },
      { atomId: ids[2], classification: 'ALTERNATIVE', entities: [ent('Beta Bistro', 'try Beta Bistro', 'ALTERNATIVE')] },
      { atomId: ids[3], classification: 'ITINERARY_STOP', entities: [ent('Fort', 'Visit the Fort', 'ITINERARY_STOP')] },
      { atomId: ids[4], classification: 'ALTERNATIVE', entities: [ent('Gamma Bar', 'try Gamma Bar', 'ALTERNATIVE')] },
    ],
  });
  const [seg] = L.assemble(z.atoms, v);
  assert.deepEqual(seg.alternativeGroups, [['Alpha Grill', 'Beta Bistro'], ['Gamma Bar']]);
  assert.deepEqual(seg.mandatory, ['Fort']);
});

test('11. adjacent TRANSFER atoms are one boundary; a transfer before any stop opens nothing', () => {
  const text = ['Take the tram to the centre.', 'Visit the Old Bridge.', 'Next: go to the Zoo.', 'Take a taxi there.', 'See the Zoo.', 'Then take a ferry.', 'Arrive at the Island.'].join('\n');
  const z = L.atomize(text);
  const ids = z.atoms.map((a) => a.atomId);
  const v = L.validateLabelling(ids, new Map(z.atoms.map((a) => [a.atomId, a])), {
    atoms: [
      { atomId: ids[0], classification: 'TRANSFER', entities: [], transferMode: 'TRAM' },
      { atomId: ids[1], classification: 'ITINERARY_STOP', entities: [ent('Old Bridge', 'Visit the Old Bridge', 'ITINERARY_STOP')] },
      { atomId: ids[2], classification: 'TRANSFER', entities: [ent('Zoo', 'go to the Zoo', 'ITINERARY_STOP')] },
      { atomId: ids[3], classification: 'TRANSFER', entities: [], transferMode: 'TAXI' },
      { atomId: ids[4], classification: 'ITINERARY_STOP', entities: [ent('Zoo', 'See the Zoo', 'ITINERARY_STOP')] },
      { atomId: ids[5], classification: 'TRANSFER', entities: [], transferMode: 'FERRY' },
      { atomId: ids[6], classification: 'ITINERARY_STOP', entities: [ent('Island', 'Arrive at the Island', 'ITINERARY_STOP')] },
    ],
  });
  const segs = L.assemble(z.atoms, v);
  assert.deepEqual(segs.map((s) => s.mandatory), [['Old Bridge'], ['Zoo'], ['Island']]);
  assert.deepEqual(segs[0].openedBy.map((o) => o.transferMode), ['TRAM']);
  assert.deepEqual(segs[1].openedBy.map((o) => o.transferMode), ['UNSPECIFIED', 'TAXI']);
  assert.deepEqual(segs[2].openedBy.map((o) => o.transferMode), ['FERRY']);
});

test('13. batching labels every global atom ID exactly once', () => {
  for (const text of [WALK, ...frozen]) {
    const { atoms } = L.atomize(text);
    const batches = L.planBatches(atoms, { maxBatchChars: 1500, contextAtoms: 3 });
    assert.ok(batches.length > 1 || text.length < 1500);
    assert.deepEqual(batches.flatMap((b) => b.atomIds), atoms.map((a) => a.atomId));
    for (const b of batches) assert.ok(b.contextAtomIds.every((id) => !b.atomIds.includes(id)));
  }
  const { atoms, byId } = setup();
  const batches = L.planBatches(atoms, { maxBatchChars: 120, contextAtoms: 2 });
  assert.ok(batches.length >= 3);
  const resp = walkResponse(atoms).atoms;
  const forBatch = (b) => ({ atoms: resp.filter((l) => b.atomIds.includes(l.atomId)) });
  const ok = L.mergeBatches(atoms, batches.map((b) => L.validateLabelling(b.atomIds, byId, forBatch(b))));
  assert.equal(ok.valid, true);
  assert.deepEqual(L.assemble(atoms, ok), L.assemble(atoms, L.validateLabelling(atoms.map((a) => a.atomId), byId, walkResponse(atoms))));
  // A batch that also labels its read-only context atoms is rejected.
  const leaky = batches.map((b) => L.validateLabelling(b.atomIds, byId, { atoms: resp.filter((l) => b.atomIds.includes(l.atomId) || b.contextAtomIds.includes(l.atomId)) }));
  assert.ok(leaky.slice(1).some((r) => r.issues.some((x) => x.code === 'UNKNOWN_ATOM')));
  assert.equal(L.mergeBatches(atoms, leaky).valid, false);
  // A dropped batch leaves global atom IDs unlabelled.
  const dropped = L.mergeBatches(atoms, batches.slice(1).map((b) => L.validateLabelling(b.atomIds, byId, forBatch(b))));
  assert.equal(dropped.valid, false);
  assert.ok(dropped.issues.some((x) => x.code === 'MISSING_ATOM'));
});

test('the prompt lists every atom of a batch exactly once and never a context atom as LABEL', () => {
  const { atoms, byId } = setup();
  const [b1, b2] = L.planBatches(atoms, { maxBatchChars: 150, contextAtoms: 2 });
  const prompt = L.buildPrompt(b2, byId);
  const labelPart = prompt.split('\nLABEL:\n')[1];
  for (const id of b2.atomIds) assert.equal(labelPart.split(`[${id}]`).length - 1, 1);
  for (const id of b2.contextAtomIds) assert.ok(!labelPart.includes(`[${id}]`));
  assert.ok(b1.atomIds.length > 0);
});
