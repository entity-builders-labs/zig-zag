import { GeoEntityKind } from '@prisma/client';
import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';
import { ExperienceGeographicValidationResult } from '../interfaces/experience-resolution.interface';
import { ExperienceProposalResolverService } from './experience-proposal-resolver.service';

describe('ExperienceProposalResolverService', () => {
  const boundary: any = {
    id: 'osm:relation:1',
    name: 'Buenos Aires',
    osmType: 'relation',
    osmId: 1,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-58.55, -34.7],
          [-58.3, -34.7],
          [-58.3, -34.45],
          [-58.55, -34.45],
          [-58.55, -34.7],
        ],
      ],
    },
    tags: { boundary: 'administrative' },
  };

  const candidate = (
    name = 'Visit Museum',
    componentName = 'Museum',
    intents: string[] = ['visit'],
  ): ExperienceCandidate => ({
    name,
    themes: ['culture'],
    traits: [],
    intents,
    componentHints: [
      {
        key: 'place',
        name: componentName,
        role: 'venue',
        expectedKind: 'PLACE',
        required: true,
        evidenceKeys: ['ev-1'],
      },
    ],
    evidenceKeys: ['ev-1'],
    shortReason: 'Evidence-backed experience',
  });

  const acceptedValidation = (
    proposalName = 'Visit Museum',
  ): ExperienceGeographicValidationResult => ({
    proposalName,
    kind: 'EXPERIENCE',
    status: 'GEO_VERIFIED',
    accepted: true,
    strategy: 'venue_centric',
    anchors: [],
    groundedEvidenceKeys: ['ev-1'],
    rejectionReasons: [],
    validatorVersion: 2,
  });

  it('uses destinationBoundary from the canonical request object', async () => {
    const osmPlaces = {
      lookupStreetsWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisWithin: jest.fn().mockResolvedValue({
        status: 'success',
        value: [
          {
            id: 'osm:node:10',
            name: 'Museum',
            osmType: 'node',
            osmId: 10,
            geometry: { type: 'Point', coordinates: [-58.45, -34.55] },
            tags: { tourism: 'museum' },
          },
        ],
      }),
    };
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-10' }),
      persistVerifiedExperience: jest.fn().mockResolvedValue({
        id: 'exp-10',
        dedupeDecision: 'NEW',
      }),
    };
    const geographicValidator = {
      validate: jest.fn().mockReturnValue(acceptedValidation()),
    };
    const service = new ExperienceProposalResolverService(
      osmPlaces as any,
      catalog as any,
      geographicValidator as any,
    );

    const result = await service.resolve({
      destinationName: 'Buenos Aires',
      destinationBoundary: boundary,
      candidates: [candidate()],
    });

    expect(osmPlaces.lookupPoisWithin).toHaveBeenCalledWith(boundary);
    expect(geographicValidator.validate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'accepted' }),
      boundary,
    );
    expect(result.acceptedCount).toBe(1);
    expect(result.resolved[0].experienceId).toBe('exp-10');
    expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
      expect.objectContaining({ kind: GeoEntityKind.PLACE }),
    );
  });

  it('resolves candidate traits into traitDefinitionIds and threads them into persistence (CP3-3)', async () => {
    const osmPlaces = {
      lookupStreetsWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisWithin: jest.fn().mockResolvedValue({
        status: 'success',
        value: [
          {
            id: 'osm:node:10',
            name: 'Museum',
            osmType: 'node',
            osmId: 10,
            geometry: { type: 'Point', coordinates: [-58.45, -34.55] },
            tags: {},
          },
        ],
      }),
    };
    const catalog = {
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-10' }),
      resolveOrCreateTraitDefinitions: jest
        .fn()
        .mockResolvedValue(['trait-romantic', 'trait-family-friendly']),
      persistVerifiedExperience: jest.fn().mockResolvedValue({
        id: 'exp-traits',
        dedupeDecision: 'NEW',
      }),
    };
    const geographicValidator = {
      validate: jest.fn().mockReturnValue(acceptedValidation()),
    };
    const service = new ExperienceProposalResolverService(
      osmPlaces as any,
      catalog as any,
      geographicValidator as any,
    );

    const withTraits = candidate();
    withTraits.traits = ['romantic', 'family-friendly'];

    await service.resolve({
      destinationBoundary: boundary,
      candidates: [withTraits],
    });

    expect(catalog.resolveOrCreateTraitDefinitions).toHaveBeenCalledWith([
      'romantic',
      'family-friendly',
    ]);
    expect(catalog.persistVerifiedExperience).toHaveBeenCalledWith(
      expect.objectContaining({
        traitDefinitionIds: ['trait-romantic', 'trait-family-friendly'],
      }),
    );
  });

  it('persists component order as null when the candidate has no order evidence (CP3-2)', async () => {
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest
        .fn()
        .mockResolvedValueOnce({ id: 'geo-a' })
        .mockResolvedValueOnce({ id: 'geo-b' }),
      persistVerifiedExperience: jest.fn().mockResolvedValue({
        id: 'exp-multi',
        dedupeDecision: 'NEW',
      }),
    };
    const geographicValidator = {
      validate: jest.fn().mockReturnValue(acceptedValidation('Two stops')),
    };
    const service = new ExperienceProposalResolverService(
      {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:1',
              name: 'Stop A',
              osmType: 'node',
              osmId: 1,
              geometry: { type: 'Point', coordinates: [-58.45, -34.55] },
              tags: {},
            },
            {
              id: 'osm:node:2',
              name: 'Stop B',
              osmType: 'node',
              osmId: 2,
              geometry: { type: 'Point', coordinates: [-58.46, -34.56] },
              tags: {},
            },
          ],
        }),
      } as any,
      catalog as any,
      geographicValidator as any,
    );

    const twoStopCandidate: ExperienceCandidate = {
      name: 'Two stops',
      themes: ['culture'],
      traits: [],
      intents: ['walk'],
      evidenceKeys: ['ev-1'],
      shortReason: 'no sequence evidence',
      // orderedByEvidence intentionally omitted — must persist order: null.
      componentHints: [
        {
          key: 'a',
          name: 'Stop A',
          role: 'waypoint',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['ev-1'],
        },
        {
          key: 'b',
          name: 'Stop B',
          role: 'waypoint',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ],
    };

    await service.resolve({
      destinationBoundary: boundary,
      candidates: [twoStopCandidate],
    });

    expect(catalog.persistVerifiedExperience).toHaveBeenCalledWith(
      expect.objectContaining({
        components: [
          expect.objectContaining({ geoEntityId: 'geo-a', order: null }),
          expect.objectContaining({ geoEntityId: 'geo-b', order: null }),
        ],
      }),
    );
  });

  it('persists sequential component order when the candidate has real order evidence (CP3-2)', async () => {
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest
        .fn()
        .mockResolvedValueOnce({ id: 'geo-a' })
        .mockResolvedValueOnce({ id: 'geo-b' }),
      persistVerifiedExperience: jest.fn().mockResolvedValue({
        id: 'exp-multi-ordered',
        dedupeDecision: 'NEW',
      }),
    };
    const geographicValidator = {
      validate: jest
        .fn()
        .mockReturnValue(acceptedValidation('Two ordered stops')),
    };
    const service = new ExperienceProposalResolverService(
      {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:1',
              name: 'Stop A',
              osmType: 'node',
              osmId: 1,
              geometry: { type: 'Point', coordinates: [-58.45, -34.55] },
              tags: {},
            },
            {
              id: 'osm:node:2',
              name: 'Stop B',
              osmType: 'node',
              osmId: 2,
              geometry: { type: 'Point', coordinates: [-58.46, -34.56] },
              tags: {},
            },
          ],
        }),
      } as any,
      catalog as any,
      geographicValidator as any,
    );

    const orderedCandidate: ExperienceCandidate = {
      name: 'Two ordered stops',
      themes: ['culture'],
      traits: [],
      intents: ['walk'],
      evidenceKeys: ['ev-1'],
      shortReason: 'evidence: "start at Stop A, then walk to Stop B"',
      orderedByEvidence: true,
      componentHints: [
        {
          key: 'a',
          name: 'Stop A',
          role: 'waypoint',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['ev-1'],
        },
        {
          key: 'b',
          name: 'Stop B',
          role: 'waypoint',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ],
    };

    await service.resolve({
      destinationBoundary: boundary,
      candidates: [orderedCandidate],
    });

    expect(catalog.persistVerifiedExperience).toHaveBeenCalledWith(
      expect.objectContaining({
        components: [
          expect.objectContaining({ geoEntityId: 'geo-a', order: 1 }),
          expect.objectContaining({ geoEntityId: 'geo-b', order: 2 }),
        ],
      }),
    );
  });

  it('resolves an evidence-associated Experience outside the base destination and validates its own geo scope', async () => {
    const osmPlaces = {
      lookupStreetsWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupBoundaryById: jest.fn(),
    };
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-tigre' }),
      persistVerifiedExperience: jest.fn().mockResolvedValue({
        id: 'exp-tigre',
        dedupeDecision: 'NEW',
      }),
    };
    const geographicValidator = {
      validate: jest
        .fn()
        .mockReturnValue(acceptedValidation('Tigre Delta day trip')),
    };
    const nominatim = {
      search: jest.fn().mockResolvedValue([
        {
          osmType: 'node',
          osmId: 77,
          addresstype: 'town',
          displayName: 'Tigre, Buenos Aires, Argentina',
          importance: 0.8,
          latitude: -34.425,
          longitude: -58.579,
          address: {
            town: 'Tigre',
            state: 'Buenos Aires',
            country: 'Argentina',
          },
        },
      ]),
    };
    const service = new ExperienceProposalResolverService(
      osmPlaces as any,
      catalog as any,
      geographicValidator as any,
      undefined,
      nominatim as any,
    );

    const result = await service.resolve({
      destinationName: 'Buenos Aires',
      destinationBoundary: boundary,
      candidates: [candidate('Tigre Delta day trip', 'Tigre', ['day_trip'])],
      evidence: [
        {
          key: 'ev-1',
          source: 'tourism-guide',
          title: 'Best day trips from Buenos Aires',
          snippet:
            'Tigre and its delta are a classic same-day escape from Buenos Aires.',
        },
      ],
    });

    expect(nominatim.search).toHaveBeenCalledWith('Tigre', undefined);
    expect(result.acceptedCount).toBe(1);
    expect(result.resolved[0]).toMatchObject({
      experienceId: 'exp-tigre',
      destinationAssociationVerified: true,
    });
    expect(catalog.persistVerifiedExperience).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ intents: ['day_trip'] }),
      }),
    );
    expect(geographicValidator.validate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tags: expect.objectContaining({
          validation_scope: 'grounded_destination_association',
        }),
      }),
    );
  });

  it("resolves a global hint whose grounded-evidence name is a translated form of Nominatim's canonical name, not an exact literal prefix", async () => {
    // Real-world regression: Argentina's OSM/Nominatim data names this park
    // in Spanish ("Parque Provincial Ischigualasto"), while English-language
    // grounded search evidence — and the LLM extracting from it — surfaces
    // the English form ("Ischigualasto Provincial Park"). The old exact
    // literal-prefix check silently discarded this single, unambiguous,
    // high-importance Nominatim result just because "Park" never literally
    // becomes "Parque".
    const osmPlaces = {
      lookupStreetsWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupBoundaryById: jest.fn(),
    };
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-ischigualasto' }),
      persistVerifiedExperience: jest.fn().mockResolvedValue({
        id: 'exp-ischigualasto',
        dedupeDecision: 'NEW',
      }),
    };
    const geographicValidator = {
      validate: jest
        .fn()
        .mockReturnValue(
          acceptedValidation(
            'Ischigualasto Provincial Park - Valle de la Luna Full-Day Tour',
          ),
        ),
    };
    const nominatim = {
      search: jest.fn().mockResolvedValue([
        {
          osmType: 'relation',
          osmId: 3290015,
          addresstype: 'protected_area',
          displayName:
            'Parque Provincial Ischigualasto, Valle Fértil, San Juan, Argentina',
          importance: 0.43,
          latitude: -30.0694429,
          longitude: -67.9849624,
          address: { state: 'San Juan', country: 'Argentina' },
        },
      ]),
    };
    const service = new ExperienceProposalResolverService(
      osmPlaces as any,
      catalog as any,
      geographicValidator as any,
      undefined,
      nominatim as any,
    );

    const result = await service.resolve({
      destinationName: 'San Juan, Argentina',
      destinationBoundary: boundary,
      candidates: [
        candidate(
          'Ischigualasto Provincial Park - Valle de la Luna Full-Day Tour',
          'Ischigualasto Provincial Park',
          ['day_trip'],
        ),
      ],
      evidence: [
        {
          key: 'ev-1',
          source: 'tourism-guide',
          title: 'Ischigualasto & Valle de la Luna Tour in San Juan, Argentina',
          snippet: 'A full-day tour from San Juan, Argentina.',
        },
      ],
    });

    expect(nominatim.search).toHaveBeenCalledWith(
      'Ischigualasto Provincial Park',
      undefined,
    );
    expect(result.acceptedCount).toBe(1);
    expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        latitude: -30.0694429,
        longitude: -67.9849624,
      }),
    );
  });

  it('threads destinationCountryCode into the Nominatim global-hint search', async () => {
    // Real-world regression: generic/common Spanish place names (e.g. "Cerro
    // Alcázar") can resolve to a same-named place in a completely unrelated
    // country when Nominatim's plain search has no geographic biasing —
    // verified live against the real API. destinationCountryCode restricts
    // the search to the resolved destination's own country.
    const osmPlaces = {
      lookupStreetsWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupBoundaryById: jest.fn(),
    };
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-alcazar' }),
      persistVerifiedExperience: jest.fn().mockResolvedValue({
        id: 'exp-alcazar',
        dedupeDecision: 'NEW',
      }),
    };
    const geographicValidator = {
      validate: jest.fn().mockReturnValue(acceptedValidation('Cerro Alcázar')),
    };
    const nominatim = {
      search: jest.fn().mockResolvedValue([
        {
          osmType: 'node',
          osmId: 999,
          addresstype: 'peak',
          displayName: 'Cerro Alcázar, San Juan, Argentina',
          importance: 0.3,
          latitude: -31.5,
          longitude: -68.5,
          address: { state: 'San Juan', country: 'Argentina' },
        },
      ]),
    };
    const service = new ExperienceProposalResolverService(
      osmPlaces as any,
      catalog as any,
      geographicValidator as any,
      undefined,
      nominatim as any,
    );

    await service.resolve({
      destinationName: 'San Juan, Argentina',
      destinationCountryCode: 'AR',
      destinationBoundary: boundary,
      candidates: [candidate('Cerro Alcázar hike', 'Cerro Alcázar', ['walk'])],
      evidence: [
        {
          key: 'ev-1',
          source: 'tourism-guide',
          title: 'Hiking near San Juan, Argentina',
          snippet: 'Cerro Alcázar is a popular hike near San Juan, Argentina.',
        },
      ],
    });

    expect(nominatim.search).toHaveBeenCalledWith('Cerro Alcázar', {
      countryCode: 'AR',
    });
  });

  it('prefers the Nominatim match closest to the destination over one with higher importance (same-country name collision)', async () => {
    // Real-world regression, verified live against the real Nominatim API:
    // two real places share the exact name "Catedral San Juan Bautista" —
    // one in Buenos Aires (importance 0.208), one in San Juan capital
    // (importance 0.199, the actual requested destination). Ranking by
    // importance alone (the pre-fix behavior) picks the wrong one even
    // though countryCode already narrowed correctly to Argentina. Distance
    // to the destination boundary's centroid is a far stronger signal for
    // disambiguating same-named real places than Nominatim's own global
    // popularity score.
    const sanJuanBoundary: any = {
      id: 'osm:relation:2',
      name: 'San Juan',
      osmType: 'relation',
      osmId: 2,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-68.57, -31.57],
            [-68.5, -31.57],
            [-68.5, -31.5],
            [-68.57, -31.57],
          ],
        ],
      },
      tags: { boundary: 'administrative' },
    };
    const osmPlaces = {
      lookupStreetsWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupBoundaryById: jest.fn(),
    };
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-cathedral' }),
      persistVerifiedExperience: jest.fn().mockResolvedValue({
        id: 'exp-cathedral',
        dedupeDecision: 'NEW',
      }),
    };
    const geographicValidator = {
      validate: jest
        .fn()
        .mockReturnValue(acceptedValidation('Catedral San Juan Bautista tour')),
    };
    const nominatim = {
      search: jest.fn().mockResolvedValue([
        {
          osmType: 'way',
          osmId: 111,
          addresstype: 'amenity',
          displayName:
            'Catedral San Juan Bautista, Chacarita, Buenos Aires, Argentina',
          importance: 0.208,
          latitude: -34.588,
          longitude: -58.453,
          address: { state: 'Buenos Aires', country: 'Argentina' },
        },
        {
          osmType: 'way',
          osmId: 222,
          addresstype: 'amenity',
          displayName:
            'Catedral San Juan Bautista, Capital, San Juan, Argentina',
          importance: 0.199,
          latitude: -31.537,
          longitude: -68.529,
          address: { state: 'San Juan', country: 'Argentina' },
        },
      ]),
    };
    const service = new ExperienceProposalResolverService(
      osmPlaces as any,
      catalog as any,
      geographicValidator as any,
      undefined,
      nominatim as any,
    );

    const result = await service.resolve({
      destinationName: 'San Juan, Argentina',
      destinationCountryCode: 'AR',
      destinationBoundary: sanJuanBoundary,
      candidates: [
        candidate(
          'Catedral San Juan Bautista tour',
          'Catedral San Juan Bautista',
          ['visit'],
        ),
      ],
      evidence: [
        {
          key: 'ev-1',
          source: 'tourism-guide',
          title: 'Visiting the cathedral in San Juan, Argentina',
          snippet: 'Catedral San Juan Bautista in San Juan, Argentina.',
        },
      ],
    });

    expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: -31.537, longitude: -68.529 }),
    );
    expect(result.resolved[0].resolvedEntities[0]).toMatchObject({
      latitude: -31.537,
      longitude: -68.529,
    });
  });

  it('falls back to the configured Places provider when Nominatim/OSM has no match for a PLACE hint', async () => {
    // Real-world regression, verified live: a real, well-known cathedral in
    // San Juan capital (confirmed on Google Maps) has no name tag at all in
    // OpenStreetMap at its real coordinates — Nominatim never returns it
    // under any query text. Google Places (the provider PLACES_PROVIDER
    // selects) does have it. This is the same catalog-refill IPlacesApiService
    // instance (via the generic 'PlacesApiService' token), not a bespoke
    // client, so it shares quota/caching with the rest of the app.
    const nominatim = { search: jest.fn().mockResolvedValue([]) };
    const placesApi = {
      provider: 'google' as const,
      searchText: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'ChIJcathedral123',
            displayName: { text: 'Catedral San Juan Bautista' },
            formattedAddress: 'San Juan, Argentina',
            location: { latitude: -31.5370714, longitude: -68.5286788 },
            types: ['church', 'place_of_worship'],
          },
        ],
        provenance: {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: 3,
          receivedCount: 1,
        },
      }),
    };
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-cathedral' }),
      persistVerifiedExperience: jest.fn().mockResolvedValue({
        id: 'exp-cathedral',
        dedupeDecision: 'NEW',
      }),
    };
    const geographicValidator = {
      validate: jest
        .fn()
        .mockReturnValue(acceptedValidation('Catedral San Juan Bautista tour')),
    };
    const service = new ExperienceProposalResolverService(
      {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupBoundaryById: jest.fn(),
      } as any,
      catalog as any,
      geographicValidator as any,
      undefined,
      nominatim as any,
      placesApi as any,
    );

    const result = await service.resolve({
      destinationName: 'San Juan, Argentina',
      destinationBoundary: boundary,
      candidates: [
        candidate(
          'Catedral San Juan Bautista tour',
          'Catedral San Juan Bautista',
          ['visit'],
        ),
      ],
      evidence: [
        {
          key: 'ev-1',
          source: 'tourism-guide',
          title: 'Visiting the cathedral in San Juan, Argentina',
          snippet: 'Catedral San Juan Bautista in San Juan, Argentina.',
        },
      ],
    });

    expect(placesApi.searchText).toHaveBeenCalledWith(
      expect.objectContaining({ textQuery: 'Catedral San Juan Bautista' }),
    );
    expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'google_places',
        latitude: -31.5370714,
        longitude: -68.5286788,
      }),
    );
    expect(result.acceptedCount).toBe(1);
    expect(result.resolved[0].resolvedEntities[0]).toMatchObject({
      provider: 'google_places',
      canonicalName: 'Catedral San Juan Bautista',
      latitude: -31.5370714,
      longitude: -68.5286788,
    });
  });

  it('stays unresolved (no crash) when Nominatim has no match and no Places provider is configured', async () => {
    const nominatim = { search: jest.fn().mockResolvedValue([]) };
    const service = new ExperienceProposalResolverService(
      {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupBoundaryById: jest.fn(),
      } as any,
      {} as any,
      { validate: jest.fn() } as any,
      undefined,
      nominatim as any,
      undefined,
    );

    const result = await service.resolve({
      destinationName: 'San Juan, Argentina',
      destinationBoundary: boundary,
      candidates: [
        candidate('Ghost Cathedral tour', 'Ghost Cathedral', ['visit']),
      ],
      evidence: [
        {
          key: 'ev-1',
          source: 'tourism-guide',
          title: 'Visiting San Juan, Argentina',
          snippet: 'Ghost Cathedral in San Juan, Argentina.',
        },
      ],
    });

    expect(result.acceptedCount).toBe(0);
    expect(result.resolved[0].status).toBe('rejected');
  });

  it('never resolves a global hint on a shared generic/short word alone (translation false-positive guard)', async () => {
    // "casa" overlaps but is below the 5-char anchor-token floor, and
    // "vieja" doesn't appear in the candidate result at all — this must stay
    // rejected exactly like it was before the translated-name fallback
    // existed, so the fallback never becomes a loophole for weak matches.
    const nominatim = {
      search: jest.fn().mockResolvedValue([
        {
          osmType: 'node',
          osmId: 1,
          addresstype: 'building',
          displayName: 'Casa Nueva, Somewhere Else, Argentina',
          importance: 0.9,
          latitude: -30.0,
          longitude: -68.0,
          address: {},
        },
      ]),
    };
    const service = new ExperienceProposalResolverService(
      {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:99',
              name: 'Unrelated Kiosk',
              geometry: { type: 'Point', coordinates: [-68.0, -30.0] },
              tags: {},
            },
          ],
        }),
      } as any,
      {} as any,
      { validate: jest.fn() } as any,
      undefined,
      nominatim as any,
    );

    const result = await service.resolve({
      destinationName: 'San Juan, Argentina',
      destinationBoundary: boundary,
      candidates: [candidate('Visit Casa Vieja', 'Casa Vieja')],
      evidence: [
        {
          key: 'ev-1',
          source: 'guide',
          title: 'San Juan, Argentina highlights',
          snippet: 'Casa Vieja is a historic house in San Juan, Argentina.',
        },
      ],
    });

    expect(result.acceptedCount).toBe(0);
    expect(result.resolved[0].rejectionReasons).toContain('NO_OSM_MATCH');
  });

  it('does not escape the destination boundary without evidence associating the Experience to the base', async () => {
    const nominatim = { search: jest.fn() };
    const service = new ExperienceProposalResolverService(
      {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:99',
              name: 'Different Place',
              geometry: { type: 'Point', coordinates: [-58.45, -34.55] },
              tags: {},
            },
          ],
        }),
      } as any,
      {} as any,
      { validate: jest.fn() } as any,
      undefined,
      nominatim as any,
    );

    const result = await service.resolve({
      destinationName: 'Buenos Aires',
      destinationBoundary: boundary,
      candidates: [candidate('Visit Eiffel Tower', 'Eiffel Tower')],
      evidence: [
        {
          key: 'ev-1',
          source: 'guide',
          title: 'Paris highlights',
          snippet: 'Visit the Eiffel Tower in Paris.',
        },
      ],
    });

    expect(nominatim.search).not.toHaveBeenCalled();
    expect(result.acceptedCount).toBe(0);
    expect(result.resolved[0].rejectionReasons).toContain('NO_OSM_MATCH');
  });

  it('fails explicitly when destination scope is absent', async () => {
    const service = new ExperienceProposalResolverService(
      {} as any,
      {} as any,
      {} as any,
    );
    await expect(
      service.resolve({ candidates: [], destinationBoundary: undefined }),
    ).rejects.toThrow('Experience resolution requires destinationBoundary');
  });

  it.each([
    {
      name: '429 rate limit',
      lookup: {
        status: 'failed',
        value: [],
        failureReason: '429 Too Many Requests',
      },
      expected: 'OSM_PROVIDER_FAILED',
    },
    {
      name: 'provider timeout',
      lookup: {
        status: 'failed',
        value: [],
        failureReason: 'Overpass request timed out',
      },
      expected: 'OSM_PROVIDER_FAILED',
    },
    {
      name: 'empty successful query',
      lookup: { status: 'success', value: [] },
      expected: 'OSM_QUERY_EMPTY',
    },
    {
      name: 'no matching candidate',
      lookup: {
        status: 'success',
        value: [
          {
            id: 'osm:node:99',
            name: 'Completely Different Place',
            geometry: { type: 'Point', coordinates: [-58.45, -34.55] },
            tags: {},
          },
        ],
      },
      expected: 'NO_OSM_MATCH',
    },
  ])('distinguishes OSM $name', async ({ lookup, expected }) => {
    const service = new ExperienceProposalResolverService(
      {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue(lookup),
      } as any,
      {} as any,
      { validate: jest.fn() } as any,
    );

    const result = await service.resolve({
      destinationBoundary: boundary,
      candidates: [candidate()],
    });

    expect(result.acceptedCount).toBe(0);
    expect(result.resolved[0].rejectionReasons).toContain(expected);
  });

  it('resolves AREA components against the canonical destination boundary and persists an AREA GeoEntity', async () => {
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-area-1' }),
      persistVerifiedExperience: jest.fn().mockResolvedValue({
        id: 'exp-area-1',
        dedupeDecision: 'NEW',
      }),
    };
    const geographicValidator = {
      validate: jest
        .fn()
        .mockReturnValue(acceptedValidation('Walk the historic center')),
    };
    const service = new ExperienceProposalResolverService(
      {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
      } as any,
      catalog as any,
      geographicValidator as any,
    );

    const areaCandidate: ExperienceCandidate = {
      name: 'Walk the historic center',
      themes: ['history'],
      traits: [],
      intents: ['walk'],
      evidenceKeys: ['ev-1'],
      shortReason: 'Area-bound experience',
      componentHints: [
        {
          key: 'historic-center',
          name: 'Buenos Aires',
          role: 'area',
          expectedKind: 'AREA',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ],
    };

    const result = await service.resolve({
      destinationBoundary: boundary,
      candidates: [areaCandidate],
    });

    expect(result.acceptedCount).toBe(1);
    expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: GeoEntityKind.AREA,
        externalId: boundary.id,
        geometry: boundary.geometry,
      }),
    );
  });

  it('uses GEOGRAPHIC_VALIDATION_FAILED when a resolved candidate has no validation result', async () => {
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-10' }),
      persistVerifiedExperience: jest.fn(),
    };
    const service = new ExperienceProposalResolverService(
      {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:10',
              name: 'Museum',
              geometry: { type: 'Point', coordinates: [-58.45, -34.55] },
              tags: { tourism: 'museum' },
            },
          ],
        }),
      } as any,
      catalog as any,
      { validate: jest.fn().mockReturnValue(undefined) } as any,
    );

    const result = await service.resolve({
      destinationBoundary: boundary,
      candidates: [candidate()],
    });

    expect(result.acceptedCount).toBe(0);
    expect(result.resolved[0].rejectionReasons).toEqual([
      'GEOGRAPHIC_VALIDATION_FAILED',
    ]);
    expect(catalog.persistVerifiedExperience).not.toHaveBeenCalled();
  });
});
