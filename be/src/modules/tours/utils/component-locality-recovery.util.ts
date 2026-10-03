import {
  DiscoveryStructuredCompletionRequest,
  ExperienceCandidate,
  GeoEntityHint,
} from '../interfaces/experience-discovery.interface';
import {
  LOCALITY_RELATIONS,
  LocalityRecoveryPromptComponent,
  LocalityRelation,
  buildLocalityRecoveryResponseJsonSchema,
  buildLocalityRecoverySystemPrompt,
  buildLocalityRecoveryUserPrompt,
} from '../prompts/component-locality-recovery.prompt';
import {
  ComponentAssertionAudit,
  LocalityRecoveryRejection,
  verifyLocalityAssertion,
} from './component-source-assertions.util';
import { EvidenceSupportText } from './component-source-support.util';
import {
  DiscoveryEvidenceRecord,
  ExperienceExtractionResult,
} from './experience-candidate-extraction.util';
import {
  LiteralOccurrence,
  foldLiteralText,
  literalOccurrences,
  occurrencesOverlap,
  sameLiteralName,
  sourceStatements,
} from './literal-source-text.util';
import { SOURCE_EXCERPT_SEPARATOR } from './source-content-windowing.util';

/**
 * Source locality recovery (RW4, amendment §19.1).
 *
 * The discovery extractor reads a whole source and proposes a composition.
 * It routinely drops a fact the source states about one component in a
 * different place, such as a caption ("Wine and lunch at Ojo de Agua in
 * Lujan de Cuyo") outside the component's itinerary entry. This step
 * recovers such a fact, once per extraction, without trusting the model
 * with anything the backend can check:
 *
 *  1. Selection (deterministic). For each source-supported PLACE component,
 *     the statements of its own cited evidence that literally name it. A
 *     name shared by components of several compositions is skipped: a
 *     statement about that name cannot be attributed to one of them.
 *  2. Classification (one bounded model call). For each statement, the
 *     model reports the places the statement relates to that component and
 *     how (`LocalityRelation`). It never writes a span.
 *  3. Admission (deterministic). A locality is admitted only when the
 *     source's statements about the component agree on one unqualified
 *     containment, from a statement that names no other component and no
 *     second place, and the canonical gate (`verifyLocalityAssertion`)
 *     accepts the statement as a literal span of the component's own
 *     evidence that names both.
 *
 * Nothing here establishes identity: an admitted locality is a source claim
 * that the locality grounder may or may not ground (§19, "Source
 * grounding"). A failed call leaves every component without a recovered
 * locality, which is missing evidence, never a contradiction.
 */

export const MAX_STATEMENTS_PER_COMPONENT = 12;

/** The structured completion of the configured discovery extractor. */
export type LocalityRecoveryCompletion = (
  request: DiscoveryStructuredCompletionRequest,
) => Promise<string>;

export interface LocalityRecoveryReportAudit {
  candidateName: string;
  componentKey: string;
  statement: string;
  place: string;
  relation: string;
  /** Why the report was discarded before admission, when it was. */
  discarded?:
    | 'UNKNOWN_COMPONENT'
    | 'UNKNOWN_STATEMENT'
    | 'MALFORMED_REPORT'
    | 'PLACE_NOT_IN_STATEMENT';
}

export interface LocalityRecoveryAudit {
  status: 'COMPLETED' | 'NOT_NEEDED' | 'FAILED';
  failureReason?: string;
  /** Components whose statements were sent to the model. */
  examinedComponentCount: number;
  reports: LocalityRecoveryReportAudit[];
  rawOutput?: string;
}

interface ComponentRef {
  candidateIndex: number;
  hintIndex: number;
  candidateName: string;
  hint: GeoEntityHint;
  sourceName: string;
}

interface SelectedComponent extends ComponentRef {
  prompt: LocalityRecoveryPromptComponent;
}

interface ComponentOutcome {
  ref: ComponentRef;
  /** Absent when no statement relates a place to the component. */
  audit?: ComponentAssertionAudit;
  hint?: GeoEntityHint;
}

function rejected(
  reason: LocalityRecoveryRejection,
  proposedLocality?: string,
): ComponentAssertionAudit {
  return {
    assertion: 'LOCALITY',
    status: 'REJECTED',
    reason,
    ...(proposedLocality ? { proposedLocality } : {}),
  };
}

