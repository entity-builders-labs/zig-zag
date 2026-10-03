/**
 * Controlled-matrix harness for the Groq discovery extractor.
 * Isolates TWO inference variables independently, using the SAME frozen run3
 * inputs and the SAME production semantic path (buildDiscoverySystemPrompt +
 * buildDiscoveryUserPrompt + LangChainService.generateChatResponse +
 * extractExperienceCandidates): max_completion_tokens and temperature.
 * No production code is changed; controlled calls use the real Groq transport.
 *
 * Env: RUNS=10, CASES=case-a,case-b,single-evidence, TEMPERATURE=0.7,
 * MAX_COMPLETION_TOKENS=900, LABEL=controlled-temp07-limit900.
 *
 * Usage (from repo/be):
 *   TEMPERATURE=0.7 MAX_COMPLETION_TOKENS=900 LABEL=controlled-temp07-limit900 \
 *   TS_NODE_TRANSPILE_ONLY=1 TS_NODE_PROJECT=tsconfig.json \
 *   npx ts-node -r tsconfig-paths/register \
 *     ../spikes/extractor-reliability-run3-replay-2026-09-25/harness/controlled-matrix.ts
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

import aiConfig from 'src/shared/ai/ai.config';
import { LangChainService } from 'src/shared/ai/langchain.service';
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
const MODEL: string = config.discoveryExtractor.groq.model;

// Instrument the real outbound transport to count 429/400 status codes.
const httpStats = { requests: 0, status429: 0, status400: 0, status200: 0, other: 0 };
const realFetch = global.fetch.bind(global);
(global as any).fetch = async (url: any, init?: any) => {
  const res = await realFetch(url, init);
  if (String(url).includes('api.groq.com')) {
    httpStats.requests++;
    if (res.status === 429) httpStats.status429++;
    else if (res.status === 400) httpStats.status400++;
    else if (res.ok) httpStats.status200++;
    else httpStats.other++;
  }
  return res;
};

const RUNS = Number(process.env.RUNS ?? 10);
const CASES = (process.env.CASES ?? 'case-a,case-b,single-evidence').split(',');
const TEMPERATURE = Number(process.env.TEMPERATURE ?? '0.7');
const MAX_COMPLETION_TOKENS = Number(process.env.MAX_COMPLETION_TOKENS ?? '900');
const RESPONSE_FORMAT = 'json_object';
const LABEL =
  process.env.LABEL ??
  `controlled-temp${String(TEMPERATURE).replace('.', '')}-limit${MAX_COMPLETION_TOKENS}`;

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

function providerErrorKind(
  message: string,
):
  | 'rate_limit_otpm_429'
  | 'rate_limit_tpd_429'
  | 'rate_limit_tpm_429'
  | 'json_validate_failed'
  | 'other' {
  if (/tokens per day|\bTPD\b/i.test(message)) return 'rate_limit_tpd_429';
  if (/OTPM|output tokens per minute|Request too large/i.test(message))
    return 'rate_limit_otpm_429';
  if (/429/.test(message)) return 'rate_limit_tpm_429';
  if (/json_validate_failed|Failed to generate JSON/i.test(message))
    return 'json_validate_failed';
  return 'other';
}

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

async function controlledOnce(request: any, searchResult: any): Promise<{
  raw: string;
  system: string;
  prompt: string;
  extracted: ReturnType<typeof extractExperienceCandidates>;
}> {
  const evidence = searchResult.evidence ?? [];
  const system = buildDiscoverySystemPrompt();
  const prompt = buildDiscoveryUserPrompt(request, evidence);
  const raw = await langChain.generateChatResponse(system, prompt, {}, {
    providerOverride: 'groq',
    modelOverride: MODEL,
    bypassCache: true,
    responseFormat: { type: 'json_object' },
    temperature: TEMPERATURE,
    groq: { maxCompletionTokens: MAX_COMPLETION_TOKENS },
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
  return { raw, system, prompt, extracted };
}

async function runControlledCase(def: { id: string; requestFile: string; evidenceFile: string }): Promise<boolean> {
  const dir = path.join(SPIKE, LABEL, def.id);
  const request = JSON.parse(fs.readFileSync(path.join(SPIKE, def.requestFile), 'utf8'));
  const searchResult = JSON.parse(fs.readFileSync(path.join(SPIKE, def.evidenceFile), 'utf8'));

  const system = buildDiscoverySystemPrompt();
  const prompt = buildDiscoveryUserPrompt(request, searchResult.evidence);
  writeText(path.join(dir, 'system-prompt.txt'), system + '\n');
  writeText(path.join(dir, 'user-prompt.txt'), prompt + '\n');
  writeJson(path.join(dir, 'input-request.json'), request);
  writeJson(path.join(dir, 'input-grounded-evidence.json'), searchResult);

  const startRequests = httpStats.requests;
  const start429 = httpStats.status429;
  const start400 = httpStats.status400;

  const outcomes: Outcome[] = [];
  let hardOTPM = 0;
  let hardTPD = 0;
  let hardTPM = 0;
  let jsonValidate = 0;
  let tpdBlocked = false;

  for (let run = 1; run <= RUNS; run++) {
    const runDir = path.join(dir, `run-${String(run).padStart(2, '0')}`);
    const started = Date.now();
    try {
      const { raw, extracted } = await controlledOnce(request, searchResult);
      const outcome = classify({
        candidates: extracted.candidates,
        validationErrors: extracted.validationErrors,
      });
      outcomes.push(outcome);
      writeText(path.join(runDir, 'raw-response.txt'), raw);
      writeJson(path.join(runDir, 'parsed-result.json'), {
        classification: outcome,
        provider: 'groq',
        model: MODEL,
        temperature: TEMPERATURE,
        maxCompletionTokens: MAX_COMPLETION_TOKENS,
        responseFormat: RESPONSE_FORMAT,
        elapsedMs: Date.now() - started,
        candidates: extracted.candidates,
        validationErrors: extracted.validationErrors,
        sourceSupportAudits: extracted.sourceSupportAudits,
        rawComponentFacts: rawComponentFacts(raw),
      });
      console.log(
        `[${def.id}] run ${String(run).padStart(2, '0')} -> ${outcome}` +
          (extracted.candidates.length ? ` (${extracted.candidates.length} candidate(s))` : ''),
      );
    } catch (err: any) {
      const raw = err?.message ?? String(err);
      const kind = providerErrorKind(raw);
      const outcome: Outcome = kind === 'json_validate_failed' ? 'INVALID_JSON' : 'PROVIDER_FAILURE';
      outcomes.push(outcome);
      if (kind === 'rate_limit_otpm_429') hardOTPM++;
      else if (kind === 'rate_limit_tpd_429') hardTPD++;
      else if (kind === 'rate_limit_tpm_429') hardTPM++;
      else if (kind === 'json_validate_failed') jsonValidate++;
      writeText(path.join(runDir, 'raw-response.txt'), '');
      writeJson(path.join(runDir, 'parsed-result.json'), {
        classification: outcome,
        provider: 'groq',
        model: MODEL,
        temperature: TEMPERATURE,
        maxCompletionTokens: MAX_COMPLETION_TOKENS,
        responseFormat: RESPONSE_FORMAT,
        elapsedMs: Date.now() - started,
        providerError: redactSecrets(raw),
        providerErrorKind: kind,
      });
      console.log(
        `[${def.id}] run ${String(run).padStart(2, '0')} -> ${outcome}` +
          ` · ${redactSecrets(raw).slice(0, 120)}`,
      );
      // Stop cleanly on daily-quota exhaustion; do not burn quota retrying.
      if (kind === 'rate_limit_tpd_429') {
        tpdBlocked = true;
        break;
      }
    }
  }

  const case429 = httpStats.status429 - start429;
  const case400 = httpStats.status400 - start400;
  const hardTotal = hardOTPM + hardTPD + hardTPM;
  const soft429Retries = Math.max(0, case429 - 4 * hardTotal);
  const completedRuns = outcomes.length;
  writeJson(path.join(dir, 'aggregate.json'), {
    model: MODEL,
    temperature: TEMPERATURE,
    maxCompletionTokens: MAX_COMPLETION_TOKENS,
    responseFormat: RESPONSE_FORMAT,
    runs: RUNS,
    completedRuns,
    ...(tpdBlocked
      ? { blocked: true, blockedReason: 'TPD daily limit exhausted' }
      : completedRuns < RUNS
        ? { blocked: true, blockedReason: 'interrupted' }
        : {}),
    distribution: outcomes.reduce<Record<string, number>>((acc, o) => {
      acc[o] = (acc[o] ?? 0) + 1;
      return acc;
    }, {}),
    outcomes,
    transport: {
      httpRequests: httpStats.requests - startRequests,
      httpStatus429: case429,
      httpStatus400: case400,
      hardOTPM429: hardOTPM,
      hardTPD429: hardTPD,
      hardTPM429: hardTPM,
      soft429Retries,
      jsonValidateFailed: jsonValidate,
    },
  });
  return tpdBlocked;
}

(async () => {
  console.log(
    `controlled matrix · provider=groq model=${MODEL} temperature=${TEMPERATURE} maxCompletionTokens=${MAX_COMPLETION_TOKENS} responseFormat=${RESPONSE_FORMAT} runs=${RUNS} cases=${CASES.join(',')} label=${LABEL}`,
  );
  for (const id of CASES) {
    const def = CASE_DEFS.find((d) => d.id === id.trim());
    if (!def) continue;
    const blocked = await runControlledCase(def);
    if (blocked) {
      console.log(`stopping: TPD daily limit exhausted during ${def.id}`);
      break;
    }
  }
  console.log('done');
})().catch((err) => {
  console.error(redactSecrets(err?.stack ?? String(err)));
  process.exit(1);
});
