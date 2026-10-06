// RW4-EXTRACT-COMPLETENESS-1 spike: exhaustive source-atom labelling.
//
// Pure, deterministic, provider-free contract (spike only, not production):
//
//   editorial unit text
//     -> atomize()            deterministic, language/semantic-neutral split
//     -> planBatches()        global atom IDs, every atom in exactly one batch
//     -> buildPrompt()        the LLM labels EVERY atom of a batch
//     -> validateLabelling()  exactly one valid label per atom, spans inside
//                             their atom, or FAIL CLOSED
//     -> assemble()           source order + TRANSFER segment boundaries +
//                             role-preserving membership
//
// The LLM is the only semantic authority. Nothing in this file classifies
// meaning: no tourism, transport or place vocabulary is used as a rule.
// Splitting uses neutral text structure only (lines, table cells, list and
// heading markers, sentence-final punctuation). Assembly derives structure
// only from labels and source positions.
'use strict';
const crypto = require('crypto');

const ATOMIZER_VERSION = 'atomizer-v1';
// v1: smoke run only (runs/smoke-gemini). v2: anaphoric mentionAtomId,
// identifying descriptions, overview/return-transfer/sight guidance.
// v3: ROUTE_LEG; areas entered/crossed and generic descriptions are not
// membership; a street that is itself the experience stays a stop.
const PROMPT_VERSION = 'labelling-prompt-v3';
const DEFAULT_MAX_ATOM_CHARS = 600;

const CLASSIFICATIONS = ['ITINERARY_STOP', 'ROUTE_LEG', 'OPTIONAL_STOP', 'ALTERNATIVE', 'TRANSFER', 'PASS_BY', 'NON_ITINERARY'];
const ENTITY_ROLES = ['ITINERARY_STOP', 'ROUTE_LEG', 'OPTIONAL_STOP', 'ALTERNATIVE', 'PASS_BY'];
// Strongest first. A non-TRANSFER, non-NON_ITINERARY atom's classification
// must equal the strongest role among its entities.
const ROLE_PRECEDENCE = ['ITINERARY_STOP', 'ROUTE_LEG', 'OPTIONAL_STOP', 'ALTERNATIVE', 'PASS_BY'];
// Roles that never count as a segment's own membership for transfer
// boundaries (a segment holding only these is not closed by a transfer).
const CONTEXT_ROLES = new Set(['ROUTE_LEG', 'PASS_BY']);
const TRANSFER_MODES = ['BUS', 'TAXI', 'METRO', 'TRAIN', 'TRAM', 'FERRY', 'CAR', 'OTHER_MOTORIZED', 'UNSPECIFIED'];

const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
const SENTENCE_FINAL = /[.!?…。！？]/u;
// Characters that may close a sentence after its final punctuation
// (quotes, brackets, emphasis markers). Structural, not lexical.
const SENTENCE_CLOSERS = /[\s"'”’»)\]*_]/u;

// ---------------------------------------------------------------------------
// Presentation: the text the model sees for one atom. Only URL targets are
// elided (a link/image target or a bare URL becomes "…"), so a model cannot
// spend its budget on them and a span cannot cite them. Every presented
// character maps back to a source offset.
// ---------------------------------------------------------------------------
const URL_TARGET = /\]\(([^)\s]*)\)|https?:\/\/[^\s)\]|]+/gu;

function present(text) {
  let out = '';
  const map = []; // presented index -> index in `text`
  let i = 0;
  URL_TARGET.lastIndex = 0;
  for (let m = URL_TARGET.exec(text); m; m = URL_TARGET.exec(text)) {
    const isLink = m[0].startsWith('](');
    const targetStart = isLink ? m.index + 2 : m.index;
    const targetEnd = isLink ? m.index + m[0].length - 1 : m.index + m[0].length;
    for (; i < targetStart; i++) {
      out += text[i];
      map.push(i);
    }
    if (targetEnd > targetStart) {
      out += '…';
      map.push(targetStart);
    }
    i = targetEnd;
  }
  for (; i < text.length; i++) {
    out += text[i];
    map.push(i);
  }
  return { text: out, map };
}

// ---------------------------------------------------------------------------
// Atomization
// ---------------------------------------------------------------------------

function blockKind(line) {
  if (/^\s{0,3}#{1,6}\s/u.test(line)) return 'HEADING';
  if (/^\s*([-*+•]|\d+[.)])\s+/u.test(line)) return 'LIST_ITEM';
  if (/^\s*\|/u.test(line)) return 'TABLE_ROW';
  return 'LINE';
}

