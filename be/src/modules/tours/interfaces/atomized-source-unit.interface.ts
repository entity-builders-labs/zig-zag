/**
 * Exhaustive source-atom labelling contract (RW4-EXTRACT-COMPLETENESS-1,
 * milestone B). Architecture: `docs/architecture/activity-discovery-and-
 * tour-generation.md`, "Experience Domain V2 — exhaustive source-atom
 * labelling amendment (2026-10-06)". Accepted spike:
 * `spikes/rw4-atom-labelling-2026-10-06/`.
 *
 * A complete editorial unit (`SECTION_UNIT`, `sectionComplete: true`) is
 * split deterministically into source atoms, the LLM labels every editorial
 * atom exactly once, and deterministic code assembles ordered segments from
 * those labels. The LLM is the only semantic authority; code never infers
 * itinerary meaning from words.
 */
import { GeoEntityHint } from './experience-discovery.interface';
import { SourceContentSelectionStrategy } from '../utils/source-content-windowing.util';

// ---------------------------------------------------------------------------
// Source atoms (deterministic, semantic-neutral)
// ---------------------------------------------------------------------------

/** Neutral text structure the atom was split from. */
export type SourceAtomBlockKind =
  | 'HEADING'
  | 'LIST_ITEM'
  | 'TABLE_CELL'
  | 'LINE';

/** Bounded split of one over-long piece, with offsets into the unit. */
export interface SourceAtomFragment {
  /** 1-based position of this fragment in its group. */
  index: number;
  count: number;
  groupStart: number;
  groupEnd: number;
}

export interface SourceAtom {
  /** `a-NNN`: the zero-padded ordinal in source order. Stable for identical
   * input; batching never changes it. */
  atomId: string;
  ordinal: number;
  /** Offsets into the editorial unit text, `text === unit.slice(start, end)`. */
  sourceStart: number;
  sourceEnd: number;
  text: string;
  blockKind: SourceAtomBlockKind;
  blockOrdinal: number;
  fragment?: SourceAtomFragment;
}

/** A range of the unit that is not an atom; it carries no letter or number. */
export type SourceSeparatorKind =
  | 'WHITESPACE'
  | 'NEWLINE'
  | 'TABLE_PIPE'
  | 'MARKUP';

export interface SourceSeparator {
  start: number;
  end: number;
  kind: SourceSeparatorKind;
}

/** Atoms and separators partition `[0, unitLength)` exactly. */
export interface SourceAtomization {
  version: string;
  maxAtomChars: number;
  unitLength: number;
  unitSha256: string;
  atoms: SourceAtom[];
  separators: SourceSeparator[];
}

export type SourceCoverageProblemCode =
  | 'GAP'
  | 'OVERLAP'
  | 'ATOM_TEXT_MISMATCH'
  | 'SEPARATOR_HAS_CONTENT'
  | 'DUPLICATE_ATOM_ID';

export interface SourceCoverageProblem {
  code: SourceCoverageProblemCode;
  start?: number;
  end?: number;
}

// ---------------------------------------------------------------------------
// Editorial structure (A.1 source-noise boundary)
// ---------------------------------------------------------------------------

/** Structural reason an atom is outside editorial content. Link structure
 * only: never a word list. */
export type NonEditorialReason = 'NAVIGATION_BLOCK';

export interface NonEditorialBlock {
  blockId: string;
  reason: NonEditorialReason;
  firstAtomId: string;
  lastAtomId: string;
  atomCount: number;
  sourceStart: number;
  sourceEnd: number;
}

/** An atom with its editorial flag. IDs, ordinals and offsets are unchanged. */
export interface StructuredSourceAtom extends SourceAtom {
  editorial: boolean;
  nonEditorial?: { reason: NonEditorialReason; blockId: string };
}

export interface EditorialStructure {
  version: string;
  minRun: number;
  atoms: StructuredSourceAtom[];
  blocks: NonEditorialBlock[];
}

// ---------------------------------------------------------------------------
// Semantic result contract
// ---------------------------------------------------------------------------

/** The model's fine atom classification (labelling prompt v4). Kept for
 * audit; it is never a membership authority. */
export type ModelAtomClassification =
  | 'ITINERARY_STOP'
  | 'ROUTE_LEG'
  | 'OPTIONAL_STOP'
  | 'ALTERNATIVE'
  | 'TRANSFER'
  | 'PASS_BY'
  | 'NON_ITINERARY';

