import { GeoEntityKind } from '@prisma/client';
import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';
import { ExperienceGeographicValidationResult } from '../interfaces/experience-resolution.interface';
import { SourceObservation } from '../interfaces/experience-acquisition.interface';
import { ExperienceProposalResolverService } from './experience-proposal-resolver.service';
import { normalizeGeoName } from '../utils/nominatim-match.util';
import { computeQualityScore } from '../utils/quality-score.util';

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

  it('uses AREA_BOUNDARY from the canonical request object', async () => {
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
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
      candidates: [candidate()],
    });

    expect(osmPlaces.lookupPoisWithin).toHaveBeenCalledWith(boundary);
    expect(geographicValidator.validate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'accepted' }),
      boundary,
      undefined,
      undefined,
      { kind: 'AREA_BOUNDARY', boundary },
    );
    expect(result.acceptedCount).toBe(1);
    expect(result.resolved[0].experienceId).toBe('exp-10');
    expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
      expect.objectContaining({ kind: GeoEntityKind.PLACE }),
    );
  });

  it('uses radius-based OSM lookups for a point-scale destination instead of "within area" (real regression: Caminito/Calle Defensa)', async () => {
    const osmPlaces = {
      lookupStreetsWithin: jest.fn(),
      lookupPoisWithin: jest.fn(),
      lookupStreetsNear: jest.fn().mockResolvedValue({
        status: 'success',
        value: [
          {
            id: 'osm:way:1',
            name: 'Caminito',
            osmType: 'way',
            osmId: 1,
            geometry: {
              type: 'LineString',
              coordinates: [
                [-58.363, -34.635],
                [-58.362, -34.634],
              ],
            },
            tags: { highway: 'pedestrian' },
          },
        ],
      }),
      lookupPoisNear: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
    };
    const routeCandidate: ExperienceCandidate = {
      name: 'Caminito Route',
      themes: ['culture'],
      traits: [],
      intents: ['walk'],
      componentHints: [
        {
          key: 'street',
          name: 'Caminito',
          role: 'route',
          expectedKind: 'ROUTE',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ],
      evidenceKeys: ['ev-1'],
      shortReason: 'A real, named pedestrian street',
    };
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-caminito' }),
      persistVerifiedExperience: jest.fn().mockResolvedValue({
        id: 'exp-caminito',
        dedupeDecision: 'NEW',
      }),
    };
    const geographicValidator = {
      validate: jest.fn().mockReturnValue(acceptedValidation('Caminito Route')),
    };
    const service = new ExperienceProposalResolverService(
      osmPlaces as any,
      catalog as any,
      geographicValidator as any,
    );

    const result = await service.resolve({
      destinationName: 'La Boca, Buenos Aires',
      geographicScope: {
        kind: 'POINT_RADIUS',
        latitude: -34.6345,
        longitude: -58.3631,
        radiusMeters: 1200,
      },
      candidates: [routeCandidate],
    });

    expect(osmPlaces.lookupStreetsNear).toHaveBeenCalledWith(
      -34.6345,
      -58.3631,
      1200,
    );
    expect(osmPlaces.lookupPoisNear).toHaveBeenCalledWith(
      -34.6345,
      -58.3631,
      1200,
    );
    expect(osmPlaces.lookupStreetsWithin).not.toHaveBeenCalled();
    expect(osmPlaces.lookupPoisWithin).not.toHaveBeenCalled();
    // ROUTE hint via POINT_RADIUS -> raw OSM ways -> identityMultiplicity
    // UNKNOWN -> no independent corroboration -> fail closed (not persisted).
    expect(result.acceptedCount).toBe(0);
    const routeAttempts =
      result.entityResolution.forensicAudit[0].componentAudits[0].attempts;
    expect(routeAttempts.map((attempt) => attempt.strategy)).toEqual([
      'LOCAL_OSM_POOL',
    ]);
    expect(routeAttempts[0]).toMatchObject({
      executionStatus: 'completed',
      candidateAcquired: true,
      poolCandidateCount: 1,
    });
  });

  it('fails closed when a raw OSM ROUTE alias matches but multiplicity is unknown', async () => {
    const osmPlaces = {
      lookupStreetsWithin: jest.fn().mockResolvedValue({
        status: 'success',
        value: [
          {
            id: 'osm:way:1',
            name: 'Defensa',
            osmType: 'way',
            osmId: 1,
            geometry: {
              type: 'LineString',
              coordinates: [
                [-58.371, -34.621],
                [-58.37, -34.62],
              ],
            },
            tags: { highway: 'pedestrian', 'name:en': 'Defensa Street' },
          },
        ],
      }),
      lookupPoisWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
    };
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest.fn(),
      persistVerifiedExperience: jest.fn(),
    };
    const service = new ExperienceProposalResolverService(
      osmPlaces as any,
      catalog as any,
      { validate: jest.fn() } as any,
    );
    const hintName = 'Defensa Street';
    const primaryName = 'Defensa';

    expect(normalizeGeoName(primaryName)).not.toBe(normalizeGeoName(hintName));

    const result = await service.resolve({
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
      candidates: [
        {
          name: 'Walk Defensa Street',
          themes: ['culture'],
          traits: [],
          intents: ['walk'],
          evidenceKeys: ['ev-1'],
          shortReason: 'Walk a named street',
          componentHints: [
            {
              key: 'defensa',
              name: hintName,
              role: 'route',
              expectedKind: 'ROUTE',
              required: true,
              evidenceKeys: ['ev-1'],
            },
          ],
        },
      ],
    });

    expect(result.acceptedCount).toBe(0);
    expect(result.resolved[0].resolvedEntities[0]).toMatchObject({
      status: 'unresolved',
      reason: 'UNCONFIRMED_MATCH',
      role: 'route',
    });
    expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
    expect(catalog.persistVerifiedExperience).not.toHaveBeenCalled();
  });

  it("dedupes components by geoEntityId before persisting (real regression: two hints of one candidate reconciled onto the same GeoEntity, crashing on ExperienceComponent's unique constraint)", async () => {
    // Verified live: a Recoleta candidate proposed an "area" hint ("Recoleta")
    // and a "venue" hint naming something inside it — cross-provider
    // reconciliation (ExperienceCatalogService.upsertGeoEntity, added earlier
    // this recovery) correctly resolved both onto the *same* real GeoEntity,
    // but nothing deduped `components` before persistVerifiedExperience's
    // nested `components: { create: [...] } }` — inserting the same
    // (experienceId, geoEntityId) pair twice crashed the whole generation on
    // ExperienceComponent's unique constraint.
    const osmPlaces = {
      lookupStreetsWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisWithin: jest.fn().mockResolvedValue({
        status: 'success',
        value: [
          {
            id: 'osm:node:1',
            name: 'Recoleta Cultural Center',
            osmType: 'node',
            osmId: 1,
            geometry: { type: 'Point', coordinates: [-58.393, -34.587] },
            tags: {},
          },
        ],
      }),
    };
    const twoHintCandidate: ExperienceCandidate = {
      name: 'Recoleta Walk',
      themes: ['culture'],
      traits: [],
      intents: ['walk'],
      componentHints: [
        {
          key: 'area',
          name: 'Recoleta',
          role: 'area',
          expectedKind: 'AREA',
          required: true,
          evidenceKeys: ['ev-1'],
        },
        {
          key: 'venue',
          name: 'Recoleta Cultural Center',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ],
      evidenceKeys: ['ev-1'],
      shortReason: 'A cultural walk through Recoleta',
    };
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      // Both hints reconcile onto the same real place, exactly like
      // ExperienceCatalogService.upsertGeoEntity's own proximity+name
      // reconciliation now does across candidates — here simulated within
      // one candidate to isolate the dedup this test targets.
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-shared' }),
      persistVerifiedExperience: jest.fn().mockResolvedValue({
        id: 'exp-recoleta',
        dedupeDecision: 'NEW',
      }),
    };
    const geographicValidator = {
      validate: jest.fn().mockReturnValue(acceptedValidation('Recoleta Walk')),
    };
    const service = new ExperienceProposalResolverService(
      osmPlaces as any,
      catalog as any,
      geographicValidator as any,
    );

    const result = await service.resolve({
      destinationName: 'Recoleta, Buenos Aires',
      geographicScope: {
        kind: 'AREA_BOUNDARY',
        boundary: { ...boundary, name: 'Recoleta' },
      },
      candidates: [twoHintCandidate],
    });

    expect(result.acceptedCount).toBe(1);
    expect(catalog.persistVerifiedExperience).toHaveBeenCalledWith(
      expect.objectContaining({
        components: [expect.objectContaining({ geoEntityId: 'geo-shared' })],
      }),
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
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
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
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
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
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
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
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
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
      boundary,
      undefined,
      undefined,
      { kind: 'AREA_BOUNDARY', boundary },
    );
  });

  it('does not use a nearby Wikidata label to bridge a translated candidate with only partial token overlap', async () => {
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
    // The nearby label confirms the hint but only partially overlaps the
    // selected Spanish candidate. Proximity cannot turn that into identity.
    const wikidata = {
      findNearbyPlaces: jest.fn().mockResolvedValue([
        {
          qid: 'Q2472363',
          label: 'Ischigualasto Provincial Park',
          latitude: -30.0694429,
          longitude: -67.9849624,
        },
      ]),
    };
    const service = new ExperienceProposalResolverService(
      osmPlaces as any,
      catalog as any,
      geographicValidator as any,
      undefined,
      nominatim as any,
      undefined,
      wikidata as any,
    );

    const result = await service.resolve({
      destinationName: 'San Juan, Argentina',
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
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
    expect(result.acceptedCount).toBe(0);
    expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
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
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
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

  it('ranks the Nominatim match closest to the destination over one with higher importance, but does not treat that ranking as identity confirmation (same-country name collision)', async () => {
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
      geographicScope: { kind: 'AREA_BOUNDARY', boundary: sanJuanBoundary },
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

    expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
    // Proximity correctly selects the San Juan candidate to TRY, but two
    // exact same-name global identities remain ambiguous without independent
    // confirmation. Ranking and identity verification are separate policies.
    expect(result.acceptedCount).toBe(0);
    expect(result.resolved[0].resolvedEntities[0]).toMatchObject({
      status: 'unresolved',
      reason: 'UNCONFIRMED_MATCH',
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
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
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

  it('continues from a rejected Nominatim candidate to an independently verified Places candidate for a PLACE hint (P1)', async () => {
    const nominatim = {
      search: jest.fn().mockResolvedValue([
        {
          displayName: 'Café Tortoni Annex, Buenos Aires, Argentina',
          osmType: 'node',
          osmId: 99,
          latitude: -34.6084,
          longitude: -58.3813,
          importance: 0.5,
          class: 'amenity',
          address: {},
        },
      ]),
    };
    const placesApi = {
      provider: 'google' as const,
      searchText: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'ChIJtortoni',
            displayName: { text: 'Café Tortoni' },
            location: { latitude: -34.6084, longitude: -58.3813 },
          },
        ],
      }),
    };
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-tortoni' }),
      persistVerifiedExperience: jest.fn().mockResolvedValue({
        id: 'exp-tortoni',
        dedupeDecision: 'NEW',
      }),
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
      {
        validate: jest.fn().mockReturnValue(acceptedValidation('visit')),
      } as any,
      undefined,
      nominatim as any,
      placesApi as any,
    );

    const result = await service.resolve({
      destinationName: 'Buenos Aires, Argentina',
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
      candidates: [candidate('Café Tortoni visit', 'Café Tortoni', ['visit'])],
      evidence: [
        {
          key: 'ev-1',
          source: 'tourism-guide',
          title: 'Café Tortoni in Buenos Aires',
          snippet: 'A historic café in Buenos Aires.',
        },
      ],
    });

    expect(nominatim.search).toHaveBeenCalled();
    expect(placesApi.searchText).toHaveBeenCalledWith(
      expect.objectContaining({ textQuery: 'Café Tortoni' }),
    );
    expect(result.acceptedCount).toBe(1);
    expect(result.resolved[0].resolvedEntities[0]).toMatchObject({
      provider: 'google_places',
      canonicalName: 'Café Tortoni',
    });
  });

  it('picks the exact-name match among the Places top-N results instead of blindly taking rank 0 (real bug: resolveViaPlaces used to always take result.data[0])', async () => {
    const nominatim = { search: jest.fn().mockResolvedValue([]) };
    const placesApi = {
      provider: 'google' as const,
      searchText: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'ChIJwrong',
            displayName: { text: 'Café Tortoni Bar' },
            location: { latitude: -34.6, longitude: -58.38 },
          },
          {
            id: 'ChIJalsowrong',
            displayName: { text: 'Gran Café Tortoni Souvenirs' },
            location: { latitude: -34.61, longitude: -58.39 },
          },
          {
            id: 'ChIJcorrect',
            displayName: { text: 'Café Tortoni' },
            location: { latitude: -34.6084, longitude: -58.3813 },
          },
        ],
        provenance: {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: 3,
          receivedCount: 3,
        },
      }),
    };
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-tortoni' }),
      persistVerifiedExperience: jest.fn().mockResolvedValue({
        id: 'exp-tortoni',
        dedupeDecision: 'NEW',
      }),
    };
    const geographicValidator = {
      validate: jest
        .fn()
        .mockReturnValue(acceptedValidation('Café Tortoni visit')),
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
      destinationName: 'Buenos Aires, Argentina',
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
      candidates: [candidate('Café Tortoni visit', 'Café Tortoni', ['visit'])],
      evidence: [
        {
          key: 'ev-1',
          source: 'tourism-guide',
          title: 'Visiting Café Tortoni in Buenos Aires, Argentina',
          snippet: 'Café Tortoni is a historic café in Buenos Aires.',
        },
      ],
    });

    expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: 'google_places:ChIJcorrect',
        latitude: -34.6084,
        longitude: -58.3813,
      }),
    );
    expect(result.acceptedCount).toBe(1);
  });

  it('prefers the exact-name Places result closest to the destination when two results share the identical name (chain/franchise ambiguity)', async () => {
    const nominatim = { search: jest.fn().mockResolvedValue([]) };
    const placesApi = {
      provider: 'google' as const,
      searchText: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'ChIJfaraway',
            displayName: { text: 'Café Tortoni' },
            // Far from the destination point used below.
            location: { latitude: -38.0, longitude: -62.0 },
          },
          {
            id: 'ChIJreal',
            displayName: { text: 'Café Tortoni' },
            location: { latitude: -34.6084, longitude: -58.3813 },
          },
        ],
        provenance: {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: 3,
          receivedCount: 2,
        },
      }),
    };
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-tortoni' }),
      persistVerifiedExperience: jest.fn().mockResolvedValue({
        id: 'exp-tortoni',
        dedupeDecision: 'NEW',
      }),
    };
    const geographicValidator = {
      validate: jest
        .fn()
        .mockReturnValue(acceptedValidation('Café Tortoni visit')),
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

    await service.resolve({
      destinationName: 'Buenos Aires, Argentina',
      geographicScope: {
        kind: 'AREA_BOUNDARY',
        boundary: {
          ...boundary,
          geometry: {
            type: 'Point',
            coordinates: [-58.3816, -34.6037],
          },
        },
      },
      candidates: [candidate('Café Tortoni visit', 'Café Tortoni', ['visit'])],
      evidence: [
        {
          key: 'ev-1',
          source: 'tourism-guide',
          title: 'Visiting Café Tortoni in Buenos Aires, Argentina',
          snippet: 'Café Tortoni is a historic café in Buenos Aires.',
        },
      ],
    });

    expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
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
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
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
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
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
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
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
      service.resolve({ candidates: [], geographicScope: undefined }),
    ).rejects.toThrow('Experience resolution requires a geographic scope');
  });

  it('accepts the canonical point-radius scope without an OSM boundary', async () => {
    const service = new ExperienceProposalResolverService(
      {
        lookupStreetsNear: jest.fn().mockResolvedValue({
          status: 'success',
          value: [],
        }),
        lookupPoisNear: jest.fn().mockResolvedValue({
          status: 'success',
          value: [],
        }),
      } as any,
      {} as any,
      {} as any,
    );

    const result = await service.resolve({
      destinationName: 'Buenos Aires',
      geographicScope: {
        kind: 'POINT_RADIUS',
        latitude: -34.6,
        longitude: -58.4,
        radiusMeters: 1200,
      },
      candidates: [],
    });

    expect(result.acceptedCount).toBe(0);
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
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
      candidates: [candidate()],
    });

    expect(result.acceptedCount).toBe(0);
    expect(result.resolved[0].rejectionReasons).toContain(expected);
    const attempt =
      result.entityResolution.forensicAudit[0].componentAudits[0].attempts[0];
    expect(attempt).toMatchObject({
      strategy: 'LOCAL_OSM_POOL',
      executionStatus: lookup.status === 'failed' ? 'failed' : 'completed',
      candidateAcquired: false,
    });
    if (lookup.status === 'failed') {
      expect(attempt).toMatchObject({
        failureReason: lookup.failureReason,
      });
      expect(attempt.poolCandidateCount).toBeUndefined();
    } else {
      expect(attempt.poolCandidateCount).toBe(lookup.value.length);
    }
  });

  it('records a failed street lookup as a failed ROUTE attempt', async () => {
    const service = new ExperienceProposalResolverService(
      {
        lookupStreetsWithin: jest.fn().mockResolvedValue({
          status: 'failed',
          value: [],
          failureReason: 'Overpass timeout',
        }),
        lookupPoisWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
      } as any,
      {} as any,
      { validate: jest.fn() } as any,
    );

    const result = await service.resolve({
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
      candidates: [
        {
          ...candidate('Defensa Walk', 'Defensa'),
          componentHints: [
            {
              key: 'street',
              name: 'Defensa',
              role: 'route',
              expectedKind: 'ROUTE',
              required: true,
              evidenceKeys: ['ev-1'],
            },
          ],
        },
      ],
    });

    const attempts =
      result.entityResolution.forensicAudit[0].componentAudits[0].attempts;
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      strategy: 'LOCAL_OSM_POOL',
      executionStatus: 'failed',
      provider: 'openstreetmap',
      candidateAcquired: false,
      failureReason: 'Overpass timeout',
    });
    expect(result.resolved[0].rejectionReasons).toContain(
      'OSM_PROVIDER_FAILED',
    );
  });

  it('records AREA_TO_PLACE_CORRECTION failure from the POI lookup', async () => {
    const service = new ExperienceProposalResolverService(
      {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'failed',
          value: [],
          failureReason: 'Overpass 429',
        }),
      } as any,
      {} as any,
      { validate: jest.fn() } as any,
    );

    const result = await service.resolve({
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
      candidates: [
        {
          ...candidate('Museum Walk', 'Museum'),
          componentHints: [
            {
              key: 'area',
              name: 'Museum',
              role: 'area',
              expectedKind: 'AREA',
              required: true,
              evidenceKeys: ['ev-1'],
            },
          ],
        },
      ],
    });

    const attempts =
      result.entityResolution.forensicAudit[0].componentAudits[0].attempts;
    expect(
      attempts.find(
        (attempt) => attempt.strategy === 'AREA_TO_PLACE_CORRECTION',
      ),
    ).toMatchObject({
      executionStatus: 'failed',
      provider: 'openstreetmap',
      candidateAcquired: false,
      failureReason: 'Overpass 429',
    });
  });

  it.each([
    {
      name: 'failed boundary hydration',
      boundaryLookup: {
        status: 'failed',
        value: null,
        failureReason: 'Overpass 429',
      },
      expected: {
        executionStatus: 'failed',
        failureStage: 'boundary_hydration',
        candidateFoundBeforeFailure: true,
        failureReason: 'Overpass 429',
      },
    },
    {
      name: 'successful empty boundary hydration',
      boundaryLookup: { status: 'success', value: null },
      expected: {
        executionStatus: 'completed',
        candidateAcquired: false,
      },
    },
  ])(
    'preserves Nominatim AREA hydration outcome: $name',
    async ({ boundaryLookup, expected }) => {
      const nominatim = {
        search: jest.fn().mockResolvedValue([
          {
            osmType: 'relation',
            osmId: 42,
            addresstype: 'suburb',
            class: 'place',
            type: 'suburb',
            placeRank: 20,
            displayName: 'San Telmo, Buenos Aires, Argentina',
            importance: 0.3,
            latitude: -34.62,
            longitude: -58.37,
          },
        ]),
      };
      const service = new ExperienceProposalResolverService(
        {
          lookupStreetsWithin: jest
            .fn()
            .mockResolvedValue({ status: 'success', value: [] }),
          lookupPoisWithin: jest
            .fn()
            .mockResolvedValue({ status: 'success', value: [] }),
          lookupBoundaryById: jest.fn().mockResolvedValue(boundaryLookup),
        } as any,
        {} as any,
        { validate: jest.fn() } as any,
        undefined,
        nominatim as any,
      );

      const result = await service.resolve({
        destinationName: 'Buenos Aires',
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [
          {
            ...candidate('San Telmo Walk', 'San Telmo'),
            componentHints: [
              {
                key: 'area',
                name: 'San Telmo',
                role: 'area',
                expectedKind: 'AREA',
                required: true,
                evidenceKeys: ['ev-1'],
              },
            ],
          },
        ],
        evidence: [
          {
            key: 'ev-1',
            source: 'guide',
            title: 'San Telmo in Buenos Aires',
            snippet: 'Explore San Telmo in Buenos Aires.',
          },
        ],
      });

      const attempts =
        result.entityResolution.forensicAudit[0].componentAudits[0].attempts;
      const nominatimAttempt = attempts.find(
        (attempt) => attempt.strategy === 'NOMINATIM',
      );
      expect(nominatimAttempt).toMatchObject(expected);
      expect(nominatimAttempt).toMatchObject({
        provider: 'nominatim',
        providerResultCount: 1,
        candidateAcquired: false,
      });
      if (boundaryLookup.status === 'success') {
        expect(nominatimAttempt.failureStage).toBeUndefined();
        expect(nominatimAttempt.failureReason).toBeUndefined();
      }
    },
  );

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
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
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

  it('uses the canonical AREA scale policy for a neighborhood-scale Nominatim match', async () => {
    const osmPlaces = {
      lookupStreetsWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupBoundaryById: jest.fn().mockResolvedValue({
        status: 'success',
        value: {
          id: 'osm:relation:42',
          name: 'San Telmo',
          osmType: 'relation',
          osmId: 42,
          geometry: boundary.geometry,
          tags: { place: 'suburb' },
        },
      }),
    };
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-san-telmo' }),
      persistVerifiedExperience: jest.fn().mockResolvedValue({
        id: 'exp-san-telmo',
        dedupeDecision: 'NEW',
      }),
    };
    const geographicValidator = {
      validate: jest.fn().mockReturnValue(acceptedValidation('San Telmo Walk')),
    };
    const nominatim = {
      search: jest.fn().mockResolvedValue([
        {
          osmType: 'relation',
          osmId: 42,
          addresstype: 'suburb',
          class: 'place',
          type: 'suburb',
          placeRank: 20,
          displayName: 'San Telmo, Buenos Aires, Argentina',
          importance: 0.3,
          latitude: -34.62,
          longitude: -58.37,
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

    const areaCandidate: ExperienceCandidate = {
      name: 'San Telmo Walk',
      themes: ['history'],
      traits: [],
      intents: ['walk'],
      evidenceKeys: ['ev-1'],
      shortReason: 'Neighborhood walk',
      componentHints: [
        {
          key: 'area',
          name: 'San Telmo',
          role: 'area',
          expectedKind: 'AREA',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ],
    };

    const result = await service.resolve({
      destinationName: 'Buenos Aires',
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
      candidates: [areaCandidate],
      evidence: [
        {
          key: 'ev-1',
          source: 'guide',
          title: 'San Telmo in Buenos Aires',
          snippet: 'Explore San Telmo in Buenos Aires.',
        },
      ],
    });

    expect(result.acceptedCount).toBe(1);
    expect(osmPlaces.lookupBoundaryById).toHaveBeenCalledWith('relation', 42);
    expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
      expect.objectContaining({ kind: GeoEntityKind.AREA }),
    );
  });

  it('preserves MULTIPLE through Nominatim AREA boundary hydration', async () => {
    const osmPlaces = {
      lookupStreetsWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupBoundaryById: jest.fn().mockResolvedValue({
        status: 'success',
        value: {
          id: 'osm:relation:42',
          name: 'San Telmo',
          osmType: 'relation',
          osmId: 42,
          geometry: boundary.geometry,
          tags: { place: 'suburb' },
        },
      }),
    };
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest.fn(),
      persistVerifiedExperience: jest.fn(),
    };
    const nominatim = {
      search: jest.fn().mockResolvedValue([
        {
          osmType: 'relation',
          osmId: 42,
          addresstype: 'suburb',
          class: 'place',
          type: 'suburb',
          placeRank: 20,
          displayName: 'San Telmo, Buenos Aires, Argentina',
          importance: 0.3,
          latitude: -34.62,
          longitude: -58.37,
        },
        {
          osmType: 'relation',
          osmId: 43,
          addresstype: 'suburb',
          class: 'place',
          type: 'suburb',
          placeRank: 20,
          displayName: 'San Telmo, La Plata, Argentina',
          importance: 0.2,
          latitude: -34.92,
          longitude: -57.95,
        },
      ]),
    };
    const service = new ExperienceProposalResolverService(
      osmPlaces as any,
      catalog as any,
      { validate: jest.fn() } as any,
      undefined,
      nominatim as any,
    );
    const areaCandidate: ExperienceCandidate = {
      name: 'San Telmo Walk',
      themes: ['history'],
      traits: [],
      intents: ['walk'],
      evidenceKeys: ['ev-1'],
      shortReason: 'Neighborhood walk',
      componentHints: [
        {
          key: 'area',
          name: 'San Telmo',
          role: 'area',
          expectedKind: 'AREA',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ],
    };

    const result = await service.resolve({
      destinationName: 'Buenos Aires',
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
      candidates: [areaCandidate],
      evidence: [
        {
          key: 'ev-1',
          source: 'guide',
          title: 'San Telmo in Buenos Aires',
          snippet: 'Explore San Telmo in Buenos Aires.',
        },
      ],
    });

    expect(osmPlaces.lookupBoundaryById).toHaveBeenCalledWith('relation', 42);
    expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
    expect(catalog.persistVerifiedExperience).not.toHaveBeenCalled();
    expect(result.acceptedCount).toBe(0);
    expect(result.resolved[0].resolvedEntities[0]).toMatchObject({
      status: 'unresolved',
      reason: 'UNCONFIRMED_MATCH',
      role: 'area',
    });
  });

  it('resolves a PLACE-role hint as an AREA when Nominatim structurally shows it is a real neighborhood (mirror of the AREA-mistaken-for-PLACE case above: "Puerto Madero" tagged role="venue"/expectedKind="PLACE" by discovery, but it is a genuine neighborhood — the discovery LLM only proposes a kind, Nominatim\'s own scale evidence decides it)', async () => {
    const osmPlaces = {
      lookupStreetsWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupBoundaryById: jest.fn().mockResolvedValue({
        status: 'success',
        value: {
          id: 'osm:relation:99',
          name: 'Puerto Madero',
          osmType: 'relation',
          osmId: 99,
          geometry: boundary.geometry,
          tags: { place: 'quarter' },
        },
      }),
    };
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-puerto-madero' }),
      persistVerifiedExperience: jest.fn().mockResolvedValue({
        id: 'exp-puerto-madero',
        dedupeDecision: 'NEW',
      }),
    };
    const geographicValidator = {
      validate: jest
        .fn()
        .mockReturnValue(acceptedValidation('Puerto Madero Waterfront Walk')),
    };
    const nominatim = {
      search: jest.fn().mockResolvedValue([
        {
          osmType: 'relation',
          osmId: 99,
          addresstype: 'quarter',
          class: 'place',
          type: 'quarter',
          placeRank: 19,
          displayName: 'Puerto Madero, Buenos Aires, Argentina',
          importance: 0.4,
          latitude: -34.611,
          longitude: -58.363,
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

    const candidateWithPlaceMisclassification: ExperienceCandidate = {
      name: 'Puerto Madero Waterfront Walk',
      themes: ['architecture'],
      traits: [],
      intents: ['walk'],
      evidenceKeys: ['ev-1'],
      shortReason: 'Waterfront neighborhood walk',
      componentHints: [
        {
          key: 'puerto-madero',
          name: 'Puerto Madero',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ],
    };

    const result = await service.resolve({
      destinationName: 'Buenos Aires',
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
      candidates: [candidateWithPlaceMisclassification],
      evidence: [
        {
          key: 'ev-1',
          source: 'guide',
          title: 'Puerto Madero Waterfront Walk in Buenos Aires',
          snippet: 'Explore Puerto Madero in Buenos Aires.',
        },
      ],
    });

    expect(result.acceptedCount).toBe(1);
    expect(osmPlaces.lookupBoundaryById).toHaveBeenCalledWith('relation', 99);
    expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
      expect.objectContaining({ kind: GeoEntityKind.AREA }),
    );
    expect(result.resolved[0].resolvedEntities[0]).toMatchObject({
      hintKey: 'puerto-madero',
      status: 'resolved',
      role: 'area',
    });
  });

  it('falls through to the global Nominatim path when a local POI-pool match is found but fails confirmation (real regression, live-verified: "Puerto Madero" fuzzy-matches an unrelated local POI, "Templo Beit Jabad Puerto Madero", a synagogue sharing both tokens; the real neighborhood is a Nominatim administrative boundary and can structurally never appear in the local POI pool at all, so once the wrong local match consumes the hint there was previously no way back to it)', async () => {
    const osmPlaces = {
      lookupStreetsWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisWithin: jest.fn().mockResolvedValue({
        status: 'success',
        value: [
          {
            id: 'osm:way:710376163',
            name: 'Templo Beit Jabad Puerto Madero',
            osmType: 'way',
            osmId: 710376163,
            geometry: {
              type: 'Point',
              coordinates: [-58.3597218, -34.6113264],
            },
            tags: {
              amenity: 'place_of_worship',
              building: 'yes',
              religion: 'jewish',
              name: 'Templo Beit Jabad Puerto Madero',
            },
          },
        ],
      }),
      lookupBoundaryById: jest.fn().mockResolvedValue({
        status: 'success',
        value: {
          id: 'osm:relation:2224562',
          name: 'Puerto Madero',
          osmType: 'relation',
          osmId: 2224562,
          geometry: boundary.geometry,
          tags: { boundary: 'administrative', admin_level: '9' },
        },
      }),
    };
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-puerto-madero' }),
      persistVerifiedExperience: jest.fn().mockResolvedValue({
        id: 'exp-puerto-madero',
        dedupeDecision: 'NEW',
      }),
    };
    const geographicValidator = {
      validate: jest
        .fn()
        .mockReturnValue(acceptedValidation('Puerto Madero Waterfront Walk')),
    };
    const nominatim = {
      search: jest.fn().mockResolvedValue([
        {
          osmType: 'relation',
          osmId: 2224562,
          addresstype: 'suburb',
          class: 'boundary',
          type: 'administrative',
          placeRank: 18,
          displayName:
            'Puerto Madero, Buenos Aires, Comuna 1, Ciudad Autónoma de Buenos Aires, Argentina',
          importance: 0.16,
          latitude: -34.6103764,
          longitude: -58.3622067,
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

    const candidateWithLocalDecoy: ExperienceCandidate = {
      name: 'Puerto Madero Waterfront Walk',
      themes: ['architecture'],
      traits: [],
      intents: ['walk'],
      evidenceKeys: ['ev-1'],
      shortReason: 'Waterfront neighborhood walk',
      componentHints: [
        {
          key: 'puerto-madero',
          name: 'Puerto Madero',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ],
    };

    const result = await service.resolve({
      destinationName: 'Buenos Aires',
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
      candidates: [candidateWithLocalDecoy],
      evidence: [
        {
          key: 'ev-1',
          source: 'guide',
          title: 'Puerto Madero Waterfront Walk in Buenos Aires',
          snippet: 'Explore Puerto Madero in Buenos Aires.',
        },
      ],
    });

    expect(result.acceptedCount).toBe(1);
    expect(osmPlaces.lookupBoundaryById).toHaveBeenCalledWith(
      'relation',
      2224562,
    );
    expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
      expect.objectContaining({ kind: GeoEntityKind.AREA }),
    );
    expect(result.resolved[0].resolvedEntities[0]).toMatchObject({
      hintKey: 'puerto-madero',
      status: 'resolved',
      role: 'area',
    });
  });

  it('falls back to the local POI pool when an AREA-role hint is actually a point-like place (real regression: "Plaza de Mayo" tagged role="area" by discovery, but it is a leisure=park POI, not a neighborhood — neither the destination boundary nor Nominatim-as-administrative-area can ever find it)', async () => {
    const osmPlaces = {
      lookupStreetsWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisWithin: jest.fn().mockResolvedValue({
        status: 'success',
        value: [
          {
            id: 'osm:relation:17076039',
            name: 'Plaza de Mayo',
            osmType: 'relation',
            osmId: 17076039,
            geometry: { type: 'Point', coordinates: [-58.3712, -34.6083] },
            tags: { leisure: 'park' },
          },
        ],
      }),
    };
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-plaza-de-mayo' }),
      persistVerifiedExperience: jest.fn().mockResolvedValue({
        id: 'exp-plaza-de-mayo',
        dedupeDecision: 'NEW',
      }),
    };
    const geographicValidator = {
      validate: jest
        .fn()
        .mockReturnValue(acceptedValidation('Historic Center Tour')),
    };
    // Nominatim genuinely has nothing usable as an administrative AREA for
    // "Plaza de Mayo" — it's a plaza, not a neighborhood/settlement.
    const nominatim = { search: jest.fn().mockResolvedValue([]) };
    const service = new ExperienceProposalResolverService(
      osmPlaces as any,
      catalog as any,
      geographicValidator as any,
      undefined,
      nominatim as any,
    );

    const candidateWithAreaMisclassification: ExperienceCandidate = {
      name: 'Historic Center Tour',
      themes: ['history'],
      traits: [],
      intents: ['walk'],
      evidenceKeys: ['ev-1'],
      shortReason: 'City highlights',
      componentHints: [
        {
          key: 'plaza-de-mayo',
          name: 'Plaza de Mayo',
          role: 'area',
          expectedKind: 'AREA',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ],
    };

    const result = await service.resolve({
      destinationName: 'Buenos Aires',
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
      candidates: [candidateWithAreaMisclassification],
      evidence: [
        {
          key: 'ev-1',
          source: 'guide',
          title: 'Historic Center Tour of Buenos Aires',
          snippet: 'Visit Plaza de Mayo in Buenos Aires.',
        },
      ],
    });

    expect(result.acceptedCount).toBe(1);
    expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: GeoEntityKind.PLACE,
        name: 'Plaza de Mayo',
      }),
    );
    expect(result.resolved[0].resolvedEntities[0]).toMatchObject({
      hintKey: 'plaza-de-mayo',
      status: 'resolved',
      role: 'venue',
    });
  });

  it('does not use the POI-pool fallback for an AREA hint that already resolves correctly via Nominatim (regression guard: Palermo/Recoleta-type neighborhoods stay on the administrative-area path)', async () => {
    const osmPlaces = {
      lookupStreetsWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisWithin: jest.fn().mockResolvedValue({
        status: 'success',
        value: [
          {
            id: 'osm:node:999',
            // A decoy POI that would ALSO satisfy a name match if the
            // fallback fired when it should not — proves the fallback is
            // never even attempted once the primary AREA path succeeds.
            name: 'San Telmo',
            osmType: 'node',
            osmId: 999,
            geometry: { type: 'Point', coordinates: [-58.37, -34.62] },
            tags: { tourism: 'attraction' },
          },
        ],
      }),
      lookupBoundaryById: jest.fn().mockResolvedValue({
        status: 'success',
        value: {
          id: 'osm:relation:42',
          name: 'San Telmo',
          osmType: 'relation',
          osmId: 42,
          geometry: boundary.geometry,
          tags: { place: 'suburb' },
        },
      }),
    };
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-san-telmo' }),
      persistVerifiedExperience: jest.fn().mockResolvedValue({
        id: 'exp-san-telmo',
        dedupeDecision: 'NEW',
      }),
    };
    const geographicValidator = {
      validate: jest.fn().mockReturnValue(acceptedValidation('San Telmo Walk')),
    };
    const nominatim = {
      search: jest.fn().mockResolvedValue([
        {
          osmType: 'relation',
          osmId: 42,
          addresstype: 'suburb',
          class: 'place',
          type: 'suburb',
          placeRank: 20,
          displayName: 'San Telmo, Buenos Aires, Argentina',
          importance: 0.3,
          latitude: -34.62,
          longitude: -58.37,
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

    const areaCandidate: ExperienceCandidate = {
      name: 'San Telmo Walk',
      themes: ['history'],
      traits: [],
      intents: ['walk'],
      evidenceKeys: ['ev-1'],
      shortReason: 'Neighborhood walk',
      componentHints: [
        {
          key: 'area',
          name: 'San Telmo',
          role: 'area',
          expectedKind: 'AREA',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ],
    };

    const result = await service.resolve({
      destinationName: 'Buenos Aires',
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
      candidates: [areaCandidate],
      evidence: [
        {
          key: 'ev-1',
          source: 'guide',
          title: 'San Telmo in Buenos Aires',
          snippet: 'Explore San Telmo in Buenos Aires.',
        },
      ],
    });

    expect(result.acceptedCount).toBe(1);
    expect(catalog.upsertGeoEntity).toHaveBeenCalledTimes(1);
    expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
      expect.objectContaining({ kind: GeoEntityKind.AREA }),
    );
  });

  it.each([
    { addresstype: 'region', placeRank: 8 },
    { addresstype: 'province', placeRank: 10 },
    { addresstype: 'county', placeRank: 12 },
  ])(
    'rejects a too-broad AREA match through the canonical scale policy (%s)',
    async (scale) => {
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
        upsertGeoEntity: jest.fn(),
      };
      const nominatim = {
        search: jest.fn().mockResolvedValue([
          {
            osmType: 'relation',
            osmId: 99,
            addresstype: scale.addresstype,
            class: 'boundary',
            type: 'administrative',
            placeRank: scale.placeRank,
            displayName: 'Too Broad, Argentina',
            importance: 0.9,
            latitude: -34.6,
            longitude: -58.4,
          },
        ]),
      };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        { validate: jest.fn() } as any,
        undefined,
        nominatim as any,
      );

      const result = await service.resolve({
        destinationName: 'Buenos Aires',
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [
          {
            name: 'Too Broad Walk',
            themes: ['history'],
            traits: [],
            intents: ['walk'],
            evidenceKeys: ['ev-1'],
            shortReason: 'Invalid area scale',
            componentHints: [
              {
                key: 'area',
                name: 'Too Broad',
                role: 'area',
                expectedKind: 'AREA',
                required: true,
                evidenceKeys: ['ev-1'],
              },
            ],
          },
        ],
        evidence: [
          {
            key: 'ev-1',
            source: 'guide',
            title: 'Too Broad in Buenos Aires',
            snippet: 'A walk in Buenos Aires.',
          },
        ],
      });

      expect(result.acceptedCount).toBe(0);
      expect(result.resolved[0].rejectionReasons).toContain('OSM_QUERY_EMPTY');
      expect(osmPlaces.lookupBoundaryById).not.toHaveBeenCalled();
    },
  );

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
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
      candidates: [candidate()],
    });

    expect(result.acceptedCount).toBe(0);
    expect(result.resolved[0].rejectionReasons).toEqual([
      'GEOGRAPHIC_VALIDATION_FAILED',
    ]);
    expect(catalog.persistVerifiedExperience).not.toHaveBeenCalled();
  });

  describe('candidate correlation by identity, not display name (review fix)', () => {
    it("never lets one candidate consume a same-named sibling candidate's validation result", async () => {
      // Two DIFFERENT real candidates that happen to share a display name
      // (structured + web candidates are concatenated with no unique-name
      // guarantee) -- different components, different geographic validity.
      // Candidate A ("Alpha Landmark") passes; Candidate B ("Beta Monument")
      // fails. A name-keyed correlation would let whichever result landed
      // last in the Map win for BOTH candidates.
      //
      // Deliberately named with NO shared >=4-char token: "Place A"/"Place
      // B" (used here before Task A3) both reduce, once the trailing
      // single-letter suffix is filtered out by hasSpecificNameOverlap's
      // >=4-char token rule, to the single significant token "place" --
      // matchOsmCandidateByName's `.find()` then matched hint "Place B"
      // against pool entry "Place A" (the first pool item sharing that
      // token), silently mismatching it. Task A3's cross-source
      // confirmation gate caught that latent mismatch (canonicalName
      // "Place A" != hint "Place B", no Wikidata mock to confirm it), which
      // is correct behavior -- but it broke this test's own premise, since
      // candidate B's entity never made it past confirmation to reach the
      // mocked geographic validator at all. Renaming here restores the
      // test's real intent (per-object validation-result correlation)
      // without weakening the new gate.
      const candidateA = candidate('Shared Name Walk', 'Alpha Landmark');
      const candidateB = candidate('Shared Name Walk', 'Beta Monument');
      const osmPlaces = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:1',
              name: 'Alpha Landmark',
              osmType: 'node',
              osmId: 1,
              geometry: { type: 'Point', coordinates: [-58.4, -34.6] },
              tags: {},
            },
            {
              id: 'osm:node:2',
              name: 'Beta Monument',
              osmType: 'node',
              osmId: 2,
              geometry: { type: 'Point', coordinates: [-58.41, -34.61] },
              tags: {},
            },
          ],
        }),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest
          .fn()
          .mockImplementation(async (input: any) =>
            input.externalId === 'osm:node:1'
              ? { id: 'geo-a' }
              : { id: 'geo-b' },
          ),
        persistVerifiedExperience: jest
          .fn()
          .mockResolvedValue({ id: 'exp-a', dedupeDecision: 'NEW' }),
      };
      // Distinguishes purely by the resolved entity's OWN identity, never
      // by the shared display name -- simulates "one passes external
      // geographic scope, one fails" without needing the real validator.
      const geographicValidator = {
        validate: jest.fn().mockImplementation((resolvedProposal: any) => {
          const hintName = resolvedProposal.resolvedEntities?.[0]?.hintName;
          const accepted = hintName === 'Alpha Landmark';
          return {
            proposalName: resolvedProposal.candidate.name,
            kind: 'EXPERIENCE',
            status: accepted ? 'GEO_VERIFIED' : 'REJECTED',
            accepted,
            anchors: [],
            groundedEvidenceKeys: ['ev-1'],
            rejectionReasons: accepted ? [] : ['external_scope_mismatch'],
            validatorVersion: 2,
          };
        }),
      };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidateA, candidateB],
        evidence: [{ key: 'ev-1', source: 'test', title: 'T', snippet: 'S' }],
      });

      expect(result.acceptedCount).toBe(1);
      expect(result.rejectedCount).toBe(1);
      // The valid candidate (A) reached persistence with ITS OWN component.
      expect(catalog.persistVerifiedExperience).toHaveBeenCalledTimes(1);
      expect(catalog.persistVerifiedExperience).toHaveBeenCalledWith(
        expect.objectContaining({
          components: [expect.objectContaining({ geoEntityId: 'geo-a' })],
        }),
      );
      // The invalid candidate (B) was rejected for the REAL reason its own
      // validation computed, never swapped with A's.
      const rejected = result.resolved.find((r) => r.status === 'rejected');
      expect(rejected?.rejectionReasons).toEqual(['external_scope_mismatch']);
    });
  });

  describe('required/optional persistence (Task B5, Fix 1)', () => {
    const walkCandidate: ExperienceCandidate = {
      name: 'San Telmo Historical Walk',
      themes: ['culture'],
      traits: [],
      intents: ['walk'],
      componentHints: [
        {
          key: 'plaza',
          name: 'Plaza Dorrego',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['ev-1'],
        },
        {
          key: 'mercado',
          name: 'Mercado de San Telmo',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['ev-1'],
        },
        {
          key: 'rooftop',
          name: 'Rooftop Viewpoint',
          role: 'venue',
          expectedKind: 'PLACE',
          required: false,
          evidenceKeys: ['ev-1'],
        },
      ],
      evidenceKeys: ['ev-1'],
      shortReason: 'A historical walk through San Telmo',
    };

    function osmPlacesFor(pois: any[]) {
      return {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: pois }),
      };
    }

    it('persists required:[true,true,false] for 2 required + 1 optional hint (distinct places)', async () => {
      const osmPlaces = osmPlacesFor([
        {
          id: 'osm:node:1',
          name: 'Plaza Dorrego',
          osmType: 'node',
          osmId: 1,
          geometry: { type: 'Point', coordinates: [-58.3731, -34.6212] },
          tags: {},
        },
        {
          id: 'osm:node:2',
          name: 'Mercado de San Telmo',
          osmType: 'node',
          osmId: 2,
          geometry: { type: 'Point', coordinates: [-58.3728, -34.6208] },
          tags: {},
        },
        {
          id: 'osm:node:3',
          name: 'Rooftop Viewpoint',
          osmType: 'node',
          osmId: 3,
          geometry: { type: 'Point', coordinates: [-58.3733, -34.6215] },
          tags: {},
        },
      ]);
      let upsertCall = 0;
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockImplementation(async () => {
          upsertCall += 1;
          return { id: `geo-${upsertCall}` };
        }),
        persistVerifiedExperience: jest
          .fn()
          .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('San Telmo Historical Walk')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
      );

      await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [walkCandidate],
      });

      expect(catalog.persistVerifiedExperience).toHaveBeenCalledWith(
        expect.objectContaining({
          components: [
            expect.objectContaining({ geoEntityId: 'geo-1', required: true }),
            expect.objectContaining({ geoEntityId: 'geo-2', required: true }),
            expect.objectContaining({ geoEntityId: 'geo-3', required: false }),
          ],
        }),
      );
    });

    it('persists required:true when an optional hint and a required hint dedupe onto the same GeoEntity (optional-then-required order)', async () => {
      const dedupeCandidate: ExperienceCandidate = {
        ...walkCandidate,
        componentHints: [
          {
            key: 'optional-mercado',
            name: 'Mercado de San Telmo',
            role: 'venue',
            expectedKind: 'PLACE',
            required: false,
            evidenceKeys: ['ev-1'],
          },
          {
            key: 'required-mercado',
            name: 'Mercado de San Telmo',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['ev-1'],
          },
        ],
      };
      const osmPlaces = osmPlacesFor([
        {
          id: 'osm:node:2',
          name: 'Mercado de San Telmo',
          osmType: 'node',
          osmId: 2,
          geometry: { type: 'Point', coordinates: [-58.3728, -34.6208] },
          tags: {},
        },
      ]);
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        // Both hints reconcile onto the SAME real GeoEntity (shared place).
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-shared' }),
        persistVerifiedExperience: jest
          .fn()
          .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('San Telmo Historical Walk')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
      );

      await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [dedupeCandidate],
      });

      expect(catalog.persistVerifiedExperience).toHaveBeenCalledWith(
        expect.objectContaining({
          components: [
            expect.objectContaining({
              geoEntityId: 'geo-shared',
              required: true,
            }),
          ],
        }),
      );
    });

    it('persists required:true when a required hint and an optional hint dedupe onto the same GeoEntity (required-then-optional order)', async () => {
      const dedupeCandidate: ExperienceCandidate = {
        ...walkCandidate,
        componentHints: [
          {
            key: 'required-mercado',
            name: 'Mercado de San Telmo',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['ev-1'],
          },
          {
            key: 'optional-mercado',
            name: 'Mercado de San Telmo',
            role: 'venue',
            expectedKind: 'PLACE',
            required: false,
            evidenceKeys: ['ev-1'],
          },
        ],
      };
      const osmPlaces = osmPlacesFor([
        {
          id: 'osm:node:2',
          name: 'Mercado de San Telmo',
          osmType: 'node',
          osmId: 2,
          geometry: { type: 'Point', coordinates: [-58.3728, -34.6208] },
          tags: {},
        },
      ]);
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-shared' }),
        persistVerifiedExperience: jest
          .fn()
          .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('San Telmo Historical Walk')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
      );

      await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [dedupeCandidate],
      });

      expect(catalog.persistVerifiedExperience).toHaveBeenCalledWith(
        expect.objectContaining({
          components: [
            expect.objectContaining({
              geoEntityId: 'geo-shared',
              required: true,
            }),
          ],
        }),
      );
    });

    it('persists required:false when every hint deduping onto the same GeoEntity is optional', async () => {
      const dedupeCandidate: ExperienceCandidate = {
        ...walkCandidate,
        componentHints: [
          {
            key: 'optional-a',
            name: 'Rooftop Viewpoint',
            role: 'venue',
            expectedKind: 'PLACE',
            required: false,
            evidenceKeys: ['ev-1'],
          },
          {
            key: 'optional-b',
            name: 'Rooftop Viewpoint',
            role: 'venue',
            expectedKind: 'PLACE',
            required: false,
            evidenceKeys: ['ev-1'],
          },
        ],
      };
      const osmPlaces = osmPlacesFor([
        {
          id: 'osm:node:3',
          name: 'Rooftop Viewpoint',
          osmType: 'node',
          osmId: 3,
          geometry: { type: 'Point', coordinates: [-58.3733, -34.6215] },
          tags: {},
        },
      ]);
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-shared' }),
        persistVerifiedExperience: jest
          .fn()
          .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('San Telmo Historical Walk')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
      );

      await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [dedupeCandidate],
      });

      expect(catalog.persistVerifiedExperience).toHaveBeenCalledWith(
        expect.objectContaining({
          components: [
            expect.objectContaining({
              geoEntityId: 'geo-shared',
              required: false,
            }),
          ],
        }),
      );
    });
  });

  describe('B3 live wiring — qualityScore at persistence (cutover M2)', () => {
    const osmPlacesForVenue = () => ({
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
    });

    it('computes a real qualityScore from Places rating/review evidence and persists it', async () => {
      const rated = candidate();
      rated.qualityEvidence = {
        consumerRating: { value: 4.6, reviewCount: 900 },
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-10' }),
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        persistVerifiedExperience: jest.fn().mockResolvedValue({
          id: 'exp-rated',
          dedupeDecision: 'NEW',
        }),
      };
      const geographicValidator = {
        validate: jest.fn().mockReturnValue(acceptedValidation()),
      };
      const service = new ExperienceProposalResolverService(
        osmPlacesForVenue() as any,
        catalog as any,
        geographicValidator as any,
      );

      await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [rated],
      });

      // 4.6 with 900 reviews (well past the confidence-saturation cap) is
      // trusted near face value by computeQualityScore -- real, deterministic
      // math, not a magic constant asserted here.
      expect(catalog.persistVerifiedExperience).toHaveBeenCalledWith(
        expect.objectContaining({
          qualityScore: expect.any(Number),
        }),
      );
      const persistedQualityScore = (
        catalog.persistVerifiedExperience.mock.calls[0][0] as {
          qualityScore: number;
        }
      ).qualityScore;
      expect(persistedQualityScore).toBeGreaterThanOrEqual(3.0);
    });

    it('never fabricates a qualityScore when the candidate carries no grounded quality evidence', async () => {
      const unrated = candidate();
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-10' }),
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        persistVerifiedExperience: jest.fn().mockResolvedValue({
          id: 'exp-unrated',
          dedupeDecision: 'NEW',
        }),
      };
      const geographicValidator = {
        validate: jest.fn().mockReturnValue(acceptedValidation()),
      };
      const service = new ExperienceProposalResolverService(
        osmPlacesForVenue() as any,
        catalog as any,
        geographicValidator as any,
      );

      await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [unrated],
      });

      expect(catalog.persistVerifiedExperience).toHaveBeenCalledWith(
        expect.objectContaining({ qualityScore: undefined }),
      );
    });
  });

  describe('component-derived quality from real Wikidata notability (composite-quality wiring)', () => {
    function osmPlacesFor(pois: any[]) {
      return {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: pois }),
      };
    }

    function catalogWithSequentialGeoIds() {
      let upsertCall = 0;
      return {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockImplementation(async () => {
          upsertCall += 1;
          return { id: `geo-${upsertCall}` };
        }),
        persistVerifiedExperience: jest
          .fn()
          .mockResolvedValue({ id: 'exp-walk', dedupeDecision: 'NEW' }),
      };
    }

    const threeComponentWalk: ExperienceCandidate = {
      name: 'Colonial History Walk',
      themes: ['history'],
      traits: [],
      intents: ['walk'],
      componentHints: [
        {
          key: 'plaza',
          name: 'Plaza Dorrego',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['ev-1'],
        },
        {
          key: 'mercado',
          name: 'Mercado de San Telmo',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['ev-1'],
        },
        {
          key: 'parque',
          name: 'Parque Lezama',
          role: 'venue',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ],
      evidenceKeys: ['ev-1'],
      shortReason: 'A historical walk through San Telmo',
    };

    const threeComponentPois = (qids: Record<string, string | undefined>) => [
      {
        id: 'osm:node:1',
        name: 'Plaza Dorrego',
        osmType: 'node',
        osmId: 1,
        geometry: { type: 'Point', coordinates: [-58.3731, -34.6212] },
        tags: qids.plaza ? { wikidata: qids.plaza } : {},
      },
      {
        id: 'osm:node:2',
        name: 'Mercado de San Telmo',
        osmType: 'node',
        osmId: 2,
        geometry: { type: 'Point', coordinates: [-58.3728, -34.6208] },
        tags: qids.mercado ? { wikidata: qids.mercado } : {},
      },
      {
        id: 'osm:node:3',
        name: 'Parque Lezama',
        osmType: 'node',
        osmId: 3,
        geometry: { type: 'Point', coordinates: [-58.3696, -34.6271] },
        tags: qids.parque ? { wikidata: qids.parque } : {},
      },
    ];

    it('derives non-null quality from real per-component Wikidata sitelink counts, fetched in ONE batched call, matching the canonical computeQualityScore output exactly (Task 13 TDD)', async () => {
      const osmPlaces = osmPlacesFor(
        threeComponentPois({
          plaza: 'Q100',
          mercado: 'Q200',
          parque: 'Q300',
        }),
      );
      const catalog = catalogWithSequentialGeoIds();
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('Colonial History Walk')),
      };
      const wikidata = {
        getEntitySummaries: jest.fn().mockResolvedValue(
          new Map([
            ['Q100', { qid: 'Q100', sitelinkCount: 30 }],
            ['Q200', { qid: 'Q200', sitelinkCount: 20 }],
            ['Q300', { qid: 'Q300', sitelinkCount: 10 }],
          ]),
        ),
      };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [threeComponentWalk],
      });

      // Batched: exactly one call, for the unique QIDs -- never one
      // network round-trip per component.
      expect(wikidata.getEntitySummaries).toHaveBeenCalledTimes(1);
      const requestedQids = wikidata.getEntitySummaries.mock.calls[0][0];
      expect(new Set(requestedQids)).toEqual(new Set(['Q100', 'Q200', 'Q300']));

      // Expected value computed via the canonical utility itself -- never
      // hardcoded independently of the one deterministic scoring authority.
      const expectedQualityScore = computeQualityScore({
        componentNotabilitySignals: [30, 20, 10],
      });
      expect(expectedQualityScore).not.toBeNull();
      expect(expectedQualityScore as number).toBeGreaterThanOrEqual(3.0);

      expect(catalog.persistVerifiedExperience).toHaveBeenCalledWith(
        expect.objectContaining({ qualityScore: expectedQualityScore }),
      );
    });

    it('(14.C) multi-component candidate with no component QIDs at all leaves quality determined only by other real signals (here: none -> undefined)', async () => {
      const osmPlaces = osmPlacesFor(threeComponentPois({}));
      const catalog = catalogWithSequentialGeoIds();
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('Colonial History Walk')),
      };
      const wikidata = { getEntitySummaries: jest.fn() };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [threeComponentWalk],
      });

      // Zero real QIDs collected -> never even calls the Wikidata API.
      expect(wikidata.getEntitySummaries).not.toHaveBeenCalled();
      expect(catalog.persistVerifiedExperience).toHaveBeenCalledWith(
        expect.objectContaining({ qualityScore: undefined }),
      );
    });

    it('(14.D) Wikidata unavailable: the Experience still persists, with no synthetic component quality', async () => {
      const osmPlaces = osmPlacesFor(
        threeComponentPois({
          plaza: 'Q100',
          mercado: 'Q200',
          parque: 'Q300',
        }),
      );
      const catalog = catalogWithSequentialGeoIds();
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('Colonial History Walk')),
      };
      const wikidata = {
        getEntitySummaries: jest
          .fn()
          .mockRejectedValue(new Error('wikidata down')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [threeComponentWalk],
      });

      expect(result.acceptedCount).toBe(1);
      expect(catalog.persistVerifiedExperience).toHaveBeenCalledWith(
        expect.objectContaining({ qualityScore: undefined }),
      );
    });

    it('(14.E) partial component evidence: two components have real counts, one has no QID -> only the two real counts are used, the missing one is never treated as 0', async () => {
      const osmPlaces = osmPlacesFor(
        threeComponentPois({ plaza: 'Q100', mercado: 'Q200' }),
      );
      const catalog = catalogWithSequentialGeoIds();
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('Colonial History Walk')),
      };
      const wikidata = {
        getEntitySummaries: jest.fn().mockResolvedValue(
          new Map([
            ['Q100', { qid: 'Q100', sitelinkCount: 30 }],
            ['Q200', { qid: 'Q200', sitelinkCount: 20 }],
          ]),
        ),
      };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [threeComponentWalk],
      });

      const expectedQualityScore = computeQualityScore({
        componentNotabilitySignals: [30, 20],
      });
      expect(catalog.persistVerifiedExperience).toHaveBeenCalledWith(
        expect.objectContaining({ qualityScore: expectedQualityScore }),
      );
    });

    it('(14.F) two hints resolving onto the SAME real GeoEntity contribute its notability only once, not twice', async () => {
      // "plaza" and "mercado" hints both resolve onto the very same real
      // POI (osm:node:1) -- e.g. two component hints that turned out to
      // name the same real place. "parque" resolves to a distinct real
      // place, so the deduped component count is 2, not 3.
      const osmPlaces = osmPlacesFor([
        {
          id: 'osm:node:1',
          name: 'Plaza Dorrego',
          osmType: 'node',
          osmId: 1,
          geometry: { type: 'Point', coordinates: [-58.3731, -34.6212] },
          tags: { wikidata: 'Q100' },
        },
        {
          id: 'osm:node:3',
          name: 'Parque Lezama',
          osmType: 'node',
          osmId: 3,
          geometry: { type: 'Point', coordinates: [-58.3696, -34.6271] },
          tags: { wikidata: 'Q300' },
        },
      ]);
      const sameEntityCandidate: ExperienceCandidate = {
        ...threeComponentWalk,
        componentHints: [
          threeComponentWalk.componentHints![0],
          {
            key: 'mercado',
            // Deliberately the SAME real name as "plaza" so both hints
            // resolve onto osm:node:1 -- the same real GeoEntity.
            name: 'Plaza Dorrego',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['ev-1'],
          },
          threeComponentWalk.componentHints![2],
        ],
      };
      // Real `upsertGeoEntity` is keyed by (provider, externalId) and
      // returns the SAME geoEntityId for the same real place -- unlike
      // `catalogWithSequentialGeoIds()`, which hands out a fresh id per
      // call and would defeat this exact test (two calls for the same
      // externalId must dedupe to one geoEntityId).
      const geoIdsByExternalId = new Map<string, string>();
      let nextGeoId = 0;
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockImplementation(async (input: any) => {
          const existing = geoIdsByExternalId.get(input.externalId);
          if (existing) return { id: existing };
          nextGeoId += 1;
          const id = `geo-${nextGeoId}`;
          geoIdsByExternalId.set(input.externalId, id);
          return { id };
        }),
        persistVerifiedExperience: jest
          .fn()
          .mockResolvedValue({ id: 'exp-walk', dedupeDecision: 'NEW' }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('Colonial History Walk')),
      };
      const wikidata = {
        getEntitySummaries: jest.fn().mockResolvedValue(
          new Map([
            ['Q100', { qid: 'Q100', sitelinkCount: 30 }],
            ['Q300', { qid: 'Q300', sitelinkCount: 10 }],
          ]),
        ),
      };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [sameEntityCandidate],
      });

      // Only 2 distinct real components -> Q100's count contributes once.
      const expectedQualityScore = computeQualityScore({
        componentNotabilitySignals: [30, 10],
      });
      expect(catalog.persistVerifiedExperience).toHaveBeenCalledWith(
        expect.objectContaining({
          qualityScore: expectedQualityScore,
          components: expect.arrayContaining([
            expect.objectContaining({ geoEntityId: 'geo-1' }),
          ]),
        }),
      );
      const persistedComponents = (
        catalog.persistVerifiedExperience.mock.calls[0][0] as {
          components: unknown[];
        }
      ).components;
      expect(persistedComponents).toHaveLength(2);
    });

    it('(14.G) a single-component Experience with a QID does NOT receive the composite component-derived quality path', async () => {
      const osmPlaces = osmPlacesFor([
        {
          id: 'osm:node:1',
          name: 'Museum',
          osmType: 'node',
          osmId: 1,
          geometry: { type: 'Point', coordinates: [-58.45, -34.55] },
          tags: { wikidata: 'Q100' },
        },
      ]);
      const catalog = catalogWithSequentialGeoIds();
      const geographicValidator = {
        validate: jest.fn().mockReturnValue(acceptedValidation()),
      };
      // Even a very high real sitelink count must never leak into a
      // single-venue Experience's quality via the composite path.
      const wikidata = {
        getEntitySummaries: jest
          .fn()
          .mockResolvedValue(
            new Map([['Q100', { qid: 'Q100', sitelinkCount: 200 }]]),
          ),
      };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate()],
      });

      expect(catalog.persistVerifiedExperience).toHaveBeenCalledWith(
        expect.objectContaining({ qualityScore: undefined }),
      );
    });
  });

  describe('cross-source confirmation (Task A3)', () => {
    const osmPlacesFor = (pois: any[]) => ({
      lookupStreetsWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: pois }),
    });

    it('auto-confirms an exact local name match without calling Wikidata', async () => {
      const wikidata = { findNearbyPlaces: jest.fn() };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
        persistVerifiedExperience: jest
          .fn()
          .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
      };
      const geographicValidator = {
        validate: jest.fn().mockReturnValue(acceptedValidation()),
      };
      const service = new ExperienceProposalResolverService(
        osmPlacesFor([
          {
            id: 'osm:node:1',
            name: 'Museum',
            osmType: 'node',
            osmId: 1,
            geometry: { type: 'Point', coordinates: [-58.45, -34.55] },
            tags: {},
          },
        ]) as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate()],
      });

      expect(result.acceptedCount).toBe(1);
      expect(wikidata.findNearbyPlaces).not.toHaveBeenCalled();
    });

    it('does NOT confirm a fuzzy match when Wikidata only corroborates ONE of several significant tokens (Task A5 real regression: "Recoleta Cemetery" -> "Hotel Urban Suites Recoleta")', async () => {
      const osmPlaces = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:1',
              name: 'Hotel Urban Suites Recoleta',
              osmType: 'node',
              osmId: 1,
              geometry: { type: 'Point', coordinates: [-58.39, -34.59] },
              tags: {},
            },
          ],
        }),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-hotel' }),
        persistVerifiedExperience: jest.fn(),
      };
      const geographicValidator = { validate: jest.fn() };
      const wikidata = {
        findNearbyPlaces: jest.fn().mockResolvedValue([
          // A real, independently-real nearby place -- but it only shares
          // the generic neighborhood token "recoleta" with the hint, not
          // "cemetery". Confirming on this alone is the exact bug Task A4
          // found live. With the old >=50% bar, just "recoleta" alone (1 of 2
          // tokens) satisfies it -- this is wrong for confirmation. The new
          // requireAllTokens: true bar must reject it.
          {
            qid: 'Q1',
            label: 'Recoleta Neighborhood Buenos Aires',
            latitude: -34.59,
            longitude: -58.39,
          },
        ]),
      };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate('Recoleta Walk', 'Recoleta Cemetery')],
      });

      const rejected = result.entityResolution.resolved[0];
      expect(rejected.resolvedEntities[0]).toEqual(
        expect.objectContaining({
          hintName: 'Recoleta Cemetery',
          status: 'unresolved',
          reason: 'UNCONFIRMED_MATCH',
        }),
      );
    });

    it('does NOT confirm a fuzzy match when the corroborating Wikidata place matches the HINT but not the entity actually matched (final-review fix round 1: "Recoleta Cemetery" wrongly matched to "Hotel Urban Suites Recoleta", confirmed by the REAL nearby "La Recoleta Cemetery")', async () => {
      const osmPlaces = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:1',
              name: 'Hotel Urban Suites Recoleta',
              osmType: 'node',
              osmId: 1,
              geometry: { type: 'Point', coordinates: [-58.39, -34.59] },
              tags: {},
            },
          ],
        }),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-hotel' }),
        persistVerifiedExperience: jest.fn(),
      };
      const geographicValidator = { validate: jest.fn() };
      const wikidata = {
        findNearbyPlaces: jest.fn().mockResolvedValue([
          // The REAL Recoleta Cemetery, genuinely nearby the wrongly-matched
          // hotel (a real, small neighborhood -- Task A6's own area-anchor
          // narrowing makes this MORE likely, not less). Its label contains
          // BOTH of the hint's significant tokens ("recoleta" AND
          // "cemetery"), so it satisfies the existing hint-only check under
          // `requireAllTokens: true` -- but it has nothing to do with the
          // entity that was actually matched (the hotel). A corroboration
          // check that only asks "does some nearby real place's name match
          // the HINT" -- without independently checking that the SAME place
          // also plausibly corresponds to the MATCHED entity's own name --
          // wrongly confirms the hotel as "Recoleta Cemetery". This is the
          // exact collision the final whole-plan review found: Task A5's
          // hint-only check is necessary but not sufficient.
          {
            qid: 'Q1749586',
            label: 'La Recoleta Cemetery',
            latitude: -34.5875,
            longitude: -58.3931,
          },
        ]),
      };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate('Recoleta Walk', 'Recoleta Cemetery')],
      });

      const rejected = result.entityResolution.resolved[0];
      expect(rejected.resolvedEntities[0]).toEqual(
        expect.objectContaining({
          hintName: 'Recoleta Cemetery',
          status: 'unresolved',
          reason: 'UNCONFIRMED_MATCH',
        }),
      );
      expect(catalog.persistVerifiedExperience).not.toHaveBeenCalled();
    });

    it('confirms a fuzzy (non-exact) local match when Wikidata independently has something nearby with a matching name', async () => {
      // Task A5 fixture fix: the hint must have ALL significant tokens
      // present in the Wikidata label for confirmation under requireAllTokens.
      // Changed from "MALBA Museum" (only "museum" appears in the Wikidata
      // label) to "Museum Latin American" (all three tokens appear in the
      // Wikidata label "Museum of Latin American Art of Buenos Aires").
      const wikidata = {
        findNearbyPlaces: jest.fn().mockResolvedValue([
          {
            qid: 'Q1808336',
            label: 'Museum of Latin American Art of Buenos Aires',
            latitude: -34.5771,
            longitude: -58.4036,
          },
        ]),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
        persistVerifiedExperience: jest
          .fn()
          .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('Museum Latin American')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlacesFor([
          {
            id: 'osm:node:1',
            name: 'Museum of Latin American Art of Buenos Aires',
            osmType: 'node',
            osmId: 1,
            geometry: { type: 'Point', coordinates: [-58.4034, -34.5769] },
            tags: {},
          },
        ]) as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [
          candidate('Museum Latin American', 'Museum Latin American'),
        ],
      });

      expect(wikidata.findNearbyPlaces).toHaveBeenCalledWith(
        -34.5769,
        -58.4034,
        200,
      );
      expect(result.acceptedCount).toBe(1);
    });

    it('does NOT confirm — and rejects the candidate — when a fuzzy local match has no independent Wikidata corroboration nearby (real regression: "San Ignacio Church" -> "Ignacio Pirovano")', async () => {
      const wikidata = { findNearbyPlaces: jest.fn().mockResolvedValue([]) };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
        persistVerifiedExperience: jest.fn(),
      };
      const geographicValidator = { validate: jest.fn() };
      const service = new ExperienceProposalResolverService(
        osmPlacesFor([
          {
            id: 'osm:node:1',
            name: 'Ignacio Pirovano',
            osmType: 'node',
            osmId: 1,
            geometry: { type: 'Point', coordinates: [-58.3948, -34.5878] },
            tags: {},
          },
        ]) as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate('San Ignacio Church', 'San Ignacio Church')],
      });

      expect(result.acceptedCount).toBe(0);
      expect(result.resolved[0].resolvedEntities[0]).toMatchObject({
        status: 'unresolved',
        reason: 'UNCONFIRMED_MATCH',
      });
      expect(catalog.persistVerifiedExperience).not.toHaveBeenCalled();
    });

    it('remains unresolved when a rejected local match also finds no trusted alternative through the global path (real regression, same "San Ignacio Church" -> "Ignacio Pirovano" collision, but with destinationAssociationVerified true and a real Nominatim call attempted -- unlike the local-only test above, this one actually exercises the global fallthrough and confirms it does not manufacture a false positive when nothing trustworthy exists there either)', async () => {
      const wikidata = { findNearbyPlaces: jest.fn().mockResolvedValue([]) };
      const nominatim = { search: jest.fn().mockResolvedValue([]) };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
        persistVerifiedExperience: jest.fn(),
      };
      const geographicValidator = { validate: jest.fn() };
      const service = new ExperienceProposalResolverService(
        osmPlacesFor([
          {
            id: 'osm:node:1',
            name: 'Ignacio Pirovano',
            osmType: 'node',
            osmId: 1,
            geometry: { type: 'Point', coordinates: [-58.3948, -34.5878] },
            tags: {},
          },
        ]) as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        nominatim as any,
        undefined,
        wikidata as any,
      );

      const result = await service.resolve({
        destinationName: 'Buenos Aires',
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate('San Ignacio Church', 'San Ignacio Church')],
        evidence: [
          {
            key: 'ev-1',
            source: 'guide',
            title: 'San Ignacio Church in Buenos Aires',
            snippet: 'Visit San Ignacio Church in Buenos Aires.',
          },
        ],
      });

      // Proves the global path was actually attempted (not short-circuited
      // before it, the way the local-only test above never even calls it).
      expect(nominatim.search).toHaveBeenCalledWith(
        'San Ignacio Church',
        undefined,
      );
      expect(result.acceptedCount).toBe(0);
      expect(result.resolved[0].resolvedEntities[0]).toMatchObject({
        status: 'unresolved',
        reason: 'UNCONFIRMED_MATCH',
      });
      expect(catalog.persistVerifiedExperience).not.toHaveBeenCalled();
    });

    it('does not confirm (fails closed) when Wikidata itself is unavailable — never treats provider failure as confirmation', async () => {
      const wikidata = {
        findNearbyPlaces: jest.fn().mockRejectedValue(new Error('down')),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
        persistVerifiedExperience: jest.fn(),
      };
      const geographicValidator = { validate: jest.fn() };
      const service = new ExperienceProposalResolverService(
        osmPlacesFor([
          {
            id: 'osm:node:1',
            name: 'Ignacio Pirovano',
            osmType: 'node',
            osmId: 1,
            geometry: { type: 'Point', coordinates: [-58.3948, -34.5878] },
            tags: {},
          },
        ]) as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate('San Ignacio Church', 'San Ignacio Church')],
      });

      expect(result.acceptedCount).toBe(0);
      expect(result.resolved[0].resolvedEntities[0]).toMatchObject({
        status: 'unresolved',
        reason: 'UNCONFIRMED_MATCH',
      });
      expect(catalog.persistVerifiedExperience).not.toHaveBeenCalled();
    });

    it('still confirms via the global (Nominatim) path the same way, when the local pool has no match at all', async () => {
      const wikidata = {
        findNearbyPlaces: jest.fn().mockResolvedValue([
          {
            qid: 'Q1',
            label: 'Some Real Place',
            latitude: -34.61,
            longitude: -58.38,
          },
        ]),
      };
      const nominatim = {
        search: jest.fn().mockResolvedValue([
          {
            displayName: 'Some Real Place, Buenos Aires, Argentina',
            osmType: 'way',
            osmId: 42,
            latitude: -34.6101,
            longitude: -58.3801,
            importance: 0.5,
            addresstype: 'building',
            address: {},
          },
        ]),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
        persistVerifiedExperience: jest
          .fn()
          .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('Visit Some Place')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlacesFor([]) as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        nominatim as any,
        undefined,
        wikidata as any,
      );

      const result = await service.resolve({
        destinationName: 'Buenos Aires',
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate('Visit Some Place', 'Some Place')],
        evidence: [
          {
            key: 'ev-1',
            source: 'guide',
            title: 'Buenos Aires highlights',
            snippet: 'Some Real Place is worth visiting in Buenos Aires.',
          },
        ],
      });

      expect(wikidata.findNearbyPlaces).toHaveBeenCalledWith(
        -34.6101,
        -58.3801,
        200,
      );
      expect(result.acceptedCount).toBe(1);
    });
  });

  describe('confirmMatch: exact name match alone is not sufficient when the candidate pool had multiple exact matches (P0.2)', () => {
    it('does NOT auto-confirm via isExact when the local OSM pool has TWO exact same-name candidates with no corroborating evidence (real-world class: a landmark and an unrelated transit stop both literally named "Plaza de Mayo") -- falls closed to UNCONFIRMED, never picks the first one and trusts it', async () => {
      const osmPlaces = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:way:1',
              name: 'Plaza de Mayo',
              osmType: 'way',
              osmId: 1,
              geometry: { type: 'Point', coordinates: [-58.3712, -34.6083] },
              tags: { leisure: 'park' },
            },
            {
              id: 'osm:node:2',
              name: 'Plaza de Mayo',
              osmType: 'node',
              osmId: 2,
              geometry: { type: 'Point', coordinates: [-58.3715, -34.6085] },
              tags: { public_transport: 'stop_position' },
            },
          ],
        }),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
        persistVerifiedExperience: jest.fn(),
      };
      const geographicValidator = { validate: jest.fn() };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate('Visit Plaza de Mayo', 'Plaza de Mayo')],
      });

      expect(result.acceptedCount).toBe(0);
      expect(result.resolved[0].resolvedEntities[0]).toMatchObject({
        status: 'unresolved',
        reason: 'UNCONFIRMED_MATCH',
      });
      expect(catalog.persistVerifiedExperience).not.toHaveBeenCalled();
    });

    it('still resolves normally when the local OSM pool has exactly ONE exact same-name candidate (regression guard: a unique exact match remains strong evidence on its own)', async () => {
      const osmPlaces = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:way:1',
              name: 'Plaza de Mayo',
              osmType: 'way',
              osmId: 1,
              geometry: { type: 'Point', coordinates: [-58.3712, -34.6083] },
              tags: { leisure: 'park' },
            },
          ],
        }),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
        persistVerifiedExperience: jest
          .fn()
          .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('Visit Plaza de Mayo')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate('Visit Plaza de Mayo', 'Plaza de Mayo')],
      });

      expect(result.acceptedCount).toBe(1);
    });

    it('resolves the ambiguous OSM case when independent evidence disambiguates one of the two exact candidates (own wikidata tag on that specific candidate)', async () => {
      const wikidata = {
        getEntitySummaries: jest
          .fn()
          .mockResolvedValue(new Map([['Q123', { label: 'Plaza de Mayo' }]])),
      };
      const osmPlaces = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:way:1',
              name: 'Plaza de Mayo',
              osmType: 'way',
              osmId: 1,
              geometry: { type: 'Point', coordinates: [-58.3712, -34.6083] },
              tags: { leisure: 'park', wikidata: 'Q123' },
            },
            {
              id: 'osm:node:2',
              name: 'Plaza de Mayo',
              osmType: 'node',
              osmId: 2,
              geometry: { type: 'Point', coordinates: [-58.3715, -34.6085] },
              tags: { public_transport: 'stop_position' },
            },
          ],
        }),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
        persistVerifiedExperience: jest
          .fn()
          .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('Visit Plaza de Mayo')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate('Visit Plaza de Mayo', 'Plaza de Mayo')],
      });

      // matchOsmCandidateByName's exact branch picks the FIRST exact match
      // (pool order) -- that first candidate happens to be the one WITH the
      // wikidata tag here, so it can be independently confirmed even though
      // the pool was ambiguous.
      expect(result.acceptedCount).toBe(1);
      expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
        expect.objectContaining({ externalId: 'osm:way:1' }),
      );
    });

    it('does NOT auto-confirm an exact Nominatim result when its global result set contains two exact same-name entities', async () => {
      const osmPlaces = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
      };
      const nominatim = {
        search: jest.fn().mockResolvedValue([
          {
            displayName: 'Plaza de Mayo, Buenos Aires, Argentina',
            osmType: 'way',
            osmId: 1,
            latitude: -34.6083,
            longitude: -58.3712,
            importance: 0.5,
            class: 'leisure',
            address: {},
          },
          {
            displayName: 'Plaza de Mayo, Other Place, Argentina',
            osmType: 'node',
            osmId: 2,
            latitude: -34.6085,
            longitude: -58.3715,
            importance: 0.4,
            class: 'leisure',
            address: {},
          },
        ]),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
        persistVerifiedExperience: jest.fn(),
      };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        { validate: jest.fn() } as any,
        undefined,
        nominatim as any,
      );

      const result = await service.resolve({
        destinationName: 'Buenos Aires',
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate('Visit Plaza de Mayo', 'Plaza de Mayo')],
        evidence: [
          {
            key: 'ev-1',
            source: 'guide',
            title: 'Buenos Aires guide',
            snippet: 'Visit Plaza de Mayo in Buenos Aires.',
          },
        ],
      });

      expect(result.acceptedCount).toBe(0);
      expect(result.resolved[0].resolvedEntities[0]).toMatchObject({
        status: 'unresolved',
        reason: 'UNCONFIRMED_MATCH',
      });
    });

    it('does NOT auto-confirm an exact Places result when its global result set contains two exact same-name entities', async () => {
      const osmPlaces = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
      };
      const placesApi = {
        provider: 'google' as const,
        searchText: jest.fn().mockResolvedValue({
          data: [
            {
              id: 'place-1',
              displayName: { text: 'Plaza de Mayo' },
              location: { latitude: -34.6083, longitude: -58.3712 },
            },
            {
              id: 'place-2',
              displayName: { text: 'Plaza de Mayo' },
              location: { latitude: -34.6085, longitude: -58.3715 },
            },
          ],
        }),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
        persistVerifiedExperience: jest.fn(),
      };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        { validate: jest.fn() } as any,
        undefined,
        undefined,
        placesApi as any,
      );

      const result = await service.resolve({
        destinationName: 'Buenos Aires',
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate('Visit Plaza de Mayo', 'Plaza de Mayo')],
        evidence: [
          {
            key: 'ev-1',
            source: 'guide',
            title: 'Buenos Aires guide',
            snippet: 'Visit Plaza de Mayo in Buenos Aires.',
          },
        ],
      });

      expect(result.acceptedCount).toBe(0);
      expect(result.resolved[0].resolvedEntities[0]).toMatchObject({
        status: 'unresolved',
        reason: 'UNCONFIRMED_MATCH',
      });
    });
  });

  it('continues to local AREA-to-PLACE correction when the global candidate is rejected (P1)', async () => {
    const osmPlaces = {
      lookupStreetsWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisWithin: jest.fn().mockResolvedValue({
        status: 'success',
        value: [
          {
            id: 'osm:way:1',
            name: 'Plaza de Mayo',
            osmType: 'way',
            osmId: 1,
            geometry: { type: 'Point', coordinates: [-58.3712, -34.6083] },
            tags: { leisure: 'park' },
          },
        ],
      }),
    };
    const nominatim = {
      search: jest.fn().mockResolvedValue([
        {
          displayName: 'Plaza Mayo, Buenos Aires, Argentina',
          osmType: 'node',
          osmId: 2,
          latitude: -34.6083,
          longitude: -58.3712,
          importance: 0.5,
          class: 'leisure',
          address: {},
        },
      ]),
    };
    const catalog = {
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
      persistVerifiedExperience: jest
        .fn()
        .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
    };
    const geographicValidator = {
      validate: jest
        .fn()
        .mockReturnValue(acceptedValidation('Visit Plaza de Mayo')),
    };
    const service = new ExperienceProposalResolverService(
      osmPlaces as any,
      catalog as any,
      geographicValidator as any,
      undefined,
      nominatim as any,
    );
    const areaCandidate = candidate('Visit Plaza de Mayo', 'Plaza de Mayo');
    areaCandidate.componentHints[0] = {
      ...areaCandidate.componentHints[0],
      role: 'area',
      expectedKind: 'AREA',
    };

    const result = await service.resolve({
      destinationName: 'Buenos Aires',
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
      candidates: [areaCandidate],
      evidence: [
        {
          key: 'ev-1',
          source: 'guide',
          title: 'Buenos Aires guide',
          snippet: 'Visit Plaza de Mayo in Buenos Aires.',
        },
      ],
    });

    expect(nominatim.search).toHaveBeenCalled();
    expect(result.acceptedCount).toBe(1);
    expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: 'osm:way:1',
        kind: GeoEntityKind.PLACE,
      }),
    );
  });

  describe("confirmMatch: direct confirmation via the OSM candidate's own wikidata tag", () => {
    const osmPlacesFor = (pois: any[]) => ({
      lookupStreetsWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: pois }),
    });

    it("confirms directly from the candidate's own wikidata tag and never calls the geo-proximity search at all", async () => {
      const wikidata = {
        findNearbyPlaces: jest.fn(),
        getEntitySummaries: jest.fn().mockResolvedValue(
          new Map([
            [
              'Q1808336',
              {
                qid: 'Q1808336',
                label: 'Museum of Latin American Art of Buenos Aires',
              },
            ],
          ]),
        ),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
        persistVerifiedExperience: jest
          .fn()
          .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('Museum Latin American')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlacesFor([
          {
            id: 'osm:node:1',
            name: 'Museum of Latin American Art of Buenos Aires',
            osmType: 'node',
            osmId: 1,
            geometry: { type: 'Point', coordinates: [-58.4034, -34.5769] },
            tags: { wikidata: 'Q1808336' },
          },
        ]) as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [
          candidate('Museum Latin American', 'Museum Latin American'),
        ],
      });

      expect(wikidata.getEntitySummaries).toHaveBeenCalledWith(['Q1808336']);
      expect(wikidata.findNearbyPlaces).not.toHaveBeenCalled();
      expect(result.acceptedCount).toBe(1);
    });

    it("confirms via an English alias when the hint is English, the local OSM name and Wikidata's primary label are both Spanish, and the strict same-language token bar alone would reject it", async () => {
      const wikidata = {
        findNearbyPlaces: jest.fn(),
        getEntitySummaries: jest.fn().mockResolvedValue(
          new Map([
            [
              'Q4394888',
              {
                qid: 'Q4394888',
                // Shares "telmo" with the hint but not "market" — under the
                // strict requireAllTokens bar this label alone still fails
                // to confirm. Wikidata separately records the real English
                // name as an alias (skos:altLabel) — exactly the data
                // `getEntitySummaries` now fetches and `findNearbyPlaces`'s
                // single label per item never did.
                label: 'Mercado de San Telmo',
                aliases: ['San Telmo Market'],
              },
            ],
          ]),
        ),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
        persistVerifiedExperience: jest
          .fn()
          .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('San Telmo Market')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlacesFor([
          {
            id: 'osm:node:1',
            name: 'Mercado de San Telmo',
            osmType: 'node',
            osmId: 1,
            geometry: { type: 'Point', coordinates: [-58.38, -34.6] },
            tags: { wikidata: 'Q4394888' },
          },
        ]) as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate('San Telmo Market', 'SAN TELMO MARKET')],
      });

      expect(result.acceptedCount).toBe(1);
    });

    it('rejects — and does NOT fall back to geo-proximity search — when the matched entity\'s own wikidata tag resolves to a real but unrelated entity (would otherwise reopen the "Recoleta Cemetery" -> hotel collision class)', async () => {
      const wikidata = {
        // If this were consulted, it would WRONGLY confirm: a real place
        // named "La Recoleta Cemetery" genuinely sits near the wrongly-
        // matched hotel, so a proximity search alone would wrongly treat
        // it as corroboration. The own-tag check must never fall through
        // to this once the entity's own Wikidata record is found and
        // disagrees.
        findNearbyPlaces: jest.fn().mockResolvedValue([
          {
            qid: 'Q1749586',
            label: 'La Recoleta Cemetery',
            latitude: -34.5875,
            longitude: -58.3931,
          },
        ]),
        getEntitySummaries: jest.fn().mockResolvedValue(
          new Map([
            [
              'Q999',
              {
                qid: 'Q999',
                label: 'Urban Suites Recoleta',
                aliases: ['Hotel Urban Suites Recoleta'],
              },
            ],
          ]),
        ),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-hotel' }),
        persistVerifiedExperience: jest.fn(),
      };
      const geographicValidator = { validate: jest.fn() };
      const service = new ExperienceProposalResolverService(
        osmPlacesFor([
          {
            id: 'osm:node:1',
            name: 'Hotel Urban Suites Recoleta',
            osmType: 'node',
            osmId: 1,
            geometry: { type: 'Point', coordinates: [-58.39, -34.59] },
            tags: { wikidata: 'Q999' },
          },
        ]) as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate('Recoleta Walk', 'Recoleta Cemetery')],
      });

      expect(wikidata.getEntitySummaries).toHaveBeenCalledWith(['Q999']);
      expect(wikidata.findNearbyPlaces).not.toHaveBeenCalled();
      const rejected = result.entityResolution.resolved[0];
      expect(rejected.resolvedEntities[0]).toEqual(
        expect.objectContaining({
          hintName: 'Recoleta Cemetery',
          status: 'unresolved',
          reason: 'UNCONFIRMED_MATCH',
        }),
      );
      expect(catalog.persistVerifiedExperience).not.toHaveBeenCalled();
    });

    it('falls back to the geo-proximity path when the tagged QID has no record in Wikidata (stale/miskeyed OSM tag)', async () => {
      const wikidata = {
        findNearbyPlaces: jest.fn().mockResolvedValue([
          {
            qid: 'Q1',
            label: 'Museum of Latin American Art of Buenos Aires',
            latitude: -34.5771,
            longitude: -58.4036,
          },
        ]),
        getEntitySummaries: jest.fn().mockResolvedValue(new Map()),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
        persistVerifiedExperience: jest
          .fn()
          .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('Museum Latin American')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlacesFor([
          {
            id: 'osm:node:1',
            name: 'Museum of Latin American Art of Buenos Aires',
            osmType: 'node',
            osmId: 1,
            geometry: { type: 'Point', coordinates: [-58.4034, -34.5769] },
            tags: { wikidata: 'Q99999999' },
          },
        ]) as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [
          candidate('Museum Latin American', 'Museum Latin American'),
        ],
      });

      expect(wikidata.getEntitySummaries).toHaveBeenCalledWith(['Q99999999']);
      expect(wikidata.findNearbyPlaces).toHaveBeenCalled();
      expect(result.acceptedCount).toBe(1);
    });

    it('fails closed (does not confirm) when getEntitySummaries throws, without falling back to geo-proximity', async () => {
      const wikidata = {
        findNearbyPlaces: jest.fn(),
        getEntitySummaries: jest.fn().mockRejectedValue(new Error('down')),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
        persistVerifiedExperience: jest.fn(),
      };
      const geographicValidator = { validate: jest.fn() };
      const service = new ExperienceProposalResolverService(
        osmPlacesFor([
          {
            id: 'osm:node:1',
            name: 'Museum of Latin American Art of Buenos Aires',
            osmType: 'node',
            osmId: 1,
            geometry: { type: 'Point', coordinates: [-58.4034, -34.5769] },
            tags: { wikidata: 'Q1808336' },
          },
        ]) as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [
          candidate('Museum Latin American', 'Museum Latin American'),
        ],
      });

      expect(result.acceptedCount).toBe(0);
      expect(wikidata.findNearbyPlaces).not.toHaveBeenCalled();
      expect(catalog.persistVerifiedExperience).not.toHaveBeenCalled();
    });

    it('ignores a malformed wikidata tag value (not a bare QID) and falls back to the geo-proximity path, same as no tag at all', async () => {
      const wikidata = {
        findNearbyPlaces: jest.fn().mockResolvedValue([
          {
            qid: 'Q1',
            label: 'Museum of Latin American Art of Buenos Aires',
            latitude: -34.5771,
            longitude: -58.4036,
          },
        ]),
        getEntitySummaries: jest.fn(),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
        persistVerifiedExperience: jest
          .fn()
          .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('Museum Latin American')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlacesFor([
          {
            id: 'osm:node:1',
            name: 'Museum of Latin American Art of Buenos Aires',
            osmType: 'node',
            osmId: 1,
            geometry: { type: 'Point', coordinates: [-58.4034, -34.5769] },
            // Real-world messy tagging: a ';'-separated list is not a
            // single well-formed QID and must be treated as absent.
            tags: { wikidata: 'Q1808336;Q7654321' },
          },
        ]) as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [
          candidate('Museum Latin American', 'Museum Latin American'),
        ],
      });

      expect(wikidata.getEntitySummaries).not.toHaveBeenCalled();
      expect(wikidata.findNearbyPlaces).toHaveBeenCalled();
      expect(result.acceptedCount).toBe(1);
    });

    it('resolves the real "Recoleta Cemetery" case end to end -- the general mechanism (best-fuzzy-match + own-tag QID confirmation), not a case-specific rule, is what fixes it (live-verified real data: OSM way "Cementerio de la Recoleta" carries `wikidata=Q831322`, which real Wikidata labels "Recoleta Cemetery" in English -- an exact match to the hint -- while the historically-wrong "Hotel Urban Suites Recoleta" carries no wikidata tag at all and shares the same single token, so the tag-presence tiebreak picks the real cemetery)', async () => {
      const wikidata = {
        findNearbyPlaces: jest.fn(),
        getEntitySummaries: jest
          .fn()
          .mockResolvedValue(
            new Map([
              ['Q831322', { qid: 'Q831322', label: 'Recoleta Cemetery' }],
            ]),
          ),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest
          .fn()
          .mockResolvedValue({ id: 'geo-recoleta-cemetery' }),
        persistVerifiedExperience: jest.fn().mockResolvedValue({
          id: 'exp-recoleta-cemetery',
          dedupeDecision: 'NEW',
        }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('Recoleta Walk')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlacesFor([
          {
            id: 'osm:node:1',
            name: 'Hotel Urban Suites Recoleta',
            osmType: 'node',
            osmId: 1,
            geometry: { type: 'Point', coordinates: [-58.39, -34.59] },
            // Real-world: hotels are rarely wikidata-cross-referenced.
            tags: {},
          },
          {
            id: 'osm:way:2',
            name: 'Cementerio de la Recoleta',
            osmType: 'way',
            osmId: 2,
            geometry: { type: 'Point', coordinates: [-58.3931, -34.5875] },
            tags: {
              landuse: 'cemetery',
              tourism: 'attraction',
              wikidata: 'Q831322',
              wikipedia: 'es:Cementerio de la Recoleta',
            },
          },
        ]) as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate('Recoleta Walk', 'Recoleta Cemetery')],
      });

      expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Cementerio de la Recoleta',
          externalId: 'osm:way:2',
        }),
      );
      expect(wikidata.getEntitySummaries).toHaveBeenCalledWith(['Q831322']);
      expect(result.acceptedCount).toBe(1);
      expect(result.resolved[0].resolvedEntities[0]).toMatchObject({
        status: 'resolved',
        canonicalName: 'Cementerio de la Recoleta',
      });
    });
  });

  describe("confirmMatch: direct confirmation via a known QID from the request's SourceObservations", () => {
    const osmPlacesFor = (pois: any[]) => ({
      lookupStreetsWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: pois }),
    });

    it('confirms via a QID carried on the SourceObservation behind the hint, when the matched OSM candidate has no wikidata tag of its own', async () => {
      const wikidata = {
        findNearbyPlaces: jest.fn(),
        getEntitySummaries: jest.fn().mockResolvedValue(
          new Map([
            [
              'Q1808336',
              {
                qid: 'Q1808336',
                label: 'Museum of Latin American Art of Buenos Aires',
              },
            ],
          ]),
        ),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
        persistVerifiedExperience: jest
          .fn()
          .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('Museum Latin American')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlacesFor([
          {
            id: 'osm:node:1',
            name: 'Museum of Latin American Art of Buenos Aires',
            osmType: 'node',
            osmId: 1,
            geometry: { type: 'Point', coordinates: [-58.4034, -34.5769] },
            // No `wikidata` tag on the OSM node itself.
            tags: {},
          },
        ]) as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      const museumCandidate = candidate(
        'Museum Latin American',
        'Museum Latin American',
      );
      museumCandidate.componentHints[0].evidenceKeys = ['wv-1'];
      museumCandidate.evidenceKeys = ['wv-1'];

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [museumCandidate],
        observations: [
          {
            provider: 'wikivoyage',
            evidenceKey: 'wv-1',
            evidenceType: 'place',
            title: 'MALBA',
            originationCapabilities: [],
            canonicalIdentity: { wikidataQid: 'Q1808336' },
          },
        ],
      });

      expect(wikidata.getEntitySummaries).toHaveBeenCalledWith(['Q1808336']);
      expect(wikidata.findNearbyPlaces).not.toHaveBeenCalled();
      expect(result.acceptedCount).toBe(1);
    });

    it("prefers the OSM candidate's own wikidata tag over an observation QID when both are present", async () => {
      const wikidata = {
        findNearbyPlaces: jest.fn().mockResolvedValue([]),
        getEntitySummaries: jest.fn().mockResolvedValue(
          new Map([
            [
              'Q999',
              {
                qid: 'Q999',
                label: 'Museum of Latin American Art of Buenos Aires',
              },
            ],
          ]),
        ),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
        persistVerifiedExperience: jest
          .fn()
          .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('Museum Latin American')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlacesFor([
          {
            id: 'osm:node:1',
            name: 'Museum of Latin American Art of Buenos Aires',
            osmType: 'node',
            osmId: 1,
            geometry: { type: 'Point', coordinates: [-58.4034, -34.5769] },
            tags: { wikidata: 'Q999' },
          },
        ]) as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      const museumCandidate = candidate(
        'Museum Latin American',
        'Museum Latin American',
      );
      museumCandidate.componentHints[0].evidenceKeys = ['wv-1'];

      await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [museumCandidate],
        observations: [
          {
            provider: 'wikivoyage',
            evidenceKey: 'wv-1',
            evidenceType: 'place',
            title: 'MALBA',
            originationCapabilities: [],
            canonicalIdentity: { wikidataQid: 'Q-from-observation' },
          },
        ],
      });

      expect(wikidata.getEntitySummaries).toHaveBeenCalledWith(['Q999']);
    });

    it('does NOT confirm — and does not fall back to geo-proximity — when the observation QID describes the HINT but the matcher picked the WRONG local candidate (an observation QID proves hint==Q831322, never that the actually-matched OSM entity==Q831322; real case "Recoleta Cemetery" -> "Hotel Urban Suites Recoleta", where the hotel has no wikidata tag of its own)', async () => {
      const wikidata = {
        findNearbyPlaces: jest.fn().mockResolvedValue([]),
        getEntitySummaries: jest.fn().mockResolvedValue(
          new Map([
            [
              'Q831322',
              {
                qid: 'Q831322',
                label: 'Recoleta Cemetery',
              },
            ],
          ]),
        ),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-hotel' }),
        persistVerifiedExperience: jest.fn(),
      };
      const geographicValidator = { validate: jest.fn() };
      const service = new ExperienceProposalResolverService(
        osmPlacesFor([
          {
            id: 'osm:node:hotel',
            // The matcher's mistake: shares the "recoleta" token with the
            // hint, no wikidata tag of its own, so this candidate has no
            // independent identity evidence -- everything downstream has
            // to come from the observation's QID, which describes the
            // HINT, not this specific wrong entity.
            name: 'Hotel Urban Suites Recoleta',
            osmType: 'node',
            osmId: 1,
            geometry: { type: 'Point', coordinates: [-58.39, -34.59] },
            tags: {},
          },
        ]) as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      const recoletaCandidate = candidate('Recoleta Walk', 'Recoleta Cemetery');
      recoletaCandidate.componentHints[0].evidenceKeys = ['wv-1'];

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [recoletaCandidate],
        observations: [
          {
            provider: 'wikivoyage',
            evidenceKey: 'wv-1',
            evidenceType: 'place',
            title: 'Recoleta Cemetery',
            originationCapabilities: [],
            // Wikivoyage correctly claims the HINT "Recoleta Cemetery" is
            // Q831322 -- true, and irrelevant to whether the WRONG local
            // candidate the matcher actually picked is also Q831322.
            canonicalIdentity: { wikidataQid: 'Q831322' },
          },
        ],
      });

      expect(result.acceptedCount).toBe(0);
      expect(result.resolved[0].resolvedEntities[0]).toMatchObject({
        hintName: 'Recoleta Cemetery',
        status: 'unresolved',
        reason: 'UNCONFIRMED_MATCH',
      });
      expect(catalog.persistVerifiedExperience).not.toHaveBeenCalled();
    });

    it('ignores observations entirely when absent from the request (regression guard: every existing caller that does not pass `observations` is unaffected)', async () => {
      const wikidata = {
        findNearbyPlaces: jest.fn().mockResolvedValue([
          {
            qid: 'Q1',
            label: 'Museum of Latin American Art of Buenos Aires',
            latitude: -34.5771,
            longitude: -58.4036,
          },
        ]),
        getEntitySummaries: jest.fn(),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
        persistVerifiedExperience: jest
          .fn()
          .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('Museum Latin American')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlacesFor([
          {
            id: 'osm:node:1',
            name: 'Museum of Latin American Art of Buenos Aires',
            osmType: 'node',
            osmId: 1,
            geometry: { type: 'Point', coordinates: [-58.4034, -34.5769] },
            tags: {},
          },
        ]) as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      const museumCandidate = candidate(
        'Museum Latin American',
        'Museum Latin American',
      );
      museumCandidate.componentHints[0].evidenceKeys = ['wv-1'];

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [museumCandidate],
        // No `observations` field at all.
      });

      expect(wikidata.getEntitySummaries).not.toHaveBeenCalled();
      expect(wikidata.findNearbyPlaces).toHaveBeenCalled();
      expect(result.acceptedCount).toBe(1);
    });
  });

  describe("confirmMatch: direct confirmation via the OSM candidate's own name:xx/alt_name/wikipedia tags", () => {
    const osmPlacesFor = (pois: any[]) => ({
      lookupStreetsWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: pois }),
    });

    it('confirms via a `name:en` tag on the matched candidate without ever calling Wikidata', async () => {
      const wikidata = {
        findNearbyPlaces: jest.fn(),
        getEntitySummaries: jest.fn(),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
        persistVerifiedExperience: jest
          .fn()
          .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('San Telmo Market')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlacesFor([
          {
            id: 'osm:way:1',
            // Primary name is Spanish; English alias bridges the language gap.
            // Primary does NOT equal hint -> exactName = UNKNOWN.
            // name:en alias matches hint -> declaredAlias = SINGLE.
            // DECLARED_ALIAS_MATCH / SINGLE -> VERIFIED without Wikidata.
            name: 'Mercado de San Telmo',
            osmType: 'way',
            osmId: 1,
            geometry: { type: 'Point', coordinates: [-58.38, -34.6] },
            tags: { 'name:en': 'San Telmo Market' },
          },
        ]) as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate('San Telmo Market', 'San Telmo Market')],
      });

      // Golden alias case 1: primary name MUST NOT equal hint.
      expect(normalizeGeoName('Mercado de San Telmo')).not.toBe(
        normalizeGeoName('San Telmo Market'),
      );

      expect(wikidata.getEntitySummaries).not.toHaveBeenCalled();
      expect(wikidata.findNearbyPlaces).not.toHaveBeenCalled();
      expect(result.acceptedCount).toBe(1);
    });

    it('confirms via the article title inside a `wikipedia=xx:Title` tag, stripping the language prefix', async () => {
      const wikidata = {
        findNearbyPlaces: jest.fn(),
        getEntitySummaries: jest.fn(),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
        persistVerifiedExperience: jest
          .fn()
          .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(
            acceptedValidation('Catedral Metropolitana de Buenos Aires'),
          ),
      };
      const service = new ExperienceProposalResolverService(
        osmPlacesFor([
          {
            id: 'osm:way:1',
            // Primary name is shorter; wikipedia title bridges the gap.
            // Primary does NOT equal hint -> exactName = UNKNOWN.
            // wikipedia title matches hint -> declaredAlias = SINGLE.
            // DECLARED_ALIAS_MATCH / SINGLE -> VERIFIED without Wikidata.
            name: 'Catedral Metropolitana',
            osmType: 'way',
            osmId: 1,
            geometry: { type: 'Point', coordinates: [-58.3731, -34.6083] },
            tags: {
              wikipedia: 'es:Catedral metropolitana de Buenos Aires',
            },
          },
        ]) as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [
          candidate(
            'Catedral Metropolitana de Buenos Aires',
            'Catedral Metropolitana de Buenos Aires',
          ),
        ],
      });

      // Golden alias case 2: primary name MUST NOT equal hint.
      expect(normalizeGeoName('Catedral Metropolitana')).not.toBe(
        normalizeGeoName('Catedral Metropolitana de Buenos Aires'),
      );

      expect(wikidata.getEntitySummaries).not.toHaveBeenCalled();
      expect(wikidata.findNearbyPlaces).not.toHaveBeenCalled();
      expect(result.acceptedCount).toBe(1);
    });

    it("falls through to the geo-proximity path when none of the candidate's own name tags match the hint (regression guard: a mismatching alt_name must never reject on its own)", async () => {
      const wikidata = {
        findNearbyPlaces: jest.fn().mockResolvedValue([
          {
            qid: 'Q1',
            label: 'Museum of Latin American Art of Buenos Aires',
            latitude: -34.5771,
            longitude: -58.4036,
          },
        ]),
        getEntitySummaries: jest.fn(),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
        persistVerifiedExperience: jest
          .fn()
          .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('Museum Latin American')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlacesFor([
          {
            id: 'osm:node:1',
            name: 'Museum of Latin American Art of Buenos Aires',
            osmType: 'node',
            osmId: 1,
            geometry: { type: 'Point', coordinates: [-58.4034, -34.5769] },
            tags: { alt_name: 'MALBA' },
          },
        ]) as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [
          candidate('Museum Latin American', 'Museum Latin American'),
        ],
      });

      expect(wikidata.findNearbyPlaces).toHaveBeenCalled();
      expect(result.acceptedCount).toBe(1);
    });

    it('alias MULTIPLE -> AMBIGUOUS -> not persisted: two POI candidates declare aliases matching the same hint', async () => {
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
        persistVerifiedExperience: jest
          .fn()
          .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('Example Museum')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlacesFor([
          {
            id: 'osm:way:A',
            // Primary does NOT equal hint.
            name: 'Example Museum Historic',
            osmType: 'way',
            osmId: 1,
            geometry: { type: 'Point', coordinates: [-58.38, -34.6] },
            tags: { 'name:en': 'Example Museum' },
          },
          {
            id: 'osm:way:B',
            // Primary does NOT equal hint.
            name: 'Example Museum Annex',
            osmType: 'way',
            osmId: 2,
            geometry: { type: 'Point', coordinates: [-58.39, -34.61] },
            tags: { alt_name: 'Example Museum' },
          },
        ]) as any,
        catalog as any,
        geographicValidator as any,
      );

      const hintName = 'Example Museum';
      // Both primary names MUST NOT equal the hint.
      expect(normalizeGeoName('Example Museum Historic')).not.toBe(
        normalizeGeoName(hintName),
      );
      expect(normalizeGeoName('Example Museum Annex')).not.toBe(
        normalizeGeoName(hintName),
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate('Example Museum', hintName)],
      });

      // Two alias-matching candidates -> declaredAlias = MULTIPLE -> AMBIGUOUS.
      expect(result.acceptedCount).toBe(0);
      expect(result.resolved[0].resolvedEntities[0]).toMatchObject({
        status: 'unresolved',
        reason: 'UNCONFIRMED_MATCH',
      });
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
    });
  });

  describe("confirmMatch: direct confirmation via the hint's own addressHint", () => {
    const osmPlacesFor = (pois: any[]) => ({
      lookupStreetsWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: pois }),
    });

    it('picks and confirms the candidate whose real address matches addressHint, over one sharing the same generic name token but a different address, without ever calling Wikidata', async () => {
      const wikidata = {
        findNearbyPlaces: jest.fn(),
        getEntitySummaries: jest.fn(),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest
          .fn()
          .mockResolvedValue({ id: 'geo-recoleta-cemetery' }),
        persistVerifiedExperience: jest.fn().mockResolvedValue({
          id: 'exp-recoleta-cemetery',
          dedupeDecision: 'NEW',
        }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('Recoleta Walk')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlacesFor([
          {
            id: 'osm:node:wrong',
            name: 'Hotel Boutique Recoleta',
            osmType: 'node',
            osmId: 1,
            geometry: { type: 'Point', coordinates: [-58.39, -34.59] },
            tags: {
              'addr:street': 'Vicente López',
              'addr:housenumber': '2050',
            },
          },
          {
            id: 'osm:way:right',
            name: 'Cementerio de la Recoleta',
            osmType: 'way',
            osmId: 2,
            geometry: { type: 'Point', coordinates: [-58.3931, -34.5875] },
            tags: { 'addr:street': 'Junín', 'addr:housenumber': '1760' },
          },
        ]) as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      const withAddressHint: ExperienceCandidate = {
        name: 'Recoleta Walk',
        themes: ['history'],
        traits: [],
        intents: ['walk'],
        evidenceKeys: ['ev-1'],
        shortReason: 'Neighborhood walk',
        componentHints: [
          {
            key: 'cemetery',
            name: 'Recoleta Cemetery',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['ev-1'],
            addressHint: 'Junín 1760',
          },
        ],
      };

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [withAddressHint],
      });

      expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Cementerio de la Recoleta' }),
      );
      expect(wikidata.getEntitySummaries).not.toHaveBeenCalled();
      expect(wikidata.findNearbyPlaces).not.toHaveBeenCalled();
      expect(result.acceptedCount).toBe(1);
    });

    it('ignores addressHint entirely when absent (regression guard: every existing hint without one is unaffected)', async () => {
      const wikidata = {
        findNearbyPlaces: jest.fn(),
        getEntitySummaries: jest.fn(),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
        persistVerifiedExperience: jest
          .fn()
          .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
      };
      const geographicValidator = {
        validate: jest.fn().mockReturnValue(acceptedValidation('Museum')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlacesFor([
          {
            id: 'osm:node:1',
            name: 'Museum',
            osmType: 'node',
            osmId: 1,
            geometry: { type: 'Point', coordinates: [-58.4, -34.6] },
            tags: {},
          },
        ]) as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate()],
      });

      expect(result.acceptedCount).toBe(1);
    });
  });

  describe('entity-resolution scope narrowing (Task A6)', () => {
    it('queries the narrower entityResolutionScope for the local OSM pool, while still passing the wide destination boundary to geographic validation', async () => {
      const wideBoundary = {
        id: 'osm:relation:1',
        name: 'Buenos Aires',
        osmType: 'relation' as const,
        osmId: 1,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [] as [number, number][][],
        },
        tags: {},
      };
      const narrowBoundary = {
        id: 'osm:relation:42',
        name: 'San Telmo',
        osmType: 'relation' as const,
        osmId: 42,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [] as [number, number][][],
        },
        tags: {},
      };
      const osmPlaces = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:1',
              name: 'Mercado de San Telmo',
              osmType: 'node',
              osmId: 1,
              geometry: { type: 'Point', coordinates: [-58.37, -34.62] },
              tags: {},
            },
          ],
        }),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-mercado' }),
        persistVerifiedExperience: jest
          .fn()
          .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
      };
      const geographicValidator = {
        validate: jest.fn().mockReturnValue({
          proposalName: 'San Telmo Market Visit',
          kind: 'EXPERIENCE',
          status: 'GEO_VERIFIED',
          accepted: true,
          anchors: [],
          groundedEvidenceKeys: ['ev-1'],
          rejectionReasons: [],
          validatorVersion: 2,
        }),
      };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
      );

      await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary: wideBoundary },
        entityResolutionScope: {
          kind: 'AREA_BOUNDARY',
          boundary: narrowBoundary,
        },
        candidates: [
          candidate('San Telmo Market Visit', 'Mercado de San Telmo'),
        ],
        evidence: [{ key: 'ev-1', source: 'test', title: 'T', snippet: 'S' }],
      });

      // The local pool fetch used the NARROW scope, not the wide one.
      expect(osmPlaces.lookupPoisWithin).toHaveBeenCalledWith(narrowBoundary);
      expect(osmPlaces.lookupStreetsWithin).toHaveBeenCalledWith(
        narrowBoundary,
      );
      // Geographic validation still receives the WIDE destination boundary,
      // unchanged -- destination_mismatch semantics must not narrow.
      expect(geographicValidator.validate).toHaveBeenCalledWith(
        expect.anything(),
        wideBoundary,
        undefined,
        undefined,
        expect.objectContaining({ boundary: wideBoundary }),
      );
    });

    it('falls back to geographicScope for the local pool fetch when entityResolutionScope is absent (regression guard: every existing caller is unaffected)', async () => {
      const boundary2 = {
        id: 'osm:relation:1',
        name: 'Buenos Aires',
        osmType: 'relation' as const,
        osmId: 1,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [] as [number, number][][],
        },
        tags: {},
      };
      const osmPlaces = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn(),
        persistVerifiedExperience: jest.fn(),
      };
      const geographicValidator = { validate: jest.fn() };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
      );

      await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary: boundary2 },
        candidates: [],
        evidence: [],
      });

      expect(osmPlaces.lookupPoisWithin).toHaveBeenCalledWith(boundary2);
      expect(osmPlaces.lookupStreetsWithin).toHaveBeenCalledWith(boundary2);
    });
  });

  describe('trusted-observation reuse for web-discovered hints (P2-B, Phase 1)', () => {
    const emptyOsmPlaces = () => ({
      lookupStreetsWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupBoundaryById: jest.fn(),
    });

    const zanjonObservation: SourceObservation = {
      provider: 'google_places',
      externalId: 'ChIJABC123',
      title: 'El Zanjón de Granados',
      evidenceType: 'place',
      evidenceKey: 'google_places:ChIJABC123',
      geo: { latitude: -34.61, longitude: -58.37 },
      originationCapabilities: [],
    };

    it('does not verify a single reused observation from exact fetched name alone, and continues through the normal resolver', async () => {
      const osmPlaces = emptyOsmPlaces();
      const placesApi = {
        provider: 'google' as const,
        searchText: jest.fn(),
        getPlaceDetails: jest.fn().mockResolvedValue({
          data: {
            id: 'ChIJABC123',
            displayName: { text: 'El Zanjón de Granados' },
            formattedAddress: 'Defensa 755, Buenos Aires',
            businessStatus: 'OPERATIONAL',
          },
        }),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-zanjon' }),
        persistVerifiedExperience: jest.fn().mockResolvedValue({
          id: 'exp-zanjon',
          dedupeDecision: 'NEW',
        }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('El Zanjón de Granados')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        placesApi as any,
      );

      const webCandidate: ExperienceCandidate = {
        name: 'El Zanjón de Granados',
        themes: ['history'],
        traits: [],
        intents: ['visit'],
        evidenceKeys: ['ev-1'],
        shortReason: 'A historic house museum',
        componentHints: [
          {
            key: 'zanjon',
            name: 'El Zanjón de Granados',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['ev-1'],
          },
        ],
      };

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [webCandidate],
        observations: [zanjonObservation],
      });

      expect(placesApi.getPlaceDetails).toHaveBeenCalledWith('ChIJABC123');
      expect(result.acceptedCount).toBe(0);
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
      expect(result.resolved[0].resolvedEntities[0]).toMatchObject({
        hintKey: 'zanjon',
        status: 'unresolved',
        role: 'venue',
      });
    });

    it('does not bypass the normal confirmation gate (P0.1/P0.2): an acquired candidate whose fetched name is not exact still needs real confirmation, not automatic VERIFIED status', async () => {
      const osmPlaces = emptyOsmPlaces();
      const placesApi = {
        provider: 'google' as const,
        searchText: jest.fn(),
        getPlaceDetails: jest.fn().mockResolvedValue({
          data: {
            id: 'ChIJABC123',
            // Fetched canonical name carries a leading article the HINT
            // does not -- correlation still passes (paraphrase), but
            // confirmMatch's isExact does NOT (no wikidata configured
            // here, so there is nothing left to confirm via -- this must
            // fail closed, never auto-pass just because reuse found it).
            displayName: { text: 'El Zanjón de Granados' },
            businessStatus: 'OPERATIONAL',
          },
        }),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-zanjon' }),
        persistVerifiedExperience: jest.fn(),
      };
      const geographicValidator = { validate: jest.fn() };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        placesApi as any,
        // No wikidata configured -- confirmMatch has nothing left to
        // confirm via once isExact/addressConfirmed/own-name-tag all fail.
      );

      const webCandidate: ExperienceCandidate = {
        name: 'Zanjón de Granados',
        themes: ['history'],
        traits: [],
        intents: ['visit'],
        evidenceKeys: ['ev-1'],
        shortReason: 'A historic house museum',
        componentHints: [
          {
            key: 'zanjon',
            name: 'Zanjón de Granados',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['ev-1'],
          },
        ],
      };

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [webCandidate],
        observations: [zanjonObservation],
      });

      // Reuse DID acquire and attempt the candidate (proves this is a
      // confirmation-gate failure, not a correlation failure) --
      expect(placesApi.getPlaceDetails).toHaveBeenCalledWith('ChIJABC123');
      // -- but it was never persisted as VERIFIED.
      expect(result.acceptedCount).toBe(0);
      expect(catalog.persistVerifiedExperience).not.toHaveBeenCalled();
    });

    it('never treats a single acquired observation as proof of real-world uniqueness (P0.2): two DIFFERENT compatible observations stay AMBIGUOUS and skip reuse entirely, falling through to the normal resolver', async () => {
      const osmPlaces = emptyOsmPlaces();
      const placesApi = {
        provider: 'google' as const,
        searchText: jest.fn().mockResolvedValue({ data: [] }),
        getPlaceDetails: jest.fn(),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn(),
        persistVerifiedExperience: jest.fn(),
      };
      const geographicValidator = { validate: jest.fn() };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        placesApi as any,
      );

      const webCandidate: ExperienceCandidate = {
        name: 'El Zanjón de Granados',
        themes: ['history'],
        traits: [],
        intents: ['visit'],
        evidenceKeys: ['ev-1'],
        shortReason: 'A historic house museum',
        componentHints: [
          {
            key: 'zanjon',
            name: 'El Zanjón de Granados',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['ev-1'],
          },
        ],
      };

      const secondObservation = {
        ...zanjonObservation,
        provider: 'geoapify' as const,
        externalId: 'geo-2',
        evidenceKey: 'geoapify:geo-2',
      };

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [webCandidate],
        observations: [zanjonObservation, secondObservation],
      });

      expect(placesApi.getPlaceDetails).not.toHaveBeenCalled();
      expect(result.resolved[0].resolvedEntities[0].status).toBe('unresolved');
    });

    it('lets a failed reuse attempt continue to the normal resolver (never terminal): no compatible observation at all still resolves via the ordinary local pool match', async () => {
      const osmPlaces = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:1',
              name: 'El Zanjón de Granados',
              osmType: 'node',
              osmId: 1,
              geometry: { type: 'Point', coordinates: [-58.37, -34.61] },
              tags: {},
            },
          ],
        }),
      };
      const placesApi = {
        provider: 'google' as const,
        searchText: jest.fn(),
        getPlaceDetails: jest.fn(),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-zanjon' }),
        persistVerifiedExperience: jest.fn().mockResolvedValue({
          id: 'exp-zanjon',
          dedupeDecision: 'NEW',
        }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('El Zanjón de Granados')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        placesApi as any,
      );

      const webCandidate: ExperienceCandidate = {
        name: 'El Zanjón de Granados',
        themes: ['history'],
        traits: [],
        intents: ['visit'],
        evidenceKeys: ['ev-1'],
        shortReason: 'A historic house museum',
        componentHints: [
          {
            key: 'zanjon',
            name: 'El Zanjón de Granados',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['ev-1'],
          },
        ],
      };

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [webCandidate],
        observations: [],
      });

      expect(placesApi.getPlaceDetails).not.toHaveBeenCalled();
      expect(result.acceptedCount).toBe(1);
      expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'openstreetmap' }),
      );
    });

    it('rejects a correlated observation outside the destination scope (name correlation alone never proves geographic applicability) and falls through to the normal resolver', async () => {
      const osmPlaces = emptyOsmPlaces();
      const farAwayObservation = {
        ...zanjonObservation,
        // Nowhere near the Buenos Aires boundary used across this file.
        geo: { latitude: 40.7128, longitude: -74.006 },
      };
      const placesApi = {
        provider: 'google' as const,
        searchText: jest.fn().mockResolvedValue({ data: [] }),
        getPlaceDetails: jest.fn(),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn(),
        persistVerifiedExperience: jest.fn(),
      };
      const geographicValidator = { validate: jest.fn() };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        placesApi as any,
      );

      const webCandidate: ExperienceCandidate = {
        name: 'El Zanjón de Granados',
        themes: ['history'],
        traits: [],
        intents: ['visit'],
        evidenceKeys: ['ev-1'],
        shortReason: 'A historic house museum',
        componentHints: [
          {
            key: 'zanjon',
            name: 'El Zanjón de Granados',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['ev-1'],
          },
        ],
      };

      await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [webCandidate],
        observations: [farAwayObservation],
      });

      expect(placesApi.getPlaceDetails).not.toHaveBeenCalled();
    });

    it('rejects reuse when the fetched place has closed permanently (freshness), falling through to the normal resolver', async () => {
      const osmPlaces = emptyOsmPlaces();
      const placesApi = {
        provider: 'google' as const,
        searchText: jest.fn().mockResolvedValue({ data: [] }),
        getPlaceDetails: jest.fn().mockResolvedValue({
          data: {
            id: 'ChIJABC123',
            displayName: { text: 'El Zanjón de Granados' },
            businessStatus: 'CLOSED_PERMANENTLY',
          },
        }),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn(),
        persistVerifiedExperience: jest.fn(),
      };
      const geographicValidator = { validate: jest.fn() };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        placesApi as any,
      );

      const webCandidate: ExperienceCandidate = {
        name: 'El Zanjón de Granados',
        themes: ['history'],
        traits: [],
        intents: ['visit'],
        evidenceKeys: ['ev-1'],
        shortReason: 'A historic house museum',
        componentHints: [
          {
            key: 'zanjon',
            name: 'El Zanjón de Granados',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['ev-1'],
          },
        ],
      };

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [webCandidate],
        observations: [zanjonObservation],
      });

      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
      expect(result.acceptedCount).toBe(0);
    });

    it('never uses an externalId with a Places backend other than the one that emitted it (provider guard: an observation from geoapify must never be fetched via an active google backend, or vice versa)', async () => {
      const osmPlaces = emptyOsmPlaces();
      const geoapifyObservation = {
        ...zanjonObservation,
        provider: 'geoapify' as const,
        externalId: 'geo-1',
        evidenceKey: 'geoapify:geo-1',
      };
      const placesApi = {
        // Active backend is google, but the observation came from geoapify.
        provider: 'google' as const,
        searchText: jest.fn().mockResolvedValue({ data: [] }),
        getPlaceDetails: jest.fn(),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn(),
        persistVerifiedExperience: jest.fn(),
      };
      const geographicValidator = { validate: jest.fn() };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        placesApi as any,
      );

      const webCandidate: ExperienceCandidate = {
        name: 'El Zanjón de Granados',
        themes: ['history'],
        traits: [],
        intents: ['visit'],
        evidenceKeys: ['ev-1'],
        shortReason: 'A historic house museum',
        componentHints: [
          {
            key: 'zanjon',
            name: 'El Zanjón de Granados',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['ev-1'],
          },
        ],
      };

      await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [webCandidate],
        observations: [geoapifyObservation],
      });

      expect(placesApi.getPlaceDetails).not.toHaveBeenCalled();
    });

    it('keeps a Geoapify single-observation reuse fail-closed even when its provider namespace matches', async () => {
      const osmPlaces = emptyOsmPlaces();
      const geoapifyObservation = {
        ...zanjonObservation,
        provider: 'geoapify' as const,
        externalId: 'geo-1',
        evidenceKey: 'geoapify:geo-1',
      };
      const placesApi = {
        provider: 'geoapify' as const,
        searchText: jest.fn(),
        getPlaceDetails: jest.fn().mockResolvedValue({
          data: {
            id: 'geo-1',
            displayName: { text: 'El Zanjón de Granados' },
          },
        }),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-zanjon' }),
        persistVerifiedExperience: jest.fn().mockResolvedValue({
          id: 'exp-zanjon',
          dedupeDecision: 'NEW',
        }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('El Zanjón de Granados')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        placesApi as any,
      );

      const webCandidate: ExperienceCandidate = {
        name: 'El Zanjón de Granados',
        themes: ['history'],
        traits: [],
        intents: ['visit'],
        evidenceKeys: ['ev-1'],
        shortReason: 'A historic house museum',
        componentHints: [
          {
            key: 'zanjon',
            name: 'El Zanjón de Granados',
            role: 'venue',
            expectedKind: 'PLACE',
            required: true,
            evidenceKeys: ['ev-1'],
          },
        ],
      };

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [webCandidate],
        observations: [geoapifyObservation],
      });

      expect(placesApi.getPlaceDetails).toHaveBeenCalledWith('geo-1');
      expect(result.acceptedCount).toBe(0);
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
    });

    it.each(['area', 'route'] as const)(
      'never resolves a %s-role hint as PLACE just because a matching Places observation exists (P1: Places can never supply AREA/ROUTE geometry -- a skip here is never terminal, the hint still gets its normal kind-correction treatment)',
      async (role) => {
        const osmPlaces = emptyOsmPlaces();
        const placesApi = {
          provider: 'google' as const,
          searchText: jest.fn().mockResolvedValue({ data: [] }),
          getPlaceDetails: jest.fn(),
        };
        const catalog = {
          resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
          upsertGeoEntity: jest.fn(),
          persistVerifiedExperience: jest.fn(),
        };
        const geographicValidator = { validate: jest.fn() };
        const nominatim = { search: jest.fn().mockResolvedValue([]) };
        const service = new ExperienceProposalResolverService(
          osmPlaces as any,
          catalog as any,
          geographicValidator as any,
          undefined,
          nominatim as any,
          placesApi as any,
        );

        const webCandidate: ExperienceCandidate = {
          name: 'El Zanjón de Granados',
          themes: ['history'],
          traits: [],
          intents: ['visit'],
          evidenceKeys: ['ev-1'],
          shortReason: 'A historic walk',
          componentHints: [
            {
              key: 'zanjon',
              name: 'El Zanjón de Granados',
              role,
              expectedKind: role === 'area' ? 'AREA' : 'ROUTE',
              required: true,
              evidenceKeys: ['ev-1'],
            },
          ],
        };

        await service.resolve({
          geographicScope: { kind: 'AREA_BOUNDARY', boundary },
          candidates: [webCandidate],
          observations: [zanjonObservation],
        });

        expect(placesApi.getPlaceDetails).not.toHaveBeenCalled();
      },
    );
  });

  describe('identity verification persistence lifecycle (no catalog pollution on unverified attempts)', () => {
    it('does NOT call upsertGeoEntity when identity verification returns REJECTED', async () => {
      const osmPlaces = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:1',
              name: 'Hotel Urban Suites Recoleta',
              osmType: 'node',
              osmId: 1,
              geometry: { type: 'Point', coordinates: [-58.393, -34.587] },
              tags: { tourism: 'hotel' },
            },
          ],
        }),
        lookupBoundaryById: jest.fn(),
      };
      const wikidata = {
        findNearbyPlaces: jest.fn().mockResolvedValue([
          {
            qid: 'Q1',
            label: 'Recoleta Cemetery',
            latitude: -34.587,
            longitude: -58.393,
          },
        ]),
        getEntitySummaries: jest.fn().mockResolvedValue(new Map()),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn(),
        persistVerifiedExperience: jest.fn(),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('Recoleta Cemetery')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate('Recoleta Cemetery', 'Recoleta Cemetery')],
      });

      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
      expect(result.acceptedCount).toBe(0);
      expect(result.resolved[0].resolvedEntities[0]).toMatchObject({
        status: 'unresolved',
        reason: 'UNCONFIRMED_MATCH',
      });
      expect(
        result.resolved[0].resolvedEntities[0].geoEntityId,
      ).toBeUndefined();
    });

    it('does NOT call upsertGeoEntity when identity verification returns AMBIGUOUS', async () => {
      const osmPlaces = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:1',
              name: 'Plaza de Mayo',
              osmType: 'node',
              osmId: 1,
              geometry: { type: 'Point', coordinates: [-58.371, -34.608] },
              tags: { leisure: 'park' },
            },
            {
              id: 'osm:node:2',
              name: 'Plaza de Mayo',
              osmType: 'node',
              osmId: 2,
              geometry: { type: 'Point', coordinates: [-58.372, -34.609] },
              tags: { railway: 'station' },
            },
          ],
        }),
        lookupBoundaryById: jest.fn(),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn(),
        persistVerifiedExperience: jest.fn(),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('Plaza de Mayo')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate('Plaza de Mayo', 'Plaza de Mayo')],
      });

      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
      expect(result.acceptedCount).toBe(0);
      expect(result.resolved[0].resolvedEntities[0]).toMatchObject({
        status: 'unresolved',
        reason: 'UNCONFIRMED_MATCH',
      });
      expect(
        result.resolved[0].resolvedEntities[0].geoEntityId,
      ).toBeUndefined();
    });

    it('does NOT call upsertGeoEntity when identity verification returns INSUFFICIENT_EVIDENCE', async () => {
      const osmPlaces = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:1',
              name: 'Iglesia San Ignacio',
              osmType: 'node',
              osmId: 1,
              geometry: { type: 'Point', coordinates: [-58.374, -34.611] },
              tags: { amenity: 'place_of_worship' },
            },
          ],
        }),
        lookupBoundaryById: jest.fn(),
      };
      const wikidata = {
        findNearbyPlaces: jest
          .fn()
          .mockRejectedValue(new Error('Wikidata down')),
        getEntitySummaries: jest
          .fn()
          .mockRejectedValue(new Error('Wikidata down')),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn(),
        persistVerifiedExperience: jest.fn(),
      };
      const geographicValidator = {
        validate: jest.fn().mockReturnValue(acceptedValidation('San Ignacio')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        undefined,
        wikidata as any,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate('San Ignacio', 'San Ignacio')],
      });

      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
      expect(result.acceptedCount).toBe(0);
      expect(result.resolved[0].resolvedEntities[0]).toMatchObject({
        status: 'unresolved',
        reason: 'UNCONFIRMED_MATCH',
      });
      expect(
        result.resolved[0].resolvedEntities[0].geoEntityId,
      ).toBeUndefined();
    });

    it('calls upsertGeoEntity exactly once and returns canonical ResolvedGeoEntity when candidate is VERIFIED', async () => {
      const osmPlaces = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:10',
              name: 'Teatro Colón',
              osmType: 'node',
              osmId: 10,
              geometry: { type: 'Point', coordinates: [-58.383, -34.601] },
              tags: { amenity: 'theatre' },
            },
          ],
        }),
        lookupBoundaryById: jest.fn(),
      };
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-colon' }),
        persistVerifiedExperience: jest.fn().mockResolvedValue({
          id: 'exp-colon',
          dedupeDecision: 'NEW',
        }),
      };
      const geographicValidator = {
        validate: jest.fn().mockReturnValue(acceptedValidation('Teatro Colón')),
      };
      const service = new ExperienceProposalResolverService(
        osmPlaces as any,
        catalog as any,
        geographicValidator as any,
      );

      const result = await service.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate('Teatro Colón', 'Teatro Colón')],
      });

      expect(catalog.upsertGeoEntity).toHaveBeenCalledTimes(1);
      expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Teatro Colón',
          provider: 'openstreetmap',
          externalId: 'osm:node:10',
        }),
      );
      expect(result.acceptedCount).toBe(1);
      expect(result.resolved[0].resolvedEntities[0]).toMatchObject({
        status: 'resolved',
        geoEntityId: 'geo-colon',
        canonicalName: 'Teatro Colón',
      });
    });

    it('persists via persistVerifiedCandidate on VERIFIED and never on unverified for OSM strategy', async () => {
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-osm' }),
        persistVerifiedExperience: jest.fn().mockResolvedValue({
          id: 'exp-osm',
          dedupeDecision: 'NEW',
        }),
      };
      const geographicValidator = {
        validate: jest.fn().mockReturnValue(acceptedValidation('Museum')),
      };

      // Case A: Unverified (fuzzy mismatch without corroboration)
      const serviceUnverified = new ExperienceProposalResolverService(
        {
          lookupStreetsWithin: jest
            .fn()
            .mockResolvedValue({ status: 'success', value: [] }),
          lookupPoisWithin: jest.fn().mockResolvedValue({
            status: 'success',
            value: [
              {
                id: 'osm:node:1',
                name: 'Museum of Modern Art',
                osmType: 'node',
                osmId: 1,
                geometry: { type: 'Point', coordinates: [-58.37, -34.62] },
                tags: {},
              },
            ],
          }),
        } as any,
        catalog as any,
        geographicValidator as any,
      );
      await serviceUnverified.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate('Historical Museum', 'Historical Museum')],
      });
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();

      // Case B: Verified (exact match)
      const serviceVerified = new ExperienceProposalResolverService(
        {
          lookupStreetsWithin: jest
            .fn()
            .mockResolvedValue({ status: 'success', value: [] }),
          lookupPoisWithin: jest.fn().mockResolvedValue({
            status: 'success',
            value: [
              {
                id: 'osm:node:2',
                name: 'Historical Museum',
                osmType: 'node',
                osmId: 2,
                geometry: { type: 'Point', coordinates: [-58.37, -34.62] },
                tags: {},
              },
            ],
          }),
        } as any,
        catalog as any,
        geographicValidator as any,
      );
      const res = await serviceVerified.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate('Historical Museum', 'Historical Museum')],
      });
      expect(catalog.upsertGeoEntity).toHaveBeenCalledTimes(1);
      expect(res.resolved[0].resolvedEntities[0]).toMatchObject({
        status: 'resolved',
        geoEntityId: 'geo-osm',
        provider: 'openstreetmap',
      });
    });

    it('persists via persistVerifiedCandidate on VERIFIED and never on unverified for Nominatim strategy', async () => {
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-nom' }),
        persistVerifiedExperience: jest.fn().mockResolvedValue({
          id: 'exp-nom',
          dedupeDecision: 'NEW',
        }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('Tigre day trip')),
      };
      const emptyOsm = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupBoundaryById: jest.fn(),
      };

      // Case A: Unverified (2 exact matches -> ambiguous)
      const nominatimAmbiguous = {
        search: jest.fn().mockResolvedValue([
          {
            osmType: 'node',
            osmId: 1,
            displayName: 'Tigre, Buenos Aires',
            latitude: -34.42,
            longitude: -58.58,
            importance: 0.8,
            addresstype: 'town',
          },
          {
            osmType: 'node',
            osmId: 2,
            displayName: 'Tigre, Buenos Aires',
            latitude: -34.43,
            longitude: -58.59,
            importance: 0.7,
            addresstype: 'village',
          },
        ]),
      };
      const serviceUnverified = new ExperienceProposalResolverService(
        emptyOsm as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        nominatimAmbiguous as any,
      );
      await serviceUnverified.resolve({
        destinationName: 'Buenos Aires',
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate('Tigre day trip', 'Tigre', ['day_trip'])],
        evidence: [
          {
            key: 'ev-1',
            source: 'web',
            title: 'Tigre',
            snippet: 'Tigre near Buenos Aires',
          },
        ],
      });
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();

      // Case B: Verified (single exact match)
      const nominatimVerified = {
        search: jest.fn().mockResolvedValue([
          {
            osmType: 'node',
            osmId: 1,
            displayName: 'Tigre, Buenos Aires',
            latitude: -34.42,
            longitude: -58.58,
            importance: 0.8,
            addresstype: 'town',
          },
        ]),
      };
      const serviceVerified = new ExperienceProposalResolverService(
        emptyOsm as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        nominatimVerified as any,
      );
      const res = await serviceVerified.resolve({
        destinationName: 'Buenos Aires',
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate('Tigre day trip', 'Tigre', ['day_trip'])],
        evidence: [
          {
            key: 'ev-1',
            source: 'web',
            title: 'Tigre',
            snippet: 'Tigre near Buenos Aires',
          },
        ],
      });
      expect(catalog.upsertGeoEntity).toHaveBeenCalledTimes(1);
      expect(res.resolved[0].resolvedEntities[0]).toMatchObject({
        status: 'resolved',
        geoEntityId: 'geo-nom',
        provider: 'nominatim',
      });
    });

    it('persists via persistVerifiedCandidate on VERIFIED and never on unverified for Places strategy', async () => {
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-places' }),
        persistVerifiedExperience: jest.fn().mockResolvedValue({
          id: 'exp-places',
          dedupeDecision: 'NEW',
        }),
      };
      const geographicValidator = {
        validate: jest
          .fn()
          .mockReturnValue(acceptedValidation('Visit Café Tortoni')),
      };
      const emptyOsm = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupBoundaryById: jest.fn(),
      };
      const emptyNominatim = { search: jest.fn().mockResolvedValue([]) };

      // Case A: Unverified (2 exact matches in Places -> ambiguous)
      const placesAmbiguous = {
        provider: 'google' as const,
        searchText: jest.fn().mockResolvedValue({
          data: [
            {
              id: 'place-1',
              displayName: { text: 'Café Tortoni' },
              location: { latitude: -34.6, longitude: -58.38 },
            },
            {
              id: 'place-2',
              displayName: { text: 'Café Tortoni' },
              location: { latitude: -34.61, longitude: -58.39 },
            },
          ],
        }),
      };
      const serviceUnverified = new ExperienceProposalResolverService(
        emptyOsm as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        emptyNominatim as any,
        placesAmbiguous as any,
      );
      await serviceUnverified.resolve({
        destinationName: 'Buenos Aires',
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [
          candidate('Visit Café Tortoni', 'Café Tortoni', ['visit']),
        ],
        evidence: [
          {
            key: 'ev-1',
            source: 'web',
            title: 'Tortoni',
            snippet: 'Famous cafe in Buenos Aires',
          },
        ],
      });
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();

      // Case B: Verified (single unique match)
      const placesVerified = {
        provider: 'google' as const,
        searchText: jest.fn().mockResolvedValue({
          data: [
            {
              id: 'place-1',
              displayName: { text: 'Café Tortoni' },
              location: { latitude: -34.6084, longitude: -58.3813 },
            },
          ],
        }),
      };
      const serviceVerified = new ExperienceProposalResolverService(
        emptyOsm as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        emptyNominatim as any,
        placesVerified as any,
      );
      const res = await serviceVerified.resolve({
        destinationName: 'Buenos Aires',
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [
          candidate('Visit Café Tortoni', 'Café Tortoni', ['visit']),
        ],
        evidence: [
          {
            key: 'ev-1',
            source: 'web',
            title: 'Tortoni',
            snippet: 'Famous cafe in Buenos Aires',
          },
        ],
      });
      expect(catalog.upsertGeoEntity).toHaveBeenCalledTimes(1);
      expect(res.resolved[0].resolvedEntities[0]).toMatchObject({
        status: 'resolved',
        geoEntityId: 'geo-places',
        provider: 'google_places',
      });
    });

    it('persists via persistVerifiedCandidate on VERIFIED and never on unverified for trusted-observation reuse strategy', async () => {
      const catalog = {
        resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-reuse' }),
        persistVerifiedExperience: jest.fn().mockResolvedValue({
          id: 'exp-reuse',
          dedupeDecision: 'NEW',
        }),
      };
      const geographicValidator = {
        validate: jest.fn().mockReturnValue(acceptedValidation('El Zanjón')),
      };
      const emptyOsm = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupBoundaryById: jest.fn(),
      };

      const observation: SourceObservation = {
        provider: 'google_places',
        externalId: 'ChIJZanjon',
        title: 'El Zanjón',
        evidenceType: 'place',
        evidenceKey: 'google_places:ChIJZanjon',
        geo: { latitude: -34.61, longitude: -58.37 },
        originationCapabilities: [],
      };

      // Case A: Unverified (single observation reuse with exact name alone -> UNKNOWN multiplicity)
      const placesApi = {
        provider: 'google' as const,
        searchText: jest.fn(),
        getPlaceDetails: jest.fn().mockResolvedValue({
          data: {
            id: 'ChIJZanjon',
            displayName: { text: 'El Zanjón' },
            businessStatus: 'OPERATIONAL',
          },
        }),
      };
      const serviceUnverified = new ExperienceProposalResolverService(
        emptyOsm as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        placesApi as any,
      );
      await serviceUnverified.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate('El Zanjón', 'El Zanjón', ['visit'])],
        observations: [observation],
      });
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();

      // Case B: Verified (observation reuse with independent Wikidata corroboration)
      const wikidata = {
        findNearbyPlaces: jest.fn().mockResolvedValue([
          {
            qid: 'QZanjon',
            label: 'El Zanjón',
            latitude: -34.61,
            longitude: -58.37,
          },
        ]),
        getEntitySummaries: jest.fn().mockResolvedValue(new Map()),
      };
      const serviceVerified = new ExperienceProposalResolverService(
        emptyOsm as any,
        catalog as any,
        geographicValidator as any,
        undefined,
        undefined,
        placesApi as any,
        wikidata as any,
      );
      const res = await serviceVerified.resolve({
        geographicScope: { kind: 'AREA_BOUNDARY', boundary },
        candidates: [candidate('El Zanjón', 'El Zanjón', ['visit'])],
        observations: [observation],
      });
      expect(catalog.upsertGeoEntity).toHaveBeenCalledTimes(1);
      expect(res.resolved[0].resolvedEntities[0]).toMatchObject({
        status: 'resolved',
        geoEntityId: 'geo-reuse',
      });
    });
  });
});