// Ranges [start, end) of a line's blocks: table rows split into cells on
// unescaped pipes; every other line is one block.
function lineBlocks(text, start, end) {
  const line = text.slice(start, end);
  const kind = blockKind(line);
  if (kind !== 'TABLE_ROW') return { kind, blocks: [[start, end]], pipes: [] };
  const blocks = [];
  const pipes = [];
  let cellStart = start;
  for (let i = start; i < end; i++) {
    if (text[i] === '|' && text[i - 1] !== '\\') {
      blocks.push([cellStart, i]);
      pipes.push([i, i + 1]);
      cellStart = i + 1;
    }
  }
  blocks.push([cellStart, end]);
  return { kind: 'TABLE_CELL', blocks, pipes };
}

// Sentence boundaries inside [start, end): after sentence-final punctuation
// (plus closers) followed by whitespace. A terminator directly after a token
// with three or fewer letters/digits is not a boundary (abbreviation guard,
// by token length only). Merging is always safe: it can only make an atom
// coarser, never lose text.
function sentenceRanges(text, start, end) {
  const ranges = [];
  let s = start;
  for (let i = start; i < end; i++) {
    if (!SENTENCE_FINAL.test(text[i])) continue;
    let j = i + 1;
    while (j < end && SENTENCE_CLOSERS.test(text[j]) && !/\s/u.test(text[j])) j++;
    if (j >= end || !/\s/u.test(text[j])) continue;
    let k = i - 1;
    while (k >= s && /[*_"'“‘«(\[]/u.test(text[k])) k--;
    let tokenChars = 0;
    while (k >= s && !/\s/u.test(text[k])) {
      if (LETTER_OR_NUMBER.test(text[k])) tokenChars++;
      k--;
    }
    if (tokenChars <= 3) continue;
    ranges.push([s, j]);
    s = j;
    i = j - 1;
  }
  ranges.push([s, end]);
  return ranges;
}

// Bounded split of an over-long piece at whitespace, keeping every character.
function boundedRanges(text, start, end, maxChars) {
  const ranges = [];
  let s = start;
  while (end - s > maxChars) {
    let cut = s + maxChars;
    while (cut > s + Math.floor(maxChars / 2) && !/\s/u.test(text[cut])) cut--;
    if (!/\s/u.test(text[cut])) cut = s + maxChars;
    ranges.push([s, cut]);
    s = cut;
  }
  ranges.push([s, end]);
  return ranges;
}

function trimRange(text, start, end) {
  let a = start;
  let b = end;
  while (a < b && /\s/u.test(text[a])) a++;
  while (b > a && /\s/u.test(text[b - 1])) b--;
  return [a, b];
}

/**
 * Deterministic atomization of one editorial unit.
 *
 * Returns atoms (with stable IDs and source offsets) and separators. Atoms
 * and separators partition [0, text.length) exactly. A separator is
 * whitespace, a newline, a table pipe, or a piece whose presented text
 * contains no letter or number (pure markup such as `| --- |`, `**`, or an
 * image whose only content is its URL target).
 */
function atomize(text, { maxAtomChars = DEFAULT_MAX_ATOM_CHARS } = {}) {
  const pieces = []; // { start, end, blockKind, blockOrdinal, fragment? }
  const separators = [];
  const sep = (start, end, kind) => {
    if (end > start) separators.push({ start, end, kind });
  };
  let blockOrdinal = 0;
  let lineStart = 0;
  while (lineStart <= text.length) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = text.length;
    const { kind, blocks, pipes } = lineBlocks(text, lineStart, lineEnd);
    for (const [ps, pe] of pipes) sep(ps, pe, 'TABLE_PIPE');
    for (const [bs, be] of blocks) {
      blockOrdinal++;
      for (const [ss, se] of sentenceRanges(text, bs, be)) {
        const [ts, te] = trimRange(text, ss, se);
        sep(ss, ts, 'WHITESPACE');
        sep(te, se, 'WHITESPACE');
        if (te <= ts) continue;
        if (!LETTER_OR_NUMBER.test(present(text.slice(ts, te)).text)) {
          sep(ts, te, 'MARKUP');
          continue;
        }
        const parts = boundedRanges(text, ts, te, maxAtomChars);
        parts.forEach(([fs, fe], index) => {
          const [a, b] = trimRange(text, fs, fe);
          sep(fs, a, 'WHITESPACE');
          sep(b, fe, 'WHITESPACE');
          if (b <= a) return;
          pieces.push({
            start: a,
            end: b,
            blockKind: kind,
            blockOrdinal,
            ...(parts.length > 1 ? { fragment: { index: index + 1, count: parts.length, groupStart: ts, groupEnd: te } } : {}),
          });
        });
      }
    }
    if (lineEnd < text.length) sep(lineEnd, lineEnd + 1, 'NEWLINE');
    lineStart = lineEnd + 1;
  }
  const width = Math.max(3, String(pieces.length).length);
  const atoms = pieces.map((p, i) => ({
    atomId: `a-${String(i + 1).padStart(width, '0')}`,
    ordinal: i + 1,
    sourceStart: p.start,
    sourceEnd: p.end,
    text: text.slice(p.start, p.end),
    blockKind: p.blockKind,
    blockOrdinal: p.blockOrdinal,
    ...(p.fragment ? { fragment: p.fragment } : {}),
  }));
  separators.sort((a, b) => a.start - b.start);
  return {
    version: ATOMIZER_VERSION,
    maxAtomChars,
    unitLength: text.length,
    unitSha256: crypto.createHash('sha256').update(text).digest('hex'),
    atoms,
    separators,
  };
}

/** Atoms + separators must partition the unit exactly. */
function checkCoverage(text, atomization) {
  const ranges = [
    ...atomization.atoms.map((a) => ({ start: a.sourceStart, end: a.sourceEnd, kind: 'ATOM', text: a.text })),
    ...atomization.separators,
  ].sort((a, b) => a.start - b.start || a.end - b.end);
  const problems = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) problems.push({ code: 'GAP', start: cursor, end: r.start });
    if (r.start < cursor) problems.push({ code: 'OVERLAP', start: r.start, end: cursor });
    if (r.kind === 'ATOM' && text.slice(r.start, r.end) !== r.text) problems.push({ code: 'ATOM_TEXT_MISMATCH', start: r.start, end: r.end });
    if (r.kind !== 'ATOM' && LETTER_OR_NUMBER.test(present(text.slice(r.start, r.end)).text)) problems.push({ code: 'SEPARATOR_HAS_CONTENT', start: r.start, end: r.end });
    cursor = Math.max(cursor, r.end);
  }
  if (cursor !== text.length) problems.push({ code: 'GAP', start: cursor, end: text.length });
  const ids = atomization.atoms.map((a) => a.atomId);
  if (new Set(ids).size !== ids.length) problems.push({ code: 'DUPLICATE_ATOM_ID' });
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Batching: every atom belongs to exactly one batch; earlier atoms may be
// shown as read-only context, never labelled in that batch.
// ---------------------------------------------------------------------------
function planBatches(atoms, { maxBatchChars = 24000, contextAtoms = 4 } = {}) {
  const batches = [];
  let current = [];
  let chars = 0;
  for (const a of atoms) {
    const size = present(a.text).text.length + a.atomId.length + 4;
    if (current.length && chars + size > maxBatchChars) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(a);
    chars += size;
  }
  if (current.length) batches.push(current);
  let offset = 0;
  return batches.map((members, index) => {
    const context = atoms.slice(Math.max(0, offset - contextAtoms), offset);
    offset += members.length;
    return { batchIndex: index + 1, batchCount: batches.length, atomIds: members.map((a) => a.atomId), contextAtomIds: context.map((a) => a.atomId) };
  });
}

