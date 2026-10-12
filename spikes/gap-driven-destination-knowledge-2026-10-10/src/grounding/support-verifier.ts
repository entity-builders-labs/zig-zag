import { ClaimType, EvidenceCapture, FacetKey, SupportLevel, SupportVerdict } from '../contracts';
import { LlmPort, parseJsonObject } from '../research/llm';

/** What the verifier is asked to judge: one claim statement for one facet. */
export interface SupportQuestion {
  claimKey: string;
  claimType: ClaimType;
  subject: string;
  area?: string;
  from?: string;
  to?: string;
  facet: FacetKey;
}

export interface SupportVerifier {
  readonly identity: { provider: string; model: string };
  judge(question: SupportQuestion, capture: EvidenceCapture): Promise<SupportVerdict>;
}

export class VerifierUnavailable extends Error {}

export function claimStatement(q: SupportQuestion): string {
  const facet = q.facet.replace(/^[a-z_]+:/, '');
  switch (q.claimType) {
    case 'RELEVANT_FOR':
      return `"${q.subject}" is worth visiting for travellers interested in ${facet}.`;
    case 'NOTABLE_WITHIN':
      return `"${q.subject}" is a notable place in "${q.area}" for travellers interested in ${facet}.`;
    case 'WALKING_CORRIDOR': {
      const stretch = q.from && q.to ? ` from "${q.from}" to "${q.to}"` : q.area ? ` in "${q.area}"` : '';
      return facet === 'walk'
        ? `Travellers walk along the street "${q.subject}"${stretch} as a sightseeing walk.`
        : `Walking along "${q.subject}"${stretch} is of interest for travellers interested in ${facet}.`;
    }
  }
}

/**
 * Constrained support verifier (design D8 step 2): a separate LLM call that
 * sees ONLY the pinned capture text and the claim statement, never the
 * research agent's reasoning or its authority label.
 */
export function llmSupportVerifier(llm: LlmPort): SupportVerifier {
  return {
    identity: llm.identity,
    async judge(question, capture) {
      if (capture.capture.kind !== 'PROSE_SPAN') throw new VerifierUnavailable('structured captures are judged by field, not by the LLM');
      const prompt = [
        'Decide whether the EVIDENCE supports the CLAIM. Judge only the evidence text; ignore your own knowledge.',
        'EXPLICIT = the evidence directly states the claim.',
        'IMPLICIT = the evidence clearly implies the claim without stating it.',
        'NONE = the evidence only mentions the subject, or does not support the claim.',
        `CLAIM: ${claimStatement(question)}`,
        `EVIDENCE: """${capture.capture.text}"""`,
        'Reply with one JSON object: {"level":"EXPLICIT|IMPLICIT|NONE","rationale":"<one sentence>"}',
      ].join('\n');
      let raw: string;
      try {
        raw = await llm.complete(prompt, 'support-verifier');
      } catch (error) {
        throw new VerifierUnavailable((error as Error).message);
      }
      const parsed = parseJsonObject(raw);
      const level = parsed?.level;
      if (level !== 'EXPLICIT' && level !== 'IMPLICIT' && level !== 'NONE') {
        throw new VerifierUnavailable('verifier reply had no valid level');
      }
      return {
        claimKey: question.claimKey,
        level: level as SupportLevel,
        verifier: llm.identity,
        ...(typeof parsed?.rationale === 'string' ? { rationale: parsed.rationale } : {}),
      };
    },
  };
}
