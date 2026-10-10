/**
 * From assembled atom segments to extractor-shaped candidates (exhaustive
 * source-atom labelling, milestone B).
 *
 * Each assembled segment with mandatory (ITINERARY_STOP) membership is one
 * source-defined composition candidate. Its component hints are exactly its
 * mandatory members, in source order. ROUTE_LEG, OPTIONAL_STOP,
 * ALTERNATIVE, PASS_BY and TRANSFER_DESTINATION entities never become
 * component hints: the candidate model has no non-membership component
 * role, so they stay extraction provenance (the trace).
 *
 * The candidates are raw extractor-shaped objects on purpose: they enter
 * the unchanged `extractExperienceCandidates` source-support and
 * normalization gate exactly like generative output, so downstream source
 * support, identity, geography, dedupe and persistence see no second
 * contract.
 */
import {
  AssembledSegment,
  AtomLabellingResult,
  AtomizedEntityTrace,
  AtomizedNonMembershipTrace,
  AtomizedSourceUnitTrace,
  LabelledEntity,
  MemberKindIssue,
  MemberPhysicalKind,
  SegmentMember,
  StructuredSourceAtom,
} from '../interfaces/atomized-source-unit.interface';
import { GeoEntityHint } from '../interfaces/experience-discovery.interface';
import {
  ATOM_LABELLING_PROMPT_VERSION,
  MEMBER_KIND_PROMPT_VERSION,
  MEMBER_PHYSICAL_KINDS,
  MemberKindPromptMember,
} from '../prompts/source-atom-labelling.prompt';
import { mandatorySegmentMembers } from './atom-segment-assembly.util';
import {
  ATOMIZER_VERSION,
  EDITORIAL_STRUCTURE_VERSION,
  foldAtomText,
  presentAtomText,
  visibleHeadingText,
} from './source-atomization.util';
import { SourceContentWindowingAudit } from './source-content-windowing.util';

/**
 * The single routing predicate: only a whole editorial unit
 * (`SECTION_UNIT`, `sectionComplete: true`) is atomized, and for that unit
 * the atomized contract is the sole composition authority. Every other
 * window keeps the generative path and its fail-closed continuation rules.
 */
export function isAtomizableSourceUnit(
  windowing: Pick<
    SourceContentWindowingAudit,
    'selectionStrategy' | 'sectionComplete'
  >,
): boolean {
  return (
    windowing.selectionStrategy === 'SECTION_UNIT' &&
    windowing.sectionComplete === true
  );
}

/** Segments that become candidates: those with mandatory membership. */
export function candidateSegments(
  segments: readonly AssembledSegment[],
): AssembledSegment[] {
  return segments.filter((s) => s.mandatory.length > 0);
}

// ---------------------------------------------------------------------------
// Member physical kind
// ---------------------------------------------------------------------------

const memberId = (index: number) => `m-${index + 1}`;

/** The kind-call input for one segment: its mandatory members by ID. */
export function memberKindPromptMembers(
  segment: AssembledSegment,
  atomsById: ReadonlyMap<string, StructuredSourceAtom>,
): MemberKindPromptMember[] {
  return mandatorySegmentMembers(segment).map((member, index) => {
    const atomIds = [
      ...new Set(
        member.provenance.flatMap((p) =>
          p.mention ? [p.mention.atomId, p.atomId] : [p.atomId],
        ),
      ),
    ].sort();
    return {
      memberId: memberId(index),
      sourceName: member.sourceName,
      sourceText: atomIds.map(
        (id) => presentAtomText(atomsById.get(id).text).text,
      ),
    };
  });
}

/**
 * Exactly one valid physical kind per member ID. Any missing, duplicate,
 * unknown, malformed or invalid entry is an issue: the unit then fails
 * closed. A member is never dropped or defaulted to make the call pass.
 */