// ---------------------------------------------------------------------------
// Semantic output contract
// ---------------------------------------------------------------------------
const LABELLING_SCHEMA = {
  type: 'object',
  properties: {
    atoms: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          atomId: { type: 'string' },
          classification: { type: 'string', enum: CLASSIFICATIONS },
          entities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sourceName: { type: 'string' },
                supportSpan: { type: 'string' },
                role: { type: 'string', enum: ENTITY_ROLES },
                mentionAtomId: { type: 'string' },
              },
              required: ['sourceName', 'supportSpan', 'role'],
            },
          },
          transferMode: { type: 'string', enum: TRANSFER_MODES },
          reason: { type: 'string' },
        },
        required: ['atomId', 'classification', 'entities'],
      },
    },
  },
  required: ['atoms'],
};

const SYSTEM_PROMPT =
  'You label every atom of one travel source text with its itinerary function. You never skip, merge, split, renumber or invent atoms, and you never invent places.';

function buildPrompt(batch, atomsById) {
  const line = (id) => `[${id}] ${present(atomsById.get(id).text).text}`;
  return [
    'The source text below is one editorial unit split into atoms, in source order. Return exactly one entry in "atoms" for EVERY atom listed under LABEL, in the same order, using each atomId exactly as written (for example "a-007"). Headings, captions, fragments and ads are atoms too. An answer that skips, repeats or adds an atom is rejected.',
    batch.contextAtomIds.length ? 'Atoms under CONTEXT precede this part of the text. Read them for context only; do not label them.' : '',
    '',
    'classification (what the atom does in the itinerary):',
    '- ITINERARY_STOP: directs the traveller to a place that is a destination of the itinerary: start at, visit, stop at, enter, go and see, arrive at, experience, or a numbered stop.',
    '- ROUTE_LEG: tells the traveller to follow, walk or ride along, cross, traverse or use a real street, avenue, path, bridge or area as the route, when that path is not itself a place to visit.',
    '- OPTIONAL_STOP: presents a named place as optional or extra ("if you have time", "you can also"), outside the main sequence.',
    '- ALTERNATIVE: offers a choice among places ("A or B", "if you prefer X, go to Y"), or recommends one of several options, such as where to eat or drink.',
    '- TRANSFER: describes or announces moving to the next part of the itinerary by motorized or public transport (bus, taxi, metro, train, ferry, car), including a heading that announces that move. Walking from place to place is never a TRANSFER.',
    '- PASS_BY: only mentions places seen, passed, referenced or used for orientation along the way, without directing a visit and without telling the traveller to use them as the route.',
    '- NON_ITINERARY: everything else: description, history, tips, prices, opening hours, navigation, captions, ads, author notes. Also an atom that only describes a place labelled in another atom.',
    '',
    'Guidance:',
    '- A place the text points out to the traveller as a sight of the route ("you will see X", "in front is X", "X is on your left", then describing it) is an ITINERARY_STOP. PASS_BY is for places only passed, glimpsed or used for orientation.',
    '- A street or corridor walked to get between stops is a ROUTE_LEG. A street, promenade or corridor that is itself the attraction or the experience (the source presents walking it as the thing to do) is an ITINERARY_STOP.',
    '- A neighbourhood or district that is only entered, crossed, used as a transport direction, or named as context is a ROUTE_LEG or PASS_BY. It is an ITINERARY_STOP only when the source presents the area itself as a destination to explore.',
    '- An overview that lists what the whole itinerary covers, or a title, is NON_ITINERARY; label each place where the text actually directs the traveller to it.',
    '- A heading or sentence that announces going to the next part of the itinerary is a TRANSFER when the text says that part is reached by transport, even if the transport is named in the next atom.',
    '- A transfer back to the start, home or the hotel at the end is a TRANSFER whose destination is PASS_BY.',
    '',
    'entities: every real place the atom refers to, with its role; zero, one or several per atom. A place counts when it has a proper name or a description that identifies one specific place (for example "the city museum"). An unnamed generic option ("two bakeries") or a generic description without its own identity ("a big building", "the oldest part of town") is not an entity.',
    '- sourceName: the name or description exactly as the source writes it. Do not translate, expand or complete it.',
    '- supportSpan: a short phrase copied verbatim from this atom that shows the role. It contains sourceName unless mentionAtomId is set.',
    '- role: ITINERARY_STOP, ROUTE_LEG, OPTIONAL_STOP, ALTERNATIVE or PASS_BY, with the meanings above.',
    '- mentionAtomId: only when this atom refers back to a place that is named in an EARLIER atom (for example "Jump inside." or "enjoy the park"): the atomId of the earlier atom whose text contains sourceName.',
    'Consistency: a NON_ITINERARY atom has no entities. Any other non-TRANSFER atom has at least one entity, and its classification equals its strongest entity role (ITINERARY_STOP > ROUTE_LEG > OPTIONAL_STOP > ALTERNATIVE > PASS_BY). A TRANSFER atom may list the place it travels to: role ITINERARY_STOP when the traveller visits that place next, otherwise ROUTE_LEG or PASS_BY.',
    'transferMode (TRANSFER atoms only): BUS, TAXI, METRO, TRAIN, TRAM, FERRY, CAR, OTHER_MOTORIZED or UNSPECIFIED; the first one the source offers.',
    'reason: at most 12 words; audit only.',
    '',
    ...(batch.contextAtomIds.length ? ['CONTEXT:', ...batch.contextAtomIds.map(line), ''] : []),
    'LABEL:',
    ...batch.atomIds.map(line),
  ]
    .filter((l, i, all) => l !== '' || all[i - 1] !== '')
    .join('\n');
}

