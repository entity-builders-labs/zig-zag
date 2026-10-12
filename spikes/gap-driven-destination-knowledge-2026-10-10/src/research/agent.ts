import { normalizeGeoName } from '../../../../be/src/modules/tours/utils/nominatim-match.util';
import {
  ClaimType,
  EvidenceCapture,
  GapType,
  KnowledgeGap,
  ProposedClaim,
  ResearchBudget,
  ResearchBudgetUsage,
  ResearchOutcome,
} from '../contracts';
import { FetchedDocument, captureFromQuote } from './documents';
import { registrableDomain } from './domain';
import { LlmPort, parseJsonObject } from './llm';
import { CatalogExcerpt, WebTools } from './tools';

/** Spec `gap-research`, "Permitted claim types per gap". */
export const PERMITTED_CLAIM_TYPES: Record<GapType, ClaimType[]> = {
  AREA_RELEVANCE: ['RELEVANT_FOR'],
  NOTABLE_PLACES: ['NOTABLE_WITHIN', 'RELEVANT_FOR'],
  WALKING_CORRIDOR: ['WALKING_CORRIDOR'],
  SCHEDULE_CAPACITY: ['RELEVANT_FOR'],
};

/** Short previews (pages open with navigation); passages come from `find`. */
const DOC_PREVIEW_CHARS = 1500;
const FIND_MAX_SENTENCES = 10;
const FIND_SENTENCE_CHARS = 400;

type AgentAction =
  | { action: 'search'; query: string }
  | { action: 'fetch'; url: string }
  | { action: 'find'; doc: string; terms: string[] }
  | { action: 'propose'; claims: RawClaim[] }
  | { action: 'finish' };

interface RawClaim {
  claimType?: string;
  subject?: string;
  area?: string;
  from?: string;
  to?: string;
  themes?: string[];
  authorityClass?: string;
  evidence?: Array<{ doc?: string; quote?: string }>;
}

/** Sentences of a document that contain any of the terms (case-insensitive). */
export function findSentences(text: string, terms: string[]): string[] {
  const lowered = terms.map((t) => t.toLowerCase());
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ0-9"'(])/);
  return sentences
    .filter((s) => lowered.some((t) => s.toLowerCase().includes(t)))
    .slice(0, FIND_MAX_SENTENCES)
    .map((s) => s.slice(0, FIND_SENTENCE_CHARS));
}

function describeGap(gap: KnowledgeGap, excerpt: CatalogExcerpt): string {
  switch (gap.type) {
    case 'AREA_RELEVANCE':
      return `Find neighbourhoods/areas of ${excerpt.destinationName} that are relevant to travellers interested in "${gap.facetKey}".`;
    case 'NOTABLE_PLACES':
      return `Find specific places inside ${excerpt.gap.scopeName} (${excerpt.destinationName}) that are notable for "${gap.facetKey}". Known: ${excerpt.knownPlacesInScope.join(', ') || 'none'}.`;
    case 'WALKING_CORRIDOR':
      return `Find streets that travellers walk along as a tourist walking route, within these areas of ${excerpt.destinationName}: ${excerpt.knownRelevantAreas.join(', ') || '(no areas known yet; destination-wide)'}. Prefer evidence that names where the walk starts and ends.`;
    case 'SCHEDULE_CAPACITY':
      return `Find additional areas of ${excerpt.destinationName} relevant to "${gap.facetKey}" that are NOT among: ${excerpt.excludedAreas.join(', ')}.`;
  }
}

