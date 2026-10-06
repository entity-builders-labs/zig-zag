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
// MAX_BATCH_CHARS forces batching (default 24000 = one request per unit).
// RESCORE=1 re-validates/re-scores saved raw output without provider calls.
// CONSISTENCY=STRICT|MEMBERSHIP (default MEMBERSHIP, contract v2).
// RELABEL=1 runs one bounded relabel round on the rejected atoms.
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
  const maxBatchChars = Number(process.env.MAX_BATCH_CHARS || 24000);
  const contextAtoms = Number(process.env.CONTEXT_ATOMS || 4);
  const consistency = process.env.CONSISTENCY || 'MEMBERSHIP';
  const outDir = path.join(HERE, 'runs', `${label}-${process.env.DISCOVERY_EXTRACTOR_PROVIDER}`);
  fs.mkdirSync(outDir, { recursive: true });
  const p = process.env.RESCORE ? null : provider();
  const summary = [];
  for (const input of (process.env.INPUTS || 'SOB_UNIT,AG_UNIT').split(',')) {
    const text = unitText(input);
    const atomization = L.atomize(text);
    const coverage = L.checkCoverage(text, atomization);
    if (!coverage.ok) throw new Error(`${input}: atomization does not cover the unit`);
    const atoms = atomization.atoms;
    const byId = new Map(atoms.map((a) => [a.atomId, a]));
    const batches = L.planBatches(atoms, { maxBatchChars, contextAtoms });
    fs.writeFileSync(path.join(outDir, `${input}.atoms.json`), JSON.stringify({ ...atomization, batches }, null, 2) + '\n');
    for (let r = 1; r <= runs; r++) {
      const t0 = wire.length;
      // One provider call (live) or a saved raw file (RESCORE). Returns the
      // parsed response, or { invalidRun } on a transport failure.
      const call = async (rawFile, user) => {
        let raw = '';
        try {
          if (process.env.RESCORE) {
            if (!fs.existsSync(rawFile)) return { invalidRun: 'no raw output recorded (INVALID_RUN at capture time)' };
            raw = fs.readFileSync(rawFile, 'utf8');
          } else {
            raw = await p.completeStructured({ system: L.SYSTEM_PROMPT, user, jsonSchema: L.LABELLING_SCHEMA });
            fs.writeFileSync(rawFile, raw);
          }
        } catch (e) {
          if (isTransportFailure(String(e.message))) return { invalidRun: String(e.message).slice(0, 300) };
          throw e;
        }
        try {
          return { parsed: JSON.parse(raw) };
        } catch {
          return { parsed: null };
        }
      };
      const batchResults = [];
      let invalidRun = null;
      for (const batch of batches) {
        const res = await call(path.join(outDir, `${input}-${r}.b${batch.batchIndex}.raw.txt`), L.buildPrompt(batch, byId));
        if (res.invalidRun) {
          invalidRun = res.invalidRun;
          break;
        }
        batchResults.push(L.validateLabelling(batch.atomIds, byId, res.parsed, { consistency }));
      }
      const first = invalidRun ? null : L.mergeBatches(atoms, batchResults);
      // Bounded relabel round (RELABEL=1): only the rejected atoms, once.
      let merged = first;
      let relabel = null;
      const relabelFile = path.join(outDir, `${input}-${r}.relabel.raw.txt`);
      if (first && !first.valid && (process.env.RELABEL || (process.env.RESCORE && fs.existsSync(relabelFile)))) {
        const scope = L.relabelScope(first);
        relabel = { scope, firstPassIssues: first.issues };
        if (scope) {
          const batch = L.relabelBatch(atoms, scope);
          const res = await call(relabelFile, L.buildRelabelPrompt(batch, byId, first.issues));
          if (res.invalidRun) invalidRun = res.invalidRun;
          else merged = L.applyRelabel(atoms, first, scope, L.validateLabelling(batch.atomIds, byId, res.parsed, { consistency }));
        }
      }
      if (!process.env.RESCORE) fs.writeFileSync(path.join(outDir, `${input}-${r}.wire.json`), JSON.stringify(wire.slice(t0), null, 2) + '\n');
      if (invalidRun) {
        const row = { input, run: r, validity: 'INVALID_RUN', error: invalidRun };
        summary.push(row);
        console.log(JSON.stringify(row));
        continue;
      }
      const count = (code) => merged.issues.filter((x) => x.code === code).map((x) => x.atomId);
      const segments = merged.valid ? L.assemble(atoms, merged) : null;
      const shadow = merged.valid ? null : shadowAssemble(atoms, merged);
      const score = REGRESSION[input] ? scoreRegression(input, segments ?? shadow) : scoreSource(SOURCES[input].sourceId, segments ?? shadow, atoms, merged.labels);
      const histogram = {};
      for (const l of merged.labels.values()) histogram[l.classification] = (histogram[l.classification] ?? 0) + 1;
      const row = {
        input,
        run: r,
        validity: 'VALID',
        promptVersion: process.env.PROMPT_VERSION_OF_CAPTURE || L.PROMPT_VERSION,
        consistency,
        batches: batches.length,
        atoms: atoms.length,
        classified: merged.labels.size,
        firstPassValid: first.valid,
        firstPassIssueCount: first.issues.length,
        relabel: relabel && { scope: relabel.scope, firstPassIssues: relabel.firstPassIssues.map((x) => `${x.code}:${x.atomId}`) },
        missingAtomIds: count('MISSING_ATOM'),
        duplicateAtomIds: count('DUPLICATE_ATOM'),
        unknownAtomIds: count('UNKNOWN_ATOM'),
        malformed: merged.issues.filter((x) => ['MALFORMED_RESPONSE', 'MALFORMED_LABEL', 'ROLE_INCONSISTENT', 'STOP_WITHOUT_ENTITY'].includes(x.code)),
        spanIssues: merged.issues.filter((x) => ['SPAN_NOT_IN_ATOM', 'NAME_NOT_IN_SPAN', 'BAD_MENTION_ATOM', 'NAME_NOT_IN_MENTION_ATOM'].includes(x.code)),
        notes: merged.notes,
        labellingValid: merged.valid,
        outcome: merged.valid ? 'ASSEMBLED' : 'CONTRACT_FAIL_CLOSED',
        histogram,
        segments: (segments ?? shadow).map((s) => ({
          segmentIndex: s.segmentIndex,
          openedBy: s.openedBy.map((o) => `${o.atomId}:${o.transferMode}`),
          mandatory: s.mandatory,
          optional: s.optional,
          alternativeGroups: s.alternativeGroups,
          routeLegs: s.routeLegs,
          passBy: s.passBy,
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
          relabel: relabel ? (relabel.scope ? relabel.scope.length + ' atoms' : 'NOT_REPAIRABLE') : undefined,
          issues: merged.issues.map((x) => `${x.code}:${x.atomId}`),
          routeAreaPromoted: score.routeAreaPromoted,
          verdicts: score.verdicts.map((v) => `${v.segment}:${v.mandatoryRecall}${v.success ? ' OK' : ' ' + v.reasons.join(',')}`),
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
