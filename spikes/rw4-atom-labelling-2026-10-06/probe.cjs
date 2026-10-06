// Live probe: exhaustive atom labelling on the frozen RW4 editorial units,
// through the REAL discovery extractor transport (`completeStructured` from
// be/dist), scored against the frozen oracle. Spike only; production code
// is not touched.
//
//   cd be && yarn build && cd ..
//   set -a; . ./.env; set +a
//   EXTRACTOR=gemini RUNS=3 INPUTS=SOB_UNIT,AG_UNIT LABEL=single \
//     node spikes/rw4-atom-labelling-2026-10-06/probe.cjs
//
// Runs `labelUnit` (editorial structure -> batches -> validation ->
// anaphora -> one relabel -> assembly) and writes the per-unit trace.
// MAX_BATCH_CHARS (default 2500), NAV_MIN_RUN (default 3),
// CONSISTENCY (default ENTITY_ROLES, contract v5), RELABEL=1 for the one
// bounded relabel round. RESCORE=1 re-validates saved raw output of a run
// recorded under the SAME settings at HEAD; batches recorded before the
// A.1 editorial structure are replayed by replay-recorded.cjs instead.
// Per-call timing is recorded in <input>-<run>.wire.json.
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./atom-labelling.cjs');
const { unitText, SOURCES, REGRESSION } = require('./units.cjs');
const { scoreSource, scoreRegression } = require('./score.cjs');

const HERE = __dirname;
const DIST = path.resolve(HERE, '../../be/dist/src');
process.env.DISCOVERY_EXTRACTOR_PROVIDER = process.env.EXTRACTOR || 'gemini';
process.env.AI_CACHE_MODE = 'off';

// Wire capture (spike only): status, usage, finish reason.
const wire = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const entry = { url: String(url).replace(/([?&]key=)[^&]+/, '$1<redacted>').replace(/accounts\/[^/]+/, 'accounts/<id>') };
  wire.push(entry);
  const resp = await realFetch(url, init);
  entry.status = resp.status;
  try {
    const data = await resp.clone().json();
    entry.usage = data.usage ?? data.usageMetadata ?? null;
    entry.status_ = data.status ?? data.choices?.[0]?.finish_reason ?? null;
  } catch {}
  return resp;
};

const isTransportFailure = (msg) => /\b(429|5\d\d)\b|Timeout|AbortError|fetch failed|ECONN|ETIMEDOUT|truncat/i.test(msg);

function provider() {
  const config = require(`${DIST}/shared/ai/ai.config`).default();
  const name = process.env.DISCOVERY_EXTRACTOR_PROVIDER;
  if (name === 'cloudflare') return new (require(`${DIST}/modules/tours/services/cloudflare-discovery.provider`).CloudflareDiscoveryProvider)(config);
  if (name === 'gemini') return new (require(`${DIST}/modules/tours/services/gemini-discovery.provider`).GeminiDiscoveryProvider)(config);
  throw new Error(`unsupported EXTRACTOR ${name}`);
}

// Diagnostic only: what assembly would produce from the labels that did
// validate. Never the pipeline outcome of an invalid run (fail closed).
function shadowAssemble(atoms, validation) {
  const labels = new Map();
  for (const a of atoms) {
    const l = validation.labels.get(a.atomId);
    if (l && !validation.issues.some((x) => x.atomId === a.atomId)) labels.set(a.atomId, l);
    else labels.set(a.atomId, { atomId: a.atomId, classification: 'NON_ITINERARY', entities: [] });
  }
  return L.assemble(atoms, { valid: true, issues: [], labels });
}

