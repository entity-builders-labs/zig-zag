import * as fs from 'fs';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from 'src/app.module';
import { DestinationResolutionService } from 'src/modules/tours/services/destination-resolution.service';
import { ExperienceProposalResolverService } from 'src/modules/tours/services/experience-proposal-resolver.service';
import { CompositeGeographicValidationService } from 'src/modules/tours/services/composite-geographic-validation.service';
import { OsmPlacesService } from 'src/modules/integrations/osm/services/osm-places.service';
import { GeographicScope } from 'src/modules/tours/interfaces/experience-resolution.interface';
import { ExperienceCandidate } from 'src/modules/tours/interfaces/experience-discovery.interface';
import { GeographicValidationAuthorization } from 'src/modules/tours/interfaces/geographic-validation-authorization.interface';
import {
  authorizeCandidates,
  NO_GEOGRAPHIC_GRANT,
  ownedIntentGrant,
} from 'src/modules/tours/utils/geographic-validation-authorization.util';
import { geographicScopeSearchWindow } from 'src/modules/tours/utils/experience-geographic-scope.policy';
import { distanceMeters } from 'src/modules/tours/utils/geographic-coherence.util';
import { loadRootEnv } from './discovery/discovery-live.helper';

loadRootEnv();
jest.setTimeout(20 * 60 * 1000);

/**
 * RW4 identity characterization (diagnostic only, never a gate).
 *
 * Replays the COLD #11 route_like-owned composites (Uco Valley, Lujan de
 * Cuyo) through the REAL production resolver
 * (`ExperienceProposalResolverService.resolve`) with the REAL configured
 * identity providers (local Nominatim/Overpass, Geoapify, Wikidata), but a
 * STUB catalog that never reads or writes canonical state: no GeoEntity,
 * identity, hint memory or Experience is ever persisted. Then probes the
 * same providers with bounded, source-justified query variants.
 *
 *   ../spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/identity-characterization/run-probe.sh
 *
 * Writes resolver-replay.json and provider-probes.json to
 * SPIKE_OUT_DIR (relative to the repo root).
 */
const RUN = process.env.RUN_RW4_IDENTITY_PROBE === '1';
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

const venue = (key: string, name: string) => ({
  key,
  name,
  sourceName: name,
  role: 'venue' as const,
  expectedKind: 'PLACE' as const,
  evidenceKeys: ['ev-1'],
});

// The COLD #11 admitted candidates (componentHints as extracted; source
// support 3/3 and 2/2 DECLARED_KEY_VERIFIED).
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

/**
 * Bounded query variants, each with its source justification. Variants are
 * probes only -- never aliases and never identity evidence.
 */
const VARIANTS: Record<
  string,
  Array<{ query: string; justification: string }>
> = {
  'Alfa Crux': [
    { query: 'Alfa Crux', justification: 'exact source hint (COLD #11 query)' },
    {
      query: 'Bodega Alfa Crux',
      justification: 'source: "This winery" (es: bodega)',
    },
    { query: 'Alfa Crux winery', justification: 'source: "This winery"' },
    {
      query: 'Agostino',
      justification:
        'source hyperlink host agostinowinegroup.com (wine GROUP site) -- coverage probe only, NOT an alias',
    },
  ],
  SuperUco: [
    { query: 'SuperUco', justification: 'exact source hint (COLD #11 query)' },
    {
      query: 'Super Uco',
      justification: 'tokenization variant of the hint (normalization probe)',
    },
    {
      query: 'Bodega SuperUco',
      justification: 'source: wineries itinerary (es: bodega)',
    },
    {
      query: 'The Vines of Mendoza',
      justification:
        'source: "same property as SuperUco (as they form part of The Vines)" -- property context, NOT an alias',
    },
  ],
  'Bodega Azul': [
    {
      query: 'Bodega Azul',
      justification: 'exact source hint (COLD #11 query)',
    },
    {
      query: 'Bodega La Azul',
      justification:
        'source hyperlink target bodegalaazul.com names the winery "La Azul"',
    },
    {
      query: 'La Azul',
      justification: 'name on the source-linked official domain',
    },
  ],
  A16: [
    { query: 'A16', justification: 'exact source hint (COLD #11 query)' },
    {
      query: 'Bodega A16',
      justification: 'source: tasting and tour at A16 (es: bodega)',
    },
    { query: 'A16 winery', justification: 'source: wineries itinerary' },
  ],
};

/** Catalog stub: empty canonical knowledge, records would-be writes, persists nothing. */
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