function evidenceSegments(record: EvidenceSupportText | undefined): string[] {
  if (!record) return [];
  return [
    ...(typeof record.title === 'string' ? [record.title] : []),
    ...(typeof record.text === 'string'
      ? record.text.split(SOURCE_EXCERPT_SEPARATOR)
      : []),
  ];
}

function statementsNaming(
  name: string,
  keys: readonly string[],
  evidenceByKey: ReadonlyMap<string, EvidenceSupportText>,
): string[] {
  const statements: string[] = [];
  for (const key of keys) {
    for (const segment of evidenceSegments(evidenceByKey.get(key))) {
      for (const statement of sourceStatements(segment)) {
        if (
          literalOccurrences(statement, name).length > 0 &&
          !statements.includes(statement)
        ) {
          statements.push(statement);
        }
      }
    }
  }
  return statements;
}

function componentRefs(candidates: ExperienceCandidate[]): ComponentRef[] {
  return candidates.flatMap((candidate, candidateIndex) =>
    candidate.componentHints.map((hint, hintIndex) => ({
      candidateIndex,
      hintIndex,
      candidateName: candidate.name,
      hint,
      sourceName: hint.sourceName ?? hint.name,
    })),
  );
}

function sharesEvidence(left: GeoEntityHint, right: GeoEntityHint): boolean {
  return left.evidenceKeys.some((key) => right.evidenceKeys.includes(key));
}

/** The verified entry of a component, from the source-support audit. */
function componentEntry(
  extraction: ExperienceExtractionResult,
  ref: ComponentRef,
): string {
  const span = extraction.sourceSupportAudits
    .find((audit) => audit.candidateName === ref.candidateName)
    ?.components.find(
      (component) =>
        component.key === ref.hint.key && component.status === 'SUPPORTED',
    )?.verifiedSupportSpan;
  return span ? sourceStatements(span).join(' ') : ref.sourceName;
}

function selectComponents(
  extraction: ExperienceExtractionResult,
  refs: ComponentRef[],
  evidenceByKey: ReadonlyMap<string, EvidenceSupportText>,
): { selected: SelectedComponent[]; skipped: ComponentOutcome[] } {
  const selected: SelectedComponent[] = [];
  const skipped: ComponentOutcome[] = [];
  let nextStatement = 0;
  for (const ref of refs) {
    if (ref.hint.expectedKind !== 'PLACE' || ref.hint.localityAssertion) {
      continue;
    }
    const sameName = refs.some(
      (other) =>
        other !== ref &&
        sameLiteralName(other.sourceName, ref.sourceName) &&
        sharesEvidence(other.hint, ref.hint),
    );
    if (sameName) {
      skipped.push({
        ref,
        audit: rejected('SAME_NAME_IN_SEVERAL_COMPOSITIONS'),
      });
      continue;
    }
    const statements = statementsNaming(
      ref.sourceName,
      ref.hint.evidenceKeys,
      evidenceByKey,
    );
    if (statements.length === 0) continue;
    if (statements.length > MAX_STATEMENTS_PER_COMPONENT) {
      skipped.push({ ref, audit: rejected('STATEMENT_LIMIT_EXCEEDED') });
      continue;
    }
    selected.push({
      ...ref,
      prompt: {
        id: `c${selected.length + 1}`,
        name: ref.sourceName,
        entry: componentEntry(extraction, ref),
        statements: statements.map((text) => ({
          id: `s${++nextStatement}`,
          text,
        })),
      },
    });
  }
  return { selected, skipped };
}

interface ValidReport {
  statementId: string;
  statement: string;
  place: string;
  relation: LocalityRelation;
  /** Occurrences of the place outside the component's own name. */
  placeOccurrences: LiteralOccurrence[];
}