export function buildAgentPrompt(input: {
  gap: KnowledgeGap;
  excerpt: CatalogExcerpt;
  permitted: ClaimType[];
  history: string[];
  remaining: ResearchBudgetUsage;
}): string {
  return [
    'You are a research assistant filling ONE knowledge gap for a travel catalog.',
    'Rules you must follow:',
    '- You discover sources yourself through the search tool. There is no list of preferred sites.',
    '- You only PROPOSE claims. You never decide that a claim is true; a separate grounding step verifies everything.',
    '- Every claim must quote text copied EXACTLY from a document you fetched in this session (same words). No quote, no claim.',
    '- Never state coordinates, identifiers or geometry. Name places as the source names them.',
    '- Street geometry or a map listing does not make a place relevant for tourists; the quote must say why it matters.',
    '- Do not rely on your own knowledge as evidence.',
    '- A claim supported by a single website is usually NOT enough: the grounding step requires either a publisher it can identify by machine or a second, independent website saying the same thing. Before finishing, look for an independent second source and cite both in the claim evidence (doc ids from different websites).',
    '- Propose only claims about the gap; prefer fewer, well-corroborated claims over many single-source ones.',
    '',
    `Gap: ${describeGap(input.gap, input.excerpt)}`,
    `Permitted claim types: ${input.permitted.join(', ')}.`,
    '  RELEVANT_FOR: {"claimType":"RELEVANT_FOR","subject":"<area or place name>","themes":["history"]}',
    '  NOTABLE_WITHIN: {"claimType":"NOTABLE_WITHIN","subject":"<place>","area":"<area>","themes":["food"]}',
    '  WALKING_CORRIDOR: {"claimType":"WALKING_CORRIDOR","subject":"<street>","area":"<area named by the source, optional>","from":"<start, optional>","to":"<end, optional>","themes":["history"]}',
    '  Each claim also has "authorityClass" (your guess about the publisher, optional) and',
    '  "evidence":[{"doc":"<doc id like d1>","quote":"<exact sentence from that doc>"}].',
    `Remaining budget: ${input.remaining.rounds} steps, ${input.remaining.searches} searches, ${input.remaining.fetches} fetches.`,
    '',
    'Session so far:',
    ...(input.history.length ? input.history : ['(nothing yet)']),
    '',
    'Reply with exactly ONE JSON object, one of:',
    '{"action":"search","query":"..."}',
    '{"action":"fetch","url":"..."}',
    '{"action":"find","doc":"d1","terms":["San Telmo","history"]}   (returns sentences of a fetched doc containing any term; quote from them)',
    '{"action":"propose","claims":[...]}',
    '{"action":"finish"}',
  ].join('\n');
}

function parseAction(raw: string): AgentAction | undefined {
  const obj = parseJsonObject(raw);
  if (!obj) return undefined;
  if (obj.action === 'search' && typeof obj.query === 'string') return { action: 'search', query: obj.query };
  if (obj.action === 'fetch' && typeof obj.url === 'string') return { action: 'fetch', url: obj.url };
  if (obj.action === 'find' && typeof obj.doc === 'string' && Array.isArray(obj.terms)) {
    return { action: 'find', doc: obj.doc, terms: obj.terms.filter((t): t is string => typeof t === 'string' && t.trim().length > 1) };
  }
  if (obj.action === 'propose' && Array.isArray(obj.claims)) return { action: 'propose', claims: obj.claims as RawClaim[] };
  if (obj.action === 'finish') return { action: 'finish' };
  return undefined;
}

/**
 * Bounded research for one gap (spec `gap-research`). Holds NO catalog
 * store: its inputs are a read-only excerpt, web tools and an LLM; its only
 * output is proposed claims plus an outcome.
 */
export class ResearchAgent {
  constructor(
    private readonly tools: WebTools,
    private readonly llm: LlmPort,
  ) {}

