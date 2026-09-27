import { ExperienceAcquisitionService } from './experience-acquisition.service';
import { StructuredExperienceCandidateSynthesizerService } from './structured-experience-candidate-synthesizer.service';
import { StructuredCandidateCorroborationService } from './structured-candidate-corroboration.service';
import { ExperienceAcquisitionPlan } from '../interfaces/experience-acquisition-plan.interface';
import { AcquisitionExecutionLedger } from '../utils/acquisition-source-plan-fingerprint.util';

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
        undefined,
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
            originationCapabilities: ['SINGLE_PLACE'],
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
            originationCapabilities: ['SINGLE_PLACE'],
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
        evidenceRequirements: ['SINGLE_PLACE'],
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

    it('skips an identical source plan on the second execution in one request ledger', async () => {
      wikivoyageProvider.acquire.mockResolvedValue({
        status: 'success',
        value: [],
      });
      const ledger: AcquisitionExecutionLedger = {
        executedSourcePlanFingerprints: new Set(),
      };
      const plan: ExperienceAcquisitionPlan = {
        destination: { destinationName: 'Buenos Aires' },
        deficits: [],
        evidenceRequirements: ['SINGLE_PLACE'],
        breadth: 'focused',
        sourcePlans: [
          { provider: 'wikivoyage', wikivoyage: { sections: ['DO'] } },
        ],
      };

      await service.executePlan(plan, ledger);
      const second = await service.executePlan(plan, ledger);

      expect(wikivoyageProvider.acquire).toHaveBeenCalledTimes(1);
      expect(second.executionSkipped).toEqual(
        expect.objectContaining({
          reason: 'DUPLICATE_SOURCE_PLAN_EXECUTION',
        }),
      );
    });

    it('2. correctly merges candidates across sources through corroboration service (and eliminates duplicate Place entities)', async () => {
      wikivoyageProvider.acquire.mockResolvedValueOnce({
        status: 'success',
        value: [
          {
            provider: 'wikivoyage',
            title: 'Teatro Colón',
            evidenceType: 'place',
            originationCapabilities: ['SINGLE_PLACE'],
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
            originationCapabilities: ['SINGLE_PLACE'],
            evidenceKey: 'google_places:ChIJTeatroColon',
            geo: { latitude: -34.60115, longitude: -58.3831 },
          },
        ],
      });

      const plan: ExperienceAcquisitionPlan = {
        destination: { destinationName: 'Buenos Aires' },
        deficits: [],
        evidenceRequirements: ['SINGLE_PLACE'],
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
            originationCapabilities: ['SINGLE_PLACE'],
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
        evidenceRequirements: ['SINGLE_PLACE'],
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
        evidenceRequirements: ['SINGLE_PLACE'],
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
            originationCapabilities: ['SINGLE_PLACE'],
            evidenceKey: 'google_places:ChIJTest',
            geo: { latitude: -34.6, longitude: -58.38 },
          },
        ],
      });

      const plan: ExperienceAcquisitionPlan = {
        destination: { destinationName: 'Test' },
        deficits: [],
        evidenceRequirements: ['SINGLE_PLACE'],
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

    describe('executePlan — web SourcePlan execution', () => {
      const webCandidate = {
        name: 'Palermo craft beer route',
        themes: ['food'],
        traits: ['craft beer'],
        intents: ['route_like'],
        componentHints: [
          {
            key: 'a',
            name: 'Strange Brewing',
            role: 'venue',
            expectedKind: 'PLACE',
            evidenceKeys: ['ev-1'],
          },
        ],
        evidenceKeys: ['ev-1'],
        shortReason: 'x',
      };

      const groundedResult = {
        provider: 'tavily',
        model: 'n/a',
        groundingStatus: 'applied',
        evidence: [
          { key: 'ev-1', source: 'timeout.com', title: 'T', snippet: 'S' },
        ],
        evidenceProvenance: [{ provider: 'tavily' }],
        rawOutput: 'grounded raw fixture',
      };

      const webPlan: ExperienceAcquisitionPlan = {
        destination: { destinationName: 'Buenos Aires' },
        deficits: [
          {
            dimension: 'trait',
            key: 'craft beer',
            reason: 'r',
            origin: 'preference_facet',
          },
        ],
        evidenceRequirements: ['SINGLE_PLACE'],
        breadth: 'focused',
        sourcePlans: [
          {
            provider: 'web',
            web: {
              query: 'Buenos Aires craft beer',
              preferredTraits: ['craft beer'],
              requestedThemes: ['food'],
            },
          },
        ],
      };

      it('runs grounded search + the shared discovery extractor and returns web candidates', async () => {
        const search = jest.fn().mockResolvedValue(groundedResult);
        const extractExperiences = jest.fn().mockResolvedValue({
          candidates: [webCandidate],
          validationErrors: [],
          provider: 'gemini',
          model: 'gemini-x',
          rawOutput: '{"candidates":[]}',
        });
        const service = new ExperienceAcquisitionService(
          {} as any,
          {} as any,
          { acquire: jest.fn() } as any,
          { acquire: jest.fn() } as any,
          new StructuredExperienceCandidateSynthesizerService(),
          new StructuredCandidateCorroborationService(),
          undefined,
          { search } as any,
          { extractExperiences } as any,
        );

        const result = await service.executePlan(webPlan);

        expect(search).toHaveBeenCalledTimes(1);
        expect(search.mock.calls[0][0]).toMatchObject({
          destinationName: 'Buenos Aires',
          query: 'Buenos Aires craft beer',
          requestedThemes: ['food'],
        });
        expect(extractExperiences).toHaveBeenCalledTimes(1);
        expect(extractExperiences.mock.calls[0][2]).toEqual({
          bypassCache: true,
        });
        expect(result.candidates).toHaveLength(1);
        expect(result.candidates[0].name).toBe('Palermo craft beer route');
        expect(result.webCandidateCount).toBe(1);
        expect(result.structuredCandidateCount).toBe(0);
        expect(result.webResults?.[0]).toMatchObject({
          status: 'success',
          query: 'Buenos Aires craft beer',
          groundedProvider: 'tavily',
          extractorProvider: 'gemini',
          candidateCount: 1,
          evidenceKeys: ['ev-1'],
          groundedRawOutput: 'grounded raw fixture',
          extractorRawOutput: '{"candidates":[]}',
          extractedCandidateCount: 1,
          candidateDecisions: [
            expect.objectContaining({
              accepted: true,
              reason: 'MATCHING_EVIDENCE_REQUIREMENT',
            }),
          ],
        });
        expect(result.evidence?.some((e) => e.key === 'ev-1')).toBe(true);
      });

      it('forwards anchorNames from the web plan into the grounded-search call (Task B5)', async () => {
        const search = jest.fn().mockResolvedValue(groundedResult);
        const extractExperiences = jest.fn().mockResolvedValue({
          candidates: [webCandidate],
          validationErrors: [],
          provider: 'gemini',
          model: 'gemini-x',
          rawOutput: '{"candidates":[]}',
        });
        const anchoredWebPlan: ExperienceAcquisitionPlan = {
          ...webPlan,
          sourcePlans: [
            {
              provider: 'web',
              web: {
                ...(webPlan.sourcePlans[0] as any).web,
                anchorNames: ['San Telmo', 'La Boca'],
              },
            },
          ],
        };
        const service = new ExperienceAcquisitionService(
          {} as any,
          {} as any,
          { acquire: jest.fn() } as any,
          { acquire: jest.fn() } as any,
          new StructuredExperienceCandidateSynthesizerService(),
          new StructuredCandidateCorroborationService(),
          undefined,
          { search } as any,
          { extractExperiences } as any,
        );

        const result = await service.executePlan(anchoredWebPlan);

        expect(search.mock.calls[0][0]).toMatchObject({
          anchorNames: ['San Telmo', 'La Boca'],
        });
        // C1: the same typed anchors reach the discovery extractor request
        // (not only the search query), and the Bitácora records them.
        expect(extractExperiences.mock.calls[0][0]).toMatchObject({
          anchorNames: ['San Telmo', 'La Boca'],
        });
        expect(result.webResults?.[0].extractorRequestAnchorNames).toEqual([
          'San Telmo',
          'La Boca',
        ]);
      });

      it('never invents anchorNames for a generic web plan (C3)', async () => {
        const search = jest.fn().mockResolvedValue(groundedResult);
        const extractExperiences = jest.fn().mockResolvedValue({
          candidates: [webCandidate],
          validationErrors: [],
          provider: 'cloudflare',
          model: '@cf/qwen/qwen3.8-27b',
          rawOutput: '{"candidates":[]}',
        });
        const service = new ExperienceAcquisitionService(
          {} as any,
          {} as any,
          { acquire: jest.fn() } as any,
          { acquire: jest.fn() } as any,
          new StructuredExperienceCandidateSynthesizerService(),
          new StructuredCandidateCorroborationService(),
          undefined,
          { search } as any,
          { extractExperiences } as any,
        );

        const result = await service.executePlan(webPlan);

        expect(extractExperiences).toHaveBeenCalledTimes(1);
        expect(extractExperiences.mock.calls[0][0]).not.toHaveProperty(
          'anchorNames',
        );
        expect(result.webResults?.[0]).not.toHaveProperty(
          'extractorRequestAnchorNames',
        );
      });

      it('forwards the resolved destination country code into the grounded-search request and records the applied locale', async () => {
        const search = jest.fn().mockResolvedValue({
          ...groundedResult,
          provider: 'serper',
          model: 'google-search',
          providerLocale: { gl: 'ar' },
        });
        const extractExperiences = jest.fn().mockResolvedValue({
          candidates: [webCandidate],
          validationErrors: [],
          provider: 'gemini',
          model: 'gemini-x',
          rawOutput: '{"candidates":[]}',
        });
        const service = new ExperienceAcquisitionService(
          {} as any,
          {} as any,
          { acquire: jest.fn() } as any,
          { acquire: jest.fn() } as any,
          new StructuredExperienceCandidateSynthesizerService(),
          new StructuredCandidateCorroborationService(),
          undefined,
          { search } as any,
          { extractExperiences } as any,
        );

        const result = await service.executePlan({
          ...webPlan,
          destination: {
            destinationName: 'Buenos Aires',
            destinationCountryCode: 'AR',
          },
        });

        expect(search.mock.calls[0][0]).toMatchObject({
          destinationName: 'Buenos Aires',
          destinationCountryCode: 'AR',
        });
        expect(result.webResults?.[0]).toMatchObject({
          groundedProvider: 'serper',
          groundedModel: 'google-search',
          destinationCountryCode: 'AR',
          groundedProviderLocale: { gl: 'ar' },
        });
      });

      it('sends no country code when the destination resolution had none', async () => {
        const search = jest.fn().mockResolvedValue(groundedResult);
        const service = new ExperienceAcquisitionService(
          {} as any,
          {} as any,
          { acquire: jest.fn() } as any,
          { acquire: jest.fn() } as any,
          new StructuredExperienceCandidateSynthesizerService(),
          new StructuredCandidateCorroborationService(),
          undefined,
          { search } as any,
          {
            extractExperiences: jest.fn().mockResolvedValue({
              candidates: [],
              validationErrors: [],
            }),
          } as any,
        );

        await service.executePlan(webPlan);

        expect(search.mock.calls[0][0].destinationCountryCode).toBeUndefined();
      });

      it('RW3-F2: reports a failed grounded provider as a failed source, never a silent success', async () => {
        const search = jest.fn().mockResolvedValue({
          ...groundedResult,
          provider: 'serper',
          groundingStatus: 'failed',
          failureReason: 'HTTP 401 Unauthorized',
          evidence: undefined,
        });
        const extractExperiences = jest.fn();
        const service = new ExperienceAcquisitionService(
          {} as any,
          {} as any,
          { acquire: jest.fn() } as any,
          { acquire: jest.fn() } as any,
          new StructuredExperienceCandidateSynthesizerService(),
          new StructuredCandidateCorroborationService(),
          undefined,
          { search } as any,
          { extractExperiences } as any,
        );

        const result = await service.executePlan(webPlan);

        expect(extractExperiences).not.toHaveBeenCalled();
        expect(result.webResults?.[0]).toMatchObject({
          status: 'failed',
          query: 'Buenos Aires craft beer',
          groundedProvider: 'serper',
          groundingStatus: 'failed',
          failureReason: 'HTTP 401 Unauthorized',
        });
        expect(result.webCandidateCount).toBe(0);
        expect(result.candidates).toHaveLength(0);
      });

      it('RW3-F2: reports an unavailable grounded provider as failed with its provider identity', async () => {
        const search = jest.fn().mockResolvedValue({
          ...groundedResult,
          provider: 'serper',
          groundingStatus: 'unavailable',
          failureReason: 'SERPER_API_KEY missing',
          evidence: [],
        });
        const extractExperiences = jest.fn();
        const service = new ExperienceAcquisitionService(
          {} as any,
          {} as any,
          { acquire: jest.fn() } as any,
          { acquire: jest.fn() } as any,
          new StructuredExperienceCandidateSynthesizerService(),
          new StructuredCandidateCorroborationService(),
          undefined,
          { search } as any,
          { extractExperiences } as any,
        );

        const result = await service.executePlan(webPlan);

        expect(extractExperiences).not.toHaveBeenCalled();
        expect(result.webResults?.[0]).toMatchObject({
          status: 'failed',
          query: 'Buenos Aires craft beer',
          groundedProvider: 'serper',
          groundingStatus: 'unavailable',
          failureReason: 'SERPER_API_KEY missing',
        });
        expect(result.candidates).toHaveLength(0);
      });

      it('isolates a web failure — structured providers still contribute', async () => {
        const wikivoyageProvider = {
          acquire: jest.fn().mockResolvedValue({
            status: 'success',
            value: [
              {
                provider: 'wikivoyage',
                title: 'Teatro Colón',
                evidenceType: 'place',
                originationCapabilities: ['SINGLE_PLACE'],
                evidenceKey: 'wikivoyage:x:see:see:Teatro:1',
                geo: { latitude: -34.6011, longitude: -58.3831 },
              },
            ],
          }),
        };
        const search = jest.fn().mockRejectedValue(new Error('tavily 503'));
        const service = new ExperienceAcquisitionService(
          {} as any,
          {} as any,
          { acquire: jest.fn() } as any,
          wikivoyageProvider as any,
          new StructuredExperienceCandidateSynthesizerService(),
          new StructuredCandidateCorroborationService(),
          undefined,
          { search } as any,
          { extractExperiences: jest.fn() } as any,
        );

        const result = await service.executePlan({
          ...webPlan,
          sourcePlans: [
            { provider: 'wikivoyage', wikivoyage: { sections: ['SEE'] } },
            webPlan.sourcePlans[0],
          ],
        });

        expect(result.webResults?.[0]).toMatchObject({
          status: 'failed',
          failureReason: 'tavily 503',
        });
        expect(result.structuredCandidateCount).toBe(1);
        expect(result.candidates).toHaveLength(1);
      });

      it('reports "skipped" when web discovery providers are not configured', async () => {
        const service = new ExperienceAcquisitionService(
          {} as any,
          {} as any,
          { acquire: jest.fn() } as any,
          { acquire: jest.fn() } as any,
          new StructuredExperienceCandidateSynthesizerService(),
          new StructuredCandidateCorroborationService(),
          undefined,
          // no groundedSearchProvider / discoveryExtractor
        );

        const result = await service.executePlan(webPlan);
        expect(result.webResults?.[0]).toMatchObject({
          status: 'skipped',
          failureReason: 'web discovery providers not configured',
        });
        expect(result.candidates).toHaveLength(0);
      });

      /**
       * Source-composition-authority correction seam test: a raw extracted
       * candidate that fails the deterministic source-support gate never
       * becomes a canonical `ExperienceCandidate` (see
       * experience-candidate-extraction.util.ts). This proves the wiring at
       * this service boundary: such a candidate must not reach
       * `candidateDecisions` (which only evaluates canonical candidates
       * against evidence requirements) nor `execution.candidates` (which
       * feeds `ExperienceProposalResolver`/materialization) -- it is only
       * observable via `webResults[].sourceSupportAudits`.
       */
      it('never threads a SOURCE_CONTRACT_VIOLATION raw candidate into candidateDecisions or execution.candidates, only into sourceSupportAudits', async () => {
        const search = jest.fn().mockResolvedValue(groundedResult);
        const extractExperiences = jest.fn().mockResolvedValue({
          // The extractor itself already rejected the raw candidate at
          // extraction time -- no canonical ExperienceCandidate is emitted.
          candidates: [],
          validationErrors: [
            'Candidate 1: SOURCE_CONTRACT_VIOLATION: component 1 (Basílica de Santa Mónica) unsupported: SPAN_NOT_FOUND_IN_CITED_EVIDENCE',
          ],
          sourceSupportAudits: [
            {
              candidateName: 'San Telmo Historic Walk',
              status: 'SOURCE_CONTRACT_VIOLATION',
              emittedComponentCount: 1,
              supportedComponentCount: 0,
              unsupportedComponentCount: 1,
              components: [
                {
                  index: 0,
                  key: 'basilica-santa-monica',
                  name: 'Basílica de Santa Mónica',
                  role: 'waypoint',
                  expectedKind: 'PLACE',
                  evidenceKeys: ['ev-11'],
                  status: 'UNSUPPORTED',
                  reason: 'SPAN_NOT_FOUND_IN_CITED_EVIDENCE',
                },
              ],
            },
          ],
          provider: 'gemini',
          model: 'gemini-x',
          rawOutput: '{"candidates":[]}',
        });
        const service = new ExperienceAcquisitionService(
          {} as any,
          {} as any,
          { acquire: jest.fn() } as any,
          { acquire: jest.fn() } as any,
          new StructuredExperienceCandidateSynthesizerService(),
          new StructuredCandidateCorroborationService(),
          undefined,
          { search } as any,
          { extractExperiences } as any,
        );

        const result = await service.executePlan(webPlan);

        expect(result.candidates).toHaveLength(0);
        expect(result.webResults?.[0]?.candidateDecisions).toEqual([]);
        expect(result.webResults?.[0]?.extractedCandidateCount).toBe(0);
        expect(result.webResults?.[0]?.candidateCount).toBe(0);
        expect(result.webResults?.[0]?.sourceSupportAudits).toEqual([
          expect.objectContaining({
            candidateName: 'San Telmo Historic Walk',
            status: 'SOURCE_CONTRACT_VIOLATION',
            unsupportedComponentCount: 1,
          }),
        ]);
        expect(result.webResults?.[0]?.validationErrors.join(' ')).toContain(
          'SOURCE_CONTRACT_VIOLATION',
        );
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

      it('B. routes candidates through proposalResolver with matching evidence when geographic scope is provided', async () => {
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
          sourceUrl: 'https://teatrocolon.org.ar',
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
          geographicScope: {
            kind: 'AREA_BOUNDARY',
            boundary: destinationScope as any,
          },
        });

        expect(proposalResolver.resolve).toHaveBeenCalledWith({
          candidates: [mockCandidate],
          destinationName: 'Buenos Aires',
          destinationCountryCode: 'AR',
          geographicScope: {
            kind: 'AREA_BOUNDARY',
            boundary: destinationScope as any,
          },
          evidence: [
            {
              key: 'google_places:ChIJTeatroColon',
              source: 'google_places',
              title: 'Teatro Colón',
              snippet: 'Historic opera house in Buenos Aires',
              url: 'https://teatrocolon.org.ar',
            },
          ],
          observations: [mockObservation],
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
          geographicScope: {
            kind: 'AREA_BOUNDARY',
            boundary: destinationScope as any,
          },
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

      it('D. does not persist when geographic scope is missing (admin/refill path)', async () => {
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

      it('16. sends a point-radius geographic scope directly to the resolver', async () => {
        proposalResolver.resolve.mockResolvedValueOnce({
          totalCandidates: 1,
          acceptedCount: 0,
          rejectedCount: 0,
          resolved: [],
        });
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
          geographicScope: {
            kind: 'POINT_RADIUS',
            latitude: -34.6011,
            longitude: -58.3831,
            radiusMeters: 3000,
          },
        });

        expect(proposalResolver.resolve).toHaveBeenCalledWith(
          expect.objectContaining({
            geographicScope: {
              kind: 'POINT_RADIUS',
              latitude: -34.6011,
              longitude: -58.3831,
              radiusMeters: 3000,
            },
          }),
        );
        expect(catalog.findVerifiedByIds).not.toHaveBeenCalled();
        expect(result.experienceIds).toEqual([]);
        expect(result.experiences).toEqual([]);
      });

      it('17. calls the resolver for a point-scale destination using POINT_RADIUS scope', async () => {
        const pointRadius = {
          latitude: -41.13,
          longitude: -71.31,
          radiusMeters: 4000,
        };
        catalog.acquireNearbyAsExperiences.mockResolvedValueOnce({
          experienceIds: [],
          experiences: [],
          candidates: [
            { candidateId: 'cand-nahuel', name: 'Cerro Campanario' },
          ],
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
          geographicScope: { kind: 'POINT_RADIUS', ...pointRadius },
        });

        expect(proposalResolver.resolve).toHaveBeenCalledWith(
          expect.objectContaining({
            geographicScope: { kind: 'POINT_RADIUS', ...pointRadius },
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
        catalog.findVerifiedByIds.mockImplementationOnce(
          async (ids: string[]) => ids.map((id) => ({ id, canonicalName: id })),
        );

        const result = await service.acquireNearby({
          latitude: -34.6011,
          longitude: -58.3831,
          radius: 3000,
          destinationName: 'Buenos Aires',
          geographicScope: {
            kind: 'AREA_BOUNDARY',
            boundary: destinationScope as any,
          },
        });

        expect(catalog.findVerifiedByIds).toHaveBeenCalledWith(['exp-new']);
        expect(result.experienceIds).toEqual(['exp-new']);
        expect(result.experiences.map((exp: any) => exp.id)).toEqual([
          'exp-new',
        ]);
      });
    });

    describe('materializeExecution — cutover M4 shared classification boundary', () => {
      let catalog: any;
      let embeddingIndexer: any;
      let proposalResolver: any;
      let classifier: any;

      beforeEach(() => {
        catalog = {
          findVerifiedByIds: jest.fn().mockResolvedValue([
            {
              id: 'exp-1',
              canonicalName: 'San Telmo Historical Walk',
              metadata: {},
            },
          ]),
          applyEvidenceClassification: jest.fn().mockResolvedValue(undefined),
        };
        embeddingIndexer = { index: jest.fn() };
        proposalResolver = {
          resolve: jest.fn().mockResolvedValue({
            resolved: [
              {
                status: 'accepted',
                experienceId: 'exp-1',
                candidate: { evidenceKeys: ['ev-1'] },
              },
            ],
          }),
        };
        classifier = {
          classify: jest.fn().mockResolvedValue({
            state: 'classified',
            promptVersion: 1,
            modelId: 'groq/qwen',
            themes: [],
            intents: ['walk'],
            traits: [],
            reasoningEvidence: [
              { facet: 'intent:walk', evidenceKeys: ['ev-1'], reason: 'r' },
            ],
          }),
        };
      });

      function buildService(withClassifier: boolean) {
        return new ExperienceAcquisitionService(
          catalog as any,
          embeddingIndexer as any,
          undefined,
          undefined,
          undefined,
          undefined,
          proposalResolver as any,
          undefined,
          undefined,
          withClassifier ? (classifier as any) : undefined,
        );
      }

      // 1. generic acquisition gets classified before/at canonical persistence
      it("classifies every accepted result exactly once, using this call's own evidence, when a classifier is configured", async () => {
        const service = buildService(true);

        const response = await service.materializeExecution(
          {
            candidates: [],
            observations: [],
            providerResults: {},
            evidence: [{ key: 'ev-1', source: 'x', snippet: 'real evidence' }],
          } as any,
          {
            geographicScope: {
              kind: 'AREA_BOUNDARY',
              boundary: { id: 'osm:relation:1' } as any,
            },
          },
        );

        expect(classifier.classify).toHaveBeenCalledTimes(1);
        expect(classifier.classify).toHaveBeenCalledWith(
          'San Telmo Historical Walk',
          [{ key: 'ev-1', source: 'x', snippet: 'real evidence' }],
        );
        expect(catalog.applyEvidenceClassification).toHaveBeenCalledWith(
          'exp-1',
          expect.objectContaining({ intents: ['walk'] }),
        );
        // The resolver's own response is still returned unchanged.
        expect(response.resolved).toHaveLength(1);
      });

      // 3. valid current classification is reused
      it('reuses a valid current classification instead of recomputing it', async () => {
        catalog.findVerifiedByIds.mockResolvedValue([
          {
            id: 'exp-1',
            canonicalName: 'San Telmo Historical Walk',
            metadata: {
              intents: ['walk'],
              classification: {
                state: 'classified',
                promptVersion: 1,
                modelId: 'groq/qwen',
                themes: [],
                intents: ['walk'],
                traits: [],
                reasoningEvidence: [
                  {
                    facet: 'intent:walk',
                    evidenceKeys: ['ev-existing'],
                    reason: 'already substantiated',
                  },
                ],
              },
            },
          },
        ]);
        const service = buildService(true);

        await service.materializeExecution(
          {
            candidates: [],
            observations: [],
            providerResults: {},
            evidence: [{ key: 'ev-1', source: 'x', snippet: 'real evidence' }],
          } as any,
          {
            geographicScope: {
              kind: 'AREA_BOUNDARY',
              boundary: { id: 'osm:relation:1' } as any,
            },
          },
        );

        expect(classifier.classify).not.toHaveBeenCalled();
        expect(catalog.applyEvidenceClassification).not.toHaveBeenCalled();
      });

      it('never calls the classifier when none is configured (backward-compatible optional dependency)', async () => {
        const service = buildService(false);

        await service.materializeExecution(
          {
            candidates: [],
            observations: [],
            providerResults: {},
            evidence: [{ key: 'ev-1', source: 'x', snippet: 'real evidence' }],
          } as any,
          {
            geographicScope: {
              kind: 'AREA_BOUNDARY',
              boundary: { id: 'osm:relation:1' } as any,
            },
          },
        );

        expect(classifier.classify).not.toHaveBeenCalled();
        expect(catalog.applyEvidenceClassification).not.toHaveBeenCalled();
      });

      it('never calls the classifier when nothing was accepted', async () => {
        proposalResolver.resolve.mockResolvedValue({
          resolved: [
            {
              status: 'rejected',
              rejectionReasons: ['geographic_incoherence'],
            },
          ],
        });
        const service = buildService(true);

        await service.materializeExecution(
          { candidates: [], observations: [], providerResults: {} } as any,
          {
            geographicScope: {
              kind: 'AREA_BOUNDARY',
              boundary: { id: 'osm:relation:1' } as any,
            },
          },
        );

        expect(classifier.classify).not.toHaveBeenCalled();
      });

      it('forwards entityResolutionScope into the resolver request (Task A6)', async () => {
        const narrowScope = {
          kind: 'AREA_BOUNDARY' as const,
          boundary: {} as any,
        };
        proposalResolver.resolve.mockResolvedValue({
          resolved: [],
          acceptedCount: 0,
          rejectedCount: 0,
          totalCandidates: 0,
          entityResolution: {
            totalCandidates: 0,
            acceptedCount: 0,
            rejectedCount: 0,
            resolved: [],
          },
          geographicValidation: {
            results: [],
            acceptedCount: 0,
            rejectedCount: 0,
          },
        });
        const service = buildService(false);

        await service.materializeExecution(
          { candidates: [], observations: [], providerResults: {} } as any,
          {
            destinationName: 'Buenos Aires',
            entityResolutionScope: narrowScope,
          },
        );

        expect(proposalResolver.resolve).toHaveBeenCalledWith(
          expect.objectContaining({ entityResolutionScope: narrowScope }),
        );
      });
    });
  });
});
