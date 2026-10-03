import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

import {
  CloudflareDiscoveryProvider,
} from 'src/modules/tours/services/cloudflare-discovery.provider';
import {
  candidateSatisfiesEvidenceRequirement,
} from 'src/modules/tours/utils/acquisition-candidate-requirement.util';

const SPIKE = __dirname;
const REPO = path.resolve(SPIKE, '..', '..');

for (const f of [path.join(REPO, '.env'), path.join(REPO, 'be', '.env')]) {
  if (fs.existsSync(f)) dotenv.config({ path: f });
}

const RUNS = Number(process.env.RUNS ?? 5);
const MODEL = process.env.CLOUDFLARE_DISCOVERY_MODEL || '@cf/qwen/qwen3.8-27b';
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const timeoutMs = Number(process.env.CLOUDFLARE_DISCOVERY_TIMEOUT_MS || 60000);

if (!accountId || !apiToken) {
  console.error('Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN');
  process.exit(1);
}

const config = {
  discoveryExtractor: {
    cloudflare: { accountId, apiToken, model: MODEL, timeoutMs },
  },
} as any;

const provider = new CloudflareDiscoveryProvider(config);

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

async function runTestCase(caseName: string, requestFile: string, evidenceFile: string) {
  const request = JSON.parse(fs.readFileSync(path.join(SPIKE, requestFile), 'utf8'));
  const searchResult = JSON.parse(fs.readFileSync(path.join(SPIKE, evidenceFile), 'utf8'));

  console.log(`\n======================================================`);
  console.log(`Starting characterization: ${caseName} (${RUNS} runs)`);
  console.log(`Model: ${MODEL}`);
  console.log(`======================================================`);

  const results = [];
  const outDir = path.join(SPIKE, caseName);
  fs.mkdirSync(outDir, { recursive: true });

  for (let i = 1; i <= RUNS; i++) {
    observed = {};
    const t0 = Date.now();
    let outcome = 'UNKNOWN';
    let extractResult: any = null;
    let errorMsg: string | null = null;

    try {
      extractResult = await provider.extractExperiences(request, searchResult);
      const candidates = extractResult.candidates || [];
      const validationErrors = extractResult.validationErrors || [];

      if (candidates.length > 0) {
        const admitted = candidates.filter((c: any) =>
          (request.evidenceRequirements || []).every((req: any) =>
            candidateSatisfiesEvidenceRequirement(c, req),
          ),
        );
        outcome = admitted.length > 0 ? `CANDIDATE_ADMITTED (${admitted.length}/${candidates.length})` : `CANDIDATE_REJECTED (${candidates.length})`;
      } else if (validationErrors.length > 0) {
        outcome = `VALIDATION_ERROR: ${validationErrors.join(', ')}`;
      } else {
        outcome = 'SEMANTIC_EMPTY (0 candidates)';
      }
    } catch (err: any) {
      outcome = `PROVIDER_FAILURE: ${err.message}`;
      errorMsg = err.message;
    }

    const elapsedMs = Date.now() - t0;
    const facts = transportFacts(observed.rawBody);

    const runRecord = {
      run: i,
      caseName,
      outcome,
      httpStatus: observed.status,
      latencyMs: observed.latencyMs,
      elapsedMs,
      finishReason: facts.finishReason,
      completionTokens: facts.completionTokens,
      rawContent: facts.rawContent,
      extractResult,
      error: errorMsg,
    };

    results.push(runRecord);

    fs.writeFileSync(
      path.join(outDir, `run-${i}.json`),
      JSON.stringify(runRecord, null, 2),
    );
    if (facts.rawContent) {
      fs.writeFileSync(
        path.join(outDir, `run-${i}-raw.txt`),
        facts.rawContent,
      );
    }

    console.log(
      `Run ${i}/${RUNS}: outcome=${outcome} http=${observed.status} tokens=${facts.completionTokens} finish=${facts.finishReason} elapsed=${elapsedMs}ms`,
    );
    if (extractResult?.candidates?.length > 0) {
      for (const c of extractResult.candidates) {
        console.log(`  -> Candidate: "${c.name}" components=${c.componentHints?.length}`);
        for (const h of c.componentHints || []) {
          console.log(`     - [${h.role}] ${h.name} (evidence: ${h.evidenceKeys?.join(',')}) supportSpan="${h.supportSpan || ''}"`);
        }
      }
    }
  }

  const summary = {
    caseName,
    model: MODEL,
    totalRuns: RUNS,
    outcomes: results.reduce((acc: any, r) => {
      acc[r.outcome] = (acc[r.outcome] || 0) + 1;
      return acc;
    }, {}),
    avgLatencyMs: Math.round(results.reduce((a, b) => a + (b.latencyMs || b.elapsedMs), 0) / RUNS),
  };

  fs.writeFileSync(
    path.join(outDir, `summary.json`),
    JSON.stringify(summary, null, 2),
  );
  console.log(`Summary for ${caseName}:`, summary);
}

async function main() {
  await runTestCase('positive-control', 'positive-control-request.json', 'positive-control-evidence.json');
  await runTestCase('latest-semantic-empty', 'latest-trace-request.json', 'latest-trace-evidence.json');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
