import { execSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { TransportationMode, TravelPace } from '../../../be/src/modules/tours/interfaces/tour-generation.interface';
import { ADMISSION_POLICY_VERSION } from './admission';
import { generate3 } from './generate';
import { AdmissionLedger } from './places';
import { RANKING_POLICY_VERSION } from './ranking';
import { READINESS_POLICY_3 } from './readiness';
import { ROUTING_POLICY_3 } from './routing';
import { COMPOSITION_POLICY, InterpretedRequest, Recorder, Spike2Catalog, SpikePlanner, buildEnvironment, osmStructuredAdapter, resolveDestination, wikidataFactsAdapter } from './reuse';

/**
 * Spike 3 entry point (no env file: no LLM or search credentials are loaded).
 *   TS_NODE_PROJECT=spikes/structured-places-baseline-2026-10-11/tsconfig.json \
 *     node_modules/.bin/ts-node -r tsconfig-paths/register --transpile-only \
 *     spikes/structured-places-baseline-2026-10-11/src/run.ts --run S3-A --mode record
 */
const RUNS = join(__dirname, '..', 'runs');
const LOCAL_OVERPASS = 'http://localhost:12345/api/interpreter';
const BUENOS_AIRES_POINT = { latitude: -34.6037, longitude: -58.3816 };

export function header3(run: string, mode: string): Record<string, string> {
  const git = (cmd: string) => execSync(`git ${cmd}`, { encoding: 'utf8' }).trim();
  return {
    spike: 'structured-places-baseline-2026-10-11', run, mode, branch: git('rev-parse --abbrev-ref HEAD'), commit: git('rev-parse --short HEAD'), startedAt: new Date().toISOString(),
    admissionPolicy: ADMISSION_POLICY_VERSION, rankingPolicy: RANKING_POLICY_VERSION, readinessPolicy: READINESS_POLICY_3.version, routingPolicy: ROUTING_POLICY_3, compositionPolicy: COMPOSITION_POLICY.version,
  };
}

/** "3 days in Buenos Aires": no themes, explicit wizard mobility as in spikes 1-2. */
const REQUEST: InterpretedRequest = {
  destinationLabel: 'Buenos Aires', days: 3, thematicFacets: [], experienceFormatFacets: [],
  mobility: { allowedTransportationModes: [TransportationMode.WALKING, TransportationMode.PUBLIC_TRANSPORT], maxWalkingDistancePerDayMeters: 8000, maxContinuousWalkingDistanceMeters: 3000, travelPace: TravelPace.MODERATE, accessibilityNeeds: [] },
};

const files = (run: string) => ({ catalog: join(RUNS, run, 'catalog-after.json'), candidates: join(RUNS, run, 'candidates-after.json'), admissions: join(RUNS, run, 'admissions-after.json') });
const write = (dir: string, name: string, data: unknown) => writeFileSync(join(dir, name), JSON.stringify(data, null, 2));

async function main() {
  const argv = process.argv.slice(2);
  const get = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const run = get('--run') ?? 'EMPTY';
  const mode = (get('--mode') ?? 'replay') as 'live' | 'record' | 'replay';
  const header = header3(run, mode);
  console.log(JSON.stringify({ trace: 'header', ...header }));
  if (run === 'EMPTY') return;
  if (!['S3-A', 'S3-B'].includes(run) && !run.startsWith('DIAG-POOL-')) throw new Error(`unknown run ${run}`);
  // Diagnostic runs (replay only): same request from an empty catalog with an explicit planner pool size.
  const diagPool = run.startsWith('DIAG-POOL-') ? Number(run.slice('DIAG-POOL-'.length)) : undefined;

  const recorder = new Recorder(join(RUNS, 'recordings'), mode);
  const envr = buildEnvironment(recorder, {});
  console.log(JSON.stringify({ trace: 'configured', ...envr.configured, llmLoaded: !!envr.llm }));
  const destination = await resolveDestination(envr, 'Buenos Aires', BUENOS_AIRES_POINT);
  const runDir = join(RUNS, run);
  mkdirSync(runDir, { recursive: true });
  const callsAfterDestination = structuredClone(recorder.counts);

  const input = run === 'S3-B' ? 'S3-A' : undefined;
  if (input && !existsSync(files(input).catalog)) throw new Error('run S3-A first');
  const catalog = input ? Spike2Catalog.load(files(input).catalog, files(input).candidates) : Spike2Catalog.empty();
  const ledger = input ? AdmissionLedger.load(files(input).admissions) : AdmissionLedger.empty();
  if (input) for (const k of ['catalog', 'candidates', 'admissions'] as const) copyFileSync(files(input)[k], join(runDir, `${k}-before.json`));
  const catalogBefore = { places: Object.keys(catalog.snapshot().candidates).length, experiences: Object.keys(catalog.snapshot().catalog.experiences).sort() };

  const report = await generate3({
    catalog, ledger, request: REQUEST, destination: destination.entity, destinationBoundary: destination.resolution.boundary,
    osm: osmStructuredAdapter(recorder, envr.osm, LOCAL_OVERPASS), wikidata: wikidataFactsAdapter(recorder),
    planner: new SpikePlanner(destination.resolution), compositionPolicy: COMPOSITION_POLICY,
    plannerPoolSize: diagPool ?? REQUEST.days * new SpikePlanner(destination.resolution).policy.paceTargets.moderate.preferredExperiencesMax * 3,
    now: new Date(), providerCounts: () => structuredClone(recorder.counts), log: (e, d) => console.log(JSON.stringify({ trace: e, data: d })),
  });

  catalog.save(files(run).catalog, files(run).candidates);
  ledger.save(files(run).admissions);
  const experiencesAfter = Object.keys(catalog.snapshot().catalog.experiences).sort();
  write(runDir, 'report.json', { header, request: REQUEST, input: input ?? 'EMPTY', catalogBefore, experiencesAfter: experiencesAfter.length, report });
  write(runDir, 'provider-calls.json', { destinationResolution: callsAfterDestination, total: recorder.counts });
  write(runDir, 'tour.json', report.tour);
  console.log(JSON.stringify({
    trace: 'summary', finalVerdict: report.finalVerdict, result: report.result, discovery: report.stages.find((s) => s.discovery)?.discovery,
    placeVisits: experiencesAfter.length, zeroL2: report.placeVisitsWithZeroL2, l2: report.l2AssertionsAtTour, tourStops: report.tour.length,
    keysStableVsInput: input ? JSON.stringify(catalogBefore.experiences) === JSON.stringify(experiencesAfter) : undefined,
    providerCalls: recorder.counts,
  }, null, 2));
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
