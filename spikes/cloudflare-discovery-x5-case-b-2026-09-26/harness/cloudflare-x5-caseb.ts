/**
 * Isolated LIVE characterization of the Cloudflare Workers AI discovery
 * extractor (`@cf/qwen/qwen3.8-27b`) on the frozen case-b fixture (10 evidence
 * items, including the strong ev-4 composite item).
 *
 * Runs the CORRECTED production `CloudflareDiscoveryProvider` (temperature 0,
 * max_completion_tokens 900, `chat_template_kwargs.enable_thinking=false`, no
 * response_format, 60s timeout) exactly 5 times. Captures per-run outcome,
 * HTTP status, finish_reason, completion tokens, latency, raw content, parsed
 * extraction, component set/order, support spans, evidence keys,
 * source-support audits, validation errors, and a SHA-256 of each raw content
 * so byte identity can be proven.
 *
 * No Serper, no DB, no planner, no tour pipeline, no evidence regeneration.
 *
 * Usage (from repo/be):
 *   RUNS=5 npx ts-node --transpile-only -P tsconfig.json \
 *     -r tsconfig-paths/register \
 *     ../spikes/cloudflare-discovery-x5-case-b-2026-09-26/harness/cloudflare-x5-caseb.ts
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createHash } from 'crypto';

import {
  CloudflareDiscoveryError,
  CloudflareDiscoveryProvider,
} from 'src/modules/tours/services/cloudflare-discovery.provider';
import {
  buildDiscoverySystemPrompt,
  buildDiscoveryUserPrompt,
} from 'src/modules/tours/prompts/experience-discovery-extraction.prompt';

const SPIKE = path.resolve(__dirname, '..');
const REPO = path.resolve(SPIKE, '..', '..');
const SOURCE = path.join(
  REPO,
  'spikes/extractor-reliability-run3-replay-2026-09-25',
);
const OUT = path.join(SPIKE, 'case-b');

function loadEnv(): void {
  for (const f of [path.join(REPO, '.env'), path.join(REPO, 'be', '.env')]) {
    if (fs.existsSync(f)) dotenv.config({ path: f });
  }
}
loadEnv();

const RUNS = Number(process.env.RUNS ?? 5);
const MODEL = process.env.CLOUDFLARE_DISCOVERY_MODEL || '@cf/qwen/qwen3.8-27b';
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const timeoutMs = Number(process.env.CLOUDFLARE_DISCOVERY_TIMEOUT_MS || 60000);

function redactSecrets(text: string): string {
  let out = text;
  for (const [k, v] of Object.entries(process.env)) {
    if (v && v.length > 8 && /(KEY|TOKEN|SECRET|PASSWORD)$/.test(k)) {
      out = out.split(v).join('[REDACTED]');
    }
  }
  return out
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/cfat_[A-Za-z0-9_-]+/g, 'cfat_[REDACTED]');
}

const config = {
  discoveryExtractor: {
    cloudflare: { accountId, apiToken, model: MODEL, timeoutMs },
  },
} as any;
const provider = new CloudflareDiscoveryProvider(config);

const request = JSON.parse(
  fs.readFileSync(path.join(SOURCE, 'case-b-request.json'), 'utf8'),
);
const searchResult = JSON.parse(
  fs.readFileSync(path.join(SOURCE, 'case-b-grounded-evidence.json'), 'utf8'),
);

type Outcome =
  | 'CANDIDATE'
  | 'NO_CANDIDATE'
  | 'INVALID_JSON'
  | 'SCHEMA_OR_NORMALIZATION_REJECTION'
  | 'PROVIDER_FAILURE';

function classify(result: any): Outcome {
  const errors: string[] = result?.validationErrors ?? [];
  const candidates: any[] = result?.candidates ?? [];
  if (candidates.length > 0) return 'CANDIDATE';
  if (errors.some((e: string) => e.includes('Failed to parse JSON response')))
    return 'INVALID_JSON';
  if (errors.length > 0) return 'SCHEMA_OR_NORMALIZATION_REJECTION';
  return 'NO_CANDIDATE';
}

function rawComponentFacts(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.candidates)
        ? parsed.candidates
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

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function writeJson(file: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}
function writeText(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
let observed: {
  status?: number;
  latencyMs?: number;
  rawBody?: string;
} = {};

const origFetch = global.fetch;
(global as any).fetch = async (input: any, init: any) => {
  const t0 = Date.now();
  const resp = await origFetch(input, init);
  observed.status = resp.status;
  observed.latencyMs = Date.now() - t0;
  try {
    observed.rawBody = await resp.clone().text();
  } catch {
    observed.rawBody = undefined;
  }
  return resp;
};

function transportFacts(rawBody?: string): {
  finishReason?: string;
  completionTokens?: number;
  rawContent?: string;
} {
  if (!rawBody) return {};
  try {
    const j = JSON.parse(rawBody);
    return {
      finishReason: j?.choices?.[0]?.finish_reason,
      completionTokens: j?.usage?.completion_tokens,
      rawContent: j?.choices?.[0]?.message?.content,
    };
  } catch {
    return {};
  }
}

async function runOnce(): Promise<{
  outcome: Outcome;
  result?: any;
  error?: string;
  errorKind?: string;
  httpStatus?: number;
  elapsedMs: number;
  finishReason?: string;
  completionTokens?: number;
  rawContent?: string;
  latencyMs?: number;
}> {
  observed = {};
  const started = Date.now();
  try {
    const result = await provider.extractExperiences(request, searchResult);
    const facts = transportFacts(observed.rawBody);
    return {
      outcome: classify(result),
      result,
      httpStatus: observed.status,
      elapsedMs: Date.now() - started,
      latencyMs: observed.latencyMs,
      finishReason: facts.finishReason,
      completionTokens: facts.completionTokens,
      rawContent: facts.rawContent,
    };
  } catch (err: any) {
    const raw = err?.message ?? String(err);
    const kind =
      err instanceof CloudflareDiscoveryError && err.status === 429
        ? 'rate_limit_429'
        : /429/.test(raw)
          ? 'rate_limit_429'
          : 'other';
    return {
      outcome: 'PROVIDER_FAILURE',
      error: redactSecrets(raw),
      errorKind: kind,
      httpStatus:
        err instanceof CloudflareDiscoveryError ? err.status : observed.status,
      elapsedMs: Date.now() - started,
      latencyMs: observed.latencyMs,
    };
  }
}

async function main() {
  console.log(
    `cloudflare case-b x5 · model=${MODEL} · temperature=0 · max_completion_tokens=900 · enable_thinking=false · no response_format · timeout=${timeoutMs}ms`,
  );

  writeText(
    path.join(OUT, 'system-prompt.txt'),
    buildDiscoverySystemPrompt() + '\n',
  );
  writeText(
    path.join(OUT, 'user-prompt.txt'),
    buildDiscoveryUserPrompt(request, searchResult.evidence ?? []) + '\n',
  );
  writeJson(path.join(OUT, 'input-request.json'), request);
  writeJson(path.join(OUT, 'input-grounded-evidence.json'), searchResult);

  const outcomes: Outcome[] = [];
  const records: Record<string, unknown>[] = [];

  for (let run = 1; run <= RUNS; run++) {
    const runDir = path.join(OUT, `run-${String(run).padStart(2, '0')}`);
    const r = await runOnce();
    outcomes.push(r.outcome);

    const rawContent = r.rawContent ?? '';
    writeText(path.join(runDir, 'raw-response.txt'), rawContent);

    const record: Record<string, unknown> = {
      classification: r.outcome,
      provider: r.result?.provider ?? 'cloudflare',
      model: r.result?.model ?? MODEL,
      temperature: 0,
      maxCompletionTokens: 900,
      responseFormat: 'none',
      chatTemplateKwargs: { enable_thinking: false },
      httpStatus: r.httpStatus,
      finishReason: r.finishReason,
      completionTokens: r.completionTokens,
      elapsedMs: r.elapsedMs,
      latencyMs: r.latencyMs,
      rawContentSha256: rawContent ? sha256(rawContent) : undefined,
    };
    if (r.error) {
      record.providerError = r.error;
      record.providerErrorKind = r.errorKind;
    }
    if (r.result) {
      record.candidates = r.result.candidates;
      record.validationErrors = r.result.validationErrors;
      record.sourceSupportAudits = r.result.sourceSupportAudits;
      record.rawComponentFacts = rawComponentFacts(r.result.rawOutput ?? '');
    }
    records.push(record);
    writeJson(path.join(runDir, 'parsed-result.json'), record);

    console.log(
      `run ${String(run).padStart(2, '0')} -> ${r.outcome}` +
        (r.httpStatus !== undefined ? ` (HTTP ${r.httpStatus})` : '') +
        (r.finishReason ? ` finish=${r.finishReason}` : '') +
        (r.completionTokens !== undefined
          ? ` tokens=${r.completionTokens}`
          : '') +
        ` ${r.elapsedMs}ms`,
    );
  }

  writeJson(path.join(OUT, 'aggregate.json'), {
    model: MODEL,
    temperature: 0,
    maxCompletionTokens: 900,
    responseFormat: 'none',
    chatTemplateKwargs: { enable_thinking: false },
    timeoutMs,
    runs: RUNS,
    completedRuns: RUNS,
    distribution: outcomes.reduce<Record<string, number>>((acc, o) => {
      acc[o] = (acc[o] ?? 0) + 1;
      return acc;
    }, {}),
    outcomes,
    records,
  });
  console.log('done');
}

main().catch((err) => {
  console.error(redactSecrets(err?.stack ?? String(err)));
  process.exit(1);
});