function parseReports(raw: string): unknown[] | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    const reports = (parsed as { reports?: unknown } | null)?.reports;
    return Array.isArray(reports) ? reports : undefined;
  } catch {
    return undefined;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

const RELATIONS = new Set<string>(LOCALITY_RELATIONS);

/**
 * The names a statement gives to other components of the extraction,
 * outside the component's own name and outside the proposed place.
 */
function namesAnotherComponent(
  statement: string,
  component: SelectedComponent,
  place: ValidReport,
  refs: ComponentRef[],
): boolean {
  const reserved = [
    ...literalOccurrences(statement, component.sourceName),
    ...place.placeOccurrences,
  ];
  return refs.some(
    (other) =>
      !sameLiteralName(other.sourceName, component.sourceName) &&
      literalOccurrences(statement, other.sourceName).some(
        (occurrence) =>
          !reserved.some((taken) => occurrencesOverlap(taken, occurrence)),
      ),
  );
}

function admitComponent(
  component: SelectedComponent,
  reports: ValidReport[],
  refs: ComponentRef[],
  evidenceByKey: ReadonlyMap<string, EvidenceSupportText>,
): ComponentOutcome {
  const ref: ComponentRef = component;
  if (
    reports.some(
      (report) =>
        report.relation === 'ALTERNATIVE' ||
        report.relation === 'SAME_NAME_OTHER_PLACE',
    )
  ) {
    return { ref, audit: rejected('LOCATION_QUALIFIED') };
  }
  const located = reports.filter((report) => report.relation === 'LOCATED_IN');
  if (located.length === 0) return { ref };

  const statementPlaces = (statementId: string) =>
    new Set(
      reports
        .filter(
          (report) =>
            report.statementId === statementId && report.relation !== 'NEAR',
        )
        .map((report) => foldLiteralText(report.place)),
    );
  for (const report of located) {
    if (namesAnotherComponent(report.statement, component, report, refs)) {
      return {
        ref,
        audit: rejected('STATEMENT_NAMES_ANOTHER_COMPONENT', report.place),
      };
    }
    if (statementPlaces(report.statementId).size > 1) {
      return {
        ref,
        audit: rejected('SEVERAL_PLACES_IN_STATEMENT', report.place),
      };
    }
  }
  const places = new Set(
    located.map((report) => foldLiteralText(report.place)),
  );
  const deniedPlace = reports.some(
    (report) =>
      report.relation === 'NOT_IN' &&
      (report.placeOccurrences.length === 0 ||
        places.has(foldLiteralText(report.place))),
  );
  if (places.size > 1 || deniedPlace) {
    return {
      ref,
      audit: rejected('CONFLICTING_LOCALITIES', located[0].place),
    };
  }
  const { localityAssertion, audit } = verifyLocalityAssertion(
    { locality: located[0].place, supportSpan: located[0].statement },
    component.sourceName,
    component.hint.evidenceKeys,
    evidenceByKey,
  );
  return {
    ref,
    audit,
    ...(localityAssertion
      ? { hint: { ...component.hint, localityAssertion } }
      : {}),
  };
}

function validateReports(
  rawReports: unknown[],
  selected: SelectedComponent[],
): {
  byComponent: Map<string, ValidReport[]>;
  audits: LocalityRecoveryReportAudit[];
} {
  const byComponent = new Map<string, ValidReport[]>();
  const audits: LocalityRecoveryReportAudit[] = [];
  for (const value of rawReports) {
    const raw = (value ?? {}) as Record<string, unknown>;
    const componentId = asString(raw.component) ?? '';
    const statementId = asString(raw.statement) ?? '';
    const place = asString(raw.place) ?? '';
    const relation = asString(raw.relation) ?? '';
    const component = selected.find((item) => item.prompt.id === componentId);
    const audit: LocalityRecoveryReportAudit = {
      candidateName: component?.candidateName ?? '',
      componentKey: component?.hint.key ?? componentId,
      statement: statementId,
      place,
      relation,
    };
    audits.push(audit);
    if (!component) {
      audit.discarded = 'UNKNOWN_COMPONENT';
      continue;
    }
    const statement = component.prompt.statements.find(
      (item) => item.id === statementId,
    );
    if (!statement) {
      audit.discarded = 'UNKNOWN_STATEMENT';
      continue;
    }
    if (!place || !RELATIONS.has(relation)) {
      audit.discarded = 'MALFORMED_REPORT';
      continue;
    }
    const names = literalOccurrences(statement.text, component.sourceName);
    const placeOccurrences = literalOccurrences(statement.text, place).filter(
      (occurrence) =>
        !names.some((name) => occurrencesOverlap(name, occurrence)),
    );
    const blocks =
      relation === 'ALTERNATIVE' ||
      relation === 'SAME_NAME_OTHER_PLACE' ||
      relation === 'NOT_IN';
    // A qualification or a denial counts even when the model misquoted its
    // place (a translation, say): the statement still says something
    // against an unqualified containment, and it cannot be compared.
    if (placeOccurrences.length === 0 && !blocks) {
      audit.discarded = 'PLACE_NOT_IN_STATEMENT';
      continue;
    }
    const reports = byComponent.get(componentId) ?? [];
    reports.push({
      statementId,
      statement: statement.text,
      place,
      relation: relation as LocalityRelation,
      placeOccurrences,
    });
    byComponent.set(componentId, reports);
  }
  return { byComponent, audits };
}

function applyOutcomes(
  extraction: ExperienceExtractionResult,
  outcomes: ComponentOutcome[],
): ExperienceExtractionResult {
  const recorded = outcomes.filter((outcome) => outcome.audit);
  const candidates = extraction.candidates.map((candidate, candidateIndex) => ({
    ...candidate,
    componentHints: candidate.componentHints.map(
      (hint, hintIndex) =>
        recorded.find(
          (outcome) =>
            outcome.hint &&
            outcome.ref.candidateIndex === candidateIndex &&
            outcome.ref.hintIndex === hintIndex,
        )?.hint ?? hint,
    ),
  }));
  const sourceSupportAudits = extraction.sourceSupportAudits.map((audit) => ({
    ...audit,
    components: audit.components.map((component) => {
      const outcome = recorded.find(
        (item) =>
          item.ref.candidateName === audit.candidateName &&
          item.ref.hint.key === component.key &&
          component.status === 'SUPPORTED',
      );
      return outcome
        ? {
            ...component,
            assertionAudits: [
              ...(component.assertionAudits ?? []),
              outcome.audit,
            ],
          }
        : component;
    }),
  }));
  return { ...extraction, candidates, sourceSupportAudits };
}

/**
 * Recovers source-stated component localities for one extraction. Returns
 * a new result; the input is never mutated.
 */
export async function recoverComponentLocalities(
  extraction: ExperienceExtractionResult,
  evidence: readonly DiscoveryEvidenceRecord[],
  complete: LocalityRecoveryCompletion,
): Promise<
  ExperienceExtractionResult & { localityRecovery: LocalityRecoveryAudit }
> {
  const evidenceByKey = new Map(
    evidence.map((item) => [item.key, { title: item.title, text: item.text }]),
  );
  const refs = componentRefs(extraction.candidates);
  const { selected, skipped } = selectComponents(
    extraction,
    refs,
    evidenceByKey,
  );
  if (selected.length === 0) {
    return {
      ...applyOutcomes(extraction, skipped),
      localityRecovery: {
        status: 'NOT_NEEDED',
        examinedComponentCount: 0,
        reports: [],
      },
    };
  }

  const prompts = selected.map((component) => component.prompt);
  let raw: string;
  try {
    raw = await complete({
      system: buildLocalityRecoverySystemPrompt(),
      user: buildLocalityRecoveryUserPrompt(prompts),
      jsonSchema: buildLocalityRecoveryResponseJsonSchema(prompts),
    });
  } catch (error: unknown) {
    return {
      ...applyOutcomes(extraction, skipped),
      localityRecovery: {
        status: 'FAILED',
        failureReason: error instanceof Error ? error.message : String(error),
        examinedComponentCount: selected.length,
        reports: [],
      },
    };
  }
  const rawReports = parseReports(raw);
  if (!rawReports) {
    return {
      ...applyOutcomes(extraction, skipped),
      localityRecovery: {
        status: 'FAILED',
        failureReason: 'UNPARSEABLE_RESPONSE',
        examinedComponentCount: selected.length,
        reports: [],
        rawOutput: raw,
      },
    };
  }

  const { byComponent, audits } = validateReports(rawReports, selected);
  const outcomes = selected.map((component) =>
    admitComponent(
      component,
      byComponent.get(component.prompt.id) ?? [],
      refs,
      evidenceByKey,
    ),
  );
  return {
    ...applyOutcomes(extraction, [...skipped, ...outcomes]),
    localityRecovery: {
      status: 'COMPLETED',
      examinedComponentCount: selected.length,
      reports: audits,
      rawOutput: raw,
    },
  };
}
