import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { TransportationMode, TravelPace } from '../../../be/src/modules/tours/interfaces/tour-generation.interface';
import { recompose } from './composition/reusable';
import { InterpretedRequest, ReusableExperience } from './contracts';
import { experienceFormatFacets, thematicFacets } from './facets';
import { recordResolved } from './grounding/identity';
import { retractAssertion } from './grounding/ground';
import { llmSupportVerifier } from './grounding/support-verifier';
import { lineVertices } from './geometry';
import { assertionKey } from './keys';
import { generate } from './orchestrator';
import { SpikePlanner } from './planner';
import { COMPOSITION_POLICY, READINESS_POLICY } from './policy';
import { Recorder, RecorderMode } from './recording';
import { ResearchAgent } from './research/agent';
import { CatalogStore, GroundingAuthority } from './stores';
import { buildEnvironment, readEnvFile, resolveDestination } from './wiring';

/**
 * Spike entry point. Usage (from the worktree root):
 *   TS_NODE_PROJECT=spikes/gap-driven-destination-knowledge-2026-10-10/tsconfig.json \
 *     node_modules/.bin/ts-node -r tsconfig-paths/register --transpile-only \
 *     spikes/gap-driven-destination-knowledge-2026-10-10/src/run.ts --run A --mode record --env-file <path>
 */
const SPIKE = join(__dirname, '..');
const RUNS = join(SPIKE, 'runs');

export interface RunArgs {
  run: string;
  mode: RecorderMode;
  envFile?: string;
  aiProvider?: string;
}

export function parseArgs(argv: string[]): RunArgs {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const mode = (get('--mode') ?? 'replay') as RecorderMode;
  if (!['live', 'record', 'replay'].includes(mode)) throw new Error(`invalid --mode ${mode}`);
  return {
    run: get('--run') ?? 'EMPTY',
    mode,
    ...(get('--env-file') ? { envFile: get('--env-file') } : {}),
    ...(get('--ai-provider') ? { aiProvider: get('--ai-provider') } : {}),
  };
}

export function traceHeader(args: RunArgs): Record<string, string> {
  const git = (cmd: string) => execSync(`git ${cmd}`, { encoding: 'utf8' }).trim();
  return {
    spike: 'gap-driven-destination-knowledge-2026-10-10',
    run: args.run,
    mode: args.mode,
    branch: git('rev-parse --abbrev-ref HEAD'),
    commit: git('rev-parse --short HEAD'),
    startedAt: new Date().toISOString(),
  };
}

/** Wizard-shaped request: label + selected point, terms, explicit mobility. */
function request(days: number, themes: string[], formats: string[]): InterpretedRequest {
  return {
    destinationLabel: 'Buenos Aires',
    days,
    thematicFacets: thematicFacets(themes),
    experienceFormatFacets: experienceFormatFacets(formats),
    mobility: {
      allowedTransportationModes: [TransportationMode.WALKING, TransportationMode.PUBLIC_TRANSPORT],
      maxWalkingDistancePerDayMeters: 8000,
      maxContinuousWalkingDistanceMeters: 3000,
      travelPace: TravelPace.MODERATE,
      accessibilityNeeds: [],
    },
  };
}

const BUENOS_AIRES_POINT = { latitude: -34.6037, longitude: -58.3816 };

const RUN_DEFINITIONS: Record<string, { request: InterpretedRequest; input?: string }> = {
  A: { request: request(4, ['history', 'food'], ['walking']) },
  B: { request: request(2, ['history'], []), input: 'A' },
  C: { request: request(3, ['food'], []), input: 'A' },
};

function write(dir: string, name: string, data: unknown) {
  writeFileSync(join(dir, name), JSON.stringify(data, null, 2));
}