/** Roles the model may write on an entity. */
export type ModelEntityRole =
  | 'ITINERARY_STOP'
  | 'ROUTE_LEG'
  | 'OPTIONAL_STOP'
  | 'ALTERNATIVE'
  | 'PASS_BY';

/**
 * Entity roles after projection: the only membership authority. Every
 * entity of a `TRANSFER` atom is `TRANSFER_DESTINATION`, structurally, so a
 * transfer's destination is provenance and never membership.
 */
export type SemanticEntityRole = ModelEntityRole | 'TRANSFER_DESTINATION';

/** Minimal structural kind of a model-labelled atom (representation R2). */
export type AtomResultKind = 'CONTENT' | 'TRANSFER' | 'NON_ITINERARY';

export type TransferMode =
  | 'BUS'
  | 'TAXI'
  | 'METRO'
  | 'TRAIN'
  | 'TRAM'
  | 'FERRY'
  | 'CAR'
  | 'OTHER_MOTORIZED'
  | 'UNSPECIFIED';

export type AnaphorStatus =
  | 'UNRESOLVED'
  | 'RESOLVED'
  | 'MENTION_ANTECEDENT_MISSING'
  | 'MENTION_ANTECEDENT_AMBIGUOUS';

/** An explicit `mentionAtomId` reference, verified by code (A.2). */
export interface AtomAnaphor {
  /** The wording the model wrote for the reference ("the park"). */
  surfaceForm: string;
  mentionAtomId: string;
  /** Where the surface form is written: this atom's span, or the cited atom
   * (zero anaphora, "Jump inside."). */
  surfaceIn: 'SPAN' | 'MENTION_ATOM';
  status: AnaphorStatus;
  antecedent?: {
    atomId: string;
    sourceName: string;
    supportSpan: string;
    role: SemanticEntityRole;
  };
}

export interface LabelledEntity {
  /** Exact source wording (resolved anaphors carry the antecedent's). */
  sourceName: string;
  supportSpan: string;
  role: SemanticEntityRole;
  /** The role the model wrote, kept when the projection changed it. */
  modelRole?: ModelEntityRole;
  /** Source offsets of `supportSpan` inside the unit. */
  sourceStart: number;
  sourceEnd: number;
  /** Antecedent span offsets, set once an anaphor resolves. */
  mention?: { atomId: string; sourceStart: number; sourceEnd: number };
  anaphor?: AtomAnaphor;
}

export interface ModelAtomLabel {
  atomId: string;
  source: 'MODEL';
  kind: AtomResultKind;
  modelClassification: ModelAtomClassification;
  entities: LabelledEntity[];
  transferMode?: TransferMode;
  /** Audit only, never authority. */
  reason?: string;
}

/** A non-editorial atom: accounted for without model output. */
export interface StructuralAtomLabel {
  atomId: string;
  source: 'STRUCTURAL';
  kind: 'NON_EDITORIAL';
  structural: { reason: NonEditorialReason; blockId: string };
  entities: LabelledEntity[];
}

export type AtomLabel = ModelAtomLabel | StructuralAtomLabel;

export type AtomLabellingIssueCode =
  | 'MALFORMED_RESPONSE'
  | 'MALFORMED_LABEL'
  | 'UNKNOWN_ATOM'
  | 'DUPLICATE_ATOM'
  | 'MISSING_ATOM'
  | 'SPAN_NOT_IN_ATOM'
  | 'NAME_NOT_IN_SPAN'
  | 'BAD_MENTION_ATOM'
  | 'NAME_NOT_IN_MENTION_ATOM'
  | 'MENTION_ANTECEDENT_MISSING'
  | 'MENTION_ANTECEDENT_AMBIGUOUS'
  | 'STOP_WITHOUT_ENTITY'
  | 'ROLE_INCONSISTENT';

export interface AtomLabellingIssue {
  code: AtomLabellingIssueCode;
  atomId?: string;
  detail?: string;
  /** The batch whose answer raised it (merged results only). */
  batchIndex?: number;
  /** Raised by the relabel answer. */
  relabel?: boolean;
}

/** Audit-only observation: a content atom whose place is unnamed adds no
 * membership ("two ice-cream shops"). Never a failure. */
