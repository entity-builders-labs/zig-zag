/**
 * Deterministic segment assembly from a VALID atom labelling (exhaustive
 * source-atom labelling, milestone B; spike `assemble`).
 *
 * - Order is atom order, then span position inside the atom; never a
 *   model-written ordinal.
 * - A TRANSFER atom closes the current segment once that segment has
 *   membership from a non-TRANSFER atom; adjacent TRANSFER atoms (with no
 *   membership-bearing atom between them) form one boundary, so
 *   back-to-back transfers never create empty segments.
 * - A transfer's entities are TRANSFER_DESTINATION provenance of the segment
 *   it opens, never membership; a later content atom may still make the
 *   same place a stop.
 * - Only ITINERARY_STOP entities are mandatory. OPTIONAL_STOP stays
 *   optional, ALTERNATIVE entities form choice groups (`A or B` never
 *   becomes `A + B`), ROUTE_LEG is route provenance and PASS_BY context.
 * - An exact folded-name repeat inside one segment is one member with all
 *   provenance; the strongest role wins. String equality, not identity.
 */
import {
  AssembledSegment,
  AtomLabellingValidation,
  ModelEntityRole,
  RoleConflict,
  SegmentMember,
  SegmentMemberProvenance,
  StructuredSourceAtom,
  TransferBoundaryAtom,
  TransferDestinationProvenance,
} from '../interfaces/atomized-source-unit.interface';
import { ENTITY_ROLE_PRECEDENCE } from './atom-labelling-contract.util';
import { foldAtomText } from './source-atomization.util';

/** Roles that never count as a segment's own membership for transfer
 * boundaries: a segment holding only these is not closed by a transfer. */
const CONTEXT_ROLES = new Set<ModelEntityRole>(['ROUTE_LEG', 'PASS_BY']);

interface OpenSegment {
  segmentIndex: number;
  firstAtomId: string;
  lastAtomId: string;
  openedBy: TransferBoundaryAtom[];
  transferDestinations: TransferDestinationProvenance[];
  members: Array<Omit<SegmentMember, 'position'> & { key: string }>;
  hasOwnMembership: boolean;
  altRun: { groupId: string } | null;
}

