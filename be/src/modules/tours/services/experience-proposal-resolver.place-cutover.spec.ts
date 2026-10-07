import { withDefaultGeographicAuthorization } from '../utils/geographic-validation-authorization.util';
import { GeoEntityKind } from '@prisma/client';
import { PlaceData } from '@integrations/google-places/interfaces/places-api.interface';
import { GeographicScope } from '../interfaces/experience-resolution.interface';
import { ExperienceProposalResolverService } from './experience-proposal-resolver.service';
import { geographicScopeSearchWindow } from '../utils/experience-geographic-scope.policy';
import { ownedAuthorization } from '../fixtures/geographic-authorization.fixture';
import { CatalogGeoEntityCandidate } from './experience-catalog.service';

/**
 * Stage 3 PLACE cutover: Geoapify Forward Geocoding (free-form hint text, no
 * `type`) -> structural PLACE compatibility -> destination scope -> bounded
 * selection -> Place Details identity enrichment of the ONE selected
 * candidate -> strong-identity convergence -> IdentityVerifier ->
 * multi-identity persistence. Fixtures are the live-captured shapes from
 * spikes/stage3-place-provider-search-characterization-2026-09-25/raw.
 */

// Destination admin boundary (Buenos Aires): covers San Telmo/Monserrat/
// Retiro, excludes Ramos Mejía (lon < -58.53) and Avellaneda (lon > -58.36).
const DESTINATION: GeographicScope = {
  kind: 'AREA_BOUNDARY',
  boundary: {
    id: 'osm:relation:1224652',
    name: 'Buenos Aires',
    osmType: 'relation',
    osmId: 1224652,
    tags: { boundary: 'administrative', admin_level: '8' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-58.53, -34.71],
          [-58.36, -34.71],
          [-58.36, -34.53],
          [-58.53, -34.53],
          [-58.53, -34.71],
        ],
      ],
    },
  },
};

const place = (
  id: string,
  name: string,
  latitude: number,
  longitude: number,
  featureClass?: PlaceData['featureClass'],
): PlaceData => ({
  id,
  name,
  displayName: { text: name },
  location: { latitude, longitude },
  types: [],
  ...(featureClass ? { featureClass } : {}),
});

const MAFALDA = place(
  'geo-mafalda-search',
  'Mafalda, Susanita and Manolito',
  -34.6159617,
  -58.3716913,
  'point_of_interest',
);
const MAFALDA_STREET = place(
  'geo-mafalda-street',
  'Mafalda',
  -34.646176,
  -58.399319,
  'street',
);
const MAFALDA_BIKE_DOCK = place(
  'geo-mafalda-dock',
  '345 - Plaza Mafalda',
  -34.5807708,
  -58.444677,
  'transport_stop',
);
const FARMACIA = place(
  'geo-farmacia-search',
  'Farmacia de la Estrella',
  -34.6102605,
  -58.3721513,
  'point_of_interest',
);

const placeCandidate = (hintName: string) => ({
  name: `${hintName} visit`,
  themes: ['history'],
  traits: [] as string[],
  intents: ['visit'],
  componentHints: [
    {
      key: 'hint',
      name: hintName,
      role: 'venue' as const,
      expectedKind: 'PLACE' as const,
      evidenceKeys: ['ev-1'],
    },
  ],
  evidenceKeys: ['ev-1'],
  shortReason: 'source-backed place',
});

function build(
  options: {
    searchResults?: PlaceData[];
    details?: Record<string, Partial<PlaceData> | Error>;
    declaresSourceIdentitiesInDetails?: boolean;
    nominatimResults?: any[];
    wikidataLabels?: Record<string, { label: string; aliases?: string[] }>;
    upsertWithIdentitiesResult?: any;
    catalogCandidates?: CatalogGeoEntityCandidate[];
    rememberVerifiedHintName?: jest.Mock;
  } = {},
) {
  const osmPlaces = {
    lookupPoisWithin: jest
      .fn()
      .mockResolvedValue({ status: 'success', value: [] }),
    lookupPoisNear: jest
      .fn()
      .mockResolvedValue({ status: 'success', value: [] }),
    lookupBoundaryById: jest.fn(),
    lookupHighwaysByName: jest.fn(),
  };
  const catalog = {
    findGeoEntityCandidatesForHint: jest
      .fn()
      .mockResolvedValue({ candidates: options.catalogCandidates ?? [] }),
    rememberVerifiedHintName:
      options.rememberVerifiedHintName ??
      jest.fn().mockResolvedValue('REMEMBERED'),
    findGeoEntityIdsByIdentities: jest.fn().mockResolvedValue([]),
    upsertGeoEntityWithIdentities: jest.fn().mockResolvedValue(
      options.upsertWithIdentitiesResult ?? {
        status: 'CREATED',
        geoEntity: { id: 'geo-place' },
        attachedExternalIds: [],
      },
    ),
    upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-single' }),
    resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
    persistVerifiedExperience: jest
      .fn()
      .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
  };
  const nominatim = {
    search: jest.fn().mockResolvedValue(options.nominatimResults ?? []),
  };
  const placesApi = {
    provider: 'geoapify' as const,
    declaresSourceIdentitiesInDetails:
      options.declaresSourceIdentitiesInDetails ?? true,
    getStatus: jest.fn(),
    searchNearby: jest.fn(),
    searchText: jest.fn().mockResolvedValue({
      data: options.searchResults ?? [],
      provenance: {
        provider: 'geoapify',
        cacheStatus: 'miss-live',
        requestedCount: 3,
        receivedCount: (options.searchResults ?? []).length,
      },
    }),
    getPlaceDetails: jest.fn(async (id: string) => {
      const details = options.details?.[id];
      if (details instanceof Error) throw details;
      return {
        data: details ?? { id },
        provenance: {
          provider: 'geoapify',
          cacheStatus: 'miss-live',
          requestedCount: 1,
          receivedCount: 1,
        },
      };
    }),
  };
  const wikidata = {
    getEntitySummaries: jest.fn(async (qids: string[]) => {
      const map = new Map();
      for (const qid of qids) {
        const summary = options.wikidataLabels?.[qid];
        if (summary) map.set(qid, summary);
      }
      return map;
    }),
    findNearbyPlaces: jest.fn().mockResolvedValue([]),
  };
  const geographicValidator = {
    validate: jest.fn().mockReturnValue({ accepted: true }),
  };
  const service = new ExperienceProposalResolverService(
    osmPlaces as any,
    catalog as any,
    geographicValidator as any,
    undefined,
    nominatim as any,
    placesApi as any,
    wikidata as any,
  );
  return { service, catalog, nominatim, placesApi, wikidata, osmPlaces };
}

