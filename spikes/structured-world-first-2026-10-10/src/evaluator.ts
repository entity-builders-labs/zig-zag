import { normalizeGeoName } from '../../../be/src/modules/tours/utils/nominatim-match.util';
import { Spike2Snapshot } from './catalog';
import { EvaluationQuestion, EvaluatorOutcome, Gap2, ProposedAnswer, UnofferedMention } from './contracts';
import {
  EvidenceCapture,
  FetchedDocument,
  LlmPort,
  ResearchBudget,
  ResearchBudgetUsage,
  WebTools,
  captureFromQuote,
  findSentences,
  parseJsonObject,
  registrableDomain,
} from './spike1';

const DOC_PREVIEW_CHARS = 1500;

interface OfferedQuestion {
  alias: string;
  question: EvaluationQuestion;
  names: string[];
  kind: string;
  areaName?: string;
  anchors: Array<{ alias: string; id: string; name: string }>;
}

function facetWord(facet: string): string {
  return facet.replace(/^[a-z_]+:/, '');
}

export function offerQuestions(snapshot: Spike2Snapshot, gap: Gap2): OfferedQuestion[] {
  return gap.questions.map((q, i) => {
    const facts = snapshot.candidates[q.candidateId];
    const entity = snapshot.catalog.geoEntities[q.candidateId];
    return {
      alias: `q${i + 1}`,
      question: q,
      names: facts?.names.length ? facts.names : [entity?.name ?? q.candidateId],
      kind: entity?.kind ?? 'UNKNOWN',
      ...(q.areaId ? { areaName: snapshot.catalog.geoEntities[q.areaId]?.name } : {}),
      anchors: (q.anchorIds ?? []).map((id, j) => ({ alias: `a${j}`, id, name: snapshot.catalog.geoEntities[id]?.name ?? id })),
    };
  });
}

function questionLine(o: OfferedQuestion, destination: string): string {
  const names = o.names.slice(0, 4).map((n) => `"${n}"`).join(' / ');
  switch (o.question.claimType) {
    case 'RELEVANT_FOR':
      return `${o.alias}. ${o.kind} ${names} in ${destination}: do sources show it is worth visiting for travellers interested in ${facetWord(o.question.facetKey)}?`;
    case 'NOTABLE_WITHIN':
      return `${o.alias}. ${o.kind} ${names} in "${o.areaName}": do sources present it as a notable place there for travellers interested in ${facetWord(o.question.facetKey)}?`;
    case 'WALKING_CORRIDOR':
      return `${o.alias}. street ${names} in "${o.areaName}": do sources describe walking along it as a sightseeing walk? If a source names where the walk starts and ends, give them as anchors from this list only: ${o.anchors.map((a) => `${a.alias}=${a.name}`).join(', ')}. If it only names the area, give "area":"a0".`;
  }
}

export function buildEvaluatorPrompt(input: { destination: string; offered: OfferedQuestion[]; history: string[]; remaining: ResearchBudgetUsage }): string {
  return [
    'You evaluate whether ALREADY-KNOWN places, areas or streets have documented meaning for travellers.',
    'Rules you must follow:',
    '- Evaluate ONLY the candidates listed below. Do not look for, suggest or answer about other places.',
    '- You discover sources yourself through search. There is no list of preferred sites.',
    '- You only PROPOSE answers. A separate grounding step verifies everything.',
    '- Every answer must quote text copied EXACTLY from a document you fetched in this session, and the quote must contain one of the listed names of the candidate.',
    '- A single website is usually not enough: cite a second, independent website when you can.',
    '- Do not rely on your own knowledge as evidence. Never state coordinates or identifiers.',
    '- If a source mentions other relevant places not listed, you may report their names under "unlisted"; they will not be evaluated.',
    '',
    `Candidates (${input.destination}):`,
    ...input.offered.map((o) => questionLine(o, input.destination)),
    '',
    `Remaining budget: ${input.remaining.rounds} steps, ${input.remaining.searches} searches, ${input.remaining.fetches} fetches.`,
    '',
    'Session so far:',
    ...(input.history.length ? input.history : ['(nothing yet)']),
    '',
    'Reply with exactly ONE JSON object, one of:',
    '{"action":"search","query":"..."}',
    '{"action":"fetch","url":"..."}',
    '{"action":"find","doc":"d1","terms":["San Telmo","historia"]}   (returns sentences of a fetched doc containing any term)',
    '{"action":"answer","answers":[{"question":"q1","evidence":[{"doc":"d1","quote":"..."}],"authorityClass":"..."}],"unlisted":[{"name":"...","note":"..."}]}',
    '   (street questions only: add "from":"a1","to":"a2" or "area":"a0" using the anchor list of that question)',
    '{"action":"finish"}',
  ].join('\n');
}

