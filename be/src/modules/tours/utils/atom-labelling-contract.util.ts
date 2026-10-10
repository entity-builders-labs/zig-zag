/**
 * Semantic result contract for exhaustive source-atom labelling (milestone
 * B; spike `atom-labelling.cjs`, accepted v5 representation
 * `ENTITY_ROLES` plus the A.1 structural labels and the A.2 anaphora
 * contract).
 *
 * Every model-visible atom receives exactly one validated label, and every
 * non-editorial atom one structural label; anything else fails the unit
 * closed. Validation never guesses: an invented name, a span outside its
 * atom, an unverifiable reference or a stop claim without a stop entity is
 * an issue with an atom ID, never a repair.
 */
import {
  AtomAnaphor,
  AtomLabel,
  AtomLabellingBatch,
  AtomLabellingIssue,
  AtomLabellingIssueCode,
  AtomLabellingNote,
  AtomLabellingValidation,
  AtomResultKind,
  LabelledEntity,
  ModelAtomClassification,
  ModelAtomLabel,
  ModelEntityRole,
  StructuredSourceAtom,
  TransferMode,
} from '../interfaces/atomized-source-unit.interface';
import {
  MODEL_ATOM_CLASSIFICATIONS,
  MODEL_ENTITY_ROLES,
  TRANSFER_MODES,
} from '../prompts/source-atom-labelling.prompt';
import {
  foldAtomText,
  locateSpanInAtom,
  presentAtomText,
} from './source-atomization.util';

/** About 2500 presented characters per batch (A.3; ~35–40 atoms). */
export const DEFAULT_ATOM_BATCH_MAX_CHARS = 2500;
export const DEFAULT_ATOM_BATCH_CONTEXT_ATOMS = 4;
export const DEFAULT_RELABEL_CONTEXT_ATOMS = 3;

/** Strongest first. */
export const ENTITY_ROLE_PRECEDENCE: readonly ModelEntityRole[] = [
  'ITINERARY_STOP',
  'ROUTE_LEG',
  'OPTIONAL_STOP',
  'ALTERNATIVE',
  'PASS_BY',
];

// ---------------------------------------------------------------------------
// Batching: every editorial atom belongs to exactly one batch; earlier atoms
// may be shown as read-only context, never labelled in that batch.
// ---------------------------------------------------------------------------
export function planAtomBatches(
  atoms: readonly StructuredSourceAtom[],
  {
    maxBatchChars = DEFAULT_ATOM_BATCH_MAX_CHARS,
    contextAtoms = DEFAULT_ATOM_BATCH_CONTEXT_ATOMS,
  }: { maxBatchChars?: number; contextAtoms?: number } = {},
): AtomLabellingBatch[] {
  const batches: StructuredSourceAtom[][] = [];
  let current: StructuredSourceAtom[] = [];
  let chars = 0;
  for (const a of atoms) {
    const size = presentAtomText(a.text).text.length + a.atomId.length + 4;
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
    return {
      batchIndex: index + 1,
      batchCount: batches.length,
      atomIds: members.map((a) => a.atomId),
      contextAtomIds: context.map((a) => a.atomId),
    };
  });
}

// ---------------------------------------------------------------------------
// Validation (fail closed)
// ---------------------------------------------------------------------------

type RawObject = Record<string, unknown>;
const isObject = (value: unknown): value is RawObject =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Validates one response against the atoms it had to label. `scopeAtomIds`
 * is the exact set to label (a batch, a relabel scope or the whole unit).
 * `visibleAtomIds` (LABEL + CONTEXT of the request) bounds what a
 * `mentionAtomId` may cite; omitted = no restriction.
 *
 * Representation R2: the atom kind is CONTENT | TRANSFER | NON_ITINERARY and
 * entity roles are the only role authority. A content atom the model calls
 * a stop must carry an ITINERARY_STOP entity (`STOP_WITHOUT_ENTITY`, the
 * missing-stop signal) and a NON_ITINERARY atom may not carry entities.
 * R1: every entity of a TRANSFER atom becomes `TRANSFER_DESTINATION`
 * provenance, never membership; the model's role stays as `modelRole`.
 */