// ---------------------------------------------------------------------------
// Validation (fail closed)
// ---------------------------------------------------------------------------

// Case/accent/markup-insensitive fold with a map back to presented indices.
// Removes emphasis/escape/quote characters and collapses whitespace.
const FOLD_DROP = /[*_`\\"'“”‘’«»]/u;
function foldWithMap(s) {
  let out = '';
  const map = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (FOLD_DROP.test(c)) continue;
    if (/\s/u.test(c)) {
      if (out.length && out[out.length - 1] !== ' ') {
        out += ' ';
        map.push(i);
      }
      continue;
    }
    for (const f of c.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()) {
      out += f;
      map.push(i);
    }
  }
  while (out.endsWith(' ')) {
    out = out.slice(0, -1);
    map.pop();
  }
  return { text: out, map };
}
const fold = (s) => foldWithMap(String(s ?? '')).text;

/** Source range of `span` inside `atom`, or null when it is not contained. */
function locateSpan(atom, span) {
  const needle = fold(span);
  if (!needle) return null;
  const shown = present(atom.text);
  const folded = foldWithMap(shown.text);
  const at = folded.text.indexOf(needle);
  if (at === -1) return null;
  const firstShown = folded.map[at];
  const lastShown = folded.map[at + needle.length - 1];
  return { sourceStart: atom.sourceStart + shown.map[firstShown], sourceEnd: atom.sourceStart + shown.map[lastShown] + 1 };
}

/**
 * Validate one response against the atoms it had to label. `scopeAtomIds`
 * is the exact set that must be labelled (a batch, or the whole unit).
 * Returns { valid, issues, notes, labels } where labels is keyed by atomId
 * and carries located entity spans. Any issue makes the result invalid;
 * notes are audit-only.
 *
 * consistency:
 * - 'MEMBERSHIP' (contract v2, default): fail closed on every inconsistency
 *   that can hide or invent membership: an ITINERARY_STOP atom without an
 *   ITINERARY_STOP entity, an entity role stronger than its atom's
 *   classification, a NON_ITINERARY atom with entities. An OPTIONAL_STOP,
 *   ALTERNATIVE, ROUTE_LEG or PASS_BY atom whose place is unnamed adds no membership
 *   and is recorded as an UNNAMED_* note.
 * - 'STRICT' (contract v1): classification must equal the strongest entity
 *   role. Kept to rescore runs under the first rule.
 */
function validateLabelling(scopeAtomIds, atomsById, response, { consistency = 'MEMBERSHIP' } = {}) {
  const issues = [];
  const notes = [];
  const labels = new Map();
  const issue = (code, atomId, detail) => issues.push({ code, ...(atomId ? { atomId } : {}), ...(detail ? { detail } : {}) });
  if (!response || typeof response !== 'object' || !Array.isArray(response.atoms)) {
    issue('MALFORMED_RESPONSE', null, 'expected an object with an atoms array');
    return { valid: false, issues, notes, labels };
  }
  const scope = new Set(scopeAtomIds);
  const seen = new Set();
  for (const raw of response.atoms) {
    const atomId = raw && typeof raw.atomId === 'string' ? raw.atomId : null;
    if (!atomId) {
      issue('MALFORMED_LABEL', null, 'label without a string atomId');
      continue;
    }
    if (!scope.has(atomId)) {
      issue('UNKNOWN_ATOM', atomId);
      continue;
    }
    if (seen.has(atomId)) {
      issue('DUPLICATE_ATOM', atomId);
      continue;
    }
    seen.add(atomId);
    const atom = atomsById.get(atomId);
    const before = issues.length;
    if (!CLASSIFICATIONS.includes(raw.classification)) issue('MALFORMED_LABEL', atomId, `classification ${JSON.stringify(raw.classification)}`);
    if (!Array.isArray(raw.entities)) issue('MALFORMED_LABEL', atomId, 'entities is not an array');
    if (raw.transferMode !== undefined && (raw.classification !== 'TRANSFER' || !TRANSFER_MODES.includes(raw.transferMode))) issue('MALFORMED_LABEL', atomId, `transferMode ${JSON.stringify(raw.transferMode)}`);
    const entities = [];
    for (const e of Array.isArray(raw.entities) ? raw.entities : []) {
      if (!e || typeof e.sourceName !== 'string' || typeof e.supportSpan !== 'string' || !ENTITY_ROLES.includes(e.role) || !fold(e.sourceName)) {
        issue('MALFORMED_LABEL', atomId, `entity ${JSON.stringify(e)}`);
        continue;
      }
      if (e.mentionAtomId !== undefined && typeof e.mentionAtomId !== 'string') {
        issue('MALFORMED_LABEL', atomId, `entity ${JSON.stringify(e)}`);
        continue;
      }
      const located = locateSpan(atom, e.supportSpan);
      if (!located) {
        issue('SPAN_NOT_IN_ATOM', atomId, e.supportSpan);
        continue;
      }
      let mention = null;
      if (e.mentionAtomId !== undefined) {
        // Anaphora: the role is shown in this atom, the name in an earlier one.
        const target = atomsById.get(e.mentionAtomId);
        if (!target || target.ordinal >= atom.ordinal) {
          issue('BAD_MENTION_ATOM', atomId, `${e.mentionAtomId} must be an earlier atom of the unit`);
          continue;
        }
        mention = locateSpan(target, e.sourceName);
        if (!mention) {
          issue('NAME_NOT_IN_MENTION_ATOM', atomId, `${e.sourceName} / ${e.mentionAtomId}`);
          continue;
        }
      } else if (!fold(e.supportSpan).includes(fold(e.sourceName))) {
        issue('NAME_NOT_IN_SPAN', atomId, `${e.sourceName} / ${e.supportSpan}`);
        continue;
      }
      entities.push({
        sourceName: e.sourceName,
        supportSpan: e.supportSpan,
        role: e.role,
        ...located,
        ...(mention ? { mention: { atomId: e.mentionAtomId, sourceStart: mention.sourceStart, sourceEnd: mention.sourceEnd } } : {}),
      });
    }
    if (issues.length === before && Array.isArray(raw.entities)) {
      const c = raw.classification;
      if (c === 'NON_ITINERARY' && entities.length) issue('ROLE_INCONSISTENT', atomId, 'NON_ITINERARY atom with entities');
      if (c !== 'NON_ITINERARY' && c !== 'TRANSFER') {
        const strongest = ROLE_PRECEDENCE.find((r) => entities.some((e) => e.role === r));
        if (consistency === 'STRICT') {
          if (strongest !== c) issue('ROLE_INCONSISTENT', atomId, `classification ${c}, strongest entity role ${strongest ?? 'none'}`);
        } else if (strongest && ROLE_PRECEDENCE.indexOf(strongest) < ROLE_PRECEDENCE.indexOf(c)) {
          issue('ROLE_INCONSISTENT', atomId, `entity role ${strongest} exceeds classification ${c}`);
        } else if (c === 'ITINERARY_STOP' && strongest !== c) {
          issue('STOP_WITHOUT_ENTITY', atomId, `ITINERARY_STOP atom, strongest entity role ${strongest ?? 'none'}`);
        } else if (strongest !== c) {
          notes.push({ code: `UNNAMED_${c}`, atomId });
        }
      }
    }
    labels.set(atomId, {
      atomId,
      classification: raw.classification,
      entities: entities.sort((a, b) => a.sourceStart - b.sourceStart),
      ...(raw.transferMode ? { transferMode: raw.transferMode } : {}),
      ...(typeof raw.reason === 'string' ? { reason: raw.reason } : {}),
    });
  }
  for (const id of scopeAtomIds) if (!seen.has(id)) issue('MISSING_ATOM', id);
  return { valid: issues.length === 0, issues, notes, labels };
}

/**
 * Merge per-batch validations and re-check the global invariant: every
 * atom of the unit labelled exactly once across all batches.
 */
function mergeBatches(atoms, batchResults) {
  const issues = batchResults.flatMap((r, i) => r.issues.map((x) => ({ batch: i + 1, ...x })));
  const labels = new Map();
  for (const r of batchResults) {
    for (const [id, l] of r.labels) {
      if (labels.has(id)) issues.push({ code: 'DUPLICATE_ATOM', atomId: id, detail: 'labelled in more than one batch' });
      else labels.set(id, l);
    }
  }
  for (const a of atoms) if (!labels.has(a.atomId)) issues.push({ code: 'MISSING_ATOM', atomId: a.atomId, detail: 'no batch labelled it' });
  const unique = [];
  const keys = new Set();
  for (const x of issues) {
    const k = `${x.code}|${x.atomId}|${x.detail}`;
    if (!keys.has(k)) unique.push(x), keys.add(k);
  }
  return { valid: unique.length === 0, issues: unique, notes: batchResults.flatMap((r) => r.notes ?? []), labels };
}

// ---------------------------------------------------------------------------
// Bounded relabel round: the model relabels ONLY the atoms the validator
// rejected, under the same contract; the result is re-validated as a whole.
// Never a repair by guessing: an unknown atom ID or a malformed response is
// not repairable, and a second invalid answer fails closed.
// ---------------------------------------------------------------------------
const NON_REPAIRABLE = new Set(['MALFORMED_RESPONSE', 'UNKNOWN_ATOM']);

/** Atom IDs to relabel, or null when the result is not repairable. */
function relabelScope(validation) {
  if (validation.valid) return [];
  if (validation.issues.some((x) => NON_REPAIRABLE.has(x.code) || !x.atomId)) return null;
  return [...new Set(validation.issues.map((x) => x.atomId))];
}

/** A relabel batch: the rejected atoms plus a few preceding atoms as context. */
function relabelBatch(atoms, scopeIds, { contextAtoms = 3 } = {}) {
  const scope = new Set(scopeIds);
  const ordinals = atoms.filter((a) => scope.has(a.atomId)).map((a) => a.ordinal);
  const context = new Set();
  for (const o of ordinals) for (let k = Math.max(1, o - contextAtoms); k < o; k++) if (!scope.has(atoms[k - 1].atomId)) context.add(atoms[k - 1].atomId);
  return {
    batchIndex: 0,
    batchCount: 0,
    atomIds: atoms.filter((a) => scope.has(a.atomId)).map((a) => a.atomId),
    contextAtomIds: atoms.filter((a) => context.has(a.atomId)).map((a) => a.atomId),
  };
}

function buildRelabelPrompt(batch, atomsById, issues) {
  const rejected = issues.filter((x) => batch.atomIds.includes(x.atomId)).map((x) => `- [${x.atomId}] ${x.code}${x.detail ? `: ${x.detail}` : ''}`);
  return [
    'Your previous labels for the atoms under LABEL were rejected by a deterministic validator:',
    ...rejected,
    'Label these atoms again under the same rules. Atoms under CONTEXT are earlier atoms you may cite with mentionAtomId; do not label them.',
    '',
    buildPrompt(batch, atomsById),
  ].join('\n');
}

/** Replace the rejected atoms' labels with the relabel result and re-check globally. */
function applyRelabel(atoms, first, scopeIds, second) {
  const scope = new Set(scopeIds);
  const labels = new Map([...first.labels].filter(([id]) => !scope.has(id)));
  const issues = [...first.issues.filter((x) => !scope.has(x.atomId)), ...second.issues.map((x) => ({ relabel: true, ...x }))];
  for (const [id, l] of second.labels) labels.set(id, l);
  for (const a of atoms) if (!labels.has(a.atomId) && !issues.some((x) => x.atomId === a.atomId)) issues.push({ code: 'MISSING_ATOM', atomId: a.atomId });
  const notes = [...(first.notes ?? []).filter((x) => !scope.has(x.atomId)), ...(second.notes ?? [])];
  return { valid: issues.length === 0, issues, notes, labels };
}

// ---------------------------------------------------------------------------
// Deterministic assembly
// ---------------------------------------------------------------------------

/**
 * Build itinerary segments from a VALID labelling. Throws on an invalid
 * one: assembly never runs on a partial semantic result.
 *
 * - Order is atom order, then span position inside the atom.
 * - A TRANSFER atom closes the current segment once that segment has
 *   membership from a non-TRANSFER atom; adjacent TRANSFER atoms (with no
 *   membership-bearing atom between them) form one boundary.
 * - ITINERARY_STOP entities are mandatory membership; OPTIONAL_STOP,
 *   ALTERNATIVE, ROUTE_LEG and PASS_BY entities are kept with their roles and are never
 *   mandatory.
 * - Consecutive alternative-bearing atoms (atoms without entities between
 *   them do not interrupt) form one choice group.
 * - Exact folded-name repeats inside a segment are one member with all
 *   provenance; a mandatory occurrence absorbs weaker ones.
 */
function assemble(atoms, validation) {
  if (!validation.valid) throw new Error('ASSEMBLY_REFUSED: labelling is invalid (fail closed)');
  const segments = [];
  const open = (transferAtomId, transferMode) => {
    const s = { segmentIndex: segments.length + 1, openedBy: transferAtomId ? [{ atomId: transferAtomId, transferMode: transferMode ?? 'UNSPECIFIED' }] : [], members: [], hasOwnMembership: false, altRun: null };
    segments.push(s);
    return s;
  };
  let current = open(null);
  for (const atom of atoms) {
    const label = validation.labels.get(atom.atomId);
    if (label.classification === 'TRANSFER') {
      if (current.hasOwnMembership) current = open(atom.atomId, label.transferMode);
      else current.openedBy.push({ atomId: atom.atomId, transferMode: label.transferMode ?? 'UNSPECIFIED' });
      current.altRun = null;
    }
    if (!label.entities.length) continue;
    if (label.classification !== 'TRANSFER' && label.entities.some((e) => !CONTEXT_ROLES.has(e.role))) current.hasOwnMembership = true;
    const hasAlt = label.entities.some((e) => e.role === 'ALTERNATIVE');
    const hasOther = label.entities.some((e) => e.role !== 'ALTERNATIVE');
    if (hasOther || !hasAlt) current.altRun = null;
    if (hasAlt && !current.altRun) current.altRun = { groupId: `${current.segmentIndex}.${atom.atomId}` };
    for (const e of label.entities) {
      const key = fold(e.sourceName);
      const provenance = {
        atomId: atom.atomId,
        supportSpan: e.supportSpan,
        sourceStart: e.sourceStart,
        sourceEnd: e.sourceEnd,
        viaTransfer: label.classification === 'TRANSFER',
        ...(e.mention ? { mention: e.mention } : {}),
      };
      const existing = current.members.find((m) => m.key === key);
      if (existing) {
        existing.provenance.push(provenance);
        if (ROLE_PRECEDENCE.indexOf(e.role) < ROLE_PRECEDENCE.indexOf(existing.role)) {
          existing.role = e.role;
          delete existing.alternativeGroup;
          if (e.role === 'ALTERNATIVE') existing.alternativeGroup = current.altRun.groupId;
        }
        continue;
      }
      current.members.push({
        key,
        sourceName: e.sourceName,
        role: e.role,
        ...(e.role === 'ALTERNATIVE' ? { alternativeGroup: current.altRun.groupId } : {}),
        provenance: [provenance],
      });
    }
    if (hasOther && hasAlt) current.altRun = null;
  }
  return segments.map((s) => {
    const members = s.members.map(({ key, ...m }, i) => ({ position: i + 1, ...m }));
    const groups = new Map();
    for (const m of members) if (m.alternativeGroup) groups.set(m.alternativeGroup, [...(groups.get(m.alternativeGroup) ?? []), m.sourceName]);
    return {
      segmentIndex: s.segmentIndex,
      openedBy: s.openedBy,
      mandatory: members.filter((m) => m.role === 'ITINERARY_STOP').map((m) => m.sourceName),
      optional: members.filter((m) => m.role === 'OPTIONAL_STOP').map((m) => m.sourceName),
      alternativeGroups: [...groups.values()],
      routeLegs: members.filter((m) => m.role === 'ROUTE_LEG').map((m) => m.sourceName),
      passBy: members.filter((m) => m.role === 'PASS_BY').map((m) => m.sourceName),
      members,
    };
  });
}

module.exports = {
  ATOMIZER_VERSION,
  PROMPT_VERSION,
  CLASSIFICATIONS,
  ENTITY_ROLES,
  TRANSFER_MODES,
  LABELLING_SCHEMA,
  SYSTEM_PROMPT,
  atomize,
  checkCoverage,
  present,
  fold,
  locateSpan,
  planBatches,
  buildPrompt,
  validateLabelling,
  mergeBatches,
  relabelScope,
  relabelBatch,
  buildRelabelPrompt,
  applyRelabel,
  assemble,
};
