import { Logger } from '@nestjs/common';
import { LangChainService } from '@shared/ai/langchain.service';

const logger = new Logger('WikidataContentSafety');

export interface WikidataExtractInput {
  qid: string;
  extract: string;
}

export const CONTENT_SAFETY_PROMPT = `You will review a list of short Wikipedia/Wikidata extracts about real-world places, identified by QID. For EACH one, decide if it is safe, on-topic encyclopedic content — no vandalism, hate speech, spam, or nonsense.

Extracts (JSON, QID -> text):
{extractsJson}

Respond ONLY with a JSON object mapping each QID to true (safe) or false (unsafe/vandalism/nonsense) — no other text, no markdown formatting. Example: {{"Q1": true, "Q2": false}}`;

export interface WikidataSafetyAssessment {
  safeQids: Set<string>;
  status: 'success' | 'failed';
}

/**
 * Filters a batch of Wikidata/Wikipedia extracts down to the ones judged
 * safe to use as LLM grounding (and, if ever persisted to
 * metadata.narrativeSources) — tags.wikidata on OSM is crowd-sourced,
 * editable data, not curated content, so this runs before any of it reaches
 * a generation prompt.
 *
 * One LLM call for the whole batch, not one per extract — same batching
 * discipline as the Wikidata HTTP fetch itself (see wikidata-api.service.ts)
 * — the content-safety check would otherwise just move the N+1 problem from
 * a cheap HTTP call to an expensive LLM call.
 *
 * Fails safe: if the check itself fails, times out, or returns something
 * unparseable, every extract in the batch is dropped rather than risked —
 * same defensive posture as "Wikidata failed" elsewhere in this pipeline.
 */
export async function filterSafeWikidataExtracts(
  inputs: WikidataExtractInput[],
  langChainService: LangChainService,
): Promise<Set<string>> {
  return (await assessWikidataExtractSafety(inputs, langChainService)).safeQids;
}

export async function assessWikidataExtractSafety(
  inputs: WikidataExtractInput[],
  langChainService: LangChainService,
): Promise<WikidataSafetyAssessment> {
  if (inputs.length === 0) {
    return { safeQids: new Set(), status: 'success' };
  }

  try {
    const extractsJson = JSON.stringify(
      Object.fromEntries(inputs.map((i) => [i.qid, i.extract])),
    );

    const response = await langChainService.generateCompletionResponse(
      CONTENT_SAFETY_PROMPT,
      { extractsJson } as any,
    );

    const parsed = JSON.parse(extractJsonObject(response));
    const safeQids = new Set<string>();
    for (const { qid } of inputs) {
      if (parsed[qid] === true) safeQids.add(qid);
    }
    return { safeQids, status: 'success' };
  } catch (error) {
    logger.warn(
      `Content-safety check failed for a batch of ${inputs.length} extract(s), dropping all of them: ${error.message}`,
    );
    return { safeQids: new Set(), status: 'failed' };
  }
}

/** The model sometimes wraps its JSON in prose or a markdown fence despite
 * instructions — pull out the first {...} block rather than fail parsing
 * outright on otherwise-usable output. */
function extractJsonObject(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}