export function validateAtomLabelling(
  scopeAtomIds: readonly string[],
  atomsById: ReadonlyMap<string, StructuredSourceAtom>,
  response: unknown,
  { visibleAtomIds }: { visibleAtomIds?: readonly string[] } = {},
): AtomLabellingValidation {
  const visible = visibleAtomIds ? new Set(visibleAtomIds) : null;
  const issues: AtomLabellingIssue[] = [];
  const notes: AtomLabellingNote[] = [];
  const labels = new Map<string, AtomLabel>();
  const issue = (
    code: AtomLabellingIssueCode,
    atomId?: string | null,
    detail?: string,
  ) =>
    issues.push({
      code,
      ...(atomId ? { atomId } : {}),
      ...(detail ? { detail } : {}),
    });
  if (!isObject(response) || !Array.isArray(response.atoms)) {
    issue('MALFORMED_RESPONSE', null, 'expected an object with an atoms array');
    return { valid: false, issues, notes, labels };
  }
  const scope = new Set(scopeAtomIds);
  const seen = new Set<string>();
  for (const raw of response.atoms as unknown[]) {
    const atomId =
      isObject(raw) && typeof raw.atomId === 'string' ? raw.atomId : null;
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
    const label = raw as RawObject;
    const atom = atomsById.get(atomId);
    const before = issues.length;
    const classification = label.classification as ModelAtomClassification;
    if (!MODEL_ATOM_CLASSIFICATIONS.includes(classification))
      issue(
        'MALFORMED_LABEL',
        atomId,
        `classification ${JSON.stringify(label.classification)}`,
      );
    if (!Array.isArray(label.entities))
      issue('MALFORMED_LABEL', atomId, 'entities is not an array');
    if (
      label.transferMode !== undefined &&
      (classification !== 'TRANSFER' ||
        !TRANSFER_MODES.includes(label.transferMode as TransferMode))
    )
      issue(
        'MALFORMED_LABEL',
        atomId,
        `transferMode ${JSON.stringify(label.transferMode)}`,
      );
    const entities: LabelledEntity[] = [];
    for (const e of Array.isArray(label.entities)
      ? (label.entities as unknown[])
      : []) {
      if (
        !isObject(e) ||
        typeof e.sourceName !== 'string' ||
        typeof e.supportSpan !== 'string' ||
        !MODEL_ENTITY_ROLES.includes(e.role as ModelEntityRole) ||
        !foldAtomText(e.sourceName)
      ) {
        issue('MALFORMED_LABEL', atomId, `entity ${JSON.stringify(e)}`);
        continue;
      }
      if (
        e.mentionAtomId !== undefined &&
        typeof e.mentionAtomId !== 'string'
      ) {
        issue('MALFORMED_LABEL', atomId, `entity ${JSON.stringify(e)}`);
        continue;
      }
      const sourceName = e.sourceName;
      const supportSpan = e.supportSpan;
      const role = e.role as ModelEntityRole;
      const located = locateSpanInAtom(atom, supportSpan);
      if (!located) {
        issue('SPAN_NOT_IN_ATOM', atomId, supportSpan);
        continue;
      }
      let anaphor: AtomAnaphor | null = null;
      if (e.mentionAtomId !== undefined) {
        const mentionAtomId = e.mentionAtomId as string;
        // Anaphora: the role is shown in this atom, the referent in an
        // earlier editorial atom the model was shown in this request.
        const target = atomsById.get(mentionAtomId);
        if (
          !target ||
          target.ordinal >= atom.ordinal ||
          target.editorial === false ||
          (visible && !visible.has(target.atomId))
        ) {
          issue(
            'BAD_MENTION_ATOM',
            atomId,
            `${mentionAtomId} must be an earlier editorial atom presented with this one`,
          );
          continue;
        }
        // A.2: the surface form is written either in this atom's span
        // ("enjoy the park") or in the cited atom (zero anaphora: "Jump
        // inside." naming the place written there). The reference itself is
        // verified against the cited atom's entities by
        // `resolveAtomMentions`.
        const surfaceIn = foldAtomText(supportSpan).includes(
          foldAtomText(sourceName),
        )
          ? 'SPAN'
          : locateSpanInAtom(target, sourceName)
            ? 'MENTION_ATOM'
            : null;
        if (!surfaceIn) {
          issue(
            'NAME_NOT_IN_MENTION_ATOM',
            atomId,
            `${sourceName} / ${mentionAtomId}`,
          );
          continue;
        }
        anaphor = {
          surfaceForm: sourceName,
          mentionAtomId,
          surfaceIn,
          status: 'UNRESOLVED',
        };
      } else if (
        !foldAtomText(supportSpan).includes(foldAtomText(sourceName))
      ) {
        issue('NAME_NOT_IN_SPAN', atomId, `${sourceName} / ${supportSpan}`);
        continue;
      }
      entities.push({
        sourceName,
        supportSpan,
        role,
        ...located,
        ...(anaphor ? { anaphor } : {}),
      });
    }
    if (issues.length === before && Array.isArray(label.entities)) {
      if (classification === 'NON_ITINERARY' && entities.length)
        issue('ROLE_INCONSISTENT', atomId, 'NON_ITINERARY atom with entities');
      if (classification !== 'NON_ITINERARY' && classification !== 'TRANSFER') {
        const strongest = ENTITY_ROLE_PRECEDENCE.find((r) =>
          entities.some((x) => x.role === r),
        );
        if (classification === 'ITINERARY_STOP' && strongest !== classification)
          issue(
            'STOP_WITHOUT_ENTITY',
            atomId,
            `stop claim, strongest entity role ${strongest ?? 'none'}`,
          );
        else if (!entities.length)
          notes.push({ code: `UNNAMED_${classification}`, atomId });
      }
    }
    const kind: AtomResultKind =
      classification === 'TRANSFER' || classification === 'NON_ITINERARY'
        ? classification
        : 'CONTENT';
    const projected: LabelledEntity[] =
      classification === 'TRANSFER'
        ? entities.map((x) => ({
            ...x,
            modelRole: x.role as ModelEntityRole,
            role: 'TRANSFER_DESTINATION',
          }))
        : entities;
    const modelLabel: ModelAtomLabel = {
      atomId,
      source: 'MODEL',
      kind,
      modelClassification: classification,
      entities: projected.sort((a, b) => a.sourceStart - b.sourceStart),
      ...(typeof label.transferMode === 'string'
        ? { transferMode: label.transferMode as TransferMode }
        : {}),
      ...(typeof label.reason === 'string' ? { reason: label.reason } : {}),
    };
    labels.set(atomId, modelLabel);
  }
  for (const id of scopeAtomIds) if (!seen.has(id)) issue('MISSING_ATOM', id);
  return { valid: issues.length === 0, issues, notes, labels };
}

