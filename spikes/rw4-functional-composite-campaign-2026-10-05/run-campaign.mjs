// Stage-3 SIMPLE/COMPOSITE/MIXED spike orchestrator.
//
// Drives the real runtime path only:
//   POST /auth/email/request-code -> POST /auth/email/verify
//   -> POST /tours/generate-tour -> GET /tours/:id (poll until terminal)
//
// Never calls acquisition/resolution services directly. Spike-only tool,
// not production code -- lives alongside the artifacts it produces.
//
// Usage:
//   BASE_URL=http://localhost:3000 REQUEST_FILE=./simple/request.json \
//   OUT_DIR=./simple/cold RUN_LABEL=simple-cold \
//   node run-campaign.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000';
const requestFile = process.env.REQUEST_FILE;
const outDir = process.env.OUT_DIR;
const runLabel = process.env.RUN_LABEL ?? 'run';
const timeoutMs = Number(process.env.OBSERVATION_TIMEOUT_MS ?? 900_000); // 15 min
const intervalMs = Number(process.env.POLL_INTERVAL_MS ?? 2_000);

if (!requestFile || !outDir) {
  throw new Error('REQUEST_FILE and OUT_DIR are required');
}

mkdirSync(outDir, { recursive: true });

const email = `rw3-spike-${runLabel}-${Date.now()}@example.com`;

function log(...args) {
  console.log(`[${runLabel}]`, ...args);
}

async function requestCode() {
  const res = await fetch(`${baseUrl}/auth/email/request-code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`request-code failed ${res.status}: ${JSON.stringify(body)}`);
  }
  if (!body.devCode) {
    throw new Error('devCode not returned -- is the backend running with NODE_ENV=production?');
  }
  return body.devCode;
}

async function verifyCode(devCode) {
  const res = await fetch(`${baseUrl}/auth/email/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, code: devCode }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`verify failed ${res.status}: ${JSON.stringify(body)}`);
  }
  return body.accessToken;
}

async function generateTour(token, requestBody) {
  const startedAt = Date.now();
  const res = await fetch(`${baseUrl}/tours/generate-tour`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(requestBody),
  });
  const body = await res.json();
  const httpMs = Date.now() - startedAt;
  if (!res.ok) {
    throw new Error(`generate-tour failed ${res.status}: ${JSON.stringify(body)}`);
  }
  return { tour: body, httpMs };
}

