// Oracle scoring for the atom-labelling spike. Evaluation only: nothing
// here feeds back into atomization, labelling, validation or assembly.
'use strict';
const fs = require('fs');
const path = require('path');
const { fold, present } = require('./atom-labelling.cjs');
const { oracle } = require('./units.cjs');

const aliases = JSON.parse(fs.readFileSync(path.join(__dirname, 'scoring-aliases.json'), 'utf8')).sources;
const gate = JSON.parse(fs.readFileSync(path.join(__dirname, 'milestone-a-gate.json'), 'utf8'));
const bare = (s) => fold(s).replace(/^(the|el|la|los|las) /u, '');

function oracleItems(sourceId) {
  return oracle.sources[sourceId].segments.flatMap((seg, si) =>
    seg.orderGroups.flatMap((g, gi) =>
      g.map((item) => ({
        ...item,
        segment: seg.id,
        segmentOrdinal: si,
        group: gi,
        wordings: [item.name, ...(item.aliases ?? []), ...(aliases[sourceId]?.[item.name] ?? [])],
      })),
    ),
  );
}

const matchItem = (items, name) => items.find((i) => i.wordings.some((w) => bare(w) === bare(name)));

// Every atom whose presented text contains one of the item's wordings, with
// the decision the labelling recorded for it.
function atomDecisions(item, atoms, labels) {
  return atoms
    .filter((a) => item.wordings.some((w) => fold(present(a.text).text).includes(fold(w))))
    .map((a) => {
      const l = labels.get(a.atomId);
      const e = l?.entities.find((x) => item.wordings.some((w) => bare(w) === bare(x.sourceName)));
      return { atomId: a.atomId, classification: l?.classification ?? 'UNLABELLED', entityRole: e?.role ?? null };
    });
}

function scoreSource(sourceId, segments, atoms, labels) {
  const items = oracleItems(sourceId);
  const oSegs = oracle.sources[sourceId].segments;
  const assembled = segments.map((s) => ({
    ...s,
    mandatoryItems: s.mandatory.map((name) => ({ name, item: matchItem(items, name) })),
  }));
  const owners = oSegs.map((seg) => {
    let best = null;
    let bestCount = 0;
    for (const s of assembled) {
      const n = s.mandatoryItems.filter((m) => m.item?.segment === seg.id && m.item.role === 'MANDATORY').length;
      if (n > bestCount) (best = s), (bestCount = n);
    }
    return best;
  });
  const verdicts = oSegs.map((seg, si) => {
    const mandatory = items.filter((i) => i.segment === seg.id && i.role === 'MANDATORY');
    const owner = owners[si];
    const reasons = [];
    const present_ = owner ? mandatory.filter((m) => owner.mandatoryItems.some((x) => x.item === m)) : [];
    const missing = mandatory.filter((m) => !present_.includes(m));
    if (!owner) reasons.push('SEGMENT_NOT_EMITTED');
    if (missing.length) reasons.push(`MISSING_MANDATORY:${missing.map((m) => m.name).join('|')}`);
    if (owner) {
      const groups = owner.mandatoryItems.filter((x) => x.item?.segment === seg.id && x.item.role === 'MANDATORY').map((x) => x.item.group);
      if (!groups.every((g, i) => i === 0 || g >= groups[i - 1])) reasons.push('ORDER_VIOLATED');
      const mixed = owner.mandatoryItems.filter((x) => x.item && x.item.segment !== seg.id && x.item.role === 'MANDATORY').map((x) => x.name);
      if (mixed.length) reasons.push(`SEGMENT_MIXED:${mixed.join('|')}`);
      if (si > 0 && owners[si - 1] === owner) reasons.push('TRANSFER_BOUNDARY_MISSED');
      const alts = owner.mandatoryItems.filter((x) => x.item?.role === 'ALTERNATIVE').map((x) => x.name);
      if (alts.length) reasons.push(`ALTERNATIVE_PROMOTED:${alts.join('|')}`);
    }
    return {
      segment: seg.id,
      assembledSegment: owner?.segmentIndex ?? null,
      success: reasons.length === 0,
      mandatoryRecall: `${present_.length}/${mandatory.length}`,
      reasons,
      acceptablePromoted: owner ? owner.mandatoryItems.filter((x) => x.item?.role === 'ACCEPTABLE').map((x) => x.name) : [],
      notInOracleMandatory: owner ? owner.mandatoryItems.filter((x) => !x.item).map((x) => x.name) : [],
      missingAtomDecisions: Object.fromEntries(missing.map((m) => [m.name, atomDecisions(m, atoms, labels)])),
    };
  });
  // Unit-wide role preservation of oracle ALTERNATIVE items.
  const roleOf = (item) => {
    for (const s of segments) for (const m of s.members) if (item.wordings.some((w) => bare(w) === bare(m.sourceName))) return m.role;
    return null;
  };
  const alternatives = items.filter((i) => i.role === 'ALTERNATIVE').map((i) => ({ name: i.name, emittedRole: roleOf(i) }));
  const mandatoryDecisions = Object.fromEntries(items.filter((i) => i.role === 'MANDATORY').map((i) => [i.name, atomDecisions(i, atoms, labels)]));
  // Route/area promotion (milestone A gate): frozen route/area items found
  // in any segment's mandatory list.
  const routeAreaItems = (gate.routeOrAreaItems[sourceId] ?? []).map((name) => {
    const item = items.find((i) => i.name === name);
    return { name, wordings: item ? item.wordings : [name, ...(gate.extraWordings[name] ?? [])] };
  });
  const mandatoryNames = segments.flatMap((s) => s.mandatory);
  const routeAreaPromoted = routeAreaItems.filter((ri) => mandatoryNames.some((n) => ri.wordings.some((w) => bare(w) === bare(n)))).map((ri) => ri.name);
  const routeLegRoles = Object.fromEntries(routeAreaItems.map((ri) => [ri.name, roleOf(ri)]));
  return { verdicts, alternatives, mandatoryDecisions, routeAreaPromoted, routeLegRoles };
}

// Regression fixtures (RW3 route-as-experience): expected mandatory present,
// forbidden names not mandatory, expected route legs.
function scoreRegression(input, segments) {
  const spec = gate.regressionFixtures[input];
  const has = (group, list) => list.some((n) => group.some((w) => bare(w) === bare(n)));
  const mandatory = segments.flatMap((s) => s.mandatory);
  const routeLegs = segments.flatMap((s) => s.routeLegs ?? []);
  const missing = spec.mandatory.filter((g) => !has(g, mandatory)).map((g) => g[0]);
  const forbidden = spec.mustNotBeMandatory.filter((g) => has(g, mandatory)).map((g) => g[0]);
  const routeLegMissing = (spec.expectedRouteLeg ?? []).filter((g) => !has(g, routeLegs)).map((g) => g[0]);
  const reasons = [...missing.map((m) => `MISSING_MANDATORY:${m}`), ...forbidden.map((f) => `PROMOTED:${f}`)];
  return {
    verdicts: [{ segment: 'ALL', success: reasons.length === 0, mandatoryRecall: `${spec.mandatory.length - missing.length}/${spec.mandatory.length}`, reasons, acceptablePromoted: [], notInOracleMandatory: [], missingAtomDecisions: {} }],
    alternatives: [],
    mandatoryDecisions: {},
    routeAreaPromoted: forbidden,
    routeLegMissing,
  };
}

module.exports = { scoreSource, scoreRegression, oracleItems };