/**
 * The structural labels of the non-editorial atoms, shaped like a valid
 * batch result so `mergeAtomLabellings` re-checks exactly-once accounting
 * across model and structural labels together.
 */
export function structuralAtomLabels(
  atoms: readonly StructuredSourceAtom[],
): AtomLabellingValidation {
  const labels = new Map<string, AtomLabel>();
  for (const a of atoms) {
    if (a.editorial !== false) continue;
    labels.set(a.atomId, {
      atomId: a.atomId,
      source: 'STRUCTURAL',
      kind: 'NON_EDITORIAL',
      structural: a.nonEditorial,
      entities: [],
    });
  }
  return { valid: true, issues: [], notes: [], labels };
}

/**
 * Merges per-batch validations and re-checks the global invariant: every
 * atom of the unit labelled exactly once across all batches and the
 * structural labels.
 */
export function mergeAtomLabellings(
  atoms: readonly StructuredSourceAtom[],
  results: ReadonlyArray<AtomLabellingValidation & { batchIndex?: number }>,
): AtomLabellingValidation {
  const issues: AtomLabellingIssue[] = results.flatMap((r) =>
    r.issues.map((x) =>
      r.batchIndex === undefined ? x : { batchIndex: r.batchIndex, ...x },
    ),
  );
  const labels = new Map<string, AtomLabel>();
  for (const r of results) {
    for (const [id, l] of r.labels) {
      if (labels.has(id))
        issues.push({
          code: 'DUPLICATE_ATOM',
          atomId: id,
          detail: 'labelled in more than one batch',
        });
      else labels.set(id, l);
    }
  }
  for (const a of atoms) {
    if (!labels.has(a.atomId))
      issues.push({
        code: 'MISSING_ATOM',
        atomId: a.atomId,
        detail: 'no batch labelled it',
      });
  }
  const unique: AtomLabellingIssue[] = [];
  const keys = new Set<string>();
  for (const x of issues) {
    const k = `${x.code}|${x.atomId}|${x.detail}`;
    if (!keys.has(k)) {
      unique.push(x);
      keys.add(k);
    }
  }
  return {
    valid: unique.length === 0,
    issues: unique,
    notes: results.flatMap((r) => r.notes ?? []),
    labels,
  };
}