const resolveHint = (
  service: ExperienceProposalResolverService,
  hintName: string,
) =>
  service.resolve({
    destinationName: 'Buenos Aires, Argentina',
    destinationCountryCode: 'AR',
    geographicScope: DESTINATION,
    candidates: withDefaultGeographicAuthorization([placeCandidate(hintName)]),
    evidence: [
      {
        key: 'ev-1',
        source: 'web',
        title: 'Buenos Aires highlights',
        snippet: `${hintName} in Buenos Aires`,
      },
    ],
  } as any);

const componentAudit = (result: any) =>
  result.entityResolution.forensicAudit[0].componentAudits[0];
const placesAttempt = (result: any) =>
  componentAudit(result).attempts.find((a: any) => a.strategy === 'PLACES');
const resolvedEntity = (result: any) => result.resolved[0].resolvedEntities[0];

describe('ExperienceProposalResolverService -- Stage 3 PLACE cutover', () => {
  it('searches with the characterized 10-result window (Geoapify limit is not a truncation: limit=3 dropped the correct pharmacy live)', async () => {
    const { service, placesApi } = build({ searchResults: [FARMACIA] });

    await resolveHint(service, 'Farmacia la Estrella');

    expect(placesApi.searchText).toHaveBeenCalledWith(
      expect.objectContaining({
        textQuery: 'Farmacia la Estrella',
        maxResultCount: 10,
      }),
    );
  });

  describe('structural PLACE compatibility (before selection)', () => {
    it('rejects a street result for a PLACE hint and never enriches it ("Defensa Street")', async () => {
      const { service, placesApi, catalog } = build({
        searchResults: [
          place('s1', 'Defensa', -34.61, -58.371, 'street'),
          place('s2', 'Defensa', -34.62, -58.371, 'street'),
        ],
      });

      const result = await resolveHint(service, 'Defensa Street');

      const attempt = placesAttempt(result);
      expect(attempt.candidateAcquired).toBe(false);
      expect(attempt.placeSearch).toMatchObject({
        resultCount: 2,
        viableCount: 0,
        rejected: [
          {
            name: 'Defensa',
            reason: 'STRUCTURALLY_INCOMPATIBLE',
            featureClass: 'street',
          },
          {
            name: 'Defensa',
            reason: 'STRUCTURALLY_INCOMPATIBLE',
            featureClass: 'street',
          },
        ],
      });
      expect(placesApi.getPlaceDetails).not.toHaveBeenCalled();
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
      expect(catalog.upsertGeoEntityWithIdentities).not.toHaveBeenCalled();
      expect(resolvedEntity(result).status).toBe('unresolved');
    });

    it('does not turn "Parque Lezama" into a same-name bus stop, and the stop does not count as a name competitor', async () => {
      const PARK = place(
        'park',
        'Parque Lezama',
        -34.6285,
        -58.3698,
        'point_of_interest',
      );
      const { service, placesApi, catalog } = build({
        searchResults: [
          place('stop-1', 'Parque Lezama', -34.628, -58.3697, 'transport_stop'),
          PARK,
          place('stop-2', 'Parque Lezama', -34.6287, -58.37, 'transport_stop'),
        ],
        details: {
          park: {
            id: 'park',
            sourceIdentities: [
              { provider: 'openstreetmap', externalId: 'osm:way:26608624' },
            ],
          },
        },
      });

      const result = await resolveHint(service, 'Parque Lezama');

      const attempt = placesAttempt(result);
      expect(attempt.selectedCandidate).toMatchObject({
        canonicalName: 'Parque Lezama',
        externalId: 'geoapify:park',
      });
      expect(attempt.verificationDecision).toBe('VERIFIED');
      expect(placesApi.getPlaceDetails).toHaveBeenCalledTimes(1);
      expect(placesApi.getPlaceDetails).toHaveBeenCalledWith('park');
      expect(catalog.upsertGeoEntityWithIdentities).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: GeoEntityKind.PLACE,
          identities: [
            { provider: 'geoapify', externalId: 'geoapify:park' },
            { provider: 'openstreetmap', externalId: 'osm:way:26608624' },
          ],
        }),
      );
    });

    it('never picks an administrative area for a bare common name ("San Martín")', async () => {
      const { service, placesApi } = build({
        searchResults: [
          place(
            'partido',
            'Ciudad del Libertador General San Martín',
            -34.575,
            -58.54,
            'administrative_area',
          ),
          place('suburb', 'San Martín', -34.8, -58.7, 'administrative_area'),
        ],
      });

      const result = await resolveHint(service, 'San Martín');

      expect(placesAttempt(result).candidateAcquired).toBe(false);
      expect(placesApi.getPlaceDetails).not.toHaveBeenCalled();
      expect(resolvedEntity(result).status).toBe('unresolved');
    });

    it('keeps a result whose provider declared no structural class (e.g. Google): unknown is not a rejection', async () => {
      const { service } = build({
        declaresSourceIdentitiesInDetails: false,
        searchResults: [place('g1', 'Casa Mínima', -34.6212, -58.3718)],
      });

      const result = await resolveHint(service, 'Casa Mínima');

      expect(placesAttempt(result).selectedCandidate?.canonicalName).toBe(
        'Casa Mínima',
      );
    });
  });

  describe('destination scope (the single destination policy, never distance identity)', () => {
    it('never accepts the same-name Ramos Mejía object for "Galería Güemes" (live G1: it is the only result)', async () => {
      const { service, placesApi, catalog } = build({
        searchResults: [
          place(
            'ramos-mejia',
            'Galería Güemes',
            -34.6408,
            -58.5647,
            'point_of_interest',
          ),
        ],
      });

      const result = await resolveHint(service, 'Galería Güemes');

      const attempt = placesAttempt(result);
      expect(attempt.candidateAcquired).toBe(false);
      expect(attempt.placeSearch.rejected).toEqual([
        {
          name: 'Galería Güemes',
          reason: 'DESTINATION_INCOMPATIBLE',
          destinationReason: 'OUTSIDE_DESTINATION_BOUNDARY',
        },
      ]);
      expect(placesApi.getPlaceDetails).not.toHaveBeenCalled();
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
      expect(catalog.upsertGeoEntityWithIdentities).not.toHaveBeenCalled();
      expect(resolvedEntity(result).status).toBe('unresolved');
    });

    it('with the real CABA object AND the Ramos Mejía homonym, selects only the in-destination object', async () => {
      const { service } = build({
        searchResults: [
          place(
            'ramos-mejia',
            'Galería Güemes',
            -34.6408,
            -58.5647,
            'point_of_interest',
          ),
          place('caba', 'Galería Güemes', -34.6034, -58.3748, 'building'),
        ],
      });

      const result = await resolveHint(service, 'Galería Güemes');

      expect(placesAttempt(result).selectedCandidate?.externalId).toBe(
        'geoapify:caba',
      );
      expect(resolvedEntity(result)).toMatchObject({
        status: 'resolved',
        latitude: -34.6034,
      });
    });

    it('two in-destination same-name objects stay AMBIGUOUS; no nearest-wins identity', async () => {
      const { service, catalog } = build({
        searchResults: [
          place('a', 'Plaza San Martín', -34.595, -58.375, 'point_of_interest'),
          place('b', 'Plaza San Martín', -34.62, -58.45, 'point_of_interest'),
        ],
      });

      const result = await resolveHint(service, 'Plaza San Martín');

      expect(placesAttempt(result).verificationDecision).toBe('AMBIGUOUS');
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
      expect(catalog.upsertGeoEntityWithIdentities).not.toHaveBeenCalled();
      expect(resolvedEntity(result).status).toBe('unresolved');
    });
  });

  describe('provider-native identity enrichment', () => {
    it('Place Details runs only for the ONE selected viable candidate', async () => {
      const { service, placesApi } = build({
        searchResults: [MAFALDA, MAFALDA_STREET, MAFALDA_BIKE_DOCK],
      });

      await resolveHint(service, 'Mafalda Statue');

      expect(placesApi.getPlaceDetails).toHaveBeenCalledTimes(1);
      expect(placesApi.getPlaceDetails).toHaveBeenCalledWith(
        'geo-mafalda-search',
      );
    });

    it('does not request details when the provider cannot declare cross-identities', async () => {
      const { service, placesApi } = build({
        declaresSourceIdentitiesInDetails: false,
        searchResults: [FARMACIA],
      });

      await resolveHint(service, 'Farmacia la Estrella');

      expect(placesApi.getPlaceDetails).not.toHaveBeenCalled();
    });

    it('a details failure is additive-evidence loss, not a failed acquisition: the candidate keeps its provider handle only', async () => {
      const { service, catalog } = build({
        searchResults: [
          place('cm', 'Casa Mínima', -34.6212, -58.3718, 'point_of_interest'),
        ],
        details: { cm: new Error('timeout') },
      });

      const result = await resolveHint(service, 'Casa Mínima');

      const attempt = placesAttempt(result);
      expect(attempt.placeSearch.identityEnrichment).toEqual({
        status: 'FAILED',
        failureReason: 'timeout',
      });
      expect(attempt.verificationDecision).toBe('VERIFIED');
      expect(catalog.upsertGeoEntityWithIdentities).not.toHaveBeenCalled();
      expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'geoapify',
          externalId: 'geoapify:cm',
        }),
      );
    });
  });

  describe('Farmacia gate: exact strong-identity convergence', () => {
    const NOMINATIM_FARMACIA = {
      osmType: 'node',
      osmId: 3348573778,
      class: 'amenity',
      type: 'pharmacy',
      addresstype: 'amenity',
      displayName:
        'Farmacia de la Estrella, 201, Defensa, Monserrat, Buenos Aires, Argentina',
      importance: 0.1,
      latitude: -34.6101871,
      longitude: -58.3721455,
      address: { city: 'Buenos Aires', country: 'Argentina' },
    };

    it('Nominatim osm:node:3348573778 + Geoapify Place Details osm:node:3348573778 -> IDENTITY_CONVERGENCE -> RESOLVED -> one PLACE GeoEntity with both identities', async () => {
      const { service, catalog, placesApi } = build({
        nominatimResults: [NOMINATIM_FARMACIA],
        searchResults: [FARMACIA],
        details: {
          'geo-farmacia-search': {
            id: 'geo-farmacia-details',
            sourceIdentities: [
              { provider: 'openstreetmap', externalId: 'osm:node:3348573778' },
            ],
          },
        },
      });

      const result = await resolveHint(service, 'Farmacia la Estrella');

      const audit = componentAudit(result);
      const nominatimAttempt = audit.attempts.find(
        (a: any) => a.strategy === 'NOMINATIM',
      );
      // Nominatim alone never verified it (non-exact name, no Wikidata).
      expect(nominatimAttempt.verificationDecision).not.toBe('VERIFIED');
      expect(nominatimAttempt.selectedCandidate.identities).toEqual([
        { provider: 'openstreetmap', externalId: 'osm:node:3348573778' },
      ]);

      const attempt = placesAttempt(result);
      expect(placesApi.searchText).toHaveBeenCalledWith(
        expect.objectContaining({ textQuery: 'Farmacia la Estrella' }),
      );
      expect(attempt.selectedCandidate.identities).toEqual([
        { provider: 'geoapify', externalId: 'geoapify:geo-farmacia-search' },
        { provider: 'openstreetmap', externalId: 'osm:node:3348573778' },
      ]);
      expect(attempt.identityEvidence).toContainEqual({
        type: 'IDENTITY_CONVERGENCE',
        priorStrategy: 'NOMINATIM',
        identity: {
          provider: 'openstreetmap',
          externalId: 'osm:node:3348573778',
        },
      });
      expect(attempt.verificationDecision).toBe('VERIFIED');

      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
      expect(catalog.upsertGeoEntityWithIdentities).toHaveBeenCalledTimes(1);
      expect(catalog.upsertGeoEntityWithIdentities).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Farmacia de la Estrella',
          kind: GeoEntityKind.PLACE,
          identities: [
            {
              provider: 'geoapify',
              externalId: 'geoapify:geo-farmacia-search',
            },
            { provider: 'openstreetmap', externalId: 'osm:node:3348573778' },
          ],
        }),
      );
      expect(audit.finalStatus).toBe('resolved');
      expect(audit.resolvedGeoEntity).toMatchObject({
        geoEntityId: 'geo-place',
        persistence: { status: 'CREATED' },
      });
      expect(result.resolved[0].status).toBe('accepted');
    });

    it('a different OSM object from each strategy is NOT convergence (identity, not name)', async () => {
      const { service, catalog } = build({
        nominatimResults: [NOMINATIM_FARMACIA],
        searchResults: [FARMACIA],
        details: {
          'geo-farmacia-search': {
            sourceIdentities: [
              { provider: 'openstreetmap', externalId: 'osm:node:1' },
            ],
          },
        },
      });

      const result = await resolveHint(service, 'Farmacia la Estrella');

      const attempt = placesAttempt(result);
      expect(
        attempt.identityEvidence.some(
          (e: any) => e.type === 'IDENTITY_CONVERGENCE',
        ),
      ).toBe(false);
      expect(attempt.verificationDecision).not.toBe('VERIFIED');
      expect(catalog.upsertGeoEntityWithIdentities).not.toHaveBeenCalled();
      expect(resolvedEntity(result).status).toBe('unresolved');
    });

    it('the same numeric id in a different namespace is NOT convergence', async () => {
      const { service } = build({
        nominatimResults: [NOMINATIM_FARMACIA],
        searchResults: [FARMACIA],
        details: {
          'geo-farmacia-search': {
            sourceIdentities: [
              { provider: 'openstreetmap', externalId: 'osm:way:3348573778' },
            ],
          },
        },
      });

      const result = await resolveHint(service, 'Farmacia la Estrella');

      expect(placesAttempt(result).verificationDecision).not.toBe('VERIFIED');
    });

    it('IDENTITY_CONFLICT at persistence fails closed (no merge, no winner)', async () => {
      const { service } = build({
        nominatimResults: [NOMINATIM_FARMACIA],
        searchResults: [FARMACIA],
        details: {
          'geo-farmacia-search': {
            sourceIdentities: [
              { provider: 'openstreetmap', externalId: 'osm:node:3348573778' },
            ],
          },
        },
        upsertWithIdentitiesResult: {
          status: 'IDENTITY_CONFLICT',
          conflictingGeoEntityIds: ['geo-a', 'geo-b'],
        },
      });

      const result = await resolveHint(service, 'Farmacia la Estrella');

      expect(resolvedEntity(result)).toMatchObject({
        status: 'unresolved',
        reason: 'IDENTITY_CONFLICT',
      });
      expect(result.resolved[0].status).toBe('rejected');
    });
  });

  describe('Mafalda gate: original hint text, generic verification', () => {
    it('searches "Mafalda Statue" unchanged, skips the street/bike dock, enriches OSM + Wikidata identities and verifies through the own-QID fact', async () => {
      const { service, placesApi, catalog, wikidata } = build({
        searchResults: [MAFALDA, MAFALDA_STREET, MAFALDA_BIKE_DOCK],
        details: {
          'geo-mafalda-search': {
            id: 'geo-mafalda-details',
            sourceIdentities: [
              { provider: 'openstreetmap', externalId: 'osm:node:2472979623' },
              { provider: 'wikidata', externalId: 'Q111038841' },
            ],
          },
        },
        wikidataLabels: {
          Q111038841: {
            label: 'Mafalda statue',
            aliases: ['Homenaje a Mafalda'],
          },
        },
      });

      const result = await resolveHint(service, 'Mafalda Statue');

      expect(placesApi.searchText).toHaveBeenCalledWith(
        expect.objectContaining({ textQuery: 'Mafalda Statue' }),
      );
      const attempt = placesAttempt(result);
      expect(attempt.placeSearch.rejected).toEqual([
        {
          name: 'Mafalda',
          reason: 'STRUCTURALLY_INCOMPATIBLE',
          featureClass: 'street',
        },
        {
          name: '345 - Plaza Mafalda',
          reason: 'STRUCTURALLY_INCOMPATIBLE',
          featureClass: 'transport_stop',
        },
      ]);
      expect(attempt.selectedCandidate).toMatchObject({
        canonicalName: 'Mafalda, Susanita and Manolito',
        identities: [
          { provider: 'geoapify', externalId: 'geoapify:geo-mafalda-search' },
          { provider: 'openstreetmap', externalId: 'osm:node:2472979623' },
          { provider: 'wikidata', externalId: 'Q111038841' },
        ],
      });
      expect(wikidata.getEntitySummaries).toHaveBeenCalledWith(['Q111038841']);
      expect(attempt.identityEvidence).toContainEqual({
        type: 'WIKIDATA_IDENTITY_MATCH',
        source: 'OWN_QID',
        hintCorrespondence: 'EQUIVALENT',
        candidateCorrespondence: 'DECLARES_QID',
      });
      expect(attempt.verificationDecision).toBe('VERIFIED');
      expect(catalog.upsertGeoEntityWithIdentities).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: GeoEntityKind.PLACE,
          identities: [
            {
              provider: 'geoapify',
              externalId: 'geoapify:geo-mafalda-search',
            },
            { provider: 'openstreetmap', externalId: 'osm:node:2472979623' },
            { provider: 'wikidata', externalId: 'Q111038841' },
          ],
        }),
      );
      expect(resolvedEntity(result)).toMatchObject({
        status: 'resolved',
        wikidataQid: 'Q111038841',
      });
    });

    it('without a corroborating QID label the gloss stays unverified (no threshold lowered)', async () => {
      const { service, catalog } = build({
        searchResults: [MAFALDA],
        details: {
          'geo-mafalda-search': {
            sourceIdentities: [
              { provider: 'openstreetmap', externalId: 'osm:node:2472979623' },
            ],
          },
        },
      });

      const result = await resolveHint(service, 'Mafalda Statue');

      expect(placesAttempt(result).verificationDecision).not.toBe('VERIFIED');
      expect(catalog.upsertGeoEntityWithIdentities).not.toHaveBeenCalled();
    });
  });

  describe('trusted-observation reuse keeps declared cross-identities', () => {
    it('a Geoapify observation whose details declare the OSM node converges with a later Nominatim acquisition of that node', async () => {
      const { service, placesApi, catalog } = build({
        details: {
          'obs-farmacia': {
            id: 'obs-farmacia',
            displayName: { text: 'Farmacia de la Estrella' },
            sourceIdentities: [
              { provider: 'openstreetmap', externalId: 'osm:node:3348573778' },
            ],
          },
        },
        nominatimResults: [
          {
            osmType: 'node',
            osmId: 3348573778,
            class: 'amenity',
            type: 'pharmacy',
            addresstype: 'amenity',
            displayName:
              'Farmacia de la Estrella, Defensa, Monserrat, Buenos Aires, Argentina',
            importance: 0.1,
            latitude: -34.6101871,
            longitude: -58.3721455,
            address: {},
          },
        ],
      });

      const result = await service.resolve({
        destinationName: 'Buenos Aires, Argentina',
        destinationCountryCode: 'AR',
        geographicScope: DESTINATION,
        candidates: withDefaultGeographicAuthorization([
          placeCandidate('Farmacia la Estrella'),
        ]),
        evidence: [
          {
            key: 'ev-1',
            source: 'web',
            title: 'Buenos Aires',
            snippet: 'Farmacia la Estrella in Buenos Aires',
          },
        ],
        observations: [
          {
            provider: 'geoapify',
            externalId: 'obs-farmacia',
            title: 'Farmacia la Estrella',
            evidenceType: 'place',
            evidenceKey: 'ev-1',
            geo: { latitude: -34.6102605, longitude: -58.3721513 },
            originationCapabilities: [],
          },
        ],
      } as any);

      const attempts = componentAudit(result).attempts;
      const reuse = attempts.find(
        (a: any) => a.strategy === 'TRUSTED_OBSERVATION_REUSE',
      );
      expect(reuse.selectedCandidate.identities).toEqual([
        { provider: 'geoapify', externalId: 'geoapify:obs-farmacia' },
        { provider: 'openstreetmap', externalId: 'osm:node:3348573778' },
      ]);
      const nominatimAttempt = attempts.find(
        (a: any) => a.strategy === 'NOMINATIM',
      );
      expect(nominatimAttempt.identityEvidence).toContainEqual({
        type: 'IDENTITY_CONVERGENCE',
        priorStrategy: 'TRUSTED_OBSERVATION_REUSE',
        identity: {
          provider: 'openstreetmap',
          externalId: 'osm:node:3348573778',
        },
      });
      expect(nominatimAttempt.verificationDecision).toBe('VERIFIED');
      expect(placesApi.searchText).not.toHaveBeenCalled();
      expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openstreetmap',
          externalId: 'osm:node:3348573778',
        }),
      );
    });
  });

  describe('Nominatim PLACE candidates answer to the same destination policy', () => {
    it('never verifies the same-name Ramos Mejía gallery Nominatim returns as its only exact match (live COLD false positive)', async () => {
      const { service, catalog } = build({
        nominatimResults: [
          {
            osmType: 'way',
            osmId: 1,
            class: 'shop',
            type: 'mall',
            addresstype: 'shop',
            displayName:
              'Galería Güemes, Ramos Mejía, Partido de La Matanza, Buenos Aires, Argentina',
            importance: 0.1,
            latitude: -34.6397571,
            longitude: -58.5657864,
            address: {},
          },
        ],
      });

      const result = await resolveHint(service, 'Galería Güemes');

      const nominatimAttempt = componentAudit(result).attempts.find(
        (a: any) => a.strategy === 'NOMINATIM',
      );
      expect(nominatimAttempt.candidateAcquired).toBe(false);
      expect(nominatimAttempt.destinationCompatibility).toEqual({
        verdict: 'INCOMPATIBLE',
        reason: 'OUTSIDE_DESTINATION_BOUNDARY',
      });
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
      expect(resolvedEntity(result)).toMatchObject({
        status: 'unresolved',
        reason: 'DESTINATION_INCOMPATIBLE',
      });
    });
  });

  describe('Nominatim identity namespace (acquisition strategy != identity provider)', () => {
    it('a Nominatim PLACE candidate is an openstreetmap identity; the attempt still records Nominatim as the acquisition provider', async () => {
      const { service, catalog } = build({
        nominatimResults: [
          {
            osmType: 'node',
            osmId: 42,
            class: 'tourism',
            type: 'museum',
            addresstype: 'tourism',
            displayName: 'Casa Mínima, San Telmo, Buenos Aires, Argentina',
            importance: 0.2,
            latitude: -34.6212,
            longitude: -58.3718,
            address: {},
          },
        ],
      });

      const result = await resolveHint(service, 'Casa Mínima');

      const nominatimAttempt = componentAudit(result).attempts.find(
        (a: any) => a.strategy === 'NOMINATIM',
      );
      expect(nominatimAttempt.provider).toBe('nominatim');
      expect(nominatimAttempt.verificationDecision).toBe('VERIFIED');
      expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openstreetmap',
          externalId: 'osm:node:42',
        }),
      );
    });
  });

  /**
   * Verified hint memory: the exact hint text is remembered on the canonical
   * GeoEntity ONLY after a VERIFIED external resolution, and a later
   * request with the same text reuses it catalog-first even when the text
   * differs from the canonical name. Never inferred from similarity.
   */
  describe('verified hint memory', () => {
    const NOMINATIM_FARMACIA = {
      osmType: 'node',
      osmId: 3348573778,
      class: 'amenity',
      type: 'pharmacy',
      addresstype: 'amenity',
      displayName:
        'Farmacia de la Estrella, 201, Defensa, Monserrat, Buenos Aires, Argentina',
      importance: 0.1,
      latitude: -34.6101871,
      longitude: -58.3721455,
      address: { city: 'Buenos Aires', country: 'Argentina' },
    };
    const farmaciaCold = (extra: Parameters<typeof build>[0] = {}) =>
      build({
        nominatimResults: [NOMINATIM_FARMACIA],
        searchResults: [FARMACIA],
        details: {
          'geo-farmacia-search': {
            id: 'geo-farmacia-details',
            sourceIdentities: [
              { provider: 'openstreetmap', externalId: 'osm:node:3348573778' },
            ],
          },
        },
        ...extra,
      });
    const catalogRow = (
      geoEntityId: string,
      name: string,
      matchKind: CatalogGeoEntityCandidate['matchKind'],
    ): CatalogGeoEntityCandidate => ({
      geoEntityId,
      name,
      kind: GeoEntityKind.PLACE,
      latitude: -34.6102605,
      longitude: -58.3721513,
      geometry: { type: 'Point', coordinates: [-58.3721513, -34.6102605] },
      address: null,
      identities: [
        { provider: 'openstreetmap', externalId: `osm:node:${geoEntityId}` },
      ],
      matchKind,
    });
    const expectNoProviderCall = (built: ReturnType<typeof build>) => {
      expect(built.placesApi.searchText).not.toHaveBeenCalled();
      expect(built.placesApi.getPlaceDetails).not.toHaveBeenCalled();
      expect(built.nominatim.search).not.toHaveBeenCalled();
      expect(built.wikidata.getEntitySummaries).not.toHaveBeenCalled();
      expect(built.wikidata.findNearbyPlaces).not.toHaveBeenCalled();
      expect(built.osmPlaces.lookupPoisWithin).not.toHaveBeenCalled();
      expect(built.osmPlaces.lookupPoisNear).not.toHaveBeenCalled();
    };

    it('COLD: remembers the verbatim hint on the canonical GeoEntity only after the VERIFIED resolution', async () => {
      const { service, catalog } = farmaciaCold();

      const result = await resolveHint(service, 'Farmacia la Estrella');

      expect(componentAudit(result).finalStatus).toBe('resolved');
      expect(catalog.rememberVerifiedHintName).toHaveBeenCalledTimes(1);
      expect(catalog.rememberVerifiedHintName).toHaveBeenCalledWith(
        'geo-place',
        'Farmacia la Estrella',
      );
      // Written after persistence established the canonical GeoEntity.
      expect(
        catalog.upsertGeoEntityWithIdentities.mock.invocationCallOrder[0],
      ).toBeLessThan(
        catalog.rememberVerifiedHintName.mock.invocationCallOrder[0],
      );
      expect(componentAudit(result).verifiedHintMemory).toBe('REMEMBERED');
    });

    it('records an idempotent re-remember as ALREADY_REMEMBERED', async () => {
      const { service } = farmaciaCold({
        rememberVerifiedHintName: jest
          .fn()
          .mockResolvedValue('ALREADY_REMEMBERED'),
      });

      const result = await resolveHint(service, 'Farmacia la Estrella');

      expect(componentAudit(result).verifiedHintMemory).toBe(
        'ALREADY_REMEMBERED',
      );
    });

    it('does not remember a hint that fails closed (only candidate outside the destination -- "Galería Güemes")', async () => {
      const { service, catalog } = build({
        searchResults: [
          place(
            'ramos',
            'Galería Güemes',
            -34.6398,
            -58.5658,
            'point_of_interest',
          ),
        ],
      });

      const result = await resolveHint(service, 'Galería Güemes');

      expect(componentAudit(result).finalStatus).toBe('unresolved');
      expect(catalog.rememberVerifiedHintName).not.toHaveBeenCalled();
      expect(componentAudit(result).verifiedHintMemory).toBeUndefined();
    });

    it('does not remember a REJECTED candidate (PLACES alone, no convergence -- Farmacia without Nominatim)', async () => {
      const { service, catalog } = farmaciaCold({ nominatimResults: [] });

      const result = await resolveHint(service, 'Farmacia la Estrella');

      expect(placesAttempt(result).verificationDecision).not.toBe('VERIFIED');
      expect(componentAudit(result).finalStatus).toBe('unresolved');
      expect(catalog.rememberVerifiedHintName).not.toHaveBeenCalled();
    });

    it('does not remember an AMBIGUOUS hint (two in-destination same-name results)', async () => {
      const { service, catalog } = build({
        searchResults: [
          place('a', 'San José', -34.61, -58.38, 'point_of_interest'),
          place('b', 'San José', -34.6, -58.42, 'point_of_interest'),
        ],
      });

      const result = await resolveHint(service, 'San José');

      expect(placesAttempt(result).verificationDecision).toBe('AMBIGUOUS');
      expect(componentAudit(result).finalStatus).toBe('unresolved');
      expect(catalog.rememberVerifiedHintName).not.toHaveBeenCalled();
    });

    it('does not remember a VERIFIED candidate whose persistence hit IDENTITY_CONFLICT', async () => {
      const { service, catalog } = farmaciaCold({
        upsertWithIdentitiesResult: {
          status: 'IDENTITY_CONFLICT',
          conflictingGeoEntityIds: ['geo-a', 'geo-b'],
        },
      });

      const result = await resolveHint(service, 'Farmacia la Estrella');

      expect(componentAudit(result).finalStatus).toBe('unresolved');
      expect(catalog.rememberVerifiedHintName).not.toHaveBeenCalled();
    });

    it('a failed memory write never fails the resolution (recorded as FAILED)', async () => {
      const { service } = farmaciaCold({
        rememberVerifiedHintName: jest
          .fn()
          .mockRejectedValue(new Error('connection reset')),
      });

      const result = await resolveHint(service, 'Farmacia la Estrella');

      expect(componentAudit(result).finalStatus).toBe('resolved');
      expect(resolvedEntity(result).geoEntityId).toBe('geo-place');
      expect(componentAudit(result).verifiedHintMemory).toBe('FAILED');
    });

    it('WARM: a single verified-hint catalog match is CATALOG_REUSE of the same GeoEntity with zero provider calls and no re-write', async () => {
      const built = build({
        catalogCandidates: [
          catalogRow(
            'geo-farmacia',
            'Farmacia de la Estrella',
            'VERIFIED_HINT',
          ),
        ],
      });

      const result = await resolveHint(built.service, 'Farmacia la Estrella');

      const audit = componentAudit(result);
      expect(audit.attempts.map((a: any) => a.strategy)).toEqual([
        'CATALOG_REUSE',
      ]);
      expect(audit.attempts[0]).toMatchObject({
        query: 'Farmacia la Estrella',
        verificationDecision: 'VERIFIED',
        selectedCandidate: { canonicalName: 'Farmacia de la Estrella' },
      });
      expect(audit.attempts[0].identityEvidence).toEqual([
        {
          type: 'CATALOG_VERIFIED_HINT_MATCH',
          verifiedHintKey: 'farmacia la estrella',
          identityMultiplicity: 'SINGLE',
        },
        { type: 'GEOGRAPHIC_CORRESPONDENCE', basis: 'BOUNDED_ADMISSION_SCOPE' },
      ]);
      expect(audit.resolvedGeoEntity).toMatchObject({
        geoEntityId: 'geo-farmacia',
        canonicalName: 'Farmacia de la Estrella',
      });
      expectNoProviderCall(built);
      expect(built.catalog.upsertGeoEntity).not.toHaveBeenCalled();
      expect(
        built.catalog.upsertGeoEntityWithIdentities,
      ).not.toHaveBeenCalled();
      expect(built.catalog.rememberVerifiedHintName).not.toHaveBeenCalled();
    });

    it('verified-hint MULTIPLE stays ambiguous: no winner, falls through to bounded external acquisition', async () => {
      const built = build({
        catalogCandidates: [
          catalogRow('geo-sj-1', 'Parroquia San José', 'VERIFIED_HINT'),
          catalogRow('geo-sj-2', 'Colegio San José', 'VERIFIED_HINT'),
        ],
      });

      const result = await resolveHint(built.service, 'San José');

      const audit = componentAudit(result);
      expect(audit.attempts[0]).toMatchObject({
        strategy: 'CATALOG_REUSE',
        poolCandidateCount: 2,
        candidateAcquired: false,
      });
      expect(audit.attempts[0].verificationDecision).toBeUndefined();
      expect(audit.attempts.length).toBeGreaterThan(1);
      expect(built.placesApi.searchText).toHaveBeenCalled();
      expect(audit.finalStatus).toBe('unresolved');
    });

    it('a canonical-name match and a different verified-hint match together are ambiguous too', async () => {
      const built = build({
        catalogCandidates: [
          catalogRow('geo-sj-1', 'San José', 'CANONICAL_NAME'),
          catalogRow('geo-sj-2', 'Colegio San José', 'VERIFIED_HINT'),
        ],
      });

      const result = await resolveHint(built.service, 'San José');

      expect(componentAudit(result).attempts[0]).toMatchObject({
        strategy: 'CATALOG_REUSE',
        poolCandidateCount: 2,
      });
      expect(built.placesApi.searchText).toHaveBeenCalled();
    });

    it('exact canonical-name reuse is unchanged: EXACT_NAME(SINGLE), zero provider calls, nothing remembered', async () => {
      const built = build({
        catalogCandidates: [
          catalogRow('geo-casa', 'Casa Mínima', 'CANONICAL_NAME'),
        ],
      });

      const result = await resolveHint(built.service, 'Casa Mínima');

      const audit = componentAudit(result);
      expect(audit.attempts).toHaveLength(1);
      expect(audit.attempts[0].identityEvidence).toEqual([
        { type: 'EXACT_NAME', identityMultiplicity: 'SINGLE' },
        // Buenos Aires is a bounded admission scope (P0.2).
        { type: 'GEOGRAPHIC_CORRESPONDENCE', basis: 'BOUNDED_ADMISSION_SCOPE' },
      ]);
      expect(audit.attempts[0].verificationDecision).toBe('VERIFIED');
      expect(audit.resolvedGeoEntity.geoEntityId).toBe('geo-casa');
      expectNoProviderCall(built);
      expect(built.catalog.rememberVerifiedHintName).not.toHaveBeenCalled();
    });
  });
});

