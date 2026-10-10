// RW4-EXTRACT-COMPLETENESS-1, Part C probe: exhaustive atom labelling.
//
// Hypothesis: the defect is that an LLM asked to LIST stops can omit one
// silently. If the unit is atomized deterministically and the LLM must label
// EVERY atom, then (a) a missing label is a deterministic failure, (b) an
// omitted stop becomes an explicit, recorded claim ("atom A41 is not a
// stop"), and (c) order and segmentation are assembled deterministically
// from atom order and TRANSFER atoms instead of being re-stated by the model.
// Spike only: real provider transport (`completeStructured`), no production
// change, scored against the frozen oracle.
//
//   EXTRACTOR=gemini RUNS=3 INPUTS=SOB_UNIT,AG_UNIT LABEL=atoms \
//     node spikes/rw4-extract-completeness-2026-10-05/atom-probe.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const DIST = path.resolve(HERE, '../../be/dist/src');
process.env.DISCOVERY_EXTRACTOR_PROVIDER = process.env.EXTRACTOR || 'gemini';
process.env.AI_CACHE_MODE = 'off';
const aiConfig = require(`${DIST}/shared/ai/ai.config`).default;
const { GeminiDiscoveryProvider } = require(`${DIST}/modules/tours/services/gemini-discovery.provider`);
const { CloudflareDiscoveryProvider } = require(`${DIST}/modules/tours/services/cloudflare-discovery.provider`);

const oracle = JSON.parse(fs.readFileSync(path.join(HERE, 'oracle.json'), 'utf8'));
const UNITS = { SOB_UNIT: 'secretsofbuenosaires-day1', AG_UNIT: 'agusyornet-san-telmo' };
const unitText = (id) => {
  const src = oracle.sources[id];
  const [start, end] = src.unit.match(/(\d+)–(\d+)/).slice(1).map(Number);
  return fs.readFileSync(path.join(HERE, src.fixture), 'utf8').slice(start, end);
};

// Deterministic atomization: drop images and link targets, split table
// cells and lines, then sentences. No semantic decision is made here.
function atomize(text) {
  const clean = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\\\*/g, '*');
  const atoms = [];
  for (const line of clean.split(/\n|\s\|\s|\|/)) {
    for (const sentence of line.split(/(?<=[.!?])\s+(?=[A-Z¡¿"“*(🌭🍦☕🥩-])/u)) {
      const t = sentence.replace(/\s+/g, ' ').trim();
      if (/\p{L}{3}/u.test(t) && !/^-+$/.test(t)) atoms.push(t);
    }
  }
  return atoms.map((t, i) => ({ id: `A${i + 1}`, text: t }));
}

const SYSTEM = 'You label every numbered atom of one travel source text. You never skip an atom and never invent places.';
function userPrompt(atoms) {
  return [
    'The source below is split into numbered atoms (sentences, lines or table cells), in source order. Return exactly one label for EVERY atom id, in order, from the first to the last; an answer that skips any atom is rejected. The atom field is the bare id, e.g. "A12".',
    'kind is one of:',
    '- STOP: the atom directs the traveller to visit, stop at, enter, start at or go and see a specific named real place that belongs to the itinerary (including a numbered stop). List each such place in stops with its name as written and a span copied VERBATIM from the atom.',
    '- TRANSFER: the atom tells the traveller to take motorized transport (bus, taxi, train, ferry, car) to the next place of the itinerary.',
    '- OTHER: everything else. reason is PASSING (a street walked or crossed, a building seen on the way, a place mentioned in passing), ALTERNATIVE (one of several options, "A or B", "if you are hungry", a food or drink recommendation), CONTEXT (history, description, tips) or NOT_ITINERARY (navigation, ads, author, links).',
    'A place the source numbers as a stop or directs the traveller to visit is a STOP even when food is also mentioned. An atom that only describes a stop already labelled is OTHER/CONTEXT.',
    '',
    ...atoms.map((a) => `[${a.id}] ${a.text}`),
  ].join('\n');
}
const SCHEMA = {
  type: 'object',
  properties: {
    labels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          atom: { type: 'string' },
          kind: { type: 'string', enum: ['STOP', 'TRANSFER', 'OTHER'] },
          reason: { type: 'string', enum: ['PASSING', 'ALTERNATIVE', 'CONTEXT', 'NOT_ITINERARY'] },
          stops: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, span: { type: 'string' } }, required: ['name', 'span'] } },
        },
        required: ['atom', 'kind'],
      },
    },
  },
  required: ['labels'],
};

