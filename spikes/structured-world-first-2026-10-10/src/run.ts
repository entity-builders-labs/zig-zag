import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { TransportationMode, TravelPace } from '../../../be/src/modules/tours/interfaces/tour-generation.interface';
import { osmStructuredAdapter, wikidataFactsAdapter } from './adapters/structured';
import { Spike2Catalog } from './catalog';
import { EvaluatorAgent } from './evaluator';
import { parseArgs2, traceHeader2 } from './header';
import { EvidenceMemory } from './memory';
import { generate2 } from './orchestrator';
import { READINESS_POLICY_2, SOURCE_CAPABILITY_VERSION } from './policy';
import { ROUTING_POLICY_VERSION } from './routing';
import {
  COMPOSITION_POLICY,
  GeographyResolutionAuthority,
  GroundingAuthority,
  InterpretedRequest,
  Recorder,
  SpikePlanner,
  assertionKey,
  buildEnvironment,
  experienceFormatFacets,
  llmSupportVerifier,
  readEnvFile,
  recompose,
  resolveDestination,
  thematicFacets,
} from './spike1';

/**
 * Spike 2 entry point. From the worktree root:
 *   TS_NODE_PROJECT=spikes/structured-world-first-2026-10-10/tsconfig.json \
 *     node_modules/.bin/ts-node -r tsconfig-paths/register --transpile-only \
 *     spikes/structured-world-first-2026-10-10/src/run.ts --run A2 --mode record --ai-provider gemini --env-file <path>
 */
const RUNS = join(__dirname, '..', 'runs');
const LOCAL_OVERPASS = 'http://localhost:12345/api/interpreter';
const BUENOS_AIRES_POINT = { latitude: -34.6037, longitude: -58.3816 };

function request(days: number, themes: string[], formats: string[]): InterpretedRequest {
  return {
    destinationLabel: 'Buenos Aires', days, thematicFacets: thematicFacets(themes), experienceFormatFacets: experienceFormatFacets(formats),
    mobility: { allowedTransportationModes: [TransportationMode.WALKING, TransportationMode.PUBLIC_TRANSPORT], maxWalkingDistancePerDayMeters: 8000, maxContinuousWalkingDistanceMeters: 3000, travelPace: TravelPace.MODERATE, accessibilityNeeds: [] },
  };
}

/** Same requests as spike 1 (A/B/C) for comparability. */
const RUN_DEFINITIONS: Record<string, { request: InterpretedRequest; input?: string }> = {
  A2: { request: request(4, ['history', 'food'], ['walking']) },
  B2: { request: request(2, ['history'], []), input: 'A2' },
  C2: { request: request(3, ['food'], []), input: 'A2' },
};

const write = (dir: string, name: string, data: unknown) => writeFileSync(join(dir, name), JSON.stringify(data, null, 2));
const files = (run: string) => ({ catalog: join(RUNS, run, 'catalog-after.json'), candidates: join(RUNS, run, 'candidates-after.json'), memory: join(RUNS, run, 'memory-after.json') });