function corridorGeoJson(store: CatalogStore) {
  const features = Object.values(store.snapshot().experiences)
    .filter((e) => e.content.footprint.type === 'LINE')
    .flatMap((e: ReusableExperience) => [
      {
        type: 'Feature',
        properties: { key: e.key, name: e.content.name, status: e.status, revision: e.contentRevision },
        geometry: { type: 'LineString', coordinates: e.content.footprint.type === 'LINE' ? e.content.footprint.line.map((p) => [p.lng, p.lat]) : [] },
      },
      ...e.content.stops.map((s) => ({ type: 'Feature', properties: { stopOf: e.key, name: s.name, alongMeters: s.alongMeters }, geometry: { type: 'Point', coordinates: [s.point.lng, s.point.lat] } })),
    ]);
  return { type: 'FeatureCollection', features };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const header = traceHeader(args);
  console.log(JSON.stringify({ trace: 'header', ...header }));
  if (args.run === 'EMPTY') return;

  const env = args.envFile ? readEnvFile(args.envFile) : {};
  const recorder = new Recorder(join(RUNS, 'recordings'), args.mode);
  const envr = buildEnvironment(recorder, env, args.aiProvider);
  console.log(JSON.stringify({ trace: 'configured', ...envr.configured }));
  const destination = await resolveDestination(envr, 'Buenos Aires', BUENOS_AIRES_POINT);
  const runDir = join(RUNS, args.run);
  mkdirSync(runDir, { recursive: true });

  if (args.run === 'PROBE') {
    const scope = { destination: destination.entity };
    const area = await destination.resolver.resolveArea('San Telmo', scope);
    const areaScope = area.status === 'RESOLVED' ? { ...scope, area: area.entity, areaNamedBySource: true } : scope;
    const probes = {
      destination: { name: destination.entity.name, identity: destination.entity.identities[0] },
      sanTelmo: area,
      plazaDorrego: await destination.resolver.resolvePlace('Plaza Dorrego', areaScope),
      mercado: await destination.resolver.resolvePlace('Mercado de San Telmo', areaScope),
      plazaDeMayoCityScope: await destination.resolver.resolvePlace('Plaza de Mayo', scope),
      defensa: await destination.resolver.resolveRoute('Calle Defensa', scope),
    };
    const route = probes.defensa;
    if (route.status === 'RESOLVED') {
      const nearRoute = { vertices: lineVertices(route.entity.geometry), toleranceMeters: COMPOSITION_POLICY.anchorOnRouteToleranceMeters };
      Object.assign(probes, {
        plazaDeMayoOnDefensa: await destination.resolver.resolvePlace('Plaza de Mayo', { ...scope, nearRoute }),
        parqueLezamaOnDefensa: await destination.resolver.resolvePlace('Parque Lezama', { ...scope, nearRoute }),
      });
    }
    const summary = Object.fromEntries(
      Object.entries(probes).map(([k, v]) => [k, 'status' in v ? { status: v.status, ...(v.status === 'RESOLVED' ? { rule: v.rule, name: v.entity.name, ids: v.entity.identities.length } : { detail: v.detail }) } : v]),
    );
    write(runDir, 'probe.json', { header, summary, providerCalls: recorder.counts });
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const inputPath = (name: string) => join(RUNS, name, 'catalog-after.json');
  const tools = envr.webFor(destination.resolution.countryCode);
  if (!tools || !envr.llm) throw new Error('search and LLM must be configured (--env-file) for generation runs');
  const planner = new SpikePlanner(destination.resolution);
  const verifier = llmSupportVerifier(envr.llm);
  const agent = new ResearchAgent(tools, envr.llm);
  const grounding = { tools, resolver: destination.resolver, verifier, policy: COMPOSITION_POLICY, now: () => new Date().toISOString() };

  if (args.run === 'MUTATIONS') {
    if (!existsSync(inputPath('A'))) throw new Error('run A first');
    const store = CatalogStore.load(inputPath('A'));
    recordResolved(store, { status: 'RESOLVED', entity: destination.entity, rule: 'DESTINATION_RESOLUTION' });
    const keys = () => Object.values(store.snapshot().experiences).map((e) => `${e.key}#rev${e.contentRevision}:${e.status}`).sort();
    const corridors = Object.values(store.snapshot().assertions).filter((a) => a.claimType === 'WALKING_CORRIDOR' && a.status === 'ACTIVE');
    const baseline = keys();

    // M1: a new grounded-place stand-in along the first corridor (administrative
    // mutation write, explicitly synthetic evidence; the place itself comes from
    // real geographic resolution).
    const scope = { destination: destination.entity };
    const area = await destination.resolver.resolveArea('San Telmo', scope);
    const place = await destination.resolver.resolvePlace('Plaza Dorrego', area.status === 'RESOLVED' ? { ...scope, area: area.entity, areaNamedBySource: true } : scope);
    const m1: Record<string, unknown> = { place: place.status };
    if (place.status === 'RESOLVED' && area.status === 'RESOLVED') {
      const placeRef = recordResolved(store, place);
      const areaRef = recordResolved(store, area);
      const subject = { kind: 'PLACE_IN_AREA' as const, placeGeoEntityId: placeRef.id, areaGeoEntityId: areaRef.id };
      const existing = Object.values(store.snapshot().assertions).some((a) => a.subject.kind === 'PLACE_IN_AREA' && a.subject.placeGeoEntityId === placeRef.id);
      store.upsertAssertion(new GroundingAuthority(), {
        key: assertionKey('NOTABLE_WITHIN', subject, 'theme:culture'),
        claimType: 'NOTABLE_WITHIN', subject, facetKey: 'theme:culture', destinationId: destination.entity.id,
        evidence: [{
          id: 'spike-mutation-1', locator: { kind: 'DATASET_RECORD', dataset: 'spike-mutation', recordId: 'm1', fieldPath: 'claim' },
          retrievedAt: new Date().toISOString(), contentFingerprint: 'spike-mutation', capture: { kind: 'STRUCTURED_FIELD', values: { mutation: 'M1 synthetic stop' } },
          provenanceSignals: [], supportVerdicts: [],
        }],
        status: 'ACTIVE', createdAt: new Date().toISOString(),
      });
      m1.placeWasAlreadyRelevant = existing;
    }
    const r1 = recompose(store, destination.entity.id, COMPOSITION_POLICY);
    const afterM1 = keys();
    // M2: retract every active corridor assertion.
    for (const c of corridors) retractAssertion(store, c.key);
    const r2 = recompose(store, destination.entity.id, COMPOSITION_POLICY);
    const afterM2 = keys();
    // M3: composition policy version bump.
    const r3 = recompose(store, destination.entity.id, { ...COMPOSITION_POLICY, version: 'composition-spike-2', corridorStopDwellMinutes: 20 });
    const afterM3 = keys();
    write(runDir, 'mutations.json', { header, baseline, m1: { ...m1, recomposition: r1, keys: afterM1 }, m2: { retracted: corridors.map((c) => c.key), recomposition: r2, keys: afterM2 }, m3: { recomposition: r3, keys: afterM3 }, providerCalls: recorder.counts });
    store.save(join(runDir, 'catalog-after.json'));
    console.log(JSON.stringify({ m1: r1, m2: r2, m3: r3 }, null, 2));
    return;
  }

  const definition = RUN_DEFINITIONS[args.run];
  if (!definition) throw new Error(`unknown run ${args.run}`);
  const store = definition.input ? CatalogStore.load(inputPath(definition.input)) : new CatalogStore();
  recordResolved(store, { status: 'RESOLVED', entity: destination.entity, rule: 'DESTINATION_RESOLUTION' });
  store.save(join(runDir, 'catalog-before.json'));
  const l4Before = Object.keys(store.snapshot().experiences).sort();
  const callsBeforeGeneration = JSON.parse(JSON.stringify(recorder.counts));

  const report = await generate({
    store, request: definition.request, destination: destination.entity, agent, grounding, planner,
    readinessPolicy: READINESS_POLICY, compositionPolicy: COMPOSITION_POLICY, now: new Date(),
    log: (event, data) => console.log(JSON.stringify({ trace: event, data })),
  });

  store.save(join(runDir, 'catalog-after.json'));
  write(runDir, 'report.json', { header, request: definition.request, input: definition.input ?? 'EMPTY', report });
  write(runDir, 'tour.json', report.tour);
  write(runDir, 'corridors.geojson', corridorGeoJson(store));
  write(runDir, 'provider-calls.json', { destinationResolution: callsBeforeGeneration, total: recorder.counts });
  const l4After = Object.keys(store.snapshot().experiences).sort();
  console.log(JSON.stringify({
    trace: 'summary',
    researchedGaps: report.iterations.map((i) => ({ gap: i.gap.key, research: i.research.kind, outcome: i.ledger.outcome })),
    stoppedBecause: report.stoppedBecause,
    l4Before: l4Before.length, l4After: l4After.length, newL4: l4After.filter((k) => !l4Before.includes(k)),
    tour: report.tour.status === 'COMPOSED' ? report.tour.tour.experiences.map((r) => `${r.dayNumber}.${r.order} ${r.experienceId}`) : report.tour,
    providerCalls: recorder.counts,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