export function validateMemberKinds(
  segmentIndex: number,
  memberIds: readonly string[],
  response: unknown,
): { kinds: Map<string, MemberPhysicalKind>; issues: MemberKindIssue[] } {
  const kinds = new Map<string, MemberPhysicalKind>();
  const issues: MemberKindIssue[] = [];
  const entries =
    response && typeof response === 'object' && !Array.isArray(response)
      ? (response as { members?: unknown }).members
      : undefined;
  if (!Array.isArray(entries)) {
    issues.push({
      code: 'KIND_MALFORMED_RESPONSE',
      segmentIndex,
      detail: 'expected an object with a members array',
    });
    return { kinds, issues };
  }
  const expected = new Set(memberIds);
  const seen = new Set<string>();
  for (const raw of entries as unknown[]) {
    const entry =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
    if (!entry || typeof entry.memberId !== 'string') {
      issues.push({
        code: 'KIND_MALFORMED_ENTRY',
        segmentIndex,
        detail: JSON.stringify(raw),
      });
      continue;
    }
    const id = entry.memberId;
    if (!expected.has(id)) {
      issues.push({ code: 'KIND_UNKNOWN_MEMBER', segmentIndex, memberId: id });
      continue;
    }
    if (seen.has(id)) {
      issues.push({
        code: 'KIND_DUPLICATE_MEMBER',
        segmentIndex,
        memberId: id,
      });
      continue;
    }
    seen.add(id);
    const kind = entry.physicalKind as MemberPhysicalKind;
    if (!MEMBER_PHYSICAL_KINDS.includes(kind)) {
      issues.push({
        code: 'KIND_INVALID',
        segmentIndex,
        memberId: id,
        detail: JSON.stringify(entry.physicalKind),
      });
      continue;
    }
    kinds.set(id, kind);
  }
  for (const id of memberIds) {
    if (!seen.has(id))
      issues.push({ code: 'KIND_MISSING_MEMBER', segmentIndex, memberId: id });
  }
  return { kinds, issues };
}

// ---------------------------------------------------------------------------
// Source-derived candidate names (owner decision, milestone B):
//   1. the SECTION_UNIT heading;
//   2. with several candidate segments, heading + the segment's own
//      source heading when exactly one exists;
//   3. the grounded source title when the unit has no heading;
//   4. a structural " (part N of M)" suffix only to disambiguate several
//      segments that have no source-backed name.
// ---------------------------------------------------------------------------

function unitHeading(atoms: readonly StructuredSourceAtom[]): {
  atomId?: string;
  text?: string;
} {
  const first = atoms[0];
  if (!first || first.blockKind !== 'HEADING' || !first.editorial) return {};
  const text = visibleHeadingText(first.text);
  return text ? { atomId: first.atomId, text } : {};
}

function segmentHeading(
  segment: AssembledSegment,
  atoms: readonly StructuredSourceAtom[],
  unitHeadingAtomId: string | undefined,
): string | undefined {
  const first = atoms.findIndex((a) => a.atomId === segment.firstAtomId);
  const last = atoms.findIndex((a) => a.atomId === segment.lastAtomId);
  const headings = atoms
    .slice(first, last + 1)
    .filter(
      (a) =>
        a.blockKind === 'HEADING' &&
        a.editorial &&
        a.atomId !== unitHeadingAtomId,
    )
    .map((a) => visibleHeadingText(a.text))
    .filter(Boolean);
  return headings.length === 1 ? headings[0] : undefined;
}

/**
 * Candidate names by segment index, or null when neither a unit heading nor
 * a source title exists (the name stays unknown; no candidate is built).
 */
export function nameAtomizedCandidates(
  segments: readonly AssembledSegment[],
  atoms: readonly StructuredSourceAtom[],
  sourceTitle: string | undefined,
): Map<number, string> | null {
  const heading = unitHeading(atoms);
  const base = heading.text ?? sourceTitle?.trim();
  if (!base) return null;
  const names = new Map<number, string>();
  if (segments.length === 1) {
    names.set(segments[0].segmentIndex, base);
    return names;
  }
  const part = (i: number) => `${base} (part ${i + 1} of ${segments.length})`;
  segments.forEach((segment, i) => {
    const own = segmentHeading(segment, atoms, heading.atomId);
    names.set(segment.segmentIndex, own ? `${base} — ${own}` : part(i));
  });
  // Two segments under the same source heading text still need distinct
  // names: only those fall back to the structural suffix.
  const counts = new Map<string, number>();
  for (const n of names.values()) counts.set(n, (counts.get(n) ?? 0) + 1);
  segments.forEach((segment, i) => {
    if (counts.get(names.get(segment.segmentIndex)) > 1)
      names.set(segment.segmentIndex, part(i));
  });
  return names;
}