async function main() {
  const args = parseArgs2(process.argv.slice(2));
  const header = { ...traceHeader2(args), routingPolicy: ROUTING_POLICY_VERSION, readinessPolicy: READINESS_POLICY_2.version, sourceCapability: SOURCE_CAPABILITY_VERSION };
  console.log(JSON.stringify({ trace: 'header', ...header }));
  if (args.run === 'EMPTY') return;

  const env = args.envFile ? readEnvFile(args.envFile) : {};
  const recorder = new Recorder(join(RUNS, 'recordings'), args.mode);
  const envr = buildEnvironment(recorder, env, args.aiProvider);
  console.log(JSON.stringify({ trace: 'configured', ...envr.configured }));
  const destination = await resolveDestination(envr, 'Buenos Aires', BUENOS_AIRES_POINT);
  const runDir = join(RUNS, args.run);
  mkdirSync(runDir, { recursive: true });
  const osm = osmStructuredAdapter(recorder, envr.osm, LOCAL_OVERPASS);
  const wikidata = wikidataFactsAdapter(recorder);
  const tools = envr.webFor(destination.resolution.countryCode);
  if (!tools || !envr.llm) throw new Error('search and LLM must be configured (--env-file)');
  const planner = new SpikePlanner(destination.resolution);

  if (args.run === 'MUTATIONS2') {
    if (!existsSync(files('A2').catalog)) throw new Error('run A2 first');
    const catalog = Spike2Catalog.load(files('A2').catalog, files('A2').candidates);
    const keys = () => Object.values(catalog.snapshot().catalog.experiences).map((e) => `${e.key}#rev${e.contentRevision}:${e.status}`).sort();
    const baseline = keys();
    const snap = catalog.snapshot();
    const corridors = Object.values(snap.catalog.assertions).filter((a) => a.claimType === 'WALKING_CORRIDOR' && a.status === 'ACTIVE');
    const m1: Record<string, unknown> = {};
    if (corridors.length && corridors[0].subject.kind === 'CORRIDOR') {
      // M1: an administrative assertion for a canonical place candidate near the corridor
      // that is not yet a stop (explicitly synthetic evidence; the place is canonical L1).
      const corridor = corridors[0];
      const area = corridor.subject.kind === 'CORRIDOR' && corridor.subject.corridor.from.kind === 'AREA_CLIP' ? corridor.subject.corridor.from.areaGeoEntityId : undefined;
      const stops = new Set(Object.values(snap.catalog.experiences).flatMap((e) => e.content.stops.map((s) => s.geoEntityId)));
      const candidate = Object.values(snap.candidates).find((c) => c.kind === 'PLACE' && !stops.has(c.geoEntityId) && (!area || c.parentAreaIds.includes(area)));
      if (candidate) {
        const areaId = candidate.parentAreaIds[0];
        const subject = { kind: 'PLACE_IN_AREA' as const, placeGeoEntityId: candidate.geoEntityId, areaGeoEntityId: areaId };
        catalog.store.upsertAssertion(new GroundingAuthority(), {
          key: assertionKey('NOTABLE_WITHIN', subject, 'theme:culture'), claimType: 'NOTABLE_WITHIN', subject, facetKey: 'theme:culture', destinationId: destination.entity.id,
          evidence: [{ id: 'spike2-mutation-1', locator: { kind: 'DATASET_RECORD', dataset: 'spike-mutation', recordId: 'm1', fieldPath: 'claim' }, retrievedAt: new Date().toISOString(), contentFingerprint: 'spike-mutation', capture: { kind: 'STRUCTURED_FIELD', values: { mutation: 'M1 synthetic stop' } }, provenanceSignals: [], supportVerdicts: [] }],
          status: 'ACTIVE', createdAt: new Date().toISOString(),
        });
        m1.place = candidate.geoEntityId;
      } else {
        m1.place = 'no canonical place candidate available';
      }
    } else {
      m1.skipped = 'no grounded corridor in A2: corridor mutations not exercisable';
    }
    const r1 = recompose(catalog.store, destination.entity.id, COMPOSITION_POLICY);
    const afterM1 = keys();
    for (const c of corridors) catalog.store.retractAssertion(new GroundingAuthority(), c.key);
    const r2 = recompose(catalog.store, destination.entity.id, COMPOSITION_POLICY);
    const afterM2 = keys();
    const r3 = recompose(catalog.store, destination.entity.id, { ...COMPOSITION_POLICY, version: 'composition-spike-2', corridorStopDwellMinutes: 20 });
    const afterM3 = keys();
    write(runDir, 'mutations.json', { header, baseline, m1: { ...m1, recomposition: r1, keys: afterM1 }, m2: { retracted: corridors.map((c) => c.key), recomposition: r2, keys: afterM2 }, m3: { recomposition: r3, keys: afterM3 } });
    console.log(JSON.stringify({ baseline, m1: r1, m2: r2, m3: r3 }, null, 2));
    return;
  }

  const definition = RUN_DEFINITIONS[args.run];
  if (!definition) throw new Error(`unknown run ${args.run}`);
  const catalog = definition.input ? Spike2Catalog.load(files(definition.input).catalog, files(definition.input).candidates) : Spike2Catalog.empty();
  const memory = definition.input ? EvidenceMemory.load(files(definition.input).memory) : EvidenceMemory.empty();
  catalog.store.recordGeoEntity(new GeographyResolutionAuthority(), destination.entity);
  if (definition.input) for (const k of ['catalog', 'candidates', 'memory'] as const) copyFileSync(files(definition.input)[k], join(runDir, `${k}-before.json`));
  const memoryBefore = memory.stats();
  const l4Before = Object.keys(catalog.snapshot().catalog.experiences).sort();
  const callsAtStart = structuredClone(recorder.counts);

  const report = await generate2({
    catalog, memory, request: definition.request, destination: destination.entity, destinationBoundary: destination.resolution.boundary,
    osm, wikidata, routes: destination.resolver, evaluator: new EvaluatorAgent(tools, envr.llm), verifier: llmSupportVerifier(envr.llm), tools, planner,
    availability: {}, policy: READINESS_POLICY_2, compositionPolicy: COMPOSITION_POLICY, now: new Date(),
    providerCounts: () => structuredClone(recorder.counts),
    log: (event, data) => console.log(JSON.stringify({ trace: event, data })),
  });

  catalog.save(files(args.run).catalog, files(args.run).candidates);
  memory.save(files(args.run).memory);
  write(runDir, 'report.json', { header, request: definition.request, input: definition.input ?? 'EMPTY', memoryBefore, memoryAfter: memory.stats(), report });
  write(runDir, 'provider-calls.json', { destinationResolution: callsAtStart, total: recorder.counts });
  const l4After = Object.keys(catalog.snapshot().catalog.experiences).sort();
  console.log(JSON.stringify({
    trace: 'summary',
    iterations: report.iterations.map((i) => `${i.index}. ${i.gap.type} ${i.gap.scopeId.slice(-12)} ${i.gap.facetKey ?? ''} -> ${i.gapOutcome}`),
    finalVerdict: report.finalVerdict, stoppedBecause: report.stoppedBecause,
    assertions: Object.keys(catalog.snapshot().catalog.assertions).length,
    l4Before: l4Before.length, l4After: l4After.length,
    result: report.result.status,
    memory: memory.stats(),
    providerCalls: recorder.counts,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
