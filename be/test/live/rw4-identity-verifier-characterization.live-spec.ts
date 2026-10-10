import * as fs from 'fs';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/core/database/prisma.service';
import { DestinationResolutionService } from 'src/modules/tours/services/destination-resolution.service';
import { ExperienceProposalResolverService } from 'src/modules/tours/services/experience-proposal-resolver.service';
import { CompositeGeographicValidationService } from 'src/modules/tours/services/composite-geographic-validation.service';
import { OsmPlacesService } from 'src/modules/integrations/osm/services/osm-places.service';
import { OverturePlacesIndexService } from 'src/modules/integrations/overture/overture-places-index.service';
import { GeographicScope } from 'src/modules/tours/interfaces/experience-resolution.interface';
import { ExperienceCandidate } from 'src/modules/tours/interfaces/experience-discovery.interface';
import {
  authorizeCandidates,
  ownedIntentGrant,
} from 'src/modules/tours/utils/geographic-validation-authorization.util';
import { normalizeGeoName } from 'src/modules/tours/utils/nominatim-match.util';
import { loadRootEnv } from './discovery/discovery-live.helper';

loadRootEnv();
jest.setTimeout(20 * 60 * 1000);

/**
 * RW4 IdentityVerifier characterization (diagnostic only, never a gate).
 *
 * Replays the COLD #11 Uco / Lujan composites through the REAL production
 * resolver with the REAL configured identity providers AND the REAL
 * `OverturePlacesIndexService`, reading the already-imported Overture
 * snapshot copied into a disposable DB. The catalog is a stub: no canonical
 * state is read or written. Records the per-strategy evidence and the
 * IdentityVerifier decision exactly as the resolver audit carries them.
 *
 *   ../spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/identity-characterization/verifier-characterization-2026-10-03/run.sh
 */
const RUN = process.env.RUN_RW4_VERIFIER_PROBE === '1';
const describeIfRun = RUN ? describe : describe.skip;

const DESTINATION = {
  label: 'Mendoza, Argentina',
  point: { latitude: -32.8895, longitude: -68.8458 },
  scaleHint: 'settlement' as any,
};

// Source evidence exactly as COLD #11 grounded it (ev-1, SolSalute).
const EVIDENCE = [
  {
    key: 'ev-1',
    source: 'web',
    url: 'https://solsalute.com/blog/mendoza-argentina-wine-capital/',
    title: 'The Best Wineries in Mendoza, A Wine Tasting Guide',
    snippet: 'Mendoza wine tasting itineraries: Valle de Uco and Lujan de Cuyo',
  },
];

// No addressHint: the SolSalute source gives no component address (S7 L1).
const venue = (key: string, name: string) => ({
  key,
  name,
  sourceName: name,
  role: 'venue' as const,
  expectedKind: 'PLACE' as const,
  evidenceKeys: ['ev-1'],
});

const UCO: ExperienceCandidate = {
  name: 'Uco Valley Wine Tasting Itinerary',
  themes: ['wine'],
  traits: [],
  intents: [],
  evidenceKeys: ['ev-1'],
  shortReason: 'source-backed itinerary',
  componentHints: [
    venue('alfa-crux', 'Alfa Crux'),
    venue('superuco', 'SuperUco'),
    venue('bodega-azul', 'Bodega Azul'),
  ],
};
const LUJAN: ExperienceCandidate = {
  name: 'Lujan de Cuyo Wine Tasting Itinerary',
  themes: ['wine'],
  traits: [],
  intents: [],
  evidenceKeys: ['ev-1'],
  shortReason: 'source-backed itinerary',
  componentHints: [venue('a16', 'A16'), venue('ojo-de-agua', 'Ojo de Agua')],
};

function stubCatalog(writes: Array<{ op: string; args: unknown }>) {
  const record =
    (op: string, result: unknown) =>
    async (...args: unknown[]) => {
      writes.push({ op, args: JSON.parse(JSON.stringify(args)) });
      return result;
    };
  return {
    findGeoEntityCandidatesForHint: async () => ({
      candidates: [] as unknown[],
    }),
    findGeoEntityIdsByIdentities: async (): Promise<string[]> => [],
    upsertGeoEntityWithIdentities: record('upsertGeoEntityWithIdentities', {
      status: 'CREATED',
      geoEntity: { id: 'probe-not-persisted' },
      attachedExternalIds: [],
    }),
    upsertGeoEntity: record('upsertGeoEntity', { id: 'probe-not-persisted' }),
    rememberVerifiedHintName: record('rememberVerifiedHintName', 'REMEMBERED'),
    resolveOrCreateTraitDefinitions: async (): Promise<unknown[]> => [],
    persistVerifiedExperience: record('persistVerifiedExperience', {
      id: 'probe-experience-not-persisted',
      dedupeDecision: 'NEW',
    }),
  };
}