// ---------------------------------------------------------------------------
// Component hints
// ---------------------------------------------------------------------------

/**
 * Component role for a physical kind, as the generative extraction contract
 * already defines it ("venue" for a point, "route" for a named street or
 * path, "area" for a district).
 */
const HINT_ROLE_BY_KIND: Record<MemberPhysicalKind, GeoEntityHint['role']> = {
  PLACE: 'venue',
  AREA: 'area',
  ROUTE: 'route',
};

/**
 * The literal source text that supports a member, for the unchanged
 * source-support gate: the first stop occurrence whose own span names the
 * member, else any occurrence that names it, else the antecedent span of a
 * resolved anaphor, else the first stop occurrence. Always a verbatim slice
 * of the unit, so the gate checks the source itself, not model wording.
 */
export function memberSupportSpan(
  member: SegmentMember,
  unitText: string,
): string {
  const name = foldAtomText(member.sourceName);
  const names = (p: SegmentMember['provenance'][number]) =>
    foldAtomText(p.supportSpan).includes(name);
  const stops = member.provenance.filter((p) => p.role === 'ITINERARY_STOP');
  const chosen =
    stops.find(names) ?? member.provenance.find(names) ?? undefined;
  if (chosen) return unitText.slice(chosen.sourceStart, chosen.sourceEnd);
  const viaMention = stops.find((p) => p.mention);
  if (viaMention)
    return unitText.slice(
      viaMention.mention.sourceStart,
      viaMention.mention.sourceEnd,
    );
  const first = stops[0] ?? member.provenance[0];
  return unitText.slice(first.sourceStart, first.sourceEnd);
}

/**
 * The member's source wording as a hint name: enclosing quote and emphasis
 * marks are removed (`"Farmacia la Estrella"` -> `Farmacia la Estrella`).
 * The atom contract already treats those marks as non-content; the words
 * themselves are never changed, so this is not a normalization.
 */