export function assembleAtomSegments(
  atoms: readonly StructuredSourceAtom[],
  validation: AtomLabellingValidation,
): AssembledSegment[] {
  if (!validation.valid)
    throw new Error('ASSEMBLY_REFUSED: labelling is invalid (fail closed)');
  for (const l of validation.labels.values()) {
    if (l.entities.some((e) => e.anaphor && e.anaphor.status !== 'RESOLVED'))
      throw new Error(
        `ASSEMBLY_REFUSED: unresolved anaphor on ${l.atomId} (run resolveAtomMentions)`,
      );
  }
  if (atoms.length === 0) return [];
  const segments: OpenSegment[] = [];
  const open = (
    atomId: string,
    transfer?: TransferBoundaryAtom,
  ): OpenSegment => {
    const s: OpenSegment = {
      segmentIndex: segments.length + 1,
      firstAtomId: atomId,
      lastAtomId: atomId,
      openedBy: transfer ? [transfer] : [],
      transferDestinations: [],
      members: [],
      hasOwnMembership: false,
      altRun: null,
    };
    segments.push(s);
    return s;
  };
  let current = open(atoms[0].atomId);
  for (const atom of atoms) {
    const label = validation.labels.get(atom.atomId);
    if (label.source === 'MODEL' && label.kind === 'TRANSFER') {
      const boundary: TransferBoundaryAtom = {
        atomId: atom.atomId,
        transferMode: label.transferMode ?? 'UNSPECIFIED',
      };
      if (current.hasOwnMembership) current = open(atom.atomId, boundary);
      else current.openedBy.push(boundary);
      current.altRun = null;
    }
    current.lastAtomId = atom.atomId;
    for (const e of label.entities.filter(
      (x) => x.role === 'TRANSFER_DESTINATION',
    )) {
      current.transferDestinations.push({
        sourceName: e.sourceName,
        atomId: atom.atomId,
        supportSpan: e.supportSpan,
        ...(e.modelRole ? { modelRole: e.modelRole } : {}),
      });
    }
    const memberEntities = label.entities.filter(
      (x) => x.role !== 'TRANSFER_DESTINATION',
    );
    if (!memberEntities.length) continue;
    const roleOf = (role: string) => role as ModelEntityRole;
    if (memberEntities.some((e) => !CONTEXT_ROLES.has(roleOf(e.role))))
      current.hasOwnMembership = true;
    const hasAlt = memberEntities.some((e) => e.role === 'ALTERNATIVE');
    const hasOther = memberEntities.some((e) => e.role !== 'ALTERNATIVE');
    if (hasOther || !hasAlt) current.altRun = null;
    if (hasAlt && !current.altRun)
      current.altRun = { groupId: `${current.segmentIndex}.${atom.atomId}` };
    for (const e of memberEntities) {
      const role = roleOf(e.role);
      const key = foldAtomText(e.sourceName);
      const provenance: SegmentMemberProvenance = {
        atomId: atom.atomId,
        supportSpan: e.supportSpan,
        sourceStart: e.sourceStart,
        sourceEnd: e.sourceEnd,
        role,
        ...(e.mention ? { mention: e.mention } : {}),
        ...(e.anaphor ? { anaphor: e.anaphor } : {}),
      };
      const existing = current.members.find((m) => m.key === key);
      if (existing) {
        existing.provenance.push(provenance);
        if (
          ENTITY_ROLE_PRECEDENCE.indexOf(role) <
          ENTITY_ROLE_PRECEDENCE.indexOf(existing.role)
        ) {
          existing.role = role;
          delete existing.alternativeGroup;
          if (role === 'ALTERNATIVE')
            existing.alternativeGroup = current.altRun.groupId;
        }
        continue;
      }
      current.members.push({
        key,
        sourceName: e.sourceName,
        role,
        ...(role === 'ALTERNATIVE'
          ? { alternativeGroup: current.altRun.groupId }
          : {}),
        provenance: [provenance],
      });
    }
    if (hasOther && hasAlt) current.altRun = null;
  }
  return segments.map((s): AssembledSegment => {
    const members: SegmentMember[] = s.members.map((m, i) => ({
      position: i + 1,
      sourceName: m.sourceName,
      role: m.role,
      ...(m.alternativeGroup ? { alternativeGroup: m.alternativeGroup } : {}),
      provenance: m.provenance,
    }));
    const groups = new Map<string, string[]>();
    for (const m of members) {
      if (m.alternativeGroup)
        groups.set(m.alternativeGroup, [
          ...(groups.get(m.alternativeGroup) ?? []),
          m.sourceName,
        ]);
    }
    // ROLE_CONFLICT: one folded name labelled both ROUTE_LEG and
    // ITINERARY_STOP in this segment. The stronger role is kept (never a
    // silent demotion) and the disagreement is made visible.
    const conflicts: RoleConflict[] = members
      .filter(
        (m) =>
          m.provenance.some((p) => p.role === 'ROUTE_LEG') &&
          m.provenance.some((p) => p.role === 'ITINERARY_STOP'),
      )
      .map((m) => ({
        code: 'ROLE_CONFLICT',
        sourceName: m.sourceName,
        routeLegAtoms: m.provenance
          .filter((p) => p.role === 'ROUTE_LEG')
          .map((p) => p.atomId),
        stopAtoms: m.provenance
          .filter((p) => p.role === 'ITINERARY_STOP')
          .map((p) => p.atomId),
      }));
    const named = (role: ModelEntityRole) =>
      members.filter((m) => m.role === role).map((m) => m.sourceName);
    return {
      segmentIndex: s.segmentIndex,
      firstAtomId: s.firstAtomId,
      lastAtomId: s.lastAtomId,
      openedBy: s.openedBy,
      transferDestinations: s.transferDestinations,
      conflicts,
      mandatory: named('ITINERARY_STOP'),
      optional: named('OPTIONAL_STOP'),
      alternativeGroups: [...groups.values()],
      routeLegs: named('ROUTE_LEG'),
      passBy: named('PASS_BY'),
      members,
    };
  });
}

/** Only ITINERARY_STOP members are mandatory component membership. */
export function mandatorySegmentMembers(
  segment: AssembledSegment,
): SegmentMember[] {
  return segment.members.filter((m) => m.role === 'ITINERARY_STOP');
}
