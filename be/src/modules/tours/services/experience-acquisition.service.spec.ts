import { ExperienceAcquisitionService } from './experience-acquisition.service';
import { StructuredExperienceCandidateSynthesizerService } from './structured-experience-candidate-synthesizer.service';
import { StructuredCandidateCorroborationService } from './structured-candidate-corroboration.service';
import { ExperienceAcquisitionPlan } from '../interfaces/experience-acquisition-plan.interface';

describe('ExperienceAcquisitionService', () => {
  const input = {
    latitude: -34.6037,
    longitude: -58.3816,
    radius: 5000,
    interests: ['culture'],
    maxResultCount: 20,
  };

  it('indexes every acquired Experience and exposes embedding provenance', async () => {
    const catalog = {
      acquireNearbyAsExperiences: jest.fn().mockResolvedValue({
        experienceIds: ['exp-1', 'exp-2'],
        experiences: [{ id: 'exp-1' }, { id: 'exp-2' }],
        provenance: {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: 20,
          receivedCount: 2,
        },
      }),
    };
    const embeddingIndexer = {
      index: jest.fn().mockResolvedValue({
        status: 'indexed',
        requestedIds: ['exp-1', 'exp-2'],
        indexedIds: ['exp-1', 'exp-2'],
        identity: {
          provider: 'ollama',
          model: 'nomic-embed-text',
          dimensions: 256,
          documentVersion: 2,
        },
      }),
    };
    const service = new ExperienceAcquisitionService(
      catalog as any,
      embeddingIndexer as any,
    );

    const result = await service.acquireNearby(input);

    expect(catalog.acquireNearbyAsExperiences).toHaveBeenCalledWith(input);
    expect(embeddingIndexer.index).toHaveBeenCalledWith(['exp-1', 'exp-2']);
    expect(result.provenance).toMatchObject({
      acceptedCount: 2,
      embeddedCount: 2,
      embeddingWriteStatus: 'indexed',
      embeddingIdentity: {
        model: 'nomic-embed-text',
        dimensions: 256,
        documentVersion: 2,
      },
    });
  });

  it('keeps provider unavailability observable without discarding persisted Experiences', async () => {
    const catalog = {
      acquireNearbyAsExperiences: jest.fn().mockResolvedValue({
        experienceIds: ['exp-1'],
        experiences: [{ id: 'exp-1' }],
        provenance: {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: 20,
          receivedCount: 1,
        },
      }),
    };
    const embeddingIndexer = {
      index: jest.fn().mockResolvedValue({
        status: 'unavailable',
        requestedIds: ['exp-1'],
        indexedIds: [],
        identity: {
          provider: 'ollama',
          model: 'nomic-embed-text',
          dimensions: 256,
          documentVersion: 2,
        },
        reason: 'embedding provider unavailable',
      }),
    };
    const service = new ExperienceAcquisitionService(
      catalog as any,
      embeddingIndexer as any,
    );

    const result = await service.acquireNearby(input);

    expect(result.experienceIds).toEqual(['exp-1']);
    expect(result.provenance).toMatchObject({
      acceptedCount: 1,
      embeddedCount: 0,
      embeddingWriteStatus: 'unavailable',
      embeddingFailureReason: 'embedding provider unavailable',
    });
  });

  it('still records a no-work index result for an empty acquisition', async () => {
    const catalog = {
      acquireNearbyAsExperiences: jest.fn().mockResolvedValue({
        experienceIds: [],
        experiences: [],
        provenance: {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: 20,
          receivedCount: 0,
        },
      }),
    };
    const embeddingIndexer = {
      index: jest.fn().mockResolvedValue({
        status: 'no_work',
        requestedIds: [],
        indexedIds: [],
        identity: {
          provider: 'ollama',
          model: 'nomic-embed-text',
          dimensions: 256,
          documentVersion: 2,
        },
      }),
    };
    const service = new ExperienceAcquisitionService(
      catalog as any,
      embeddingIndexer as any,
    );

    const result = await service.acquireNearby(input);

    expect(embeddingIndexer.index).toHaveBeenCalledWith([]);
    expect(result.provenance.embeddingWriteStatus).toBe('no_work');
    expect(result.provenance.embeddedCount).toBe(0);
  });

  describe('executePlan', () => {
    let googlePlacesProvider: any;
    let wikivoyageProvider: any;
    let osmProvider: any;
    let synthesizer: StructuredExperienceCandidateSynthesizerService;
    let corroborator: StructuredCandidateCorroborationService;
    let service: ExperienceAcquisitionService;

    beforeEach(() => {
      googlePlacesProvider = {
        acquire: jest.fn(),
      };
      wikivoyageProvider = {
        acquire: jest.fn(),
      };
      osmProvider = {
        acquire: jest.fn(),
      };
      synthesizer = new StructuredExperienceCandidateSynthesizerService();
      corroborator = new StructuredCandidateCorroborationService();
      service = new ExperienceAcquisitionService(
        {} as any,
        {} as any,
        googlePlacesProvider,
        wikivoyageProvider,
        synthesizer,
        corroborator,
        undefined,
        osmProvider,
      );
    });

    it('1. executes Wikivoyage and Google Places when both are planned', async () => {
      wikivoyageProvider.acquire.mockResolvedValueOnce({
        status: 'success',
        value: [
          {
            provider: 'wikivoyage',
            title: 'Plaza de Mayo',
            evidenceType: 'place',
            evidenceKey: 'wikivoyage:Monserrat:see:see:Plaza_de_Mayo:1',
            geo: { latitude: -34.6083, longitude: -58.3719 },
          },
        ],
      });

      googlePlacesProvider.acquire.mockResolvedValueOnce({
        status: 'success',
        value: [
          {
            provider: 'google_places',
            externalId: 'ChIJPlazaDeMayo',
            title: 'Plaza de Mayo',
            evidenceType: 'place',
            evidenceKey: 'google_places:ChIJPlazaDeMayo',
            geo: { latitude: -34.60835, longitude: -58.37195 },
          },
        ],
      });

      const plan: ExperienceAcquisitionPlan = {
        destination: {
          destinationName: 'Buenos Aires',
          latitude: -34.6037,
          longitude: -58.3816,
        },
        deficits: [],
        breadth: 'focused',
        sourcePlans: [
          { provider: 'wikivoyage', wikivoyage: { sections: ['SEE'] } },
          {
            provider: 'google_places',
            places: { searchTypes: ['tourist_attraction'] },
          },
        ],
      };

      const result = await service.executePlan(plan);

      expect(wikivoyageProvider.acquire).toHaveBeenCalledWith(
        plan.destination.destinationName,
        { sections: ['SEE'] },
      );
      expect(googlePlacesProvider.acquire).toHaveBeenCalledWith(
        plan.destination,
        { searchTypes: ['tourist_attraction'] },
      );
      expect(result.providerResults.wikivoyage?.status).toBe('success');
      expect(result.providerResults.google_places?.status).toBe('success');
      expect(result.observations).toHaveLength(2);
    });

    it('2. correctly merges candidates across sources through corroboration service (and eliminates duplicate Place entities)', async () => {
      wikivoyageProvider.acquire.mockResolvedValueOnce({
        status: 'success',
        value: [
          {
            provider: 'wikivoyage',
            title: 'Teatro Colón',
            evidenceType: 'place',
            evidenceKey: 'wikivoyage:San_Nicolas:see:see:Teatro_Colon:1',
            geo: { latitude: -34.601111, longitude: -58.383056 },
          },
        ],
      });

      googlePlacesProvider.acquire.mockResolvedValueOnce({
        status: 'success',
        value: [
          {
            provider: 'google_places',
            externalId: 'ChIJTeatroColon',
            title: 'Teatro Colon',
            evidenceType: 'place',
            evidenceKey: 'google_places:ChIJTeatroColon',
            geo: { latitude: -34.60115, longitude: -58.3831 },
          },
        ],
      });

      const plan: ExperienceAcquisitionPlan = {
        destination: { destinationName: 'Buenos Aires' },
        deficits: [],
        breadth: 'focused',
        sourcePlans: [
          { provider: 'wikivoyage', wikivoyage: { sections: ['SEE'] } },
          {
            provider: 'google_places',
            places: { searchTypes: ['tourist_attraction'] },
          },
        ],
      };

      const result = await service.executePlan(plan);

      // Exactly 1 merged candidate, containing both evidence keys
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].evidenceKeys).toEqual([
        'google_places:ChIJTeatroColon',
        'wikivoyage:San_Nicolas:see:see:Teatro_Colon:1',
      ]);
      expect(result.candidates[0].componentHints).toHaveLength(1);
      expect(result.candidates[0].componentHints[0].role).toBe('venue');
      expect(result.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'wikivoyage:San_Nicolas:see:see:Teatro_Colon:1',
            source: 'wikivoyage',
            title: 'Teatro Colón',
          }),
          expect.objectContaining({
            key: 'google_places:ChIJTeatroColon',
            source: 'google_places',
            title: 'Teatro Colon',
          }),
        ]),
      );
    });

    it('3. failure in Google Places does NOT fail Wikivoyage or the pass', async () => {
      wikivoyageProvider.acquire.mockResolvedValueOnce({
        status: 'success',
        value: [
          {
            provider: 'wikivoyage',
            title: 'Obelisco de Buenos Aires',
            evidenceType: 'place',
            evidenceKey: 'wikivoyage:San_Nicolas:see:see:Obelisco:1',
            geo: { latitude: -34.603722, longitude: -58.381592 },
          },
        ],
      });

      googlePlacesProvider.acquire.mockResolvedValueOnce({
        status: 'failed',
        value: [],
        failureReason: 'Google Places API quota exceeded',
      });

      const plan: ExperienceAcquisitionPlan = {
        destination: { destinationName: 'Buenos Aires' },
        deficits: [],
        breadth: 'focused',
        sourcePlans: [
          { provider: 'wikivoyage', wikivoyage: { sections: ['SEE'] } },
          {
            provider: 'google_places',
            places: { searchTypes: ['tourist_attraction'] },
          },
        ],
      };

      const result = await service.executePlan(plan);

      expect(result.providerResults.google_places?.status).toBe('failed');
      expect(result.providerResults.google_places?.failureReason).toBe(
        'Google Places API quota exceeded',
      );
      expect(result.providerResults.wikivoyage?.status).toBe('success');
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].name).toBe('Obelisco de Buenos Aires');
    });

    it('4. zero results from Google Places is handled cleanly as success with []', async () => {
      wikivoyageProvider.acquire.mockResolvedValueOnce({
        status: 'success',
        value: [],
      });

      googlePlacesProvider.acquire.mockResolvedValueOnce({
        status: 'success',
        value: [],
      });

      const plan: ExperienceAcquisitionPlan = {
        destination: { destinationName: 'Empty Place' },
        deficits: [],
        breadth: 'focused',
        sourcePlans: [
          { provider: 'wikivoyage', wikivoyage: { sections: ['SEE'] } },
          { provider: 'google_places', places: { searchTypes: [] } },
        ],
      };

      const result = await service.executePlan(plan);

      expect(result.providerResults.google_places).toEqual({
        status: 'success',
        value: [],
      });
      expect(result.candidates).toEqual([]);
      expect(result.observations).toEqual([]);
    });

    it('5. raw Google Places results do NOT bypass observation / proposal pipeline', async () => {
      const synthesizeSpy = jest.spyOn(synthesizer, 'synthesizeProposals');
      const corroborateSpy = jest.spyOn(corroborator, 'corroborateAndMerge');

      googlePlacesProvider.acquire.mockResolvedValueOnce({
        status: 'success',
        value: [
          {
            provider: 'google_places',
            externalId: 'ChIJTest',
            title: 'Test Place',
            evidenceType: 'place',
            evidenceKey: 'google_places:ChIJTest',
            geo: { latitude: -34.6, longitude: -58.38 },
          },
        ],
      });

      const plan: ExperienceAcquisitionPlan = {
        destination: { destinationName: 'Test' },
        deficits: [],
        breadth: 'focused',
        sourcePlans: [
          { provider: 'google_places', places: { searchTypes: [] } },
        ],
      };

      const result = await service.executePlan(plan);

      expect(synthesizeSpy).toHaveBeenCalledTimes(1);
      expect(corroborateSpy).toHaveBeenCalledTimes(1);
      expect(result.candidates).toHaveLength(1);
    });

    it('6. executes an osm SourcePlan and flows its observations through shared synthesis + corroboration', async () => {
      const synthesizeSpy = jest.spyOn(synthesizer, 'synthesizeProposals');
      const corroborateSpy = jest.spyOn(corroborator, 'corroborateAndMerge');

      osmProvider.acquire.mockResolvedValueOnce({
        status: 'success',
        value: [
          {
            provider: 'osm',
            externalId: 'osm:node:1',
            evidenceKey: 'osm:node:1',
            title: 'Museo Histórico Nacional',
            evidenceType: 'place',
            geo: { latitude: -34.62, longitude: -58.37 },
            metadata: {
              osmType: 'node',
              osmTags: {},
              matchedConcepts: ['museum'],
            },
          },
        ],
      });

      const plan: ExperienceAcquisitionPlan = {
        destination: {
          destinationName: 'Buenos Aires',
          latitude: -34.6037,
          longitude: -58.3816,
        },
        deficits: [],
        breadth: 'focused',
        sourcePlans: [{ provider: 'osm', osm: { concepts: ['museum'] } }],
      };

      const result = await service.executePlan(plan);

      expect(osmProvider.acquire).toHaveBeenCalledWith(plan.destination, {
        concepts: ['museum'],
      });
      expect(result.providerResults.osm?.status).toBe('success');
      expect(synthesizeSpy).toHaveBeenCalledTimes(1);
      expect(corroborateSpy).toHaveBeenCalledTimes(1);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].name).toBe('Museo Histórico Nacional');
    });

    it('7. an osm provider failure is isolated: Wikivoyage still contributes and the pass succeeds', async () => {
      wikivoyageProvider.acquire.mockResolvedValueOnce({
        status: 'success',
        value: [
          {
            provider: 'wikivoyage',
            title: 'Obelisco de Buenos Aires',
            evidenceType: 'place',
            evidenceKey: 'wikivoyage:San_Nicolas:see:see:Obelisco:1',
            geo: { latitude: -34.6037, longitude: -58.3816 },
          },
        ],
      });
      osmProvider.acquire.mockResolvedValueOnce({
        status: 'failed',
        value: [],
        failureReason: 'overpass 504',
      });

      const plan: ExperienceAcquisitionPlan = {
        destination: {
          destinationName: 'Buenos Aires',
          latitude: -34.6037,
          longitude: -58.3816,
        },
        deficits: [],
        breadth: 'focused',
        sourcePlans: [
          { provider: 'wikivoyage', wikivoyage: { sections: ['SEE'] } },
          { provider: 'osm', osm: { concepts: ['park'] } },
        ],
      };

      const result = await service.executePlan(plan);

      expect(result.providerResults.osm?.status).toBe('failed');
      expect(result.providerResults.osm?.failureReason).toBe('overpass 504');
      expect(result.providerResults.wikivoyage?.status).toBe('success');
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].name).toBe('Obelisco de Buenos Aires');
    });

    it('8. zero results from an osm SourcePlan is handled cleanly as success with []', async () => {
      osmProvider.acquire.mockResolvedValueOnce({
        status: 'success',
        value: [],
      });

      const plan: ExperienceAcquisitionPlan = {
        destination: {
          destinationName: 'Quiet Town',
          latitude: -34.6,
          longitude: -58.4,
        },
        deficits: [],
        breadth: 'focused',
        sourcePlans: [{ provider: 'osm', osm: { concepts: ['winery'] } }],
      };

      const result = await service.executePlan(plan);

      expect(result.providerResults.osm).toEqual({
        status: 'success',
        value: [],
      });
      expect(result.candidates).toEqual([]);
      expect(result.observations).toEqual([]);
    });

    it('9. an osm place observation corroborates with a Google Places observation for the same real place', async () => {
      osmProvider.acquire.mockResolvedValueOnce({
        status: 'success',
        value: [
          {
            provider: 'osm',
            externalId: 'osm:node:99',
            evidenceKey: 'osm:node:99',
            title: 'Mercado de San Telmo',
            evidenceType: 'place',
            geo: { latitude: -34.6208, longitude: -58.3717 },
            metadata: {
              osmType: 'node',
              osmTags: {},
              matchedConcepts: ['historic'],
            },
          },
        ],
      });
      googlePlacesProvider.acquire.mockResolvedValueOnce({
        status: 'success',
        value: [
          {
            provider: 'google_places',
            externalId: 'ChIJMercadoSanTelmo',
            evidenceKey: 'google_places:ChIJMercadoSanTelmo',
            evidenceType: 'place',
            title: 'Mercado de San Telmo',
            geo: { latitude: -34.62085, longitude: -58.37172 },
          },
        ],
      });

      const plan: ExperienceAcquisitionPlan = {
        destination: {
          destinationName: 'Buenos Aires',
          latitude: -34.6037,
          longitude: -58.3816,
        },
        deficits: [],
        breadth: 'focused',
        sourcePlans: [
          { provider: 'osm', osm: { concepts: ['historic'] } },
          {
            provider: 'google_places',
            places: { searchTypes: ['tourist_attraction'] },
          },
        ],
      };

      const result = await service.executePlan(plan);

      expect(result.observations).toHaveLength(2);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].evidenceKeys.sort()).toEqual([
        'google_places:ChIJMercadoSanTelmo',
        'osm:node:99',
      ]);
    });
  });

  describe('acquireNearby with ExperienceProposalResolver', () => {
    let catalog: any;
    let embeddingIndexer: any;
    let proposalResolver: any;
    let service: ExperienceAcquisitionService;

    const destinationScope = {
      boundaryGeoJson: { type: 'Polygon', coordinates: [] as any[] },
      countryCode: 'AR',
      displayName: 'Buenos Aires, Argentina',
    };

    beforeEach(() => {
      catalog = {
        acquireNearbyAsExperiences: jest.fn(),
        findVerifiedWithin: jest.fn(),
        findVerifiedByIds: jest.fn(),
      };
      embeddingIndexer = {
        index: jest.fn().mockResolvedValue({
          status: 'indexed',
          requestedIds: [],
          indexedIds: [],
        }),
      };
      proposalResolver = {
        resolve: jest.fn(),
      };
      service = new ExperienceAcquisitionService(
        catalog as any,
        embeddingIndexer as any,
        undefined,
        undefined,
        undefined,
        undefined,
        proposalResolver as any,
      );
    });

    it('B. routes candidates through proposalResolver with matching evidence when destinationBoundary is provided', async () => {
      const mockCandidate = {
        candidateId: 'cand-1',
        name: 'Teatro Colón',
        description: 'Historic opera house',
        componentHints: [{ name: 'Teatro Colón', role: 'venue' as const }],
        evidenceKeys: ['google_places:ChIJTeatroColon'],
        primaryProvider: 'google_places' as const,
      };

      const mockObservation = {
        provider: 'google_places' as const,
        externalId: 'ChIJTeatroColon',
        evidenceKey: 'google_places:ChIJTeatroColon',
        evidenceType: 'place' as const,
        title: 'Teatro Colón',
        description: 'Historic opera house in Buenos Aires',
        geo: { latitude: -34.6011, longitude: -58.3831 },
        metadata: { websiteUri: 'https://teatrocolon.org.ar' },
      };

      catalog.acquireNearbyAsExperiences.mockResolvedValueOnce({
        experienceIds: [],
        experiences: [],
        candidates: [mockCandidate],
        observations: [mockObservation],
        provenance: {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: 10,
          receivedCount: 1,
        },
      });

      proposalResolver.resolve.mockResolvedValueOnce({
        resolved: [
          {
            candidateId: 'cand-1',
            status: 'accepted',
            experienceId: 'exp-teatro-colon',
          },
        ],
        rejectedCountByReason: {},
      });

      catalog.findVerifiedByIds.mockResolvedValueOnce([
        { id: 'exp-teatro-colon', canonicalName: 'Teatro Colón' },
      ]);

      const result = await service.acquireNearby({
        latitude: -34.6011,
        longitude: -58.3831,
        radius: 3000,
        destinationName: 'Buenos Aires',
        destinationCountryCode: 'AR',
        destinationBoundary: destinationScope,
      });

      expect(proposalResolver.resolve).toHaveBeenCalledWith({
        candidates: [mockCandidate],
        destinationName: 'Buenos Aires',
        destinationCountryCode: 'AR',
        destinationBoundary: destinationScope,
        destinationPointRadius: undefined,
        evidence: [
          {
            key: 'google_places:ChIJTeatroColon',
            source: 'google_places',
            title: 'Teatro Colón',
            snippet: 'Historic opera house in Buenos Aires',
            url: 'https://teatrocolon.org.ar',
          },
        ],
      });

      // Exact accepted-id retrieval, not a broad geographic re-query.
      expect(catalog.findVerifiedByIds).toHaveBeenCalledWith([
        'exp-teatro-colon',
      ]);
      expect(catalog.findVerifiedWithin).not.toHaveBeenCalled();
      expect(result.experienceIds).toEqual(['exp-teatro-colon']);
      expect(result.experiences).toHaveLength(1);
      expect(result.experiences[0].id).toBe('exp-teatro-colon');
      expect(result.provenance.acceptedCount).toBe(1);
      // Embedding provenance is owned by the resolver and not reported here —
      // it must never be fabricated from the accepted-id count.
      expect(result.provenance.embeddingWriteStatus).toBeUndefined();
      expect(result.provenance.embeddedCount).toBeUndefined();
      expect(result.provenance.embeddingIdentity).toBeUndefined();
    });

    it('C. preserves geographic validation: rejected candidates with GEOGRAPHIC_VALIDATION_FAILED are NOT persisted', async () => {
      const mockCandidate = {
        candidateId: 'cand-faraway',
        name: 'Plaza Italia (wrong city)',
        description: 'Located 700km away',
        componentHints: [{ name: 'Plaza Italia', role: 'venue' as const }],
        evidenceKeys: ['google_places:ChIJFaraway'],
        primaryProvider: 'google_places' as const,
      };

      const mockObservation = {
        provider: 'google_places' as const,
        externalId: 'ChIJFaraway',
        evidenceKey: 'google_places:ChIJFaraway',
        evidenceType: 'place' as const,
        title: 'Plaza Italia (wrong city)',
        description: 'Located 700km away',
        geo: { latitude: -31.4, longitude: -64.18 },
      };

      catalog.acquireNearbyAsExperiences.mockResolvedValueOnce({
        experienceIds: [],
        experiences: [],
        candidates: [mockCandidate],
        observations: [mockObservation],
        provenance: {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: 10,
          receivedCount: 1,
        },
      });

      proposalResolver.resolve.mockResolvedValueOnce({
        resolved: [
          {
            candidateId: 'cand-faraway',
            status: 'rejected',
            rejectionReasons: ['GEOGRAPHIC_VALIDATION_FAILED'],
          },
        ],
        rejectedCountByReason: {
          GEOGRAPHIC_VALIDATION_FAILED: 1,
        },
      });

      const result = await service.acquireNearby({
        latitude: -34.6011,
        longitude: -58.3831,
        radius: 3000,
        destinationName: 'Buenos Aires',
        destinationCountryCode: 'AR',
        destinationBoundary: destinationScope,
      });

      expect(proposalResolver.resolve).toHaveBeenCalledTimes(1);
      expect(catalog.findVerifiedByIds).not.toHaveBeenCalled();
      expect(catalog.findVerifiedWithin).not.toHaveBeenCalled();
      expect(result.experienceIds).toEqual([]);
      expect(result.experiences).toEqual([]);
      expect(result.provenance.acceptedCount).toBe(0);
      expect(result.provenance.rejectedCountByReason).toEqual({
        GEOGRAPHIC_VALIDATION_FAILED: 1,
      });
    });

    it('D. does not persist when destinationBoundary is missing (legacy admin/refill path)', async () => {
      catalog.acquireNearbyAsExperiences.mockResolvedValueOnce({
        experienceIds: [],
        experiences: [],
        candidates: [{ candidateId: 'cand-legacy', name: 'Legacy Place' }],
        observations: [],
        provenance: {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: 10,
          receivedCount: 1,
        },
      });

      const result = await service.acquireNearby({
        latitude: -34.6011,
        longitude: -58.3831,
        radius: 3000,
      });

      expect(proposalResolver.resolve).not.toHaveBeenCalled();
      expect(result.experienceIds).toEqual([]);
      expect(result.experiences).toEqual([]);
    });

    it('16. does not call the resolver when only destinationPointRadius is present (no destinationBoundary)', async () => {
      catalog.acquireNearbyAsExperiences.mockResolvedValueOnce({
        experienceIds: [],
        experiences: [],
        candidates: [{ candidateId: 'cand-pr', name: 'Point-radius Place' }],
        observations: [],
        provenance: {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: 10,
          receivedCount: 1,
        },
      });

      const result = await service.acquireNearby({
        latitude: -34.6011,
        longitude: -58.3831,
        radius: 3000,
        destinationPointRadius: {
          latitude: -34.6011,
          longitude: -58.3831,
          radiusMeters: 3000,
        },
      });

      // pointRadius alone must never enter a resolver that requires a boundary.
      expect(proposalResolver.resolve).not.toHaveBeenCalled();
      expect(catalog.findVerifiedByIds).not.toHaveBeenCalled();
      expect(result.experienceIds).toEqual([]);
      expect(result.experiences).toEqual([]);
    });

    it('17. calls the resolver for a point-scale destination that passes a synthetic boundary alongside destinationPointRadius', async () => {
      const pointRadius = {
        latitude: -41.13,
        longitude: -71.31,
        radiusMeters: 4000,
      };
      catalog.acquireNearbyAsExperiences.mockResolvedValueOnce({
        experienceIds: [],
        experiences: [],
        candidates: [{ candidateId: 'cand-nahuel', name: 'Cerro Campanario' }],
        observations: [],
        provenance: {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: 10,
          receivedCount: 1,
        },
      });
      proposalResolver.resolve.mockResolvedValueOnce({
        resolved: [
          {
            candidateId: 'cand-nahuel',
            status: 'accepted',
            experienceId: 'exp-campanario',
          },
        ],
      });
      catalog.findVerifiedByIds.mockResolvedValueOnce([
        { id: 'exp-campanario', canonicalName: 'Cerro Campanario' },
      ]);

      const result = await service.acquireNearby({
        latitude: pointRadius.latitude,
        longitude: pointRadius.longitude,
        radius: 4000,
        destinationName: 'San Carlos de Bariloche',
        destinationBoundary: destinationScope,
        destinationPointRadius: pointRadius,
      });

      expect(proposalResolver.resolve).toHaveBeenCalledWith(
        expect.objectContaining({
          destinationBoundary: destinationScope,
          destinationPointRadius: pointRadius,
        }),
      );
      expect(result.experienceIds).toEqual(['exp-campanario']);
    });

    it('18. returns exactly the accepted resolver experienceIds, never a broader nearby pool', async () => {
      catalog.acquireNearbyAsExperiences.mockResolvedValueOnce({
        experienceIds: [],
        experiences: [],
        candidates: [{ candidateId: 'cand-new', name: 'Exp New' }],
        observations: [],
        provenance: {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: 10,
          receivedCount: 1,
        },
      });
      proposalResolver.resolve.mockResolvedValueOnce({
        resolved: [
          {
            candidateId: 'cand-new',
            status: 'accepted',
            experienceId: 'exp-new',
          },
        ],
      });
      // Catalog exact-id lookup returns only what was asked for.
      catalog.findVerifiedByIds.mockImplementationOnce(async (ids: string[]) =>
        ids.map((id) => ({ id, canonicalName: id })),
      );

      const result = await service.acquireNearby({
        latitude: -34.6011,
        longitude: -58.3831,
        radius: 3000,
        destinationName: 'Buenos Aires',
        destinationBoundary: destinationScope,
      });

      expect(catalog.findVerifiedByIds).toHaveBeenCalledWith(['exp-new']);
      expect(result.experienceIds).toEqual(['exp-new']);
      expect(result.experiences.map((exp: any) => exp.id)).toEqual(['exp-new']);
    });
  });
});