  async research(input: {
    gap: KnowledgeGap;
    excerpt: CatalogExcerpt;
    budget: ResearchBudget;
    snapshotEpoch: number;
  }): Promise<ResearchOutcome> {
    const { gap, excerpt, budget } = input;
    const permitted = PERMITTED_CLAIM_TYPES[gap.type];
    const excluded = new Set(excerpt.excludedAreas.map(normalizeGeoName));
    const usage: ResearchBudgetUsage = { rounds: 0, searches: 0, fetches: 0 };
    const history: string[] = [];
    const docs = new Map<string, FetchedDocument>();
    const claims: ProposedClaim[] = [];
    const discarded: ResearchOutcome['discarded'] = [];
    let searchFailures = 0;
    let searchSuccesses = 0;
    let budgetHit = false;
    let finished = false;

    const outcome = (kind: ResearchOutcome['kind'], failure?: string): ResearchOutcome => ({
      gapKey: gap.key, kind, claims, discarded, budgetUsed: { ...usage }, snapshotEpoch: input.snapshotEpoch,
      ...(failure ? { failure } : {}),
    });

    while (usage.rounds < budget.maxRounds) {
      usage.rounds += 1;
      let raw: string;
      try {
        raw = await this.llm.complete(
          buildAgentPrompt({
            gap, excerpt, permitted, history,
            remaining: {
              rounds: budget.maxRounds - usage.rounds + 1,
              searches: budget.maxSearches - usage.searches,
              fetches: budget.maxFetches - usage.fetches,
            },
          }),
          'research-agent',
        );
      } catch (error) {
        return outcome(claims.length ? 'CLAIMS_PROPOSED' : 'TOOL_FAILURE', `llm: ${(error as Error).message}`);
      }
      const action = parseAction(raw);
      if (!action) {
        history.push(`step ${usage.rounds}: invalid reply ignored (reply must be one JSON action)`);
        continue;
      }
      if (action.action === 'finish') {
        finished = true;
        break;
      }

      if (action.action === 'search') {
        if (usage.searches >= budget.maxSearches) {
          budgetHit = true;
          history.push(`step ${usage.rounds}: search refused, search budget exhausted`);
          continue;
        }
        usage.searches += 1;
        try {
          const results = await this.tools.search(action.query);
          searchSuccesses += 1;
          history.push(
            `step ${usage.rounds}: search "${action.query}" ->`,
            ...results.slice(0, 8).map((r, i) => `  r${i + 1}. ${r.title} | ${r.url} | ${r.snippet}`),
          );
        } catch (error) {
          searchFailures += 1;
          history.push(`step ${usage.rounds}: search failed (${(error as Error).message})`);
        }
        continue;
      }

      if (action.action === 'fetch') {
        if (usage.fetches >= budget.maxFetches) {
          budgetHit = true;
          history.push(`step ${usage.rounds}: fetch refused, fetch budget exhausted`);
          continue;
        }
        usage.fetches += 1;
        try {
          const doc = await this.tools.fetch(action.url, 'research');
          const id = `d${docs.size + 1}`;
          docs.set(id, doc);
          history.push(`step ${usage.rounds}: fetched ${id} = ${doc.url} "${doc.title ?? ''}"`, `  [preview] ${doc.text.slice(0, DOC_PREVIEW_CHARS)}`);
        } catch (error) {
          history.push(`step ${usage.rounds}: fetch ${action.url} failed (${(error as Error).message})`);
        }
        continue;
      }

      if (action.action === 'find') {
        const doc = docs.get(action.doc);
        if (!doc || action.terms.length === 0) {
          history.push(`step ${usage.rounds}: find ignored (unknown doc or no terms)`);
          continue;
        }
        const sentences = findSentences(doc.text, action.terms);
        history.push(
          `step ${usage.rounds}: find in ${action.doc} [${action.terms.join(', ')}] -> ${sentences.length} sentence(s)`,
          ...sentences.map((t) => `  > ${t}`),
        );
        continue;
      }

      // propose
      let accepted = 0;
      for (const rawClaim of action.claims) {
        const claimType = rawClaim.claimType as ClaimType;
        const partial: Partial<ProposedClaim> = { claimType, subjectMention: rawClaim.subject };
        if (!permitted.includes(claimType)) {
          discarded.push({ reason: 'CLAIM_TYPE_NOT_PERMITTED', claim: partial });
          continue;
        }
        if (!rawClaim.subject || (gap.type === 'SCHEDULE_CAPACITY' && excluded.has(normalizeGeoName(rawClaim.subject)))) {
          discarded.push({ reason: 'EXCLUDED_SUBJECT', claim: partial });
          continue;
        }
        const captures: EvidenceCapture[] = [];
        for (const ev of rawClaim.evidence ?? []) {
          const doc = ev.doc ? docs.get(ev.doc) : undefined;
          const capture = doc && ev.quote ? captureFromQuote(doc, ev.quote, registrableDomain(doc.url), rawClaim.authorityClass) : undefined;
          if (capture) captures.push(capture);
        }
        if (captures.length === 0) {
          discarded.push({ reason: 'NO_CAPTURE', claim: partial });
          continue;
        }
        claims.push({
          claimType,
          subjectMention: rawClaim.subject,
          ...(rawClaim.area ? { areaMention: rawClaim.area } : {}),
          ...(rawClaim.from ? { fromMention: rawClaim.from } : {}),
          ...(rawClaim.to ? { toMention: rawClaim.to } : {}),
          proposedThemes: Array.isArray(rawClaim.themes) ? rawClaim.themes.filter((t) => typeof t === 'string') : [],
          captures,
          ...(rawClaim.authorityClass ? { proposedAuthorityClass: rawClaim.authorityClass } : {}),
        });
        accepted += 1;
      }
      history.push(`step ${usage.rounds}: proposed ${action.claims.length} claim(s); ${accepted} carried a verifiable quote`);
    }

    if (!finished && usage.rounds >= budget.maxRounds) budgetHit = true;
    if (claims.length > 0) return outcome('CLAIMS_PROPOSED');
    if (searchSuccesses === 0 && searchFailures > 0) return outcome('TOOL_FAILURE', 'every search failed');
    return outcome(budgetHit ? 'BUDGET_EXHAUSTED' : 'NO_EVIDENCE_FOUND');
  }
}