export function memberHintName(sourceName: string): string {
  const trimmed = sourceName.trim();
  const bare = trimmed.replace(/^[\s*_`"'“”‘’«»]+|[\s*_`"'“”‘’«»]+$/gu, '');
  return bare || trimmed;
}

/** Extractor-shaped candidate for `extractExperienceCandidates`. */
export interface AtomizedRawCandidate {
  name: string;
  themes: string[];
  traits: string[];
  intents: string[];
  componentHints: Array<{
    key: string;
    name: string;
    role: GeoEntityHint['role'];
    expectedKind: MemberPhysicalKind;
    evidenceKeys: string[];
    supportSpan: string;
  }>;
  evidenceKeys: string[];
  shortReason: string;
  orderedByEvidence: boolean;
}

/**
 * One raw candidate per candidate segment.
 *
 * - `name` is the member's exact source wording (`memberHintName`) and no
 *   `sourceName` or `normalizationKind` is written: no normalization
 *   happened, so none is claimed (the gate's case "sourceName absent ->
 *   sourceName = name").
 * - Themes, intents and traits are left empty: they are not part of the
 *   atom contract, and evidence-only classification owns them after
 *   persistence. Unknown stays unknown.
 * - `orderedByEvidence` is true: the order is the source's own atom order,
 *   never a model-written ordinal.
 */
export function buildAtomizedRawCandidates(input: {
  segments: readonly AssembledSegment[];
  kindsBySegment: ReadonlyMap<number, ReadonlyMap<string, MemberPhysicalKind>>;
  names: ReadonlyMap<number, string>;
  evidenceKey: string;
  unitText: string;
}): AtomizedRawCandidate[] {
  return input.segments.map((segment) => {
    const kinds = input.kindsBySegment.get(segment.segmentIndex);
    const componentHints = mandatorySegmentMembers(segment).map(
      (member, index) => {
        const expectedKind = kinds.get(memberId(index));
        return {
          key: memberId(index),
          name: memberHintName(member.sourceName),
          role: HINT_ROLE_BY_KIND[expectedKind],
          expectedKind,
          evidenceKeys: [input.evidenceKey],
          supportSpan: memberSupportSpan(member, input.unitText),
        };
      },
    );
    const candidate: AtomizedRawCandidate = {
      name: input.names.get(segment.segmentIndex),
      themes: [],
      traits: [],
      intents: [],
      componentHints,
      evidenceKeys: [input.evidenceKey],
      shortReason: `atomized source unit, segment ${segment.segmentIndex}`,
      orderedByEvidence: true,
    };
    return candidate;
  });
}

// ---------------------------------------------------------------------------
// Pre-identity trace
// ---------------------------------------------------------------------------

export interface AtomizedUnitTraceContext {
  sourceUrl: string;
  evidenceKey: string;
  windowing: Pick<
    SourceContentWindowingAudit,
    'selectionStrategy' | 'sectionComplete' | 'windowOrdinal'
  >;
  extractorProvider: string;
  extractorModel: string;
  memberKindIssues: MemberKindIssue[];
  kindsBySegment: ReadonlyMap<number, ReadonlyMap<string, MemberPhysicalKind>>;
  names: ReadonlyMap<number, string> | null;
}

/**
 * Everything needed to prove what extraction produced BEFORE identity, so
 * "the source yielded mandatory sequence A → B → C, then identity failed on
 * C" is demonstrable without a persisted Experience. Semantic fidelity
 * against an oracle is attached by evaluation, never computed here. Holds
 * no credentials: only source text slices, IDs, offsets and labels.
 */
export function buildAtomizedUnitTrace(
  result: AtomLabellingResult,
  context: AtomizedUnitTraceContext,
): AtomizedSourceUnitTrace {
  const v = result.final ?? result.first;
  const entityTrace = (e: LabelledEntity): AtomizedEntityTrace => ({
    sourceName: e.sourceName,
    role: e.role,
    supportSpan: e.supportSpan,
    sourceStart: e.sourceStart,
    sourceEnd: e.sourceEnd,
    ...(e.modelRole ? { modelRole: e.modelRole } : {}),
    ...(e.anaphor
      ? {
          mentionAtomId: e.anaphor.mentionAtomId,
          anaphorStatus: e.anaphor.status,
          surfaceForm: e.anaphor.surfaceForm,
          ...(e.anaphor.antecedent
            ? {
                antecedentAtomId: e.anaphor.antecedent.atomId,
                antecedentSourceName: e.anaphor.antecedent.sourceName,
              }
            : {}),
        }
      : {}),
  });
  const segments = result.segments ?? [];
  const nonMembership = new Map<string, AtomizedNonMembershipTrace>();
  const addNonMember = (
    role: AtomizedNonMembershipTrace['role'],
    sourceName: string,
    atomIds: string[],
  ) => {
    const key = `${role}|${foldAtomText(sourceName)}`;
    const existing = nonMembership.get(key);
    if (existing)
      existing.atomIds = [...new Set([...existing.atomIds, ...atomIds])];
    else nonMembership.set(key, { role, sourceName, atomIds });
  };
  for (const s of segments) {
    for (const m of s.members) {
      if (m.role !== 'ITINERARY_STOP')
        addNonMember(
          m.role,
          m.sourceName,
          m.provenance.map((p) => p.atomId),
        );
    }
    for (const d of s.transferDestinations)
      addNonMember('TRANSFER_DESTINATION', d.sourceName, [d.atomId]);
  }
  const atoms = result.atoms;
  return {
    sourceUnitId: `${context.evidenceKey}:w${context.windowing.windowOrdinal}:${result.atomization.unitSha256.slice(0, 12)}`,
    sourceUrl: context.sourceUrl,
    evidenceKey: context.evidenceKey,
    selectionStrategy: context.windowing.selectionStrategy,
    sectionComplete: context.windowing.sectionComplete,
    windowOrdinal: context.windowing.windowOrdinal,
    unitLength: result.atomization.unitLength,
    unitSha256: result.atomization.unitSha256,
    versions: {
      atomizer: ATOMIZER_VERSION,
      structure: EDITORIAL_STRUCTURE_VERSION,
      prompt: ATOM_LABELLING_PROMPT_VERSION,
      memberKindPrompt: MEMBER_KIND_PROMPT_VERSION,
    },
    extractorProvider: context.extractorProvider,
    extractorModel: context.extractorModel,
    atomCount: atoms.length,
    editorialAtomCount: atoms.filter((a) => a.editorial).length,
    nonEditorialAtomCount: atoms.filter((a) => !a.editorial).length,
    nonEditorialBlocks: result.structure.blocks,
    atoms: atoms.map((a) => {
      const l = v?.labels.get(a.atomId);
      return {
        atomId: a.atomId,
        sourceStart: a.sourceStart,
        sourceEnd: a.sourceEnd,
        editorial: a.editorial,
        label: l ? l.kind : null,
        ...(l?.source === 'MODEL'
          ? { modelClassification: l.modelClassification }
          : {}),
        ...(l?.source === 'MODEL' && l.transferMode
          ? { transferMode: l.transferMode }
          : {}),
        entities: (l?.entities ?? []).map(entityTrace),
      };
    }),
    batchCount: result.batches.length,
    batches: result.batches.map((b) => ({
      batchIndex: b.batchIndex,
      atomCount: b.atomIds.length,
      firstAtomId: b.atomIds[0],
      lastAtomId: b.atomIds[b.atomIds.length - 1],
      contextAtomIds: b.contextAtomIds,
    })),
    calls: result.calls,
    relabelAttempts: result.calls.filter((c) => c.kind === 'relabel').length,
    relabel: result.relabel,
    contractOutcome: result.outcome,
    issues: v?.issues ?? [],
    memberKindIssues: context.memberKindIssues,
    notes: v?.notes ?? [],
    providerFailure: result.failure ?? null,
    assembledSegmentCount: result.segments ? result.segments.length : null,
    segments: segments.map((s) => {
      const kinds = context.kindsBySegment.get(s.segmentIndex);
      const candidateName = context.names?.get(s.segmentIndex);
      return {
        segmentIndex: s.segmentIndex,
        firstAtomId: s.firstAtomId,
        lastAtomId: s.lastAtomId,
        transferBoundary: s.openedBy,
        transferDestinations: s.transferDestinations,
        mandatoryBeforeIdentity: mandatorySegmentMembers(s).map((m, i) => {
          const physicalKind = kinds?.get(memberId(i));
          return {
            position: i + 1,
            sourceName: m.sourceName,
            ...(physicalKind ? { physicalKind } : {}),
            provenanceAtomIds: m.provenance.map((p) => p.atomId),
            provenance: m.provenance.map((p) => ({
              atomId: p.atomId,
              role: p.role,
              supportSpan: p.supportSpan,
              sourceStart: p.sourceStart,
              sourceEnd: p.sourceEnd,
              ...(p.anaphor
                ? {
                    mentionAtomId: p.anaphor.mentionAtomId,
                    surfaceForm: p.anaphor.surfaceForm,
                  }
                : {}),
            })),
          };
        }),
        optional: s.optional,
        alternativeGroups: s.alternativeGroups,
        routeLegs: s.routeLegs,
        passBy: s.passBy,
        conflicts: s.conflicts,
        ...(candidateName ? { candidateName } : {}),
      };
    }),
    nonMembership: [...nonMembership.values()],
    candidateNames: segments
      .map((s) => context.names?.get(s.segmentIndex))
      .filter((n): n is string => Boolean(n)),
  };
}