async function main() {
  const runs = Number(process.env.RUNS || 3);
  const label = process.env.LABEL || 'single';
  const maxBatchChars = Number(process.env.MAX_BATCH_CHARS || L.DEFAULT_MAX_BATCH_CHARS);
  const contextAtoms = Number(process.env.CONTEXT_ATOMS || 4);
  const consistency = process.env.CONSISTENCY || 'ENTITY_ROLES';
  const navigationMinRun = process.env.NAV_MIN_RUN ? Number(process.env.NAV_MIN_RUN) : L.DEFAULT_NAVIGATION_MIN_RUN;
  const outDir = path.join(HERE, 'runs', `${label}-${process.env.DISCOVERY_EXTRACTOR_PROVIDER}`);
  fs.mkdirSync(outDir, { recursive: true });
  const p = process.env.RESCORE ? null : provider();
  const summary = [];
  for (const input of (process.env.INPUTS || 'SOB_UNIT,AG_UNIT').split(',')) {
    const text = unitText(input);
    for (let r = 1; r <= runs; r++) {
      const t0 = wire.length;
      // The only provider seam: live call, or the saved raw file (RESCORE).
      // An operational failure becomes TransportFailure -> INVALID_RUN.
      const complete = async ({ kind, batch, system, user, schema }) => {
        const rawFile = path.join(outDir, kind === 'batch' ? `${input}-${r}.b${batch.batchIndex}.raw.txt` : `${input}-${r}.relabel.raw.txt`);
        if (process.env.RESCORE) {
          if (!fs.existsSync(rawFile)) throw new L.TransportFailure('no raw output recorded (INVALID_RUN at capture time)');
          return fs.readFileSync(rawFile, 'utf8');
        }
        const started = Date.now();
        try {
          const raw = await p.completeStructured({ system, user, jsonSchema: schema });
          fs.writeFileSync(rawFile, raw);
          wire.push({ kind, batchIndex: batch.batchIndex, atoms: batch.atomIds.length, elapsedMs: Date.now() - started });
          return raw;
        } catch (e) {
          wire.push({ kind, batchIndex: batch.batchIndex, atoms: batch.atomIds.length, elapsedMs: Date.now() - started, error: String(e.message).slice(0, 200) });
          if (isTransportFailure(String(e.message))) throw new L.TransportFailure(String(e.message).slice(0, 300), { batchIndex: batch.batchIndex, kind });
          throw e;
        }
      };
      const res = await L.labelUnit(text, { complete, maxBatchChars, contextAtoms, relabel: Boolean(process.env.RELABEL), consistency, navigationMinRun });
      if (r === 1) fs.writeFileSync(path.join(outDir, `${input}.atoms.json`), JSON.stringify({ ...res.atomization, structure: { version: res.structure.version, minRun: res.structure.minRun, blocks: res.structure.blocks }, batches: res.batches }, null, 2) + '\n');
      if (!process.env.RESCORE) fs.writeFileSync(path.join(outDir, `${input}-${r}.wire.json`), JSON.stringify(wire.slice(t0), null, 2) + '\n');
      const trace = L.unitTrace(res, { sourceUnitId: input, sourceUrl: SOURCES[input]?.url ?? REGRESSION[input]?.file, sectionComplete: true });
      fs.writeFileSync(path.join(outDir, `${input}-${r}.trace.json`), JSON.stringify(trace, null, 2) + '\n');
      if (res.outcome === 'INVALID_RUN') {
        const row = { input, run: r, validity: 'INVALID_RUN', error: res.failure.message, failure: res.failure };
        summary.push(row);
        console.log(JSON.stringify(row));
        continue;
      }
      const { atoms, first } = res;
      const merged = res.final;
      const count = (code) => merged.issues.filter((x) => x.code === code).map((x) => x.atomId);
      const segments = res.segments;
      const shadow = merged.valid ? null : shadowAssemble(atoms, merged);
      const score = REGRESSION[input] ? scoreRegression(input, segments ?? shadow) : scoreSource(SOURCES[input].sourceId, segments ?? shadow, atoms, merged.labels);
      const histogram = {};
      for (const l of merged.labels.values()) histogram[l.classification] = (histogram[l.classification] ?? 0) + 1;
      const row = {
        input,
        run: r,
        validity: 'VALID',
        promptVersion: L.PROMPT_VERSION,
        structureVersion: L.STRUCTURE_VERSION,
        consistency,
        batches: res.batches.length,
        atoms: atoms.length,
        editorialAtoms: atoms.filter((a) => a.editorial).length,
        nonEditorialBlocks: res.structure.blocks.map((b) => `${b.firstAtomId}..${b.lastAtomId}`),
        classified: merged.labels.size,
        firstPassValid: first.valid,
        firstPassIssueCount: first.issues.length,
        relabel: res.relabel && { scope: res.relabel.scope, firstPassIssues: res.relabel.firstPassIssues.map((x) => `${x.code}:${x.atomId}`) },
        missingAtomIds: count('MISSING_ATOM'),
        duplicateAtomIds: count('DUPLICATE_ATOM'),
        unknownAtomIds: count('UNKNOWN_ATOM'),
        malformed: merged.issues.filter((x) => ['MALFORMED_RESPONSE', 'MALFORMED_LABEL', 'ROLE_INCONSISTENT', 'STOP_WITHOUT_ENTITY'].includes(x.code)),
        spanIssues: merged.issues.filter((x) => ['SPAN_NOT_IN_ATOM', 'NAME_NOT_IN_SPAN', 'BAD_MENTION_ATOM', 'NAME_NOT_IN_MENTION_ATOM', 'MENTION_ANTECEDENT_MISSING', 'MENTION_ANTECEDENT_AMBIGUOUS'].includes(x.code)),
        notes: merged.notes,
        labellingValid: merged.valid,
        outcome: res.outcome,
        histogram,
        segments: (segments ?? shadow).map((s) => ({
          segmentIndex: s.segmentIndex,
          openedBy: s.openedBy.map((o) => `${o.atomId}:${o.transferMode}`),
          mandatory: s.mandatory,
          optional: s.optional,
          alternativeGroups: s.alternativeGroups,
          routeLegs: s.routeLegs,
          passBy: s.passBy,
          conflicts: s.conflicts,
        })),
        segmentsAreDiagnosticShadow: !merged.valid,
        ...score,
      };
      fs.writeFileSync(
        path.join(outDir, `${input}-${r}.result.${consistency}.json`),
        JSON.stringify({ ...row, labels: atoms.map((a) => ({ text: L.present(a.text).text, ...(merged.labels.get(a.atomId) ?? { atomId: a.atomId, classification: 'UNLABELLED' }) })), issues: merged.issues }, null, 2) + '\n',
      );
      summary.push(row);
      console.log(
        JSON.stringify({
          input,
          run: r,
          outcome: row.outcome,
          firstPass: first.valid ? 'VALID' : `${first.issues.length} issues`,
          relabel: res.relabel ? (res.relabel.scope ? res.relabel.scope.length + ' atoms' : 'NOT_REPAIRABLE') : undefined,
          issues: merged.issues.map((x) => `${x.code}:${x.atomId}`),
          routeAreaPromoted: score.routeAreaPromoted,
          verdicts: score.verdicts.map((v) => `${v.segment}:${v.mandatoryRecall}${v.success ? ' OK' : ' ' + v.reasons.join(',')}`),
          calls: wire.slice(t0).filter((w) => w.kind).map((w) => `${w.kind}${w.batchIndex}:${w.atoms}a/${w.elapsedMs}ms${w.error ? '!' : ''}`),
        }),
      );
    }
  }
  fs.writeFileSync(path.join(outDir, `results.${consistency}.json`), JSON.stringify(summary, null, 2) + '\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
