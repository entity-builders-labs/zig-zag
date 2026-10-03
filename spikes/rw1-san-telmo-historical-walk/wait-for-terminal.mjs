const baseUrl = process.env.RW1_BASE_URL ?? 'http://localhost:4002';
const tourId = process.env.RW1_TOUR_ID;
const token = process.env.RW1_AUTH_TOKEN;
const timeoutMs = Number(process.env.RW1_OBSERVATION_TIMEOUT_MS ?? 600_000);
const intervalMs = Number(process.env.RW1_POLL_INTERVAL_MS ?? 1_000);

if (!tourId || !token) {
  throw new Error('RW1_TOUR_ID and RW1_AUTH_TOKEN are required');
}

const startedAt = Date.now();
let last;

async function readTour() {
  const response = await fetch(`${baseUrl}/tours/${tourId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`GET /tours/${tourId} failed with ${response.status}`);
  }
  return response.json();
}

function diagnostics(tour) {
  const metadata = tour.metadata ?? {};
  const trace = metadata.generationTrace ?? {};
  const steps = trace.steps ?? [];
  const lastStep = steps.at(-1);
  const acquisition = trace.executionSummary?.acquisition ?? {};
  return {
    elapsedMs: Date.now() - startedAt,
    generationStatus: metadata.generationStatus,
    lastTraceStage: lastStep?.stage ?? null,
    lastTraceStatus: lastStep?.status ?? null,
    lastAcquisitionPass: acquisition.passes ?? null,
    providersAttempted: acquisition.providersAttempted ?? [],
    providersCompleted: (acquisition.providersAttempted ?? []).filter(
      (provider) => !(acquisition.providersFailed ?? []).includes(provider),
    ),
    providersFailed: acquisition.providersFailed ?? [],
  };
}

while (Date.now() - startedAt <= timeoutMs) {
  last = await readTour();
  const diagnostic = diagnostics(last);
  if (
    diagnostic.generationStatus === 'completed' ||
    diagnostic.generationStatus === 'failed'
  ) {
    console.log(JSON.stringify({ terminal: true, ...diagnostic }));
    console.log(JSON.stringify(last));
    process.exitCode = diagnostic.generationStatus === 'completed' ? 0 : 1;
    break;
  }
  if (diagnostic.elapsedMs === 0 || diagnostic.elapsedMs % 10_000 < intervalMs) {
    console.log(JSON.stringify({ terminal: false, ...diagnostic }));
  }
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}

if (!last || !['completed', 'failed'].includes(last.metadata?.generationStatus)) {
  console.error(
    JSON.stringify({
      terminal: false,
      observationTimeout: true,
      ...diagnostics(last ?? { metadata: {} }),
    }),
  );
  process.exitCode = 2;
}