export interface AtomLabellingNote {
  code: `UNNAMED_${ModelAtomClassification}`;
  atomId: string;
}

export interface AtomLabellingValidation {
  valid: boolean;
  issues: AtomLabellingIssue[];
  notes: AtomLabellingNote[];
  labels: Map<string, AtomLabel>;
}

/** Every editorial atom belongs to exactly one batch; earlier atoms may be
 * shown as read-only context. Relabel batches use index 0. */
export interface AtomLabellingBatch {
  batchIndex: number;
  batchCount: number;
  atomIds: string[];
  contextAtomIds: string[];
}

// ---------------------------------------------------------------------------
// Deterministic assembly
// ---------------------------------------------------------------------------

export interface SegmentMemberProvenance {
  atomId: string;
  supportSpan: string;
  sourceStart: number;
  sourceEnd: number;
  role: ModelEntityRole;
  mention?: { atomId: string; sourceStart: number; sourceEnd: number };
  anaphor?: AtomAnaphor;
}

export interface SegmentMember {
  /** 1-based, in source order. */
  position: number;
  sourceName: string;
  /** Strongest role among the member's occurrences in this segment. */
  role: ModelEntityRole;
  alternativeGroup?: string;
  provenance: SegmentMemberProvenance[];
}

export interface TransferBoundaryAtom {
  atomId: string;
  transferMode: TransferMode;
}

export interface TransferDestinationProvenance {
  sourceName: string;
  atomId: string;
  supportSpan: string;
  modelRole?: ModelEntityRole;
}

export interface RoleConflict {
  code: 'ROLE_CONFLICT';
  sourceName: string;
  routeLegAtoms: string[];
  stopAtoms: string[];
}

export interface AssembledSegment {
  segmentIndex: number;
  /** First and last unit atom this segment spans (its transfer atoms
   * included). Structural range only. */
  firstAtomId: string;
  lastAtomId: string;
  openedBy: TransferBoundaryAtom[];
  transferDestinations: TransferDestinationProvenance[];
  conflicts: RoleConflict[];
  /** ITINERARY_STOP members only: the mandatory sequence before identity. */
  mandatory: string[];
  optional: string[];
  /** `A or B` stays one group; never flattened into `A + B`. */
  alternativeGroups: string[][];
  routeLegs: string[];
  passBy: string[];
  members: SegmentMember[];
}

// ---------------------------------------------------------------------------
// Unit outcome
// ---------------------------------------------------------------------------

/** Extraction outcome per unit, known at runtime. */
export type AtomizedUnitOutcome =
  | 'ASSEMBLED'
  | 'CONTRACT_FAIL_CLOSED'
  | 'INVALID_RUN';

/** Provider calls this contract makes. */
export type AtomizedUnitCallKind = 'batch' | 'relabel' | 'member_kind';

export interface AtomizedUnitCall {
  kind: AtomizedUnitCallKind;
  /** Batch index, 0 for the relabel call, segment index for a kind call. */
  batchIndex: number;
  atomCount: number;
  promptChars: number;
  elapsedMs?: number;
}

/** A provider or transport failure: operational, never semantic. */
export interface AtomizedUnitProviderFailure {
  kind: AtomizedUnitCallKind;
  batchIndex: number;
  message: string;
}

export interface AtomLabellingRelabelRound {
  /** Atom IDs relabelled, or null when the first result was not repairable. */
  scope: string[] | null;
  firstPassIssues: AtomLabellingIssue[];
}

/** Everything the labelling chain established for one unit. */
export interface AtomLabellingResult {
  atomization: SourceAtomization;
  structure: EditorialStructure;
  atoms: StructuredSourceAtom[];
  batches: AtomLabellingBatch[];
  calls: AtomizedUnitCall[];
  outcome: AtomizedUnitOutcome;
  first?: AtomLabellingValidation;
  final?: AtomLabellingValidation;
  relabel: AtomLabellingRelabelRound | null;
  segments: AssembledSegment[] | null;
  failure?: AtomizedUnitProviderFailure;
}

// ---------------------------------------------------------------------------
// Member physical kind (production integration step)
// ---------------------------------------------------------------------------

/**
 * The physical kind of one mandatory member, which identity resolution
 * routes on (`GeoEntityHint.expectedKind`). Asked after assembly, per
 * candidate segment, keyed by member ID: it can never add, drop, rename or
 * reorder a member.
 */
