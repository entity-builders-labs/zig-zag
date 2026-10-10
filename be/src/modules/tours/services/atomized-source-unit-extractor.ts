import {
  AtomLabellingBatch,
  AtomLabellingResult,
  AtomLabellingValidation,
  AtomizedSourceUnitTrace,
  AtomizedUnitCall,
  AtomizedUnitCallKind,
  MemberKindIssue,
  MemberPhysicalKind,
} from '../interfaces/atomized-source-unit.interface';
import {
  DiscoveryStructuredCompletion,
  DiscoveryStructuredCompletionRequest,
} from '../interfaces/experience-discovery.interface';
import {
  ATOM_LABELLING_SCHEMA,
  ATOM_LABELLING_SYSTEM_PROMPT,
  MEMBER_KIND_SCHEMA,
  MEMBER_KIND_SYSTEM_PROMPT,
  buildAtomLabellingPrompt,
  buildAtomRelabellingPrompt,
  buildMemberKindPrompt,
} from '../prompts/source-atom-labelling.prompt';
import {
  DEFAULT_ATOM_BATCH_CONTEXT_ATOMS,
  DEFAULT_ATOM_BATCH_MAX_CHARS,
  applyAtomRelabel,
  atomRelabelBatch,
  atomRelabelScope,
  mergeAtomLabellings,
  planAtomBatches,
  resolveAtomMentions,
  structuralAtomLabels,
  validateAtomLabelling,
} from '../utils/atom-labelling-contract.util';
import { assembleAtomSegments } from '../utils/atom-segment-assembly.util';
import {
  buildAtomizedRawCandidates,
  buildAtomizedUnitTrace,
  candidateSegments,
  isAtomizableSourceUnit,
  memberKindPromptMembers,
  nameAtomizedCandidates,
  validateMemberKinds,
} from '../utils/atomized-candidate-mapping.util';
import { recoverComponentLocalities } from '../utils/component-locality-recovery.util';
import {
  DiscoveryEvidenceRecord,
  ExperienceExtractionResult,
  extractExperienceCandidates,
} from '../utils/experience-candidate-extraction.util';
import {
  atomizeSourceUnit,
  checkAtomCoverage,
  markEditorialStructure,
} from '../utils/source-atomization.util';
import { SourceContentWindowingAudit } from '../utils/source-content-windowing.util';

/** DI token of the complete-unit composition authority. */
export const ATOMIZED_SOURCE_UNIT_EXTRACTOR = 'ATOMIZED_SOURCE_UNIT_EXTRACTOR';

/**
 * A provider or transport failure of one call (timeout, 429/5xx, truncated
 * output). Operational: the unit is INVALID_RUN, never a semantic or
 * contract outcome.
 */
export class AtomizedUnitTransportFailure extends Error {
  constructor(
    message: string,
    readonly kind: AtomizedUnitCallKind,
    readonly batchIndex: number,
  ) {
    super(message);
    this.name = 'AtomizedUnitTransportFailure';
  }
}

/** The extractor's structured completion: its only provider seam. */
export type AtomizedUnitCompletion = (
  request: DiscoveryStructuredCompletionRequest,
) => Promise<string>;

/**
 * One provider call. Per `DiscoveryStructuredCompletion`, a rejection is a
 * provider/transport failure; an answer that is not JSON is a malformed
 * response (`null`), which the contract validator fails closed on.
 */
