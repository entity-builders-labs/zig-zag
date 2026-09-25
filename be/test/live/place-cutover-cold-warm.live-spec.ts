import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/core/database/prisma.service';
import { DestinationResolutionService } from 'src/modules/tours/services/destination-resolution.service';
import { ExperienceProposalResolverService } from 'src/modules/tours/services/experience-proposal-resolver.service';
import { ExperienceEmbeddingIndexerService } from 'src/shared/ai/services/experience-embedding-indexer.service';
import { GeographicScope } from 'src/modules/tours/interfaces/experience-resolution.interface';
import { loadRootEnv } from './discovery/discovery-live.helper';

loadRootEnv();
jest.setTimeout(20 * 60 * 1000);

/**
 * Stage 3 PLACE cutover -- deterministic COLD/WARM controls through the REAL
 * production resolver (`ExperienceProposalResolverService.resolve`) against
 * real providers (Geoapify Forward Geocoding + Place Details, local
 * Nominatim/Overpass, Wikidata) and a dedicated fresh Postgres database.
 * Nothing is mocked; provider requests are counted per hint and phase.
 *
 *   set -a; source ../.env; source ../.env.spike.stage3-place-cutover; set +a
 *   RUN_SPIKE_PREFLIGHT=1 npx jest --config ./test/jest-live.json \
 *     --runInBand place-cutover-cold-warm
 *
 * COLD: the database has no GeoEntity for any hint. WARM: the same
 * database, same hints, immediately after COLD. Writes matrix.json and
 * summary.md to spikes/stage3-place-cutover-cold-warm-2026-09-25/ (or to
 * SPIKE_OUT_DIR, relative to the repo root, for a later evidence run).
 *
 * Verified hint memory gate: COLD remembers each VERIFIED hint text on its
 * canonical GeoEntity; WARM must then reuse the catalog (CATALOG_REUSE,
 * same GeoEntity, zero external identity calls) also for the hints whose
 * text differs from the canonical name (Farmacia, Mafalda, Recoleta EN,
 * El Zanjón). Fail-closed controls must never be remembered.
 */
const RUN = process.env.RUN_SPIKE_PREFLIGHT === '1';
const describeIfRun = RUN ? describe : describe.skip;

const DESTINATION = {
  label: 'Buenos Aires, Argentina',
  point: { latitude: -34.6037, longitude: -58.3816 },
};

/** Every hint is sent exactly as written, as a PLACE venue hint. */
const ALL_HINTS: Array<{ hint: string; role: string }> = [
  { hint: 'Farmacia la Estrella', role: 'gate: exact OSM identity' },
  { hint: 'Mafalda Statue', role: 'gate: acquisition with raw hint' },
  { hint: 'Casa Mínima', role: 'regression' },
  { hint: 'Mercado de San Telmo', role: 'regression' },
  { hint: 'Plaza Dorrego', role: 'regression' },
  { hint: 'El Zanjón de Granados', role: 'regression' },
  { hint: 'Basílica de San Francisco', role: 'regression' },
  { hint: 'Parque Lezama', role: 'negative: never a bus stop' },
  { hint: 'Cementerio de la Recoleta', role: 'regression' },
  { hint: 'Recoleta Cemetery', role: 'negative: never a business' },
  { hint: 'Galería Güemes', role: 'negative: never Ramos Mejía' },
  { hint: 'Plaza San Martín', role: 'regression / homonyms' },
  { hint: 'Defensa Street', role: 'negative: street is never a PLACE' },
  // Adversarial control added by this harness -- NOT an observed,
  // source-backed production hint. Its IdentityVerifier outcome is known
  // hardening debt and does not gate Stage 3.
  { hint: 'San Martín', role: 'adversarial: bare common name (harness-only)' },
  // Stage 3 exit-gate control (in the default corpus since the verified
  // hint memory run: its WARM reuse is part of the gate).
  { hint: 'Solar de French', role: 'exit gate: prior-knowledge reuse' },
];
// LIVE_HINTS="Farmacia la Estrella,Mafalda Statue" narrows a diagnostic rerun.
/** Name-divergent hints: text differs from the canonical GeoEntity name. */
const NAME_DIVERGENT = [
  'Farmacia la Estrella',
  'Mafalda Statue',
  'Recoleta Cemetery',
  'El Zanjón de Granados',
];
const EXACT_NAME_REGRESSIONS = [
  'Casa Mínima',
  'Mercado de San Telmo',
  'Plaza Dorrego',
  'Basílica de San Francisco',
  'Parque Lezama',
  'Cementerio de la Recoleta',
  'Plaza San Martín',
  'Solar de French',
];
/** Must fail closed and therefore never enter verified hint memory. */
const NEVER_REMEMBERED = ['Galería Güemes', 'Defensa Street'];
/** Hosts that are external identity work (the local embedder is not). */
const IDENTITY_HOSTS = [
  'geoapify.geocode-search',
  'geoapify.place-details',
  'geoapify.autocomplete',
  'nominatim.local/search',
  'overpass.local',
  'wikidata',
  'en.wikipedia.org',
  'serper',
  'serpapi',
  'google.places',
];

