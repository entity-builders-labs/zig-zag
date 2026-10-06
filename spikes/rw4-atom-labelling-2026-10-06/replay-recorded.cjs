// Offline replay of RECORDED model output under the current contract
// (A.1 editorial structure + A.2 anaphora). No provider calls, no prompt
// change: the model's recorded answers are re-validated, re-resolved and
// re-assembled exactly as `labelUnit` would, using the batches the model
// actually saw (from `<input>.atoms.json`).
//
// Counterfactual limits, reported rather than hidden:
// - labels the model gave to atoms now marked NON_EDITORIAL are dropped
//   (those atoms would never have been presented);
// - a relabel round is replayed only when the recorded relabel answer
//   covers the new relabel scope; otherwise the run is NOT_REPLAYABLE.
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./atom-labelling.cjs');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function replayRecorded(dir, input, run, { consistency = 'ENTITY_ROLES' } = {}) {
  const recorded = JSON.parse(fs.readFileSync(path.join(dir, `${input}.atoms.json`), 'utf8'));
  const structure = L.markEditorialStructure(recorded.atoms);
  const atoms = structure.atoms;
  const byId = new Map(atoms.map((a) => [a.atomId, a]));
  const editorial = atoms.filter((a) => a.editorial);
  const editorialIds = new Set(editorial.map((a) => a.atomId));
  const base = { input, run, atoms, structure };
  const results = [];
  for (const b of recorded.batches) {
    const file = path.join(dir, `${input}-${run}.b${b.batchIndex}.raw.txt`);
    if (!fs.existsSync(file)) return { ...base, outcome: 'INVALID_RUN', detail: `no recorded output for batch ${b.batchIndex}` };
    const parsed = readJson(file);
    const kept = parsed && Array.isArray(parsed.atoms) ? { ...parsed, atoms: parsed.atoms.filter((x) => !(x && byId.get(x.atomId)?.editorial === false)) } : parsed;
    const scope = b.atomIds.filter((id) => editorialIds.has(id));
    if (!scope.length) continue;
    results.push(L.validateLabelling(scope, byId, kept, { consistency, visibleAtomIds: [...b.contextAtomIds, ...b.atomIds] }));
  }
  const first = L.resolveMentions(L.mergeBatches(atoms, [...results, L.structuralLabels(atoms)]));
  let final = first;
  let relabel = null;
  if (!first.valid) {
    const scope = L.relabelScope(first);
    relabel = { scope, firstPassIssues: first.issues.map((x) => `${x.code}:${x.atomId}`) };
    if (scope) {
      const answer = readJson(path.join(dir, `${input}-${run}.relabel.raw.txt`));
      const answered = new Set((answer?.atoms ?? []).map((x) => x?.atomId));
      if (!answer || !scope.every((id) => answered.has(id))) {
        return { ...base, outcome: 'NOT_REPLAYABLE', detail: `recorded relabel does not cover new scope ${scope.join(',')}`, first, relabel };
      }
      const batch = L.relabelBatch(editorial, scope);
      const second = L.validateLabelling(batch.atomIds, byId, { ...answer, atoms: answer.atoms.filter((x) => scope.includes(x?.atomId)) }, { consistency, visibleAtomIds: [...batch.contextAtomIds, ...batch.atomIds] });
      final = L.resolveMentions(L.applyRelabel(atoms, first, scope, second));
    }
  }
  return { ...base, outcome: final.valid ? 'ASSEMBLED' : 'CONTRACT_FAIL_CLOSED', first, final, relabel, segments: final.valid ? L.assemble(atoms, final) : null };
}

module.exports = { replayRecorded };