describe('ExperienceProposalResolverService -- candidate-scoped geographic authorization (matrix L/M)', () => {
  const twoVenueCandidate = (name: string, hintNames: [string, string]) => ({
    name,
    themes: ['wine'],
    traits: [] as string[],
    intents: [] as string[],
    componentHints: hintNames.map((hintName, index) => ({
      key: `${name}-${index}`,
      name: hintName,
      role: 'venue' as const,
      expectedKind: 'PLACE' as const,
      evidenceKeys: ['ev-1'],
    })),
    evidenceKeys: ['ev-1'],
    shortReason: 'source-backed multi-stop experience',
  });
  const evidence = (names: string[]) => [
    {
      key: 'ev-1',
      source: 'web',
      title: 'Buenos Aires itinerary',
      snippet: `${names.join(', ')} in Buenos Aires`,
    },
  ];
  // The destination window: the bounding-box covering circle of the
  // destination polygon (spec 2026-10-02 Part II §P2-10), never 50/80 km.
  const destinationWindow = geographicScopeSearchWindow(
    DESTINATION,
    'DESTINATION_AREA',
  )!;
  const searchCircleFor = (
    placesApi: ReturnType<typeof build>['placesApi'],
    hintName: string,
  ) =>
    placesApi.searchText.mock.calls.find(
      ([params]: any[]) => params.textQuery === hintName,
    )?.[0].locationBias;

  it('G: without a verified candidate-owned scope, ROUTE_LIKE and DEFAULT candidates both search the destination window derived from its polygon -- no ROUTE_SCALE circle, no 50 km plausibility radius', async () => {
    const { service, placesApi } = build({ searchResults: [] });
    const routeCandidate = twoVenueCandidate('Wine road', [
      'Bodega Uno',
      'Bodega Dos',
    ]);
    const defaultCandidate = placeCandidate('Farmacia la Estrella');

    const result = await service.resolve({
      destinationName: 'Buenos Aires, Argentina',
      destinationCountryCode: 'AR',
      geographicScope: DESTINATION,
      candidates: [
        {
          candidate: routeCandidate,
          geographicAuthorization: ownedAuthorization('route_like'),
        },
        {
          candidate: defaultCandidate,
          geographicAuthorization: { kind: 'DEFAULT' },
        },
      ],
      evidence: evidence(['Bodega Uno', 'Bodega Dos', 'Farmacia la Estrella']),
    });

    expect(destinationWindow.radiusMeters).toBeLessThan(50_000);
    for (const hintName of [
      'Bodega Uno',
      'Bodega Dos',
      'Farmacia la Estrella',
    ]) {
      expect(searchCircleFor(placesApi, hintName)).toEqual({
        center: destinationWindow.center,
        radius: destinationWindow.radiusMeters,
      });
    }
    const windows = result.entityResolution.forensicAudit.map((audit) =>
      audit.componentAudits.map(
        (component) =>
          component.attempts.find((attempt) => attempt.strategy === 'PLACES')
            ?.placeSearch?.searchWindow?.provenance,
      ),
    );
    expect(windows).toEqual([
      ['DESTINATION_AREA', 'DESTINATION_AREA'],
      ['DESTINATION_AREA'],
    ]);
    expect(
      result.entityResolution.forensicAudit[0].componentSearchScope,
    ).toEqual({
      kind: 'AREA',
      provenance: 'DESTINATION_AREA',
      name: 'Buenos Aires',
    });
  });

  it('E/§P2-18: a place 70 km out is never admitted by a destination-centroid radius, and a Places search (no country bound) never admits it beyond the destination; the unresolved component is an IDENTITY blocker, never GEOGRAPHIC_SCOPE_UNKNOWN for a missing AREA', async () => {
    const farWinery = place(
      'geo-far-winery',
      'Bodega Lejana',
      -35.1,
      -58.9,
      'point_of_interest',
    );
    const resolveFar = (authorization: any) => {
      const built = build({ searchResults: [farWinery] });
      return built.service.resolve({
        destinationName: 'Buenos Aires, Argentina',
        destinationCountryCode: 'AR',
        geographicScope: DESTINATION,
        candidates: [
          {
            candidate: twoVenueCandidate('Far road', [
              'Bodega Lejana',
              'Bodega Lejana Dos',
            ]),
            geographicAuthorization: authorization,
          },
        ],
        evidence: evidence(['Bodega Lejana', 'Bodega Lejana Dos']),
      });
    };
    const placesAttemptOf = (result: any) =>
      result.entityResolution.forensicAudit[0].componentAudits[0].attempts.find(
        (attempt: any) => attempt.strategy === 'PLACES',
      );

    for (const authorization of [
      ownedAuthorization('route_like'),
      { kind: 'DEFAULT' },
    ]) {
      const result = await resolveFar(authorization);
      expect(placesAttemptOf(result)?.placeSearch?.viableCount).toBe(0);
      expect(placesAttemptOf(result)?.placeSearch?.rejected).toEqual([
        expect.objectContaining({
          reason: 'DESTINATION_INCOMPATIBLE',
          destinationReason: 'OUTSIDE_DESTINATION_BOUNDARY',
        }),
      ]);
      expect(result.resolved[0].status).toBe('rejected');
      expect(result.resolved[0].rejectionReasons).not.toContain(
        'GEOGRAPHIC_SCOPE_UNKNOWN',
      );
    }
  });

  it('M: one batch with ROUTE_LIKE, DEFAULT and WALK candidates applies each its own policy -- authorization never selects a radius', async () => {
    const { service, placesApi } = build({ searchResults: [] });
    const a = twoVenueCandidate('A route', ['Alpha One', 'Alpha Two']);
    const b = placeCandidate('Bravo');
    const c = twoVenueCandidate('C walk', ['Charlie One', 'Charlie Two']);

    const result = await service.resolve({
      destinationName: 'Buenos Aires, Argentina',
      destinationCountryCode: 'AR',
      geographicScope: DESTINATION,
      candidates: [
        {
          candidate: a,
          geographicAuthorization: ownedAuthorization('route_like'),
        },
        { candidate: b, geographicAuthorization: { kind: 'DEFAULT' } },
        {
          candidate: c,
          geographicAuthorization: ownedAuthorization(
            'walk',
            'AREA_ROUTE_WALK',
          ),
        },
      ],
      evidence: evidence([
        'Alpha One',
        'Alpha Two',
        'Bravo',
        'Charlie One',
        'Charlie Two',
      ]),
    });

    const radiusOf = (hintName: string) =>
      searchCircleFor(placesApi, hintName)?.radius;
    for (const hintName of [
      'Alpha One',
      'Alpha Two',
      'Bravo',
      'Charlie One',
      'Charlie Two',
    ]) {
      expect(radiusOf(hintName)).toBe(destinationWindow.radiusMeters);
    }

    expect(
      result.entityResolution.forensicAudit.map(
        (audit) => audit.geographicAuthorization.kind,
      ),
    ).toEqual(['ROUTE_LIKE', 'DEFAULT', 'WALK']);
    expect(result.resolved.map((r) => r.geographicAuthorization?.kind)).toEqual(
      ['ROUTE_LIKE', 'DEFAULT', 'WALK'],
    );
  });

  it("M: geographic validation receives each accepted candidate's OWN authorization", async () => {
    const { service } = build({ searchResults: [] });
    const validator = (service as any).geographicValidator;
    // Accept every candidate at identity time so all reach validation.
    jest
      .spyOn(service as any, 'resolveCandidate')
      .mockImplementation(async (candidate: any, ...rest: any[]) => {
        // (boundary, getPoiLookup, entityResolutionScope, destinationScope,
        //  destinationName, evidence, countryCode, observations, AUTHORIZATION,
        //  workUnitScope)
        const authorization = rest[8];
        return {
          resolved: {
            candidate,
            status: 'accepted',
            resolvedEntities: [],
            rejectionReasons: [],
          },
          audit: {
            candidateTraceKey: candidate.name,
            candidateName: candidate.name,
            candidateEvidenceKeys: [],
            candidateHintKeys: [],
            componentAudits: [],
            geographicAuthorization: authorization,
          },
        };
      });
    validator.validate.mockReturnValue({
      accepted: false,
      rejectionReasons: ['x'],
    });
    const routeAuthorization = ownedAuthorization('route_like');
    const walkAuthorization = ownedAuthorization('walk', 'AREA_ROUTE_WALK');

    await service.resolve({
      destinationName: 'Buenos Aires, Argentina',
      geographicScope: DESTINATION,
      candidates: [
        {
          candidate: twoVenueCandidate('A route', ['Alpha One', 'Alpha Two']),
          geographicAuthorization: routeAuthorization,
        },
        {
          candidate: placeCandidate('Bravo'),
          geographicAuthorization: { kind: 'DEFAULT' },
        },
        {
          candidate: twoVenueCandidate('C walk', [
            'Charlie One',
            'Charlie Two',
          ]),
          geographicAuthorization: walkAuthorization,
        },
      ],
      evidence: evidence(['Alpha One', 'Bravo', 'Charlie One']),
    });

    expect(
      validator.validate.mock.calls.map(
        ([resolved, , , authorization]: any[]) => [
          resolved.candidate.name,
          authorization,
        ],
      ),
    ).toEqual([
      ['A route', routeAuthorization],
      ['Bravo visit', { kind: 'DEFAULT' }],
      ['C walk', walkAuthorization],
    ]);
  });
});