describeIfRun('RW4 identity characterization (diagnostic)', () => {
  let moduleRef: TestingModule;
  const outDir = path.resolve(
    __dirname,
    '../../..',
    process.env.SPIKE_OUT_DIR ??
      'spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/identity-characterization',
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

  it('replays the COLD #11 composites and probes the identity providers', async () => {
    const destination = await moduleRef
      .get(DestinationResolutionService)
      .resolveDestination(
        DESTINATION.label,
        DESTINATION.point,
        DESTINATION.scaleHint,
      );
    if (destination.scale !== 'area') {
      throw new Error(
        `expected an area-scale Mendoza destination, got ${destination.scale}`,
      );
    }
    const scope: GeographicScope = {
      kind: 'AREA_BOUNDARY',
      boundary: destination.boundary,
    };
    const destinationName = destination.boundary.name;
    // Production identity-search geography since the spec 2026-10-02 Part II
    // cutover: the destination polygon's covering window (no 80 km circle).
    const destinationWindow = geographicScopeSearchWindow(
      scope,
      'DESTINATION_AREA',
    )!;

    const placesApi: any = moduleRef.get('PlacesApiService');
    const nominatim: any = moduleRef.get('NominatimApiService');
    const wikidata: any = moduleRef.get('WikidataApiService');
    const writes: Array<{ op: string; args: unknown }> = [];
    const resolver = new ExperienceProposalResolverService(
      moduleRef.get(OsmPlacesService),
      stubCatalog(writes) as any,
      new CompositeGeographicValidationService(),
      undefined,
      nominatim,
      placesApi,
      wikidata,
    );

    // 1. Production resolver replay, as COLD #11 (AREA_ROUTE_WALK route_like
    // grant) and, for contrast, under DEFAULT.
    const routeGrant = ownedIntentGrant('AREA_ROUTE_WALK', {
      origin: 'preference_facet',
      dimension: 'intent',
      key: 'route_like',
      reason:
        'Preference facet [intent:route_like] has no strong catalog match yet.',
    });
    const replay: Record<string, unknown> = {};
    for (const [label, grant] of [
      ['ROUTE_LIKE (COLD #11 policy)', routeGrant],
      ['DEFAULT (contrast)', NO_GEOGRAPHIC_GRANT],
    ] as const) {
      const response = await resolver.resolve({
        destinationName,
        destinationCountryCode: destination.countryCode,
        geographicScope: scope,
        candidates: authorizeCandidates(grant, [UCO, LUJAN]),
        evidence: EVIDENCE,
      });
      replay[label] = {
        candidates: response.resolved.map((r) => ({
          name: r.candidate.name,
          status: r.status,
          rejectionReasons: r.rejectionReasons,
          geographicPolicy: (
            r.geographicAuthorization as GeographicValidationAuthorization
          )?.kind,
        })),
        forensicAudit: response.entityResolution.forensicAudit.map((audit) => ({
          candidateName: audit.candidateName,
          geographicPolicy: audit.geographicAuthorization.kind,
          components: audit.componentAudits.map((component) => ({
            hintName: component.hintName,
            finalStatus: component.finalStatus,
            finalReason: component.finalReason,
            attempts: component.attempts,
          })),
        })),
        geographicValidation: response.geographicValidation.results,
      };
    }

    // 2. Bounded provider probes with source-justified variants.
    const centroid = destinationWindow.center;
    const km = (lat?: number, lon?: number) =>
      Number.isFinite(lat) && Number.isFinite(lon)
        ? Math.round(
            distanceMeters(centroid, { latitude: lat!, longitude: lon! }) / 100,
          ) / 10
        : null;
    const probes: Record<string, unknown> = {};
    for (const [component, variants] of Object.entries(VARIANTS)) {
      const rows: unknown[] = [];
      for (const { query, justification } of variants) {
        const places = await placesApi.searchText({
          textQuery: query,
          maxResultCount: 10,
          locationBias: {
            center: destinationWindow.center,
            radius: destinationWindow.radiusMeters,
          },
        });
        const placeRows = [];
        for (const place of places.data ?? []) {
          const details =
            place.id && placesApi.getPlaceDetails
              ? await placesApi
                  .getPlaceDetails(place.id)
                  .catch((error: Error) => ({
                    error: error.message,
                  }))
              : undefined;
          placeRows.push({
            id: place.id,
            name: place.displayName?.text ?? place.name,
            featureClass: place.featureClass,
            types: place.types,
            formattedAddress: place.formattedAddress,
            location: place.location,
            kmFromDestinationCentroid: km(
              place.location?.latitude,
              place.location?.longitude,
            ),
            details: details?.data
              ? {
                  websiteUri: details.data.websiteUri,
                  nationalPhoneNumber: details.data.nationalPhoneNumber,
                  formattedAddress: details.data.formattedAddress,
                  name: details.data.name,
                  sourceIdentities: details.data.sourceIdentities,
                }
              : details,
          });
        }
        const nominatimResults = await nominatim
          .search(query, { countryCode: destination.countryCode })
          .catch((error: Error) => ({ error: error.message }));
        rows.push({
          query,
          justification,
          places: { resultCount: placeRows.length, results: placeRows },
          nominatim: Array.isArray(nominatimResults)
            ? nominatimResults.slice(0, 10).map((r: any) => ({
                displayName: r.displayName,
                osm: `${r.osmType}/${r.osmId}`,
                class: r.class,
                type: r.type,
                addresstype: r.addresstype,
                latitude: r.latitude,
                longitude: r.longitude,
                kmFromDestinationCentroid: km(r.latitude, r.longitude),
              }))
            : nominatimResults,
        });
      }
      probes[component] = rows;
    }

    fs.writeFileSync(
      path.join(outDir, 'resolver-replay.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          destination: {
            name: destinationName,
            countryCode: destination.countryCode,
            destinationWindowCenter: destinationWindow.center,
            destinationWindowRadiusMeters: destinationWindow.radiusMeters,
          },
          catalog: 'STUB (empty; no reads of canonical state, no writes)',
          wouldPersistCalls: writes.map((write) => write.op),
          replay,
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(outDir, 'provider-probes.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          placesProvider: placesApi.provider,
          probes,
        },
        null,
        2,
      ),
    );
    expect(Object.keys(probes)).toHaveLength(4);
  });
});