async function readTour(tourId, token) {
  const res = await fetch(`${baseUrl}/tours/${tourId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`GET /tours/${tourId} failed ${res.status}`);
  }
  return res.json();
}

function diagnostics(tour, startedAt) {
  const metadata = tour?.metadata ?? {};
  const trace = metadata.generationTrace ?? {};
  const steps = trace.steps ?? [];
  const lastStep = steps.at(-1);
  return {
    elapsedMs: Date.now() - startedAt,
    generationStatus: metadata.generationStatus,
    generationMessage: metadata.generationMessage,
    lastTraceStage: lastStep?.stage ?? null,
    lastTraceStatus: lastStep?.status ?? null,
  };
}

async function pollUntilTerminal(tourId, token) {
  const startedAt = Date.now();
  let last;
  while (Date.now() - startedAt <= timeoutMs) {
    // A transport error on one poll (the backend briefly not answering)
    // must not abort observation of a generation that is still running.
    // HTTP error statuses stay fatal; the overall timeout still bounds this.
    try {
      last = await readTour(tourId, token);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      log('poll transport error, retrying:', String(error.cause?.code ?? error.message));
      await new Promise((r) => setTimeout(r, intervalMs));
      continue;
    }
    const d = diagnostics(last, startedAt);
    if (d.generationStatus === 'completed' || d.generationStatus === 'failed') {
      log('terminal:', JSON.stringify(d));
      return { tour: last, terminal: true, observationTimeout: false, elapsedMs: d.elapsedMs };
    }
    if (d.elapsedMs % 10_000 < intervalMs) {
      log('polling:', JSON.stringify(d));
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { tour: last, terminal: false, observationTimeout: true, elapsedMs: Date.now() - startedAt };
}

async function main() {
  const requestBody = JSON.parse(readFileSync(requestFile, 'utf-8'));

  log('requesting dev code for', email);
  const devCode = await requestCode();

  log('verifying');
  const accessToken = await verifyCode(devCode);

  log('POST /tours/generate-tour');
  const { tour: createdTour, httpMs } = await generateTour(accessToken, requestBody);
  writeFileSync(path.join(outDir, 'create-response.json'), JSON.stringify(createdTour, null, 2));
  log('tourId =', createdTour.id, 'create http ms =', httpMs);

  log('polling until terminal (timeout', timeoutMs, 'ms)');
  const pollStartedAt = Date.now();
  const { tour: terminalTour, terminal, observationTimeout, elapsedMs } = await pollUntilTerminal(
    createdTour.id,
    accessToken,
  );

  writeFileSync(path.join(outDir, 'terminal-tour.json'), JSON.stringify(terminalTour, null, 2));
  writeFileSync(
    path.join(outDir, 'generation-trace.json'),
    JSON.stringify(terminalTour?.metadata?.generationTrace ?? null, null, 2),
  );

  const runManifest = {
    runLabel,
    tourId: createdTour.id,
    email,
    baseUrl,
    requestFile: path.basename(requestFile),
    createHttpMs: httpMs,
    generationStatus: terminalTour?.metadata?.generationStatus ?? null,
    terminal,
    observationTimeout,
    observationTimeoutMs: timeoutMs,
    pollElapsedMs: elapsedMs,
    startedAt: new Date(pollStartedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    // Canonical runtime provenance: what run.sh built and launched, next to
    // what the runtime itself reported in the trace. run.sh verifies they
    // agree; this manifest only records the values.
    provenance: {
      sourceHead: process.env.CANONICAL_SOURCE_HEAD || null,
      sourceBranch: process.env.CANONICAL_SOURCE_BRANCH || null,
      buildCommit: process.env.BUILD_COMMIT || null,
      buildTimestamp: process.env.BUILD_TIMESTAMP || null,
      distSha256: process.env.CANONICAL_DIST_SHA256 || null,
      runtimeBuildCommit:
        terminalTour?.metadata?.generationTrace?.runtime?.buildCommit ?? null,
      runtimeBuildTimestamp:
        terminalTour?.metadata?.generationTrace?.runtime?.buildTimestamp ?? null,
    },
    effectiveConfig: {
      groundedSearchProvider: process.env.GROUNDED_SEARCH_PROVIDER || null,
      webSourceContentProvider: process.env.WEB_SOURCE_CONTENT_PROVIDER || null,
      discoveryExtractorProvider: process.env.DISCOVERY_EXTRACTOR_PROVIDER || null,
      cloudflareDiscoveryModel: process.env.CLOUDFLARE_DISCOVERY_MODEL || null,
      cloudflareDiscoveryMaxCompletionTokens: process.env.CLOUDFLARE_DISCOVERY_MAX_COMPLETION_TOKENS
        ? Number(process.env.CLOUDFLARE_DISCOVERY_MAX_COMPLETION_TOKENS)
        : null,
      classificationProvider: process.env.CLASSIFICATION_PROVIDER || null,
      geminiClassificationModel: process.env.GEMINI_CLASSIFICATION_MODEL || null,
      placesProvider: process.env.PLACES_PROVIDER || null,
      aiCacheMode: process.env.AI_CACHE_MODE || null,
    },
  };
  writeFileSync(path.join(outDir, 'run-manifest.json'), JSON.stringify(runManifest, null, 2));

  log('done. generationStatus =', runManifest.generationStatus, 'observationTimeout =', observationTimeout);
  process.exitCode = terminal && terminalTour?.metadata?.generationStatus === 'completed' ? 0 : terminal ? 1 : 2;
}

main().catch((err) => {
  console.error(`[${runLabel}] FATAL:`, err);
  writeFileSync(
    path.join(outDir, 'run-manifest.json'),
    JSON.stringify({ runLabel, error: String(err?.stack ?? err), finishedAt: new Date().toISOString() }, null, 2),
  );
  process.exitCode = 3;
});