const MATCH = process.env.MATCH || 'STRICT';
const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const bare = (s) => fold(s).replace(/^(the|el|la|los|las) /, '');
const matches = (item, label) => !!label && [item.name, ...(item.aliases ?? [])].some((n) => bare(n) === bare(label));

// Deterministic checks + assembly.
function assemble(atoms, labels) {
  const byId = new Map();
  const problems = [];
  for (const l of labels) {
    // Canonicalize the atom id only ("[A12]", "A12 text" -> "A12").
    l.atom = String(l.atom).match(/\bA\d+\b/)?.[0] ?? String(l.atom);
    if (byId.has(l.atom)) problems.push(`DUPLICATE_LABEL:${l.atom}`);
    byId.set(l.atom, l);
  }
  const unlabelled = atoms.filter((a) => !byId.has(a.id)).map((a) => a.id);
  const segments = [[]];
  for (const a of atoms) {
    const l = byId.get(a.id);
    if (!l) continue;
    if (l.kind === 'TRANSFER') {
      if (segments.at(-1).length) segments.push([]);
      continue;
    }
    if (l.kind !== 'STOP') continue;
    if (!l.stops?.length) problems.push(`STOP_WITHOUT_PLACE:${a.id}`);
    for (const s of l.stops ?? []) {
      if (!fold(a.text).includes(fold(s.span))) problems.push(`SPAN_NOT_IN_ATOM:${a.id}:${s.name}`);
      else if (!segments.at(-1).some((x) => bare(x.name) === bare(s.name))) segments.at(-1).push({ name: s.name, span: s.span, atom: a.id });
    }
  }
  return { unlabelled, problems, segments: segments.filter((s) => s.length) };
}

function score(sourceId, segments) {
  const oSegs = oracle.sources[sourceId].segments;
  const items = oSegs.flatMap((seg) => seg.orderGroups.flatMap((g, gi) => g.map((item) => ({ ...item, segment: seg.id, group: gi }))));
  // Strict: the emitted name equals the oracle name/alias. SPAN: the probe
  // keeps literal source wording (canonical naming is the resolver's job),
  // so a stop whose verbatim span lies inside an oracle item's frozen span
  // also matches that item. The oracle itself is never changed.
  const bySpan = (s) => items.find((i) => fold(i.span).includes(fold(s.span)) && fold(s.span).length >= 4 && fold(i.span).includes(fold(s.name)));
  const emitted = segments.map((seg) => seg.map((s) => ({ ...s, item: items.find((i) => matches(i, s.name)) ?? (MATCH === 'SPAN' ? bySpan(s) : undefined) })));
  return oSegs.map((seg) => {
    const owner = emitted.find((e) => e.filter((s) => s.item?.segment === seg.id).length > 0 && e.filter((s) => s.item?.segment === seg.id).length >= e.filter((s) => s.item && s.item.segment !== seg.id).length);
    const mandatory = items.filter((i) => i.segment === seg.id && i.role === 'MANDATORY');
    if (!owner) return { segment: seg.id, success: false, mandatoryRecall: `0/${mandatory.length}`, reasons: ['SEGMENT_NOT_EMITTED'] };
    const present = mandatory.filter((m) => owner.some((s) => s.item === m));
    // Ordering is asserted on MANDATORY stops (the brief's criterion).
    const groups = owner.filter((s) => s.item?.segment === seg.id && s.item.role === 'MANDATORY').map((s) => s.item.group);
    const reasons = [];
    const missing = mandatory.filter((m) => !present.includes(m)).map((m) => m.name);
    if (missing.length) reasons.push(`MISSING_MANDATORY:${missing.join('|')}`);
    if (!groups.every((g, i) => i === 0 || g >= groups[i - 1])) reasons.push('ORDER_VIOLATED');
    const mixed = owner.filter((s) => s.item && s.item.segment !== seg.id && s.item.role === 'MANDATORY').map((s) => s.name);
    if (mixed.length) reasons.push(`SEGMENT_MIXED:${mixed.join('|')}`);
    const alts = owner.filter((s) => s.item?.role === 'ALTERNATIVE').map((s) => s.name);
    if (alts.length) reasons.push(`ALTERNATIVE_FLATTENED:${alts.join('|')}`);
    const unknown = owner.filter((s) => !s.item).map((s) => s.name);
    return { segment: seg.id, success: reasons.length === 0, mandatoryRecall: `${present.length}/${mandatory.length}`, reasons, passBy: owner.filter((s) => s.item?.role === 'ACCEPTABLE').map((s) => s.name), notInOracle: unknown };
  });
}

