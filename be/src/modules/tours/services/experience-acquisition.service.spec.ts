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
      synthesizer = new StructuredExperienceCandidateSynthesizerService();
      corroborator = new StructuredCandidateCorroborationService();
      service = new ExperienceAcquisitionService(
        {} as any,
        {} as any,
        googlePlacesProvider,
        wikivoyageProvider,
        synthesizer,
        corroborator,
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
  });
});