describeIfRun('RW4 IdentityVerifier characterization (diagnostic)', () => {
  let moduleRef: TestingModule;
  const outDir = path.resolve(
    __dirname,
    '../../..',
    process.env.SPIKE_OUT_DIR ??
      'spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/identity-characterization/verifier-characterization-2026-10-03',
  );

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await moduleRef.init();
    fs.mkdirSync(outDir, { recursive: true });
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  it('replays the Uco/Lujan components with the Overture index wired in', async () => {
    const destination = await moduleRef
      .get(DestinationResolutionService)
      .resolveDestination(
        DESTINATION.label,
        DESTINATION.point,
        DESTINATION.scaleHint,
      );
    if (destination.scale !== 'area') {
      throw new Error(`expected area-scale Mendoza, got ${destination.scale}`);
    }
    const scope: GeographicScope = {
      kind: 'AREA_BOUNDARY',
      boundary: destination.boundary,
    };
    const overture = moduleRef.get(OverturePlacesIndexService);
    const prisma = moduleRef.get(PrismaService);

    // 1. Index state: what the provider-owned snapshot actually holds.
    const snapshots = await prisma.overturePlacesImportSession.findMany();
    const indexRows: Record<string, unknown> = {};
    for (const name of [
      'Alfa Crux',
      'SuperUco',
      'Bodega Azul',
      'Bodega La Azul',
      'La Azul',
      'A16',
      'Bodega A16',
    ]) {
      indexRows[name] = await prisma.overturePlaceIndex.findMany({
        where: { normalizedName: normalizeGeoName(name) },
        orderBy: { featureId: 'asc' },
      });
    }

    // 2. Direct index lookups exactly as the resolver issues them.
    const lookups: Record<string, unknown> = {};
    for (const hint of [...UCO.componentHints, ...LUJAN.componentHints]) {
      lookups[hint.name] = await overture.lookupExactPlace({
        hintKey: hint.key,
        hintName: hint.name,
        countryCode: destination.countryCode!,
        role: hint.role,
      });
    }

    // 2b. Raw Nominatim pools for the member hints, in the default and the
    // provider-maximum window, so the observed candidate pool is recorded
    // rather than reconstructed (the audit keeps only the selected member).
    const nominatim = moduleRef.get('NominatimApiService');
    const nominatimPools: Record<string, unknown> = {};
    for (const hint of [...UCO.componentHints, ...LUJAN.componentHints]) {
      nominatimPools[hint.name] = {};
      for (const resultWindow of ['DEFAULT', 'PROVIDER_MAXIMUM'] as const) {
        const results = await nominatim.search(hint.name, {
          countryCode: destination.countryCode,
          resultWindow,
        });
        (nominatimPools[hint.name] as Record<string, unknown>)[resultWindow] =
          results.map((r: any) => ({
            id: `osm:${r.osmType}:${r.osmId}`,
            class: r.class,
            type: r.type,
            addresstype: r.addresstype,
            importance: r.importance,
            state: r.address?.state,
            exactName:
              normalizeGeoName(r.displayName) === normalizeGeoName(hint.name) ||
              normalizeGeoName(r.displayName).startsWith(
                `${normalizeGeoName(hint.name)} `,
              ),
            displayName: r.displayName,
            latitude: r.latitude,
            longitude: r.longitude,
          }));
      }
    }

    // 3. Production resolver replay (COLD #11 ROUTE_LIKE grant).
    const writes: Array<{ op: string; args: unknown }> = [];
    const resolver = new ExperienceProposalResolverService(
      moduleRef.get(OsmPlacesService),
      stubCatalog(writes) as any,
      new CompositeGeographicValidationService(),
      undefined,
      moduleRef.get('NominatimApiService'),
      moduleRef.get('PlacesApiService'),
      moduleRef.get('WikidataApiService'),
      overture,
    );
    const routeGrant = ownedIntentGrant('AREA_ROUTE_WALK', {
      origin: 'preference_facet',
      dimension: 'intent',
      key: 'route_like',
      reason:
        'Preference facet [intent:route_like] has no strong catalog match yet.',
    });
    const response = await resolver.resolve({
      destinationName: destination.boundary.name,
      destinationCountryCode: destination.countryCode,
      geographicScope: scope,
      candidates: authorizeCandidates(routeGrant, [UCO, LUJAN]),
      evidence: EVIDENCE,
    });

    fs.writeFileSync(
      path.join(outDir, 'resolver-replay.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          destination: {
            name: destination.boundary.name,
            countryCode: destination.countryCode,
          },
          catalog: 'STUB (empty; no reads of canonical state, no writes)',
          overtureSnapshots: snapshots,
          overtureIndexRows: indexRows,
          overtureLookups: lookups,
          nominatimPools,
          wouldPersistCalls: writes.map((write) => ({
            op: write.op,
            args: write.args,
          })),
          candidates: response.resolved.map((r) => ({
            name: r.candidate.name,
            status: r.status,
            rejectionReasons: r.rejectionReasons,
          })),
          forensicAudit: response.entityResolution.forensicAudit.map(
            (audit) => ({
              candidateName: audit.candidateName,
              geographicPolicy: audit.geographicAuthorization.kind,
              componentSearchScope: audit.componentSearchScope,
              components: audit.componentAudits,
              componentResolution: audit.componentResolution,
            }),
          ),
          geographicValidation: response.geographicValidation.results,
        },
        null,
        2,
      ),
    );
    expect(response.resolved).toHaveLength(2);
  });
});