interface RawAnswer {
  question?: string;
  subject?: string;
  evidence?: Array<{ doc?: string; quote?: string }>;
  from?: string;
  to?: string;
  area?: string;
  authorityClass?: string;
}

/**
 * Semantic evaluator over offered canonical candidates (design R6). Holds no
 * catalog store; its only output is proposed answers to offered questions,
 * discards, unoffered mentions and fetched documents.
 */
export class EvaluatorAgent {
  constructor(
    private readonly tools: WebTools,
    private readonly llm: LlmPort,
  ) {}

  async evaluate(input: {
    gap: Gap2;
    offered: OfferedQuestion[];
    destinationName: string;
    budget: ResearchBudget;
    now: () => string;
  }): Promise<EvaluatorOutcome & { documents: FetchedDocument[] }> {
    const { gap, offered, budget } = input;
    const byAlias = new Map(offered.map((o) => [o.alias, o]));
    const usage: ResearchBudgetUsage = { rounds: 0, searches: 0, fetches: 0 };
    const history: string[] = [];
    const docs = new Map<string, FetchedDocument>();
    const answers: ProposedAnswer[] = [];
    const discarded: EvaluatorOutcome['discarded'] = [];
    const mentions: UnofferedMention[] = [];
    let searchOk = 0;
    let searchFailed = 0;
    let finished = false;
    let budgetHit = false;

    const outcome = (kind: EvaluatorOutcome['kind'], failure?: string) => ({
      gapKey: gap.key, kind, answers, discarded, mentions, budgetUsed: { ...usage }, documents: [...docs.values()], ...(failure ? { failure } : {}),
    });

    while (usage.rounds < budget.maxRounds) {
      usage.rounds += 1;
      let raw: string;
      try {
        raw = await this.llm.complete(
          buildEvaluatorPrompt({
            destination: input.destinationName, offered, history,
            remaining: { rounds: budget.maxRounds - usage.rounds + 1, searches: budget.maxSearches - usage.searches, fetches: budget.maxFetches - usage.fetches },
          }),
          'evaluator-agent',
        );
      } catch (error) {
        return outcome(answers.length ? 'CLAIMS_PROPOSED' : 'TOOL_FAILURE', `llm: ${(error as Error).message}`);
      }
      const obj = parseJsonObject(raw);
      const action = typeof obj?.action === 'string' ? obj.action : undefined;
      if (action === 'finish') { finished = true; break; }
      if (action === 'search' && typeof obj?.query === 'string') {
        if (usage.searches >= budget.maxSearches) { budgetHit = true; history.push(`step ${usage.rounds}: search refused, budget exhausted`); continue; }
        usage.searches += 1;
        try {
          const results = await this.tools.search(obj.query);
          searchOk += 1;
          history.push(`step ${usage.rounds}: search "${obj.query}" ->`, ...results.slice(0, 8).map((r, i) => `  r${i + 1}. ${r.title} | ${r.url} | ${r.snippet}`));
        } catch (error) {
          searchFailed += 1;
          history.push(`step ${usage.rounds}: search failed (${(error as Error).message})`);
        }
        continue;
      }
      if (action === 'fetch' && typeof obj?.url === 'string') {
        if (usage.fetches >= budget.maxFetches) { budgetHit = true; history.push(`step ${usage.rounds}: fetch refused, budget exhausted`); continue; }
        usage.fetches += 1;
        try {
          const doc = await this.tools.fetch(obj.url, 'research');
          const id = `d${docs.size + 1}`;
          docs.set(id, doc);
          history.push(`step ${usage.rounds}: fetched ${id} = ${doc.url} "${doc.title ?? ''}"`, `  [preview] ${doc.text.slice(0, DOC_PREVIEW_CHARS)}`);
        } catch (error) {
          history.push(`step ${usage.rounds}: fetch ${obj.url} failed (${(error as Error).message})`);
        }
        continue;
      }
      if (action === 'find' && typeof obj?.doc === 'string' && Array.isArray(obj.terms)) {
        const doc = docs.get(obj.doc);
        const terms = obj.terms.filter((t): t is string => typeof t === 'string' && t.trim().length > 1);
        if (!doc || !terms.length) { history.push(`step ${usage.rounds}: find ignored`); continue; }
        const sentences = findSentences(doc.text, terms);
        history.push(`step ${usage.rounds}: find in ${obj.doc} [${terms.join(', ')}] -> ${sentences.length} sentence(s)`, ...sentences.map((t) => `  > ${t}`));
        continue;
      }
      if (action === 'answer' && Array.isArray(obj?.answers)) {
        let accepted = 0;
        for (const u of Array.isArray(obj.unlisted) ? (obj.unlisted as Array<{ name?: unknown; note?: unknown }>) : []) {
          if (typeof u.name === 'string') mentions.push({ name: u.name, gapKey: gap.key, context: typeof u.note === 'string' ? u.note : 'unlisted', at: input.now() });
        }
        for (const a of obj.answers as RawAnswer[]) {
          const o = a.question ? byAlias.get(a.question) : undefined;
          if (!o) { discarded.push({ reason: 'UNKNOWN_QUESTION', detail: String(a.question) }); continue; }
          if (a.subject && !o.names.some((n) => normalizeGeoName(n) === normalizeGeoName(a.subject as string))) {
            discarded.push({ reason: 'NOT_OFFERED_CANDIDATE', detail: a.subject });
            mentions.push({ name: a.subject, gapKey: gap.key, context: `answer to ${o.alias}`, at: input.now() });
            continue;
          }
          const anchor = (alias?: string) => (alias ? o.anchors.find((x) => x.alias === alias) : undefined);
          // Anchors exist only for street (corridor) questions; elsewhere the fields are ignored.
          const isCorridor = o.question.claimType === 'WALKING_CORRIDOR';
          const badAnchor = isCorridor ? [a.from, a.to, a.area].filter((x): x is string => !!x).find((x) => !anchor(x)) : undefined;
          if (badAnchor) {
            discarded.push({ reason: 'NOT_OFFERED_CANDIDATE', detail: `anchor ${badAnchor}` });
            mentions.push({ name: badAnchor, gapKey: gap.key, context: `anchor for ${o.alias}`, at: input.now() });
            continue;
          }
          const captures: EvidenceCapture[] = [];
          for (const ev of a.evidence ?? []) {
            const doc = ev.doc ? docs.get(ev.doc) : undefined;
            const c = doc && ev.quote ? captureFromQuote(doc, ev.quote, registrableDomain(doc.url), a.authorityClass) : undefined;
            if (c) captures.push(c);
          }
          if (!captures.length) { discarded.push({ reason: 'NO_CAPTURE', detail: o.alias }); continue; }
          const from = anchor(a.from);
          const to = anchor(a.to);
          const area = anchor(a.area);
          answers.push({
            questionKey: o.question.key, claimType: o.question.claimType, candidateId: o.question.candidateId, facetKey: o.question.facetKey,
            ...(o.question.claimType === 'WALKING_CORRIDOR'
              ? { ...(area ? { areaId: area.id } : {}), ...(from && to ? { fromId: from.id, toId: to.id } : {}) }
              : o.question.areaId ? { areaId: o.question.areaId } : {}),
            captures, ...(a.authorityClass ? { proposedAuthorityClass: a.authorityClass } : {}), origin: 'WEB_EVIDENCE',
          });
          accepted += 1;
        }
        history.push(`step ${usage.rounds}: answered ${obj.answers.length}; ${accepted} carried a verifiable quote`);
        continue;
      }
      history.push(`step ${usage.rounds}: invalid reply ignored (reply must be one JSON action)`);
    }

    if (!finished && usage.rounds >= budget.maxRounds) budgetHit = true;
    if (answers.length) return outcome('CLAIMS_PROPOSED');
    if (searchOk === 0 && searchFailed > 0) return outcome('TOOL_FAILURE', 'every search failed');
    return outcome(budgetHit ? 'BUDGET_EXHAUSTED' : 'NO_EVIDENCE_FOUND');
  }
}