const CORPUS = process.env.LIVE_HINTS
  ? ALL_HINTS.filter(({ hint }) =>
      process.env.LIVE_HINTS!.split(',').includes(hint),
    )
  : ALL_HINTS;

type HostCounts = Record<string, number>;

function hostKey(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname;
    if (u.hostname === 'api.geoapify.com') {
      return p.startsWith('/v2/place-details')
        ? 'geoapify.place-details'
        : p.startsWith('/v1/geocode/search')
          ? 'geoapify.geocode-search'
          : p.startsWith('/v1/geocode/autocomplete')
            ? 'geoapify.autocomplete'
            : `geoapify${p}`;
    }
    if (u.port === '8088') return `nominatim.local${p}`;
    if (u.port === '12345') return 'overpass.local';
    if (u.hostname.endsWith('wikidata.org')) return 'wikidata';
    if (u.hostname === 'serpapi.com') return 'serpapi';
    if (u.hostname === 'google.serper.dev') return 'serper';
    if (u.hostname === 'places.googleapis.com') return 'google.places';
    return u.hostname;
  } catch {
    return 'unknown';
  }
}

describeIfRun('Stage 3 PLACE cutover -- live COLD/WARM controls', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let resolver: ExperienceProposalResolverService;
  let scope: GeographicScope;
  let destinationSummary: Record<string, unknown>;
  let counts: HostCounts = {};
  let geoapifyRequests: Array<Record<string, unknown>> = [];
  let embeddingIndexCalls = 0;
  const matrix: any[] = [];
  const phaseTotals: Record<string, HostCounts> = {};
  const snapshots: Record<string, unknown> = {};
  const originalFetch = global.fetch;

  const count = (url: string | undefined) => {
    const key = hostKey(url ?? '');
    counts[key] = (counts[key] ?? 0) + 1;
  };

  beforeAll(async () => {
    const dbName = new URL(process.env.DATABASE_URL ?? '').pathname;
    if (!/spike_stage3_place_cutover/.test(dbName)) {
      throw new Error(
        `Refusing to run: DATABASE_URL must point at the dedicated spike DB (got ${dbName}).`,
      );
    }
    axios.interceptors.request.use((config) => {
      const url = axios.getUri(config);
      count(url);
      if (url.startsWith('https://api.geoapify.com')) {
        // Keys are never recorded.
        const params = {
          ...((config.params ?? {}) as Record<string, unknown>),
        };
        delete params.apiKey;
        geoapifyRequests.push({ endpoint: new URL(url).pathname, ...params });
      }
      return config;
    });
    global.fetch = (async (input: any, init?: any) => {
      count(typeof input === 'string' ? input : input?.url);
      return originalFetch(input, init);
    }) as typeof fetch;

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    resolver = moduleRef.get(ExperienceProposalResolverService);
    const indexer = moduleRef.get(ExperienceEmbeddingIndexerService);
    const originalIndex = indexer.index.bind(indexer);
    jest.spyOn(indexer, 'index').mockImplementation(async (ids?: string[]) => {
      embeddingIndexCalls++;
      return originalIndex(ids);
    });

    expect(await prisma.geoEntity.count()).toBe(0);

    counts = {};
    const destination = await moduleRef
      .get(DestinationResolutionService)
      .resolveDestination(DESTINATION.label, DESTINATION.point);
    phaseTotals.destinationResolution = counts;
    scope =
      destination.scale === 'area'
        ? { kind: 'AREA_BOUNDARY', boundary: destination.boundary }
        : {
            kind: 'POINT_RADIUS',
            latitude: DESTINATION.point.latitude,
            longitude: DESTINATION.point.longitude,
            radiusMeters: 50_000,
          };
    destinationSummary = {
      scale: destination.scale,
      countryCode: destination.countryCode,
      boundaryId:
        destination.scale === 'area' ? destination.boundary.id : undefined,
      boundaryGeometryType:
        destination.scale === 'area'
          ? destination.boundary.geometry?.type
          : undefined,
    };
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    const outDir = path.join(
      __dirname,
      '../../..',
      process.env.SPIKE_OUT_DIR ??
        'spikes/stage3-place-cutover-cold-warm-2026-09-25',
    );
    fs.mkdirSync(outDir, { recursive: true });
    // A narrowed diagnostic rerun never overwrites the full-corpus evidence.
    const suffix = process.env.LIVE_HINTS ? '.diagnostic' : '';
    fs.writeFileSync(
      path.join(outDir, `matrix${suffix}.json`),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          destination: destinationSummary,
          phaseTotals,
          embeddingIndexCalls,
          snapshots,
          rows: matrix,
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(path.join(outDir, `summary${suffix}.md`), summarize());
    await moduleRef?.close();
  });

  async function runPhase(phase: 'COLD' | 'WARM') {
    const totals: HostCounts = {};
    for (const { hint, role } of CORPUS) {
      counts = {};
      geoapifyRequests = [];
      const startedAt = Date.now();
      const result = await resolver.resolve({
        destinationName: DESTINATION.label,
        destinationCountryCode: 'AR',
        geographicScope: scope,
        candidates: [
          {
            name: hint,
            themes: ['history'],
            traits: [],
            intents: ['visit'],
            componentHints: [
              {
                key: 'hint',
                name: hint,
                role: 'venue',
                expectedKind: 'PLACE',
                evidenceKeys: ['ev-1'],
              },
            ],
            evidenceKeys: ['ev-1'],
            shortReason: 'live PLACE cutover control',
          },
        ],
        evidence: [
          {
            key: 'ev-1',
            source: 'spike',
            title: 'Buenos Aires',
            snippet: `${hint} in Buenos Aires, Argentina`,
          },
        ],
      } as any);
      const durationMs = Date.now() - startedAt;
      const audit = result.entityResolution.forensicAudit[0].componentAudits[0];
      const entity = result.resolved[0].resolvedEntities[0];
      for (const [key, n] of Object.entries(counts)) {
        totals[key] = (totals[key] ?? 0) + n;
      }
      matrix.push({
        phase,
        hint,
        role,
        durationMs,
        requests: counts,
        geoapifyRequests,
        finalStatus: audit.finalStatus,
        finalReason: audit.finalReason,
        verifiedHintMemory: audit.verifiedHintMemory,
        resolved:
          entity?.status === 'resolved'
            ? {
                geoEntityId: entity.geoEntityId,
                canonicalName: entity.canonicalName,
                provider: entity.provider,
                externalId: entity.externalId,
                wikidataQid: entity.wikidataQid,
                latitude: entity.latitude,
                longitude: entity.longitude,
                persistence: entity.persistence,
              }
            : undefined,
        candidateStatus: result.resolved[0].status,
        rejectionReasons: result.resolved[0].rejectionReasons,
        attempts: audit.attempts.map((a: any) => ({
          strategy: a.strategy,
          provider: a.provider,
          query: a.query,
          executionStatus: a.executionStatus,
          providerResultCount: a.providerResultCount,
          candidateAcquired: a.candidateAcquired,
          selectedCandidate: a.selectedCandidate,
          placeSearch: a.placeSearch,
          destinationCompatibility: a.destinationCompatibility,
          identityEvidence: a.identityEvidence,
          verificationDecision: a.verificationDecision,
          failureReason: a.failureReason,
        })),
      });
      console.info(
        `[${phase}] ${hint}: ${audit.finalStatus}${audit.finalReason ? `/${audit.finalReason}` : ''} ${
          entity?.status === 'resolved'
            ? `-> ${entity.canonicalName} (${entity.geoEntityId})`
            : ''
        } requests=${JSON.stringify(counts)} ${durationMs}ms`,
      );
    }
    phaseTotals[phase] = totals;
    snapshots[phase] = await snapshot();
  }

  async function snapshot() {
    const entities = await prisma.geoEntity.findMany({
      include: { identities: { select: { provider: true, externalId: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      geoEntityCount: entities.length,
      identityCount: entities.reduce((n, e) => n + e.identities.length, 0),
      verifiedHintEntryCount: entities.reduce(
        (n, e) => n + e.verifiedHintNameKeys.length,
        0,
      ),
      experienceCount: await prisma.experience.count(),
      entities: entities.map((e) => ({
        id: e.id,
        name: e.name,
        kind: e.kind,
        latitude: e.latitude,
        longitude: e.longitude,
        identities: e.identities
          .map((i) => `${i.provider}/${i.externalId}`)
          .sort(),
        verifiedHintNames: e.verifiedHintNames,
        verifiedHintNameKeys: e.verifiedHintNameKeys,
      })),
    };
  }

  function summarize(): string {
    const lines = [
      '# Stage 3 PLACE cutover -- live COLD/WARM summary',
      '',
      `Generated by \`be/test/live/place-cutover-cold-warm.live-spec.ts\` (${new Date().toISOString()}). Destination: ${JSON.stringify(destinationSummary)}.`,
      '',
      '| phase | hint | final | selected / resolved | identities | decisive evidence | hint memory | requests | ms |',
      '|---|---|---|---|---|---|---|---|---|',
    ];
    for (const row of matrix.filter((r) => r.attempts)) {
      const verified = row.attempts.find(
        (a: any) => a.verificationDecision === 'VERIFIED',
      );
      const last = verified ?? row.attempts[row.attempts.length - 1];
      const evidence = (verified?.identityEvidence ?? [])
        .map((e: any) =>
          e.type === 'IDENTITY_CONVERGENCE'
            ? `IDENTITY_CONVERGENCE(${e.priorStrategy}; ${e.identity?.provider}/${e.identity?.externalId})`
            : e.type === 'WIKIDATA_IDENTITY_MATCH'
              ? `WIKIDATA(${e.source};h=${e.hintMatched};c=${e.candidateMatched})`
              : e.type === 'EXACT_NAME'
                ? `EXACT_NAME(${e.identityMultiplicity})`
                : e.type === 'CATALOG_VERIFIED_HINT_MATCH'
                  ? `VERIFIED_HINT(${e.identityMultiplicity}; "${e.verifiedHintKey}")`
                  : e.type,
        )
        .join(', ');
      lines.push(
        `| ${row.phase} | ${row.hint} | ${row.finalStatus}${row.finalReason ? ` / ${row.finalReason}` : ''} via ${verified?.strategy ?? '—'} | ${
          row.resolved?.canonicalName ??
          last?.selectedCandidate?.canonicalName ??
          '—'
        } | ${(verified?.selectedCandidate?.identities ?? [])
          .map((i: any) => `${i.provider}/${i.externalId}`)
          .join(
            '<br>',
          )} | ${evidence || '—'} | ${row.verifiedHintMemory ?? '—'} | ${Object.entries(
          row.requests,
        )
          .map(([k, v]) => `${k}:${v}`)
          .join(' ')} | ${row.durationMs} |`,
      );
    }
    lines.push(
      '',
      '## PLACES strategy in isolation (Geoapify path alone, nothing persisted)',
      '',
      '| hint | status | rejected before selection | selected | identities | decision | evidence | requests |',
      '|---|---|---|---|---|---|---|---|',
    );
    for (const row of matrix.filter((r) => r.phase === 'PLACES_ISOLATED')) {
      lines.push(
        `| ${row.hint} | ${row.acquisitionStatus} (${row.placeSearch?.resultCount ?? 0} results, ${row.placeSearch?.viableCount ?? 0} viable) | ${(
          row.placeSearch?.rejected ?? []
        )
          .map(
            (r: any) =>
              `${r.name}: ${r.reason === 'STRUCTURALLY_INCOMPATIBLE' ? r.featureClass : r.destinationReason}`,
          )
          .join(
            '<br>',
          )} | ${row.candidate ? `${row.candidate.canonicalName} (${row.candidate.latitude?.toFixed(4)}, ${row.candidate.longitude?.toFixed(4)})` : '—'} | ${(
          row.candidate?.identities ?? []
        )
          .filter((i: any) => i.provider !== 'geoapify')
          .map((i: any) => `${i.provider}/${i.externalId}`)
          .join('<br>')} | ${row.verificationDecision ?? '—'} | ${(
          row.identityEvidence ?? []
        )
          .map((e: any) =>
            e.type === 'WIKIDATA_IDENTITY_MATCH'
              ? `WIKIDATA(${e.source};h=${e.hintMatched};c=${e.candidateMatched})`
              : e.type === 'EXACT_NAME'
                ? `EXACT_NAME(${e.identityMultiplicity})`
                : e.type,
          )
          .join(', ')} | ${Object.entries(row.requests)
          .map(([k, v]) => `${k}:${v}`)
          .join(' ')} |`,
      );
    }
    lines.push(
      '',
      '## Phase request totals',
      '',
      '```json',
      JSON.stringify(phaseTotals, null, 2),
      '```',
      '',
      `Embedding index calls: ${embeddingIndexCalls}`,
      '',
      '## Catalog snapshots',
      '',
      '```json',
      JSON.stringify(
        Object.fromEntries(
          Object.entries(snapshots).map(([k, v]: [string, any]) => [
            k,
            {
              geoEntityCount: v.geoEntityCount,
              identityCount: v.identityCount,
              verifiedHintEntryCount: v.verifiedHintEntryCount,
              experienceCount: v.experienceCount,
            },
          ]),
        ),
        null,
        2,
      ),
      '```',
      '',
      '## Verified hint memory after WARM',
      '',
      '| GeoEntity | canonical name | verifiedHintNames |',
      '|---|---|---|',
      ...((snapshots.WARM as any)?.entities ?? [])
        .filter((e: any) => e.verifiedHintNames.length > 0)
        .map(
          (e: any) =>
            `| ${e.id} | ${e.name} | ${e.verifiedHintNames.join('<br>')} |`,
        ),
    );
    return lines.join('\n') + '\n';
  }

  /**
   * Strategy-isolated PLACES control: the production `resolveViaPlaces`
   * (Geoapify search -> structural filter -> destination policy ->
   * selection -> Place Details) and the production `isVerified`
   * (IdentityVerifier + Wikidata collector) for every hint, with no prior
   * strategy (so no convergence) and nothing persisted. Shows what the
   * Geoapify path alone decides when earlier strategies would otherwise
   * short-circuit it (e.g. Mafalda verified by LOCAL_OSM_POOL first).
   */
  async function runPlacesIsolated() {
    const internal = resolver as any;
    const point = internal.representativePoint(
      scope.kind === 'AREA_BOUNDARY' ? scope.boundary : undefined,
    );
    const totals: HostCounts = {};
    for (const { hint, role } of CORPUS) {
      counts = {};
      geoapifyRequests = [];
      const startedAt = Date.now();
      const componentHint = {
        key: 'hint',
        name: hint,
        role: 'venue',
        expectedKind: 'PLACE',
        evidenceKeys: ['ev-1'],
      };
      const acquired = await internal.resolveViaPlaces(
        componentHint,
        scope,
        point,
      );
      const verification =
        acquired.status === 'candidate'
          ? await internal.isVerified(
              'PLACES',
              acquired.candidate,
              componentHint,
              [],
              new Map(),
            )
          : undefined;
      for (const [key, n] of Object.entries(counts)) {
        totals[key] = (totals[key] ?? 0) + n;
      }
      matrix.push({
        phase: 'PLACES_ISOLATED',
        hint,
        role,
        durationMs: Date.now() - startedAt,
        requests: counts,
        geoapifyRequests,
        acquisitionStatus: acquired.status,
        placeSearch: acquired.placeSearch,
        candidate:
          acquired.status === 'candidate'
            ? {
                canonicalName: acquired.candidate.canonicalName,
                externalId: acquired.candidate.externalId,
                identities: acquired.candidate.identities,
                wikidataQid: acquired.candidate.wikidataQid,
                latitude: acquired.candidate.latitude,
                longitude: acquired.candidate.longitude,
                nameEvidenceMultiplicity:
                  acquired.candidate.nameEvidenceMultiplicity,
              }
            : undefined,
        identityEvidence: verification?.evidence,
        verificationDecision: verification?.decision.status,
      });
      console.info(
        `[PLACES_ISOLATED] ${hint}: ${acquired.status}${
          acquired.status === 'candidate'
            ? ` -> ${acquired.candidate.canonicalName} ${verification?.decision.status}`
            : ''
        } requests=${JSON.stringify(counts)}`,
      );
    }
    phaseTotals.PLACES_ISOLATED = totals;
  }

  it('COLD then WARM over the same dedicated database', async () => {
    await runPhase('COLD');
    await runPhase('WARM');
    // The strategy-isolated PLACES characterization is opt-in
    // (LIVE_PLACES_ISOLATED=1): it was captured once in the 2026-09-25
    // cutover evidence and costs ~25 Geoapify requests per run.
    if (process.env.LIVE_PLACES_ISOLATED === '1') {
      const persistedAfterWarm = await prisma.geoEntity.count();
      await runPlacesIsolated();
      // The isolated control never writes.
      expect(await prisma.geoEntity.count()).toBe(persistedAfterWarm);
    }
    const cold = snapshots.COLD as any;
    const warm = snapshots.WARM as any;
    // WARM never duplicates what COLD established.
    expect(warm.geoEntityCount).toBe(cold.geoEntityCount);
    const identityKeys = warm.entities.flatMap((e: any) => e.identities);
    expect(new Set(identityKeys).size).toBe(identityKeys.length);
    expect(warm.identityCount).toBe(cold.identityCount);

    // Verified hint memory: WARM writes nothing new, and no array holds a
    // duplicate key.
    expect(warm.verifiedHintEntryCount).toBe(cold.verifiedHintEntryCount);
    for (const entity of warm.entities) {
      expect(new Set(entity.verifiedHintNameKeys).size).toBe(
        entity.verifiedHintNameKeys.length,
      );
    }
    const remembered = new Set(
      warm.entities.flatMap((e: any) => e.verifiedHintNames),
    );
    for (const hint of NEVER_REMEMBERED) {
      expect(remembered.has(hint)).toBe(false);
    }

    // WARM gate: every COLD-resolved name-divergent or exact-name hint is
    // CATALOG_REUSE onto the same GeoEntity with zero identity calls.
    const row = (phase: string, hint: string) =>
      matrix.find((r) => r.phase === phase && r.hint === hint);
    const gated = [...NAME_DIVERGENT, ...EXACT_NAME_REGRESSIONS].filter(
      (hint) => row('COLD', hint)?.resolved,
    );
    for (const hint of gated) {
      const warmRow = row('WARM', hint);
      expect({
        hint,
        strategies: warmRow.attempts.map((a: any) => a.strategy),
        geoEntityId: warmRow.resolved?.geoEntityId,
        identityCalls: Object.entries(warmRow.requests)
          .filter(([key]) => IDENTITY_HOSTS.includes(key))
          .reduce((n, [, v]) => n + (v as number), 0),
      }).toEqual({
        hint,
        strategies: ['CATALOG_REUSE'],
        geoEntityId: row('COLD', hint).resolved.geoEntityId,
        identityCalls: 0,
      });
    }
  });
});