async function callModel(
  complete: AtomizedUnitCompletion,
  calls: AtomizedUnitCall[],
  call: Omit<AtomizedUnitCall, 'elapsedMs'>,
  request: DiscoveryStructuredCompletionRequest,
): Promise<unknown> {
  const record: AtomizedUnitCall = { ...call };
  calls.push(record);
  const started = Date.now();
  let raw: string;
  try {
    raw = await complete(request);
  } catch (error: unknown) {
    record.elapsedMs = Date.now() - started;
    throw new AtomizedUnitTransportFailure(
      error instanceof Error ? error.message : String(error),
      call.kind,
      call.batchIndex,
    );
  }
  record.elapsedMs = Date.now() - started;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export interface AtomLabellingOptions {
  maxBatchChars?: number;
  contextAtoms?: number;
}

/**
 * Labels one complete editorial unit: atomize -> editorial structure ->
 * batches -> validation -> merge with structural labels -> anaphora -> at
 * most ONE relabel round -> assembly. Fails closed on any contract issue;
 * a transport failure is INVALID_RUN with its call kind and batch index.
 */
export async function labelAtomizedSourceUnit(
  text: string,
  complete: AtomizedUnitCompletion,
  {
    maxBatchChars = DEFAULT_ATOM_BATCH_MAX_CHARS,
    contextAtoms = DEFAULT_ATOM_BATCH_CONTEXT_ATOMS,
  }: AtomLabellingOptions = {},
): Promise<AtomLabellingResult> {
  const atomization = atomizeSourceUnit(text);
  const coverage = checkAtomCoverage(text, atomization);
  if (!coverage.ok)
    throw new Error(
      `ATOMIZATION_COVERAGE: ${JSON.stringify(coverage.problems.slice(0, 3))}`,
    );
  const structure = markEditorialStructure(atomization.atoms);
  const atoms = structure.atoms;
  const byId = new Map(atoms.map((a) => [a.atomId, a]));
  const editorial = atoms.filter((a) => a.editorial);
  const batches = planAtomBatches(editorial, { maxBatchChars, contextAtoms });
  const calls: AtomizedUnitCall[] = [];
  const base = { atomization, structure, atoms, batches, calls };

  const ask = (
    kind: 'batch' | 'relabel',
    batch: AtomLabellingBatch,
    user: string,
  ) =>
    callModel(
      complete,
      calls,
      {
        kind,
        batchIndex: batch.batchIndex,
        atomCount: batch.atomIds.length,
        promptChars: user.length,
      },
      {
        system: ATOM_LABELLING_SYSTEM_PROMPT,
        user,
        jsonSchema: ATOM_LABELLING_SCHEMA,
      },
    );
  const validate = (batch: AtomLabellingBatch, parsed: unknown) =>
    validateAtomLabelling(batch.atomIds, byId, parsed, {
      visibleAtomIds: [...batch.contextAtomIds, ...batch.atomIds],
    });

  try {
    const results: Array<AtomLabellingValidation & { batchIndex: number }> = [];
    for (const batch of batches) {
      const parsed = await ask(
        'batch',
        batch,
        buildAtomLabellingPrompt(batch, byId),
      );
      results.push({
        ...validate(batch, parsed),
        batchIndex: batch.batchIndex,
      });
    }
    const first = resolveAtomMentions(
      mergeAtomLabellings(atoms, [...results, structuralAtomLabels(atoms)]),
    );
    let final = first;
    let relabel: AtomLabellingResult['relabel'] = null;
    if (!first.valid) {
      const scope = atomRelabelScope(first);
      relabel = { scope, firstPassIssues: first.issues };
      if (scope) {
        const batch = atomRelabelBatch(editorial, scope);
        const parsed = await ask(
          'relabel',
          batch,
          buildAtomRelabellingPrompt(batch, byId, first.issues),
        );
        final = resolveAtomMentions(
          applyAtomRelabel(atoms, first, scope, validate(batch, parsed)),
        );
      }
    }
    return {
      ...base,
      outcome: final.valid ? 'ASSEMBLED' : 'CONTRACT_FAIL_CLOSED',
      first,
      final,
      relabel,
      segments: final.valid ? assembleAtomSegments(atoms, final) : null,
    };
  } catch (error: unknown) {
    if (!(error instanceof AtomizedUnitTransportFailure)) throw error;
    return {
      ...base,
      outcome: 'INVALID_RUN',
      relabel: null,
      segments: null,
      failure: {
        kind: error.kind,
        batchIndex: error.batchIndex,
        message: error.message,
      },
    };
  }
}

/** The complete editorial unit one deep-source window carries. */
export interface AtomizedSourceUnitInput {
  sourceUrl: string;
  /** The grounded evidence record the unit's text substitutes. */
  evidenceKey: string;
  /** That record's grounded title, the naming fallback. */
  sourceTitle?: string;
  content: string;
  windowing: SourceContentWindowingAudit;
}

export type AtomizedSourceUnitExtraction = ExperienceExtractionResult & {
  provider: string;
  model: string;
  unit: AtomizedSourceUnitTrace;
};

/**
 * The composition authority for a complete editorial unit
 * (`SECTION_UNIT`, `sectionComplete: true`). It runs on the configured
 * discovery extractor's own structured completion, so the provider and
 * model are the ones the trace names; it contains no provider branch.
 *
 * Its candidates go through the same source-support/normalization gate
 * (`extractExperienceCandidates`) and source locality recovery as every
 * generative extraction, and then the unchanged downstream pipeline. No
 * fallback to the generative extractor exists for the unit: a contract
 * failure or an INVALID_RUN yields no candidates, visibly.
 */
export class AtomizedSourceUnitExtractor {
  constructor(
    private readonly transport: DiscoveryStructuredCompletion,
    private readonly identity: { provider: string; model: string },
    private readonly options: AtomLabellingOptions = {},
  ) {}

  async extract(
    input: AtomizedSourceUnitInput,
  ): Promise<AtomizedSourceUnitExtraction> {
    if (!isAtomizableSourceUnit(input.windowing))
      throw new Error(
        'AtomizedSourceUnitExtractor accepts only a complete SECTION_UNIT window',
      );
    const complete: AtomizedUnitCompletion = (request) =>
      this.transport.completeStructured(request);
    const labelled = await labelAtomizedSourceUnit(
      input.content,
      complete,
      this.options,
    );
    const kindsBySegment = new Map<number, Map<string, MemberPhysicalKind>>();
    const memberKindIssues: MemberKindIssue[] = [];
    let result: AtomLabellingResult = labelled;
    let names: Map<number, string> | null = null;
    let segments = labelled.segments
      ? candidateSegments(labelled.segments)
      : [];

    if (labelled.outcome === 'ASSEMBLED' && segments.length > 0) {
      const byId = new Map(labelled.atoms.map((a) => [a.atomId, a]));
      try {
        for (const segment of segments) {
          const members = memberKindPromptMembers(segment, byId);
          const user = buildMemberKindPrompt(members);
          const parsed = await callModel(
            complete,
            labelled.calls,
            {
              kind: 'member_kind',
              batchIndex: segment.segmentIndex,
              atomCount: members.length,
              promptChars: user.length,
            },
            {
              system: MEMBER_KIND_SYSTEM_PROMPT,
              user,
              jsonSchema: MEMBER_KIND_SCHEMA,
            },
          );
          const validated = validateMemberKinds(
            segment.segmentIndex,
            members.map((m) => m.memberId),
            parsed,
          );
          kindsBySegment.set(segment.segmentIndex, validated.kinds);
          memberKindIssues.push(...validated.issues);
        }
        if (memberKindIssues.length > 0)
          result = { ...labelled, outcome: 'CONTRACT_FAIL_CLOSED' };
      } catch (error: unknown) {
        if (!(error instanceof AtomizedUnitTransportFailure)) throw error;
        result = {
          ...labelled,
          outcome: 'INVALID_RUN',
          failure: {
            kind: error.kind,
            batchIndex: error.batchIndex,
            message: error.message,
          },
        };
      }
      if (result.outcome === 'ASSEMBLED') {
        names = nameAtomizedCandidates(
          segments,
          labelled.atoms,
          input.sourceTitle,
        );
      }
    }
    if (result.outcome !== 'ASSEMBLED' || !names) segments = [];

    const evidence: DiscoveryEvidenceRecord[] = [
      {
        key: input.evidenceKey,
        title: input.sourceTitle,
        text: input.content,
      },
    ];
    const raw = buildAtomizedRawCandidates({
      segments,
      kindsBySegment,
      names: names ?? new Map(),
      evidenceKey: input.evidenceKey,
      unitText: input.content,
    });
    let extraction: ExperienceExtractionResult = extractExperienceCandidates(
      raw,
      evidence,
      Math.max(raw.length, 1),
    );
    if (raw.length > 0) {
      extraction = await recoverComponentLocalities(
        extraction,
        evidence,
        complete,
      );
    }

    const unit = buildAtomizedUnitTrace(result, {
      sourceUrl: input.sourceUrl,
      evidenceKey: input.evidenceKey,
      windowing: input.windowing,
      extractorProvider: this.identity.provider,
      extractorModel: this.identity.model,
      memberKindIssues,
      kindsBySegment,
      names,
    });
    const outcomeNote =
      result.outcome === 'ASSEMBLED'
        ? names
          ? []
          : ['ATOMIZED_UNIT_NAME_UNAVAILABLE: no unit heading or source title']
        : [
            `ATOMIZED_UNIT_${result.outcome}: ${[
              ...unit.issues.map((x) =>
                x.atomId ? `${x.code}:${x.atomId}` : x.code,
              ),
              ...memberKindIssues.map((x) =>
                x.memberId
                  ? `${x.code}:s${x.segmentIndex}.${x.memberId}`
                  : `${x.code}:s${x.segmentIndex}`,
              ),
              ...(result.failure
                ? [
                    `${result.failure.kind}#${result.failure.batchIndex}: ${result.failure.message}`,
                  ]
                : []),
            ].join(', ')}`,
          ];
    return {
      ...extraction,
      validationErrors: [...outcomeNote, ...extraction.validationErrors],
      provider: this.identity.provider,
      model: this.identity.model,
      unit,
    };
  }
}