export type MemberPhysicalKind = GeoEntityHint['expectedKind'];

export type MemberKindIssueCode =
  | 'KIND_MALFORMED_RESPONSE'
  | 'KIND_MALFORMED_ENTRY'
  | 'KIND_UNKNOWN_MEMBER'
  | 'KIND_DUPLICATE_MEMBER'
  | 'KIND_MISSING_MEMBER'
  | 'KIND_INVALID';

export interface MemberKindIssue {
  code: MemberKindIssueCode;
  segmentIndex: number;
  memberId?: string;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Pre-identity trace
// ---------------------------------------------------------------------------

export interface AtomizedEntityTrace {
  sourceName: string;
  role: SemanticEntityRole;
  supportSpan: string;
  sourceStart: number;
  sourceEnd: number;
  modelRole?: ModelEntityRole;
  mentionAtomId?: string;
  anaphorStatus?: AnaphorStatus;
  surfaceForm?: string;
  antecedentAtomId?: string;
  antecedentSourceName?: string;
}

export interface AtomizedAtomTrace {
  atomId: string;
  sourceStart: number;
  sourceEnd: number;
  editorial: boolean;
  /** Structural/result kind, or null when no valid label exists. */
  label: AtomResultKind | 'NON_EDITORIAL' | null;
  modelClassification?: ModelAtomClassification;
  transferMode?: TransferMode;
  entities: AtomizedEntityTrace[];
}

/** Flat provenance (the trace recorder truncates deep nesting). */
export interface AtomizedProvenanceTrace {
  atomId: string;
  role: ModelEntityRole;
  supportSpan: string;
  sourceStart: number;
  sourceEnd: number;
  mentionAtomId?: string;
  surfaceForm?: string;
}

export interface AtomizedMandatoryMemberTrace {
  position: number;
  sourceName: string;
  physicalKind?: MemberPhysicalKind;
  provenanceAtomIds: string[];
  provenance: AtomizedProvenanceTrace[];
}

export interface AtomizedSegmentTrace {
  segmentIndex: number;
  firstAtomId: string;
  lastAtomId: string;
  transferBoundary: TransferBoundaryAtom[];
  transferDestinations: TransferDestinationProvenance[];
  /** In source order, before identity resolution. */
  mandatoryBeforeIdentity: AtomizedMandatoryMemberTrace[];
  optional: string[];
  alternativeGroups: string[][];
  routeLegs: string[];
  passBy: string[];
  conflicts: RoleConflict[];
  /** Set for a segment that became a candidate. */
  candidateName?: string;
}

export interface AtomizedNonMembershipTrace {
  role: Exclude<SemanticEntityRole, 'ITINERARY_STOP'>;
  sourceName: string;
  atomIds: string[];
}

export interface AtomizedSourceUnitTrace {
  sourceUnitId: string;
  sourceUrl: string;
  evidenceKey: string;
  selectionStrategy: SourceContentSelectionStrategy;
  sectionComplete: boolean;
  windowOrdinal: number;
  unitLength: number;
  unitSha256: string;
  versions: {
    atomizer: string;
    structure: string;
    prompt: string;
    memberKindPrompt: string;
  };
  extractorProvider: string;
  extractorModel: string;
  atomCount: number;
  editorialAtomCount: number;
  nonEditorialAtomCount: number;
  nonEditorialBlocks: NonEditorialBlock[];
  /** Every atom with offsets, label and entities. */
  atoms: AtomizedAtomTrace[];
  batchCount: number;
  batches: Array<{
    batchIndex: number;
    atomCount: number;
    firstAtomId: string;
    lastAtomId: string;
    contextAtomIds: string[];
  }>;
  calls: AtomizedUnitCall[];
  relabelAttempts: number;
  relabel: AtomLabellingRelabelRound | null;
  contractOutcome: AtomizedUnitOutcome;
  issues: AtomLabellingIssue[];
  memberKindIssues: MemberKindIssue[];
  notes: AtomLabellingNote[];
  providerFailure: AtomizedUnitProviderFailure | null;
  assembledSegmentCount: number | null;
  segments: AtomizedSegmentTrace[];
  nonMembership: AtomizedNonMembershipTrace[];
  /** Names of the candidates handed to source support, in segment order. */
  candidateNames: string[];
}
