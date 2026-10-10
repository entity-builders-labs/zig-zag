/**
 * Isolated LIVE characterization harness for the Groq discovery extractor.
 * Replays the EXACT frozen ExperienceDiscoveryRequest + grounded evidence
 * captured from run3 and calls ONLY GroqDiscoveryProvider.extractExperiences()
 * over the real Groq transport. Reuses production provider/prompt/parser.
 *
 * Usage (from repo/be):
 *   RUNS=10 npx ts-node -r tsconfig-paths/register \
 *     ../spikes/extractor-reliability-run3-replay-2026-09-25/harness/replay.ts
 * Optional separate controlled experiment (lower completion tokens):
 *   CONTROLLED_MAX_COMPLETION_TOKENS=900 ... (same command)
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

import aiConfig from 'src/shared/ai/ai.config';
import { LangChainService } from 'src/shared/ai/langchain.service';
import { GroqDiscoveryProvider } from 'src/modules/tours/services/groq-discovery.provider';
import {
  buildDiscoverySystemPrompt,
  buildDiscoveryUserPrompt,
} from 'src/modules/tours/prompts/experience-discovery-extraction.prompt';
import { extractExperienceCandidates } from 'src/modules/tours/utils/experience-candidate-extraction.util';

const SPIKE = path.resolve(__dirname, '..');
const REPO = path.resolve(SPIKE, '../..');

function loadEnv(): void {
  for (const f of [path.join(REPO, '.env'), path.join(REPO, 'be', '.env')]) {
    if (fs.existsSync(f)) dotenv.config({ path: f });
  }
}
loadEnv();

function redactSecrets(text: string): string {
  let out = text;
  for (const [k, v] of Object.entries(process.env)) {
    if (v && v.length > 8 && /(KEY|TOKEN|SECRET|PASSWORD)$/.test(k)) {
      out = out.split(v).join('[REDACTED]');
    }
  }
  return out
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]')
    .replace(/org_[A-Za-z0-9_-]+/g, 'org_[REDACTED]')
    .replace(/\b(?:account|user|proj)_[A-Za-z0-9_-]+/g, '$1_[REDACTED]');
}

const config = (aiConfig as unknown as () => any)();
const noCache = {
  getCachedResponse: async (): Promise<string | null> => null,
  cacheResponse: async (): Promise<void> => undefined,
  isEnabled: (): boolean => false,
};
const langChain = new LangChainService(config, noCache as any);
const provider = new GroqDiscoveryProvider(langChain as any, config);
const MODEL: string = config.discoveryExtractor.groq.model;

const RUNS = Number(process.env.RUNS ?? 10);
const CASES = (process.env.CASES ?? 'case-a,case-b,single-evidence').split(',');
const CONTROLLED_TOKENS = process.env.CONTROLLED_MAX_COMPLETION_TOKENS
  ? Number(process.env.CONTROLLED_MAX_COMPLETION_TOKENS)
  : undefined;

type Outcome =
  | 'PROVIDER_FAILURE'
  | 'INVALID_JSON'
  | 'SCHEMA_OR_NORMALIZATION_REJECTION'
  | 'NO_CANDIDATE'
  | 'CANDIDATE';

const CASE_DEFS = [
  { id: 'case-a', requestFile: 'case-a-request.json', evidenceFile: 'case-a-grounded-evidence.json' },
  { id: 'case-b', requestFile: 'case-b-request.json', evidenceFile: 'case-b-grounded-evidence.json' },
  { id: 'single-evidence', requestFile: 'single-evidence-request.json', evidenceFile: 'single-evidence-grounded-evidence.json' },
];

function writeJson(file: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}
function writeText(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function classify(result: any): Outcome {
  const errors: string[] = result?.validationErrors ?? [];
  const candidates: any[] = result?.candidates ?? [];
  if (candidates.length > 0) return 'CANDIDATE';
  if (errors.some((e: string) => e.includes('Failed to parse JSON response')))
    return 'INVALID_JSON';
  if (errors.length > 0) return 'SCHEMA_OR_NORMALIZATION_REJECTION';
  return 'NO_CANDIDATE';
}

// Component-level detail straight from the raw model envelope: the
// deterministic parser strips supportSpan, so supportSpan/order stability
// must be read from the raw output.
function rawComponentFacts(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.candidates)
        ? parsed.candidates
        : parsed && typeof parsed === 'object' && Array.isArray(parsed.componentHints)
          ? [parsed]
          : [];
    return entries.map((c: any) => ({
      name: c?.name,
      components: (c?.componentHints ?? []).map((h: any, i: number) => ({
        index: i,
        key: h?.key,
        name: h?.name,
        role: h?.role,
        expectedKind: h?.expectedKind,
        evidenceKeys: h?.evidenceKeys,
        supportSpan: h?.supportSpan,
      })),
      evidenceKeys: c?.evidenceKeys,
      orderedByEvidence: c?.orderedByEvidence,
    }));
  } catch {
    return [];
  }
}

function providerErrorKind(
  message: string,
): 'rate_limit_429' | 'json_validate_failed' | 'other' {
  if (/429/.test(message)) return 'rate_limit_429';
  if (/json_validate_failed|Failed to generate JSON/i.test(message))
    return 'json_validate_failed';
  return 'other';
}

async function runOnce(
  request: any,
  searchResult: any,
): Promise<{
  outcome: Outcome;
  error?: string;
  errorKind?: string;
  result?: any;
  elapsedMs: number;
}> {
  const started = Date.now();
  try {
    const result = await provider.extractExperiences(request, searchResult, {
      bypassCache: true,
    });
    return { outcome: classify(result), result, elapsedMs: Date.now() - started };
  } catch (err: any) {
    const raw = err?.message ?? String(err);
    const kind = providerErrorKind(raw);
    return {
      outcome: kind === 'json_validate_failed' ? 'INVALID_JSON' : 'PROVIDER_FAILURE',
      error: redactSecrets(raw),
      errorKind: kind,
      elapsedMs: Date.now() - started,
    };
  }
}

async function runCase(def: { id: string; requestFile: string; evidenceFile: string }): Promise<void> {
  const dir = path.join(SPIKE, def.id);
  const request = JSON.parse(fs.readFileSync(path.join(SPIKE, def.requestFile), 'utf8'));
  const searchResult = JSON.parse(fs.readFileSync(path.join(SPIKE, def.evidenceFile), 'utf8'));

  const systemPrompt = buildDiscoverySystemPrompt();
  const userPrompt = buildDiscoveryUserPrompt(request, searchResult.evidence);
  writeText(path.join(dir, 'system-prompt.txt'), systemPrompt + '\n');
  writeText(path.join(dir, 'user-prompt.txt'), userPrompt + '\n');
  writeJson(path.join(dir, 'input-request.json'), request);
  writeJson(path.join(dir, 'input-grounded-evidence.json'), searchResult);

  const outcomes: Outcome[] = [];
  for (let run = 1; run <= RUNS; run++) {
    const runDir = path.join(dir, `run-${String(run).padStart(2, '0')}`);
    const { outcome, error, errorKind, result, elapsedMs } = await runOnce(
      request,
      searchResult,
    );
    outcomes.push(outcome);
    const raw = result?.rawOutput ?? '';
    writeText(path.join(runDir, 'raw-response.txt'), raw);

    const record: Record<string, unknown> = {
      classification: outcome,
      provider: result?.provider ?? 'groq',
      model: result?.model ?? MODEL,
      elapsedMs,
    };
    if (error) {
      record.providerError = error;
      record.providerErrorKind = errorKind;
    }
    if (result) {
      record.candidates = result.candidates;
      record.validationErrors = result.validationErrors;
      record.sourceSupportAudits = result.sourceSupportAudits;
      record.rawComponentFacts = rawComponentFacts(raw);
    }
    writeJson(path.join(runDir, 'parsed-result.json'), record);
    console.log(
      `[${def.id}] run ${String(run).padStart(2, '0')} -> ${outcome}` +
        (result?.candidates?.length ? ` (${result.candidates.length} candidate(s))` : '') +
        (error ? ` · ${error.slice(0, 120)}` : ''),
    );
  }
  writeJson(path.join(dir, 'aggregate.json'), {
    model: MODEL,
    runs: RUNS,
    distribution: outcomes.reduce<Record<string, number>>((acc, o) => {
      acc[o] = (acc[o] ?? 0) + 1;
      return acc;
    }, {}),
    outcomes,
  });
}

async function runControlledExperiment(def: { id: string; requestFile: string; evidenceFile: string }): Promise<void> {
  if (!CONTROLLED_TOKENS) return;
  const dir = path.join(SPIKE, def.id, `controlled-limit-${CONTROLLED_TOKENS}`);
  const request = JSON.parse(fs.readFileSync(path.join(SPIKE, def.requestFile), 'utf8'));
  const searchResult = JSON.parse(fs.readFileSync(path.join(SPIKE, def.evidenceFile), 'utf8'));
  const evidence = searchResult.evidence ?? [];
  const system = buildDiscoverySystemPrompt();
  const prompt = buildDiscoveryUserPrompt(request, evidence);
  writeText(path.join(dir, 'system-prompt.txt'), system + '\n');
  writeText(path.join(dir, 'user-prompt.txt'), prompt + '\n');

  const started = Date.now();
  try {
    const raw = await langChain.generateChatResponse(system, prompt, {}, {
      providerOverride: 'groq',
      modelOverride: MODEL,
      bypassCache: true,
      responseFormat: { type: 'json_object' },
      groq: { maxCompletionTokens: CONTROLLED_TOKENS },
    } as any);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    const extracted = extractExperienceCandidates(
      parsed,
      evidence.map((item: any) => ({ key: item.key, title: item.title, text: item.snippet })),
      request.maxCandidates,
    );
    const outcome = classify({ candidates: extracted.candidates, validationErrors: extracted.validationErrors });
    writeText(path.join(dir, 'raw-response.txt'), raw);
    writeJson(path.join(dir, 'parsed-result.json'), {
      classification: outcome,
      provider: 'groq',
      model: MODEL,
      maxCompletionTokens: CONTROLLED_TOKENS,
      elapsedMs: Date.now() - started,
      candidates: extracted.candidates,
      validationErrors: extracted.validationErrors,
      sourceSupportAudits: extracted.sourceSupportAudits,
      rawComponentFacts: rawComponentFacts(raw),
    });
    console.log(`[${def.id} controlled-${CONTROLLED_TOKENS}] -> ${outcome}`);
  } catch (err: any) {
    writeJson(path.join(dir, 'parsed-result.json'), {
      classification: 'PROVIDER_FAILURE',
      providerError: redactSecrets(err?.message ?? String(err)),
      maxCompletionTokens: CONTROLLED_TOKENS,
      elapsedMs: Date.now() - started,
    });
    console.log(`[${def.id} controlled-${CONTROLLED_TOKENS}] -> PROVIDER_FAILURE · ${redactSecrets(err?.message ?? '')}`);
  }
}

(async () => {
  console.log(
    `extractor replay · provider=groq model=${MODEL} runs=${RUNS} cases=${CASES.join(',')}` +
      (CONTROLLED_TOKENS ? ` controlledTokens=${CONTROLLED_TOKENS}` : ''),
  );
  for (const def of CASE_DEFS) {
    if (!CASES.includes(def.id)) continue;
    if (process.env.SKIP_PRIMARY !== '1') await runCase(def);
    if (CONTROLLED_TOKENS) await runControlledExperiment(def);
  }
  console.log('done');
})().catch((err) => {
  console.error(redactSecrets(err?.stack ?? String(err)));
  process.exit(1);
});