// ---------------------------------------------------------------------------
// Bounded relabel round: the model relabels ONLY the atoms the validator
// rejected, under the same contract; the result is re-validated as a whole.
// An unknown atom ID or a malformed response is not repairable, and a
// second invalid answer fails closed.
// ---------------------------------------------------------------------------
const NON_REPAIRABLE = new Set<AtomLabellingIssueCode>([
  'MALFORMED_RESPONSE',
  'UNKNOWN_ATOM',
]);

/** Atom IDs to relabel, `[]` when valid, or null when not repairable. */
export function atomRelabelScope(
  validation: AtomLabellingValidation,
): string[] | null {
  if (validation.valid) return [];
  if (validation.issues.some((x) => NON_REPAIRABLE.has(x.code) || !x.atomId))
    return null;
  return [...new Set(validation.issues.map((x) => x.atomId))];
}

/** A relabel batch: the rejected atoms plus a few preceding atoms as context. */
export function atomRelabelBatch(
  atoms: readonly StructuredSourceAtom[],
  scopeIds: readonly string[],
  {
    contextAtoms = DEFAULT_RELABEL_CONTEXT_ATOMS,
  }: { contextAtoms?: number } = {},
): AtomLabellingBatch {
  const scope = new Set(scopeIds);
  // By position in `atoms` (the editorial subset), not by ordinal.
  const context = new Set<string>();
  atoms.forEach((a, i) => {
    if (!scope.has(a.atomId)) return;
    for (let k = Math.max(0, i - contextAtoms); k < i; k++) {
      if (!scope.has(atoms[k].atomId)) context.add(atoms[k].atomId);
    }
  });
  return {
    batchIndex: 0,
    batchCount: 0,
    atomIds: atoms.filter((a) => scope.has(a.atomId)).map((a) => a.atomId),
    contextAtomIds: atoms
      .filter((a) => context.has(a.atomId))
      .map((a) => a.atomId),
  };
}

/** Replaces the rejected atoms' labels with the relabel result and re-checks. */
export function applyAtomRelabel(
  atoms: readonly StructuredSourceAtom[],
  first: AtomLabellingValidation,
  scopeIds: readonly string[],
  second: AtomLabellingValidation,
): AtomLabellingValidation {
  const scope = new Set(scopeIds);
  const labels = new Map([...first.labels].filter(([id]) => !scope.has(id)));
  const issues: AtomLabellingIssue[] = [
    ...first.issues.filter((x) => !scope.has(x.atomId)),
    ...second.issues.map((x) => ({ relabel: true, ...x })),
  ];
  for (const [id, l] of second.labels) labels.set(id, l);
  for (const a of atoms) {
    if (!labels.has(a.atomId) && !issues.some((x) => x.atomId === a.atomId))
      issues.push({ code: 'MISSING_ATOM', atomId: a.atomId });
  }
  const notes = [
    ...(first.notes ?? []).filter((x) => !scope.has(x.atomId)),
    ...(second.notes ?? []),
  ];
  return { valid: issues.length === 0, issues, notes, labels };
}