async function main() {
  const config = aiConfig();
  const provider = process.env.DISCOVERY_EXTRACTOR_PROVIDER === 'cloudflare' ? new CloudflareDiscoveryProvider(config) : new GeminiDiscoveryProvider(config);
  const runs = Number(process.env.RUNS || 3);
  const label = process.env.LABEL || 'atoms';
  const outDir = path.join(HERE, 'replays', `${label}-${process.env.DISCOVERY_EXTRACTOR_PROVIDER}`);
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];
  const resultsFile = path.join(outDir, MATCH === 'SPAN' ? 'results.span.json' : 'results.json');
  for (const input of (process.env.INPUTS || 'SOB_UNIT,AG_UNIT').split(',')) {
    const sourceId = UNITS[input];
    const atoms = atomize(unitText(sourceId));
    fs.writeFileSync(path.join(outDir, `${input}.atoms.json`), JSON.stringify(atoms, null, 2) + '\n');
    for (let r = 1; r <= runs; r++) {
      let raw = '';
      let row;
      try {
        // RESCORE=1 re-scores the saved raw output without a provider call.
        raw = process.env.RESCORE
          ? fs.readFileSync(path.join(outDir, `${input}-${r}.raw.txt`), 'utf8')
          : await provider.completeStructured({ system: SYSTEM, user: userPrompt(atoms), jsonSchema: SCHEMA });
        const labels = JSON.parse(raw).labels ?? [];
        const a = assemble(atoms, labels);
        row = { input, run: r, validity: 'VALID', atoms: atoms.length, labelled: labels.length, unlabelled: a.unlabelled, problems: a.problems, segments: a.segments.map((s) => s.map((x) => `${x.name}@${x.atom}`)), verdicts: score(sourceId, a.segments) };
      } catch (e) {
        row = { input, run: r, validity: /429|5\d\d|Timeout|fetch failed|truncated/i.test(String(e.message)) ? 'INVALID_RUN' : 'VALID', error: String(e.message).slice(0, 300) };
      }
      fs.writeFileSync(path.join(outDir, `${input}-${r}.raw.txt`), raw);
      results.push(row);
      console.log(JSON.stringify({ input, run: r, validity: row.validity, error: row.error, atoms: row.atoms, labelled: row.labelled, unlabelled: row.unlabelled?.length, problems: row.problems?.length, verdicts: row.verdicts?.map((v) => `${v.segment}:${v.mandatoryRecall}${v.success ? ' OK' : ' ' + v.reasons.join(',')}`) }));
    }
  }
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2) + '\n');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