// ---------------------------------------------------------------------------
// Anaphora resolution (A.2), unit level, after batches merge (an antecedent
// may sit in an earlier batch). The LLM names the antecedent atom; code only
// verifies that explicit reference against the entities the cited atom
// itself carries:
//   1. the exact canonical name (a repeat is not ambiguous);
//   2. else the ONE cited entity whose name contains the surface form as
//      whole words ("Plaza" in "Plaza de Mayo");
//   3. else the cited atom's only entity ("park" -> "Parque Lezama").
// Several candidates fail closed as ambiguous; none fails closed as missing.
// This is not a global search and not a pronoun/NLP inference engine. Pure:
// every anaphor is recomputed from its recorded surface form, so it runs
// again after a relabel round.
// ---------------------------------------------------------------------------
const MENTION_ISSUES = new Set<AtomLabellingIssueCode>([
  'MENTION_ANTECEDENT_MISSING',
  'MENTION_ANTECEDENT_AMBIGUOUS',
]);

export function resolveAtomMentions(
  validation: AtomLabellingValidation,
): AtomLabellingValidation {
  const issues = validation.issues.filter((x) => !MENTION_ISSUES.has(x.code));
  const labels = new Map(validation.labels);
  // Atom IDs are zero-padded ordinals: lexical order is source order, so an
  // antecedent is final before any atom that cites it (a chain resolves hop
  // by hop).
  for (const id of [...labels.keys()].sort()) {
    const label = labels.get(id);
    if (!label.entities.some((e) => e.anaphor)) continue;
    const entities = label.entities.map((e): LabelledEntity => {
      if (!e.anaphor) return e;
      const { surfaceForm, mentionAtomId, surfaceIn } = e.anaphor;
      const base: LabelledEntity = {
        ...e,
        sourceName: surfaceForm,
        anaphor: {
          surfaceForm,
          mentionAtomId,
          surfaceIn,
          status: 'UNRESOLVED',
        },
      };
      delete base.mention;
      const antecedent = labels.get(mentionAtomId);
      // Entities the cited atom carries, by canonical name; an anaphor of
      // its own counts only once resolved.
      const supported = new Map<string, LabelledEntity>();
      for (const x of antecedent?.entities ?? []) {
        if (x.anaphor && x.anaphor.status !== 'RESOLVED') continue;
        if (!supported.has(foldAtomText(x.sourceName)))
          supported.set(foldAtomText(x.sourceName), x);
      }
      const surface = ` ${foldAtomText(surfaceForm)} `;
      const containing = [...supported.values()].filter((x) =>
        ` ${foldAtomText(x.sourceName)} `.includes(surface),
      );
      const ref =
        supported.get(foldAtomText(surfaceForm)) ??
        (containing.length === 1 ? containing[0] : null) ??
        (!containing.length && supported.size === 1
          ? [...supported.values()][0]
          : null);
      if (!ref) {
        const code: AtomLabellingIssueCode = supported.size
          ? 'MENTION_ANTECEDENT_AMBIGUOUS'
          : 'MENTION_ANTECEDENT_MISSING';
        const names = [...supported.values()].map((x) => x.sourceName);
        issues.push({
          code,
          atomId: id,
          detail: `${surfaceForm} / ${mentionAtomId}${
            names.length
              ? `: ${names.join(' | ')}`
              : antecedent
                ? ': no entity'
                : ': antecedent not validly labelled'
          }`,
        });
        return { ...base, anaphor: { ...base.anaphor, status: code } };
      }
      return {
        ...base,
        sourceName: ref.sourceName,
        mention: {
          atomId: mentionAtomId,
          sourceStart: ref.sourceStart,
          sourceEnd: ref.sourceEnd,
        },
        anaphor: {
          ...base.anaphor,
          status: 'RESOLVED',
          antecedent: {
            atomId: mentionAtomId,
            sourceName: ref.sourceName,
            supportSpan: ref.supportSpan,
            role: ref.role,
          },
        },
      };
    });
    labels.set(id, { ...label, entities });
  }
  return { ...validation, valid: issues.length === 0, issues, labels };
}
