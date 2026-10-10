import {
  NO_GEOGRAPHIC_GRANT,
  ownedIntentGrant,
  withDefaultGeographicAuthorization,
} from '../utils/geographic-validation-authorization.util';
import { geographicIntentDeficit } from '../fixtures/geographic-authorization.fixture';
import {
  ExperienceAcquisitionService,
  WebAcquisitionResult,
} from './experience-acquisition.service';
import { StructuredExperienceCandidateSynthesizerService } from './structured-experience-candidate-synthesizer.service';
import { StructuredCandidateCorroborationService } from './structured-candidate-corroboration.service';
import { ExperienceAcquisitionPlan } from '../interfaces/experience-acquisition-plan.interface';
import { AcquisitionExecutionLedger } from '../utils/acquisition-source-plan-fingerprint.util';
import {
  DEFAULT_WEB_SOURCE_CONTENT_MAX_CHARS,
  DEFAULT_WEB_SOURCE_UNIT_MAX_CHARS,
} from '../interfaces/web-source-content.interface';
import { windowSourceContentSequence } from '../utils/source-content-windowing.util';
import { extractExperienceCandidates } from '../utils/experience-candidate-extraction.util';
import {
  readAtomizedFixture,
  recordedAtomTransport,
  recordedRun,
} from '../fixtures/atomized-source-units.fixture';
import { AtomizedSourceUnitExtractor } from './atomized-source-unit-extractor';
import { GenerationTraceRecorder } from '../utils/generation-trace-recorder.util';
import { recordAcquisitionLifecycle } from '../utils/experience-generation-trace.util';

/**
 * Double of the complete-unit composition authority (milestone B): a
 * complete SECTION_UNIT window goes to it, never to the generative
 * extractor. `candidatesFor` decides what the unit yields.
 */
function atomizedExtractorDouble(
  candidatesFor: (input: { content: string }) => any[] = () => [],
) {
  return {
    extract: jest.fn().mockImplementation((input: { content: string }) =>
      Promise.resolve({
        candidates: candidatesFor(input),
        validationErrors: [],
        extractionFailures: [],
        sourceSupportAudits: [],
        provider: 'gemini',
        model: 'gemini-x',
        unit: { contractOutcome: 'ASSEMBLED', providerFailure: null },
      }),
    ),
  };
}

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
          extractionFailures: [],
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
          extractionFailures: [],
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
          extractionFailures: [],
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
          extractionFailures: [],
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
              extractionFailures: [],
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
          extractionFailures: [],
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

      describe('deep source content retrieval on composition gap', () => {
        const multiComponentWebPlan: ExperienceAcquisitionPlan = {
          destination: { destinationName: 'Buenos Aires' },
          deficits: [],
          evidenceRequirements: ['MULTI_COMPONENT_EXPERIENCE'],
          breadth: 'focused',
          sourcePlans: [
            {
              provider: 'web',
              web: {
                query: 'Buenos Aires historic walk',
                requestedThemes: ['history'],
              },
            },
          ],
        };

        const groundedWithUrls = {
          provider: 'tavily',
          model: 'n/a',
          groundingStatus: 'applied',
          evidence: [
            {
              key: 'ev-1',
              source: 'buenosaires.travel',
              title: 'San Telmo Walk',
              snippet: 'A great walk in San Telmo',
              url: 'https://buenosaires.travel/san-telmo-walk',
            },
            {
              key: 'ev-2',
              source: 'travelblog.com',
              title: 'La Boca Walk',
              snippet: 'Walk through Caminito',
              url: 'https://travelblog.com/la-boca',
            },
            {
              key: 'ev-3',
              source: 'other.com',
              title: 'Recoleta Walk',
              snippet: 'Walk around cemetery',
              url: 'https://other.com/recoleta',
            },
          ],
          rawOutput: 'grounded raw fixture',
        };

        it('triggers deep retrieval when MULTI_COMPONENT_EXPERIENCE has a composition gap, enriches evidence, and re-extracts', async () => {
          const search = jest.fn().mockResolvedValue(groundedWithUrls);
          const singleComponentCandidate = {
            name: 'San Telmo partial walk',
            themes: ['history'],
            componentHints: [
              {
                key: 'c1',
                name: 'Plaza Dorrego',
                role: 'venue',
                expectedKind: 'PLACE',
                evidenceKeys: ['ev-1'],
              },
            ],
            evidenceKeys: ['ev-1'],
            shortReason: 'Single stop found in snippet',
          };

          const fullMultiComponentCandidate = {
            name: 'San Telmo complete walk',
            themes: ['history'],
            componentHints: [
              {
                key: 'c1',
                name: 'Plaza Dorrego',
                role: 'venue',
                expectedKind: 'PLACE',
                evidenceKeys: ['ev-1'],
              },
              {
                key: 'c2',
                name: 'Parque Lezama',
                role: 'venue',
                expectedKind: 'PLACE',
                evidenceKeys: ['ev-1'],
              },
            ],
            evidenceKeys: ['ev-1'],
            shortReason: 'Multi-stop route found in full text',
          };

          const extractExperiences = jest
            .fn()
            .mockResolvedValueOnce({
              candidates: [singleComponentCandidate],
              extractionFailures: [],
              validationErrors: [],
              provider: 'gemini',
              model: 'gemini-x',
              rawOutput: '{"candidates":[...]}',
            })
            .mockResolvedValueOnce({
              candidates: [fullMultiComponentCandidate],
              extractionFailures: [],
              validationErrors: [],
              provider: 'gemini',
              model: 'gemini-x',
              rawOutput: '{"candidates":[...]}',
            });

          const webSourceContentProvider: any = {
            providerName: 'tavily',
            retrieve: jest.fn().mockResolvedValue({
              provider: 'tavily',
              requestedCount: 2,
              retrievedCount: 1,
              items: [
                {
                  requestedUrl: 'https://buenosaires.travel/san-telmo-walk',
                  status: 'retrieved',
                  contentType: 'markdown',
                  content:
                    'Full article: Start at Plaza Dorrego, explore the antique market, then walk along Defensa to Parque Lezama.',
                  contentChars: 120,
                  truncated: false,
                  provider: 'tavily',
                  durationMs: 50,
                },
              ],
              totalDurationMs: 60,
            }),
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
            undefined,
            webSourceContentProvider,
          );

          const result = await service.executePlan(multiComponentWebPlan);

          expect(webSourceContentProvider.retrieve).toHaveBeenCalledTimes(1);
          expect(
            webSourceContentProvider.retrieve.mock.calls[0][0].urls,
          ).toHaveLength(2);
          expect(extractExperiences).toHaveBeenCalledTimes(2);

          const secondExtractionEvidence =
            extractExperiences.mock.calls[1][1].evidence;
          const enrichedItem = secondExtractionEvidence.find(
            (e: any) => e.key === 'ev-1',
          );
          expect(enrichedItem.evidenceQuality).toBe('original_content');
          expect(enrichedItem.snippet).toContain(
            'Full article: Start at Plaza Dorrego',
          );

          expect(result.webResults?.[0].sourceContentRetrieval).toMatchObject({
            attempted: true,
            provider: 'tavily',
            reExtractionAttempted: true,
            requestedUrls: [
              'https://buenosaires.travel/san-telmo-walk',
              'https://travelblog.com/la-boca',
            ],
            retrievedUrls: ['https://buenosaires.travel/san-telmo-walk'],
          });
          expect(result.candidates).toHaveLength(1);
          expect(result.candidates[0].name).toBe('San Telmo complete walk');
        });

        describe.each(['tavily', 'cloudflare'] as const)(
          'canonical source-content windowing (%s transport)',
          (providerName) => {
            const intro = Array.from(
              { length: 90 },
              (_, i) =>
                `Intro paragraph ${i}: the neighborhood is lively, prices went up and hotels are plentiful.`,
            ).join('\n\n');
            const lateSection = [
              '## Sample San Telmo Itineraries',
              '',
              '### Morning Itinerary',
              '',
              'Start at Plaza Dorrego, then walk down Defensa to Parque Lezama.',
            ].join('\n');
            const fullContent = `# San Telmo Walk\n\n${intro}\n\n${lateSection}\n\n## Outro\n\n${intro}`;

            it('windows the complete retrieved source by relevance before re-extraction, identically for every transport', async () => {
              expect(fullContent.indexOf('Parque Lezama')).toBeGreaterThan(
                DEFAULT_WEB_SOURCE_CONTENT_MAX_CHARS,
              );
              const grounded = {
                ...groundedWithUrls,
                evidence: groundedWithUrls.evidence.map((e) =>
                  e.key === 'ev-1'
                    ? {
                        ...e,
                        snippet: 'First hand tips and sample itineraries',
                      }
                    : e,
                ),
              };
              const extractExperiences = jest.fn().mockResolvedValue({
                candidates: [],
                extractionFailures: [],
                validationErrors: [],
                provider: 'gemini',
                model: 'gemini-x',
                rawOutput: '{"candidates":[]}',
              });
              const webSourceContentProvider: any = {
                providerName,
                retrieve: jest.fn().mockResolvedValue({
                  provider: providerName,
                  requestedCount: 2,
                  retrievedCount: 1,
                  items: [
                    {
                      requestedUrl: 'https://buenosaires.travel/san-telmo-walk',
                      status: 'retrieved',
                      contentType: 'markdown',
                      content: fullContent,
                      contentChars: fullContent.length,
                      provider: providerName,
                    },
                  ],
                  totalDurationMs: 10,
                }),
              };

              const atomized = atomizedExtractorDouble();
              const service = new ExperienceAcquisitionService(
                {} as any,
                {} as any,
                { acquire: jest.fn() } as any,
                { acquire: jest.fn() } as any,
                new StructuredExperienceCandidateSynthesizerService(),
                new StructuredCandidateCorroborationService(),
                undefined,
                { search: jest.fn().mockResolvedValue(grounded) } as any,
                { extractExperiences } as any,
                undefined,
                webSourceContentProvider,
                atomized as any,
              );

              const result = await service.executePlan(multiComponentWebPlan);

              const windows = windowSourceContentSequence(
                fullContent,
                {
                  titles: ['San Telmo Walk'],
                  snippets: ['First hand tips and sample itineraries'],
                  queries: ['Buenos Aires historic walk'],
                },
                DEFAULT_WEB_SOURCE_CONTENT_MAX_CHARS,
                DEFAULT_WEB_SOURCE_UNIT_MAX_CHARS,
              );
              // Nothing qualifies, so every window is examined exactly once:
              // window 1 is the complete itinerary unit, so the atomized
              // contract examines it and the generative extractor never sees
              // it; every other window stays generative.
              expect(windows[0].audit).toMatchObject({
                selectionStrategy: 'SECTION_UNIT',
                sectionComplete: true,
              });
              expect(atomized.extract).toHaveBeenCalledTimes(1);
              expect(extractExperiences).toHaveBeenCalledTimes(
                1 + windows.length - 1,
              );
              const unit = atomized.extract.mock.calls[0][0];
              expect(unit).toMatchObject({
                sourceUrl: 'https://buenosaires.travel/san-telmo-walk',
                evidenceKey: 'ev-1',
                windowing: windows[0].audit,
              });
              expect(unit.content.length).toBeLessThanOrEqual(
                DEFAULT_WEB_SOURCE_UNIT_MAX_CHARS,
              );
              expect(unit.content).toContain(
                'Start at Plaza Dorrego, then walk down Defensa to Parque Lezama.',
              );
              expect(unit.content).toBe(windows[0].content);
              for (const call of extractExperiences.mock.calls.slice(1)) {
                const deep = call[1].evidence.find(
                  (e: any) => e.key === 'ev-1',
                );
                expect(deep.snippet).not.toBe(windows[0].content);
              }

              const traceItem =
                result.webResults?.[0].sourceContentRetrieval?.items[0];
              expect(traceItem).not.toHaveProperty('content');
              expect(traceItem?.contentChars).toBe(fullContent.length);
              expect(traceItem?.windowSequence).toEqual(
                windows.map((w) => w.audit),
              );
              // Window 1 is the advertised itinerary section, whole.
              expect(traceItem?.windowSequence?.[0]).toMatchObject({
                selectionStrategy: 'SECTION_UNIT',
                sectionComplete: true,
                originalContentChars: fullContent.length,
                retainedContentChars: unit.content.length,
                maxChars: DEFAULT_WEB_SOURCE_CONTENT_MAX_CHARS,
                unitMaxChars: DEFAULT_WEB_SOURCE_UNIT_MAX_CHARS,
                truncated: true,
              });
            });
          },
        );

        describe('progressive deep-source window scan', () => {
          const URL_A = 'https://buenosaires.travel/san-telmo-walk';
          const URL_B = 'https://travelblog.com/la-boca';

          /** ~350 chars of prose carrying `marker`. */
          const paragraph = (label: string, marker: string) =>
            `${marker} ${Array.from(
              { length: 4 },
              (_, i) =>
                `${label} sentence ${i} describes ordinary scenery and transport in plain words.`,
            ).join(' ')}`;

          // The composition sits in an early section the snippet does not
          // advertise; the advertised ("zebra") prose fills window 1, so
          // the composition first appears in window 2 (document order).
          const composition =
            'Start at Plaza Dorrego, then walk to Parque Lezama and finish at Caminito.';
          const pageWithLateWindowComposition = [
            '# Guide',
            '',
            '## Itinerary',
            '',
            `${composition} ${'Plain words about the day follow here. '.repeat(25)}`,
            '',
            '## Notes',
            '',
            // Longer than one editorial unit: walked in runs, never whole.
            Array.from({ length: 80 }, (_, i) =>
              paragraph(`Notes-${i}`, 'zebra quokka'),
            ).join('\n\n'),
          ].join('\n');

          const groundedAdvertisingZebra = {
            ...groundedWithUrls,
            evidence: groundedWithUrls.evidence.map((e) =>
              e.key === 'ev-1' ? { ...e, snippet: 'zebra quokka notes' } : e,
            ),
          };

          const hint = (key: string, name: string, evidenceKey = 'ev-1') => ({
            key,
            name,
            role: 'venue',
            expectedKind: 'PLACE',
            evidenceKeys: [evidenceKey],
          });
          const walk = (name: string, ...hints: any[]) => ({
            name,
            themes: ['history'],
            componentHints: hints,
            evidenceKeys: [...new Set(hints.flatMap((h) => h.evidenceKeys))],
            shortReason: 'fixture',
          });
          const extraction = (candidates: any[], extra: any = {}) => ({
            candidates,
            extractionFailures: [],
            validationErrors: [],
            provider: 'gemini',
            model: 'gemini-x',
            rawOutput: '{"candidates":[]}',
            ...extra,
          });
          const deepEvidence = (call: any[]) =>
            call[1].evidence.filter(
              (e: any) => e.evidenceQuality === 'original_content',
            );

          function serviceFor(
            pages: Record<string, string>,
            extractExperiences: jest.Mock,
            grounded: any = groundedAdvertisingZebra,
            evidenceRequirements: ExperienceAcquisitionPlan['evidenceRequirements'] = [
              'MULTI_COMPONENT_EXPERIENCE',
            ],
            atomized = atomizedExtractorDouble(),
          ) {
            const retrieve = jest.fn().mockResolvedValue({
              provider: 'cloudflare',
              requestedCount: 2,
              retrievedCount: Object.keys(pages).length,
              items: Object.entries(pages).map(([url, content]) => ({
                requestedUrl: url,
                status: 'retrieved',
                contentType: 'markdown',
                content,
                contentChars: content.length,
                provider: 'cloudflare',
              })),
              totalDurationMs: 10,
            });
            const service = new ExperienceAcquisitionService(
              {} as any,
              {} as any,
              { acquire: jest.fn() } as any,
              { acquire: jest.fn() } as any,
              new StructuredExperienceCandidateSynthesizerService(),
              new StructuredCandidateCorroborationService(),
              undefined,
              { search: jest.fn().mockResolvedValue(grounded) } as any,
              { extractExperiences } as any,
              undefined,
              { providerName: 'cloudflare', retrieve } as any,
              atomized as any,
            );
            const plan: ExperienceAcquisitionPlan = {
              ...multiComponentWebPlan,
              evidenceRequirements,
            };
            return { service, retrieve, plan, atomized };
          }

          /** Extractor double: the composition is only "found" when a deep
           * window actually contains its text. */
          const findsCompositionWhenVisible = (otherwise: () => any) =>
            jest.fn().mockImplementation((_req: any, grounded: any) => {
              const visible = deepEvidence([null, grounded]).some((e: any) =>
                e.snippet.includes(composition),
              );
              return Promise.resolve(
                visible
                  ? extraction([
                      walk(
                        'San Telmo walk',
                        hint('c1', 'Plaza Dorrego'),
                        hint('c2', 'Parque Lezama'),
                        hint('c3', 'Caminito'),
                      ),
                    ])
                  : otherwise(),
              );
            });

          it('fast path: window 1 satisfies the requirement — one fetch, one deep attempt', async () => {
            const page = `# Guide\n\n## Walk\n\n${composition}\n\n## Other\n\n${'filler text. '.repeat(2400)}`;
            const extractExperiences = findsCompositionWhenVisible(() =>
              extraction([]),
            );
            const atomizedWalk = atomizedExtractorDouble(({ content }) =>
              content.includes(composition)
                ? [
                    walk(
                      'San Telmo walk',
                      hint('m-1', 'Plaza Dorrego'),
                      hint('m-2', 'Parque Lezama'),
                      hint('m-3', 'Caminito'),
                    ),
                  ]
                : [],
            );
            const { service, retrieve, plan } = serviceFor(
              { [URL_A]: page },
              extractExperiences,
              {
                ...groundedWithUrls,
                evidence: groundedWithUrls.evidence.map((e) =>
                  e.key === 'ev-1'
                    ? { ...e, snippet: 'Plaza Dorrego Parque Lezama Caminito' }
                    : e,
                ),
              },
              ['MULTI_COMPONENT_EXPERIENCE'],
              atomizedWalk,
            );

            const result = await service.executePlan(plan);

            expect(retrieve).toHaveBeenCalledTimes(1);
            // Window 1 is a complete unit: the atomized contract is its only
            // composition authority; the generative extractor ran only on
            // the grounded snippets.
            expect(atomizedWalk.extract).toHaveBeenCalledTimes(1);
            expect(extractExperiences).toHaveBeenCalledTimes(1);
            expect(
              result.webResults![0].extractionAttempts.map((a) => a.inputKind),
            ).toEqual(['grounded_snippets', 'atomized_source_unit']);
            const web = result.webResults![0];
            expect(web.sourceContentRetrieval?.scan).toMatchObject({
              outcome: 'REQUIREMENT_SATISFIED',
              attemptCount: 1,
              satisfiedBy: [{ sourceUrl: URL_A, windowOrdinal: 1 }],
              plan: {
                selectedSources: [URL_A, URL_B],
                examinedSources: [URL_A],
                completion: 'ALL_SELECTED_SOURCES_EXAMINED',
              },
            });
            // Source-local stop: the satisfied source's later windows are
            // never examined.
            expect(web.sourceContentRetrieval!.scan!.plan.sources).toEqual([
              expect.objectContaining({
                sourceUrl: URL_A,
                examinedWindowCount: 1,
                localStop: 'SOURCE_REQUIREMENT_SATISFIED',
                satisfiedByWindowOrdinal: 1,
              }),
              // Selected but never retrieved: skipped, with the reason.
              expect.objectContaining({
                sourceUrl: URL_B,
                examinedWindowCount: 0,
                localStop: 'CONTENT_NOT_RETRIEVED',
              }),
            ]);
            expect(
              web.sourceContentRetrieval!.scan!.windowCount,
            ).toBeGreaterThan(1);
            expect(result.candidates.map((c) => c.name)).toEqual([
              'San Telmo walk',
            ]);
          });

          it('never accepts a composition from a window that cuts its editorial unit (RW4-EXTRACT-COMPLETENESS-1)', async () => {
            // The walk sits inside one section longer than the unit budget,
            // so every window that shows it holds only part of the section.
            const oversized = [
              '# Guide',
              '',
              '## Day 1',
              '',
              composition,
              '',
              Array.from({ length: 80 }, (_, i) =>
                paragraph(`Day-${i}`, 'then continue walking'),
              ).join('\n\n'),
            ].join('\n');
            const windows = windowSourceContentSequence(
              oversized,
              { snippets: ['Plaza Dorrego Parque Lezama Caminito'] },
              DEFAULT_WEB_SOURCE_CONTENT_MAX_CHARS,
              DEFAULT_WEB_SOURCE_UNIT_MAX_CHARS,
            );
            const showing = windows.filter((w) =>
              w.content.includes(composition),
            );
            expect(showing.length).toBeGreaterThan(0);
            expect(showing.every((w) => !w.audit.sectionComplete)).toBe(true);

            const extractExperiences = findsCompositionWhenVisible(() =>
              extraction([]),
            );
            const { service, plan, atomized } = serviceFor(
              { [URL_A]: oversized },
              extractExperiences,
              {
                ...groundedWithUrls,
                evidence: groundedWithUrls.evidence.map((e) =>
                  e.key === 'ev-1'
                    ? { ...e, snippet: 'Plaza Dorrego Parque Lezama Caminito' }
                    : e,
                ),
              },
            );

            const result = await service.executePlan(plan);

            // An incomplete unit is never atomized: atomization cannot make
            // a cut composition complete.
            expect(atomized.extract).not.toHaveBeenCalled();

            const web = result.webResults![0];
            const deep = web.extractionAttempts.filter(
              (a) => a.inputKind === 'deep_source_content',
            );
            // Every window is examined; none may stand in for the whole day.
            expect(deep).toHaveLength(windows.length);
            const refused = deep.filter((a) =>
              a.sourceWindow!.content.includes(composition),
            );
            expect(refused.length).toBeGreaterThan(0);
            for (const attempt of refused) {
              expect([
                'CONTINUE_SOURCE_UNIT_INCOMPLETE',
                'STOP_SOURCES_EXHAUSTED',
              ]).toContain(attempt.scanDecision);
            }
            expect(web.sourceContentRetrieval?.scan?.outcome).toBe(
              'SOURCES_EXHAUSTED',
            );
            expect(result.candidates.map((c) => c.name)).not.toContain(
              'San Telmo walk',
            );
          });

          it('recovers a composition the ranked window missed from window 2, then stops', async () => {
            const windows = windowSourceContentSequence(
              pageWithLateWindowComposition,
              {
                titles: ['San Telmo Walk'],
                snippets: ['zebra quokka notes'],
                queries: ['Buenos Aires historic walk'],
              },
              DEFAULT_WEB_SOURCE_CONTENT_MAX_CHARS,
              DEFAULT_WEB_SOURCE_UNIT_MAX_CHARS,
            );
            expect(windows[0].content).not.toContain(composition);
            expect(windows[1].content).toContain(composition);
            expect(windows.length).toBeGreaterThan(2);

            const extractExperiences = findsCompositionWhenVisible(() =>
              extraction([]),
            );
            const { service, retrieve, plan } = serviceFor(
              { [URL_A]: pageWithLateWindowComposition },
              extractExperiences,
            );

            const result = await service.executePlan(plan);

            expect(retrieve).toHaveBeenCalledTimes(1);
            // 1 snippet attempt + exactly 2 deep attempts.
            expect(extractExperiences).toHaveBeenCalledTimes(3);
            const web = result.webResults![0];
            expect(
              web.extractionAttempts.map((a) => [
                a.inputKind,
                a.sourceWindow?.windowing.windowOrdinal,
                a.scanDecision,
              ]),
            ).toEqual([
              ['grounded_snippets', undefined, undefined],
              ['deep_source_content', 1, 'CONTINUE_NO_QUALIFYING_CANDIDATE'],
              ['deep_source_content', 2, 'STOP_REQUIREMENT_SATISFIED'],
            ]);
            expect(web.extractionAttempts[2].sourceWindow?.content).toBe(
              windows[1].content,
            );
            expect(result.candidates.map((c) => c.name)).toEqual([
              'San Telmo walk',
            ]);
            // The satisfying window's text is the evidence that flows on.
            expect(result.evidence.find((e) => e.key === 'ev-1')).toMatchObject(
              {
                snippet: windows[1].content,
                evidenceQuality: 'original_content',
              },
            );
          });

          it('examines every finite window exactly once and terminates when nothing qualifies', async () => {
            const extractExperiences = jest
              .fn()
              .mockImplementation(() => Promise.resolve(extraction([])));
            const { service, plan } = serviceFor(
              { [URL_A]: pageWithLateWindowComposition },
              extractExperiences,
            );

            const result = await service.executePlan(plan);

            const windows =
              result.webResults![0].sourceContentRetrieval!.items[0]
                .windowSequence!;
            expect(extractExperiences).toHaveBeenCalledTimes(
              1 + windows.length,
            );
            const examined = extractExperiences.mock.calls
              .slice(1)
              .map((call) => deepEvidence(call)[0].snippet);
            expect(new Set(examined).size).toBe(windows.length);
            const deep = result.webResults![0].extractionAttempts.slice(1);
            expect(
              deep.map((a) => a.sourceWindow?.windowing.windowOrdinal),
            ).toEqual(windows.map((w) => w.windowOrdinal));
            expect(deep[deep.length - 1].scanDecision).toBe(
              'STOP_SOURCES_EXHAUSTED',
            );
            expect(
              deep
                .slice(0, -1)
                .every(
                  (a) => a.scanDecision === 'CONTINUE_NO_QUALIFYING_CANDIDATE',
                ),
            ).toBe(true);
            expect(result.webResults![0].sourceContentRetrieval?.scan).toEqual({
              outcome: 'SOURCES_EXHAUSTED',
              attemptCount: windows.length,
              windowCount: windows.length,
              plan: {
                selectedSources: [URL_A, URL_B],
                examinedSources: [URL_A],
                completion: 'ALL_SELECTED_SOURCES_EXAMINED',
                sources: [
                  {
                    sourceUrl: URL_A,
                    selectionOrder: 1,
                    windowCount: windows.length,
                    examinedWindowCount: windows.length,
                    localStop: 'SOURCE_WINDOWS_EXHAUSTED',
                  },
                  {
                    sourceUrl: URL_B,
                    selectionOrder: 2,
                    windowCount: 0,
                    examinedWindowCount: 0,
                    localStop: 'CONTENT_NOT_RETRIEVED',
                  },
                ],
              },
            });
            // No deep window has authority: the grounded snippets stand.
            expect(result.evidence.find((e) => e.key === 'ev-1')).toMatchObject(
              { snippet: 'zebra quokka notes' },
            );
          });

          it('continues past a window whose only candidate violated the source contract', async () => {
            let deepCalls = 0;
            const extractExperiences = findsCompositionWhenVisible(() =>
              extraction([], {
                validationErrors: [
                  'candidate "Ghost walk": SOURCE_CONTRACT_VIOLATION (0/3 components supported)',
                ],
              }),
            );
            extractExperiences.mockImplementationOnce(() =>
              Promise.resolve(extraction([])),
            );
            const wrapped = jest.fn((...args: any[]) => {
              deepCalls++;
              return extractExperiences(...args);
            });
            const { service, plan } = serviceFor(
              { [URL_A]: pageWithLateWindowComposition },
              wrapped,
            );

            const result = await service.executePlan(plan);

            expect(deepCalls).toBe(3);
            const deep = result.webResults![0].extractionAttempts.slice(1);
            expect(deep[0].validationErrors).toHaveLength(1);
            expect(deep[0].scanDecision).toBe(
              'CONTINUE_NO_QUALIFYING_CANDIDATE',
            );
            expect(deep[1].scanDecision).toBe('STOP_REQUIREMENT_SATISFIED');
          });

          it('continues past an admitted candidate of the wrong shape', async () => {
            const extractExperiences = findsCompositionWhenVisible(() =>
              extraction([walk('Plaza only', hint('c1', 'Plaza Dorrego'))]),
            );
            const { service, plan } = serviceFor(
              { [URL_A]: pageWithLateWindowComposition },
              extractExperiences,
              groundedAdvertisingZebra,
              ['MULTI_COMPONENT_EXPERIENCE', 'SINGLE_PLACE'],
            );

            const result = await service.executePlan(plan);

            const deep = result.webResults![0].extractionAttempts.slice(1);
            expect(deep[0].admittedCandidateCount).toBe(1);
            expect(deep[0].scanDecision).toBe(
              'CONTINUE_NO_QUALIFYING_CANDIDATE',
            );
            expect(deep[1].scanDecision).toBe('STOP_REQUIREMENT_SATISFIED');
            // Only the satisfying attempt's candidates flow on.
            expect(result.candidates.map((c) => c.name)).toEqual([
              'San Telmo walk',
            ]);
          });

          it('stops fail-closed when a window extraction fails as a whole', async () => {
            const extractExperiences = jest
              .fn()
              .mockResolvedValueOnce(extraction([]))
              .mockResolvedValueOnce(
                extraction([], {
                  extractionFailures: ['unparseable envelope'],
                }),
              );
            const { service, plan } = serviceFor(
              { [URL_A]: pageWithLateWindowComposition },
              extractExperiences,
            );

            const result = await service.executePlan(plan);

            expect(extractExperiences).toHaveBeenCalledTimes(2);
            expect(
              result.webResults![0].sourceContentRetrieval?.scan,
            ).toMatchObject({ outcome: 'EXTRACTION_FAILED', attemptCount: 1 });
            expect(
              result.webResults![0].extractionAttempts[1].scanDecision,
            ).toBe('STOP_EXTRACTION_FAILED');
          });

          it('never merges single components found in different windows into one candidate', async () => {
            const extractExperiences = jest
              .fn()
              .mockResolvedValueOnce(extraction([]))
              .mockResolvedValueOnce(
                extraction([walk('A only', hint('c1', 'Plaza Dorrego'))]),
              )
              .mockResolvedValueOnce(
                extraction([walk('B only', hint('c1', 'Parque Lezama'))]),
              )
              .mockImplementation(() => Promise.resolve(extraction([])));
            const { service, plan } = serviceFor(
              { [URL_A]: pageWithLateWindowComposition },
              extractExperiences,
              groundedAdvertisingZebra,
              ['MULTI_COMPONENT_EXPERIENCE', 'SINGLE_PLACE'],
            );

            const result = await service.executePlan(plan);

            expect(
              result.webResults![0].sourceContentRetrieval?.scan?.outcome,
            ).toBe('SOURCES_EXHAUSTED');
            // No synthetic A+B candidate; deep attempts never had authority.
            expect(result.candidates).toEqual([]);
            for (const attempt of result.webResults![0].extractionAttempts) {
              for (const d of attempt.candidateDecisions) {
                expect(d.candidate.componentHints).toHaveLength(1);
              }
            }
          });

          it('isolates sources: one deep source per attempt, round-robin by window ordinal', async () => {
            const extractExperiences = jest
              .fn()
              .mockImplementation(() => Promise.resolve(extraction([])));
            const { service, plan } = serviceFor(
              {
                [URL_A]: pageWithLateWindowComposition,
                [URL_B]: pageWithLateWindowComposition.replace(
                  /Notes/g,
                  'Boca',
                ),
              },
              extractExperiences,
            );

            const result = await service.executePlan(plan);

            const items = result.webResults![0].sourceContentRetrieval!.items;
            const total = items.reduce(
              (n, i) => n + (i.windowSequence?.length ?? 0),
              0,
            );
            const deepCalls = extractExperiences.mock.calls.slice(1);
            const atomizedCalls = (service as any).atomizedUnitExtractor.extract
              .mock.calls;
            // A complete unit is atomized, every other window generative;
            // each window is examined by exactly one of them.
            expect(deepCalls.length + atomizedCalls.length).toBe(total);
            for (const call of deepCalls) {
              // Exactly one source carries deep content in each attempt.
              expect(deepEvidence(call)).toHaveLength(1);
            }
            const order = result
              .webResults![0].extractionAttempts.slice(1)
              .map((a) => [
                a.sourceWindow?.sourceUrl,
                a.sourceWindow?.windowing.windowOrdinal,
              ]);
            expect(order.slice(0, 4)).toEqual([
              [URL_A, 1],
              [URL_B, 1],
              [URL_A, 2],
              [URL_B, 2],
            ]);
          });

          describe('bounded selected-source plan: source-local vs plan completion', () => {
            // Generic synthetic sources: each page opens with a complete
            // editorial unit (window 1) followed by filler windows.
            const COMPOSITION_A =
              'Start at Alpha Square, then walk to Beta Park and finish at Gamma Gate.';
            const COMPOSITION_B =
              'Begin at Delta Market, continue to Epsilon Bridge and end at Zeta Hall.';
            const pageWith = (unit: string, label: string) =>
              `# Guide\n\n## Walk\n\n${unit}\n\n## Other\n\n${`${label} filler text. `.repeat(1200)}`;
            const pageA = pageWith(COMPOSITION_A, 'alpha');
            const pageB = pageWith(COMPOSITION_B, 'bravo');
            const pageBWithoutUnit = pageWith(
              'Nothing here names a route.',
              'bravo',
            );
            const URL_C = 'https://other.com/recoleta';

            const walkA = walk(
              'Walk A',
              hint('a1', 'Alpha Square', 'ev-1'),
              hint('a2', 'Beta Park', 'ev-1'),
              hint('a3', 'Gamma Gate', 'ev-1'),
            );
            const walkB = walk(
              'Walk B',
              hint('b1', 'Delta Market', 'ev-2'),
              hint('b2', 'Epsilon Bridge', 'ev-2'),
              hint('b3', 'Zeta Hall', 'ev-2'),
            );
            /** A window yields a walk only when it shows that walk's unit. */
            const candidatesIn = (content: string) => [
              ...(content.includes(COMPOSITION_A) ? [walkA] : []),
              ...(content.includes(COMPOSITION_B) ? [walkB] : []),
            ];
            const generative = () =>
              jest
                .fn()
                .mockImplementation((_req: any, grounded: any) =>
                  Promise.resolve(
                    extraction(
                      deepEvidence([null, grounded]).flatMap((e: any) =>
                        candidatesIn(e.snippet),
                      ),
                    ),
                  ),
                );
            const atomizedFor = () =>
              atomizedExtractorDouble(({ content }) => candidatesIn(content));
            const examinedOrder = (web: WebAcquisitionResult) =>
              web.extractionAttempts
                .filter((a) => a.sourceWindow)
                .map((a): [string, number] => [
                  a.sourceWindow!.sourceUrl,
                  a.sourceWindow!.windowing.windowOrdinal,
                ]);

            it('examines an already-selected source B after source A satisfied the requirement', async () => {
              const atomized = atomizedFor();
              const { service, plan } = serviceFor(
                { [URL_A]: pageA, [URL_B]: pageBWithoutUnit },
                generative(),
                groundedWithUrls,
                ['MULTI_COMPONENT_EXPERIENCE'],
                atomized,
              );

              const result = await service.executePlan(plan);

              const web = result.webResults![0];
              const scan = web.sourceContentRetrieval!.scan!;
              const windowsB = scan.plan.sources[1].windowCount;
              expect(windowsB).toBeGreaterThan(1);
              // A satisfies at window 1; B still gets every window examined.
              expect(examinedOrder(web)[0]).toEqual([URL_A, 1]);
              expect(
                examinedOrder(web).filter(([url]) => url === URL_B),
              ).toHaveLength(windowsB);
              expect(scan.plan).toMatchObject({
                selectedSources: [URL_A, URL_B],
                examinedSources: [URL_A, URL_B],
                completion: 'ALL_SELECTED_SOURCES_EXAMINED',
              });
              expect(scan.plan.sources).toEqual([
                expect.objectContaining({
                  sourceUrl: URL_A,
                  selectionOrder: 1,
                  examinedWindowCount: 1,
                  localStop: 'SOURCE_REQUIREMENT_SATISFIED',
                  satisfiedByWindowOrdinal: 1,
                }),
                expect.objectContaining({
                  sourceUrl: URL_B,
                  selectionOrder: 2,
                  examinedWindowCount: windowsB,
                  localStop: 'SOURCE_WINDOWS_EXHAUSTED',
                }),
              ]);
              expect(web.extractionAttempts[1].scanDecision).toBe(
                'STOP_REQUIREMENT_SATISFIED',
              );
              expect(scan.outcome).toBe('REQUIREMENT_SATISFIED');
              expect(scan.satisfiedBy).toEqual([
                { sourceUrl: URL_A, windowOrdinal: 1 },
              ]);
              // A's result survives B's examination.
              expect(result.candidates.map((c) => c.name)).toEqual(['Walk A']);
              expect(
                result.evidence.find(
                  (e) => e.key === 'ev-1' && e.url === URL_A,
                ),
              ).toMatchObject({ evidenceQuality: 'original_content' });
            });

            it('discovers no source beyond the selected plan and stays within its window budget', async () => {
              const extractExperiences = generative();
              const { service, retrieve, plan } = serviceFor(
                { [URL_A]: pageA, [URL_B]: pageBWithoutUnit },
                extractExperiences,
                groundedWithUrls,
                ['MULTI_COMPONENT_EXPERIENCE'],
                atomizedFor(),
              );
              const search = (service as any).groundedSearchProvider.search;

              const result = await service.executePlan(plan);

              const web = result.webResults![0];
              const scan = web.sourceContentRetrieval!.scan!;
              // C is an eligible grounded source, but selection bounded the
              // plan to two: it is neither selected, fetched nor examined.
              expect(web.deepSourceSelection?.selectedUrls).toEqual([
                URL_A,
                URL_B,
              ]);
              expect(
                web.deepSourceSelection?.items.find((i) => i.url === URL_C),
              ).toMatchObject({
                selected: false,
                decisionReason: 'BELOW_SELECTION_LIMIT',
              });
              expect(search).toHaveBeenCalledTimes(1);
              expect(retrieve).toHaveBeenCalledTimes(1);
              expect(retrieve).toHaveBeenCalledWith({ urls: [URL_A, URL_B] });
              expect(examinedOrder(web).every(([url]) => url !== URL_C)).toBe(
                true,
              );
              // Every attempt is one window of the selected plan, at most once.
              const examined = examinedOrder(web).map((e) => e.join('#'));
              expect(new Set(examined).size).toBe(examined.length);
              expect(scan.attemptCount).toBe(examined.length);
              expect(scan.attemptCount).toBeLessThanOrEqual(scan.windowCount);
              expect(
                scan.plan.sources.reduce((n, s) => n + s.windowCount, 0),
              ).toBe(scan.windowCount);
            });

            it('completes a one-source plan normally', async () => {
              const atomized = atomizedFor();
              const { service, plan } = serviceFor(
                { [URL_A]: pageA },
                generative(),
                {
                  ...groundedWithUrls,
                  evidence: groundedWithUrls.evidence.filter(
                    (e) => e.url === URL_A,
                  ),
                },
                ['MULTI_COMPONENT_EXPERIENCE'],
                atomized,
              );

              const result = await service.executePlan(plan);

              const scan = result.webResults![0].sourceContentRetrieval!.scan!;
              expect(atomized.extract).toHaveBeenCalledTimes(1);
              expect(scan).toMatchObject({
                outcome: 'REQUIREMENT_SATISFIED',
                attemptCount: 1,
                satisfiedBy: [{ sourceUrl: URL_A, windowOrdinal: 1 }],
                plan: {
                  selectedSources: [URL_A],
                  examinedSources: [URL_A],
                  completion: 'ALL_SELECTED_SOURCES_EXAMINED',
                },
              });
              expect(result.candidates.map((c) => c.name)).toEqual(['Walk A']);
            });

            it('keeps source-local early stop: a satisfied source has no later window examined', async () => {
              const extractExperiences = generative();
              const atomized = atomizedFor();
              const { service, plan } = serviceFor(
                { [URL_A]: pageA, [URL_B]: pageB },
                extractExperiences,
                groundedWithUrls,
                ['MULTI_COMPONENT_EXPERIENCE'],
                atomized,
              );

              const result = await service.executePlan(plan);

              const web = result.webResults![0];
              const scan = web.sourceContentRetrieval!.scan!;
              expect(scan.plan.sources.every((s) => s.windowCount > 1)).toBe(
                true,
              );
              // Window 1 of each source satisfies: their filler windows are
              // never examined, by either extractor.
              expect(examinedOrder(web)).toEqual([
                [URL_A, 1],
                [URL_B, 1],
              ]);
              expect(atomized.extract).toHaveBeenCalledTimes(2);
              expect(extractExperiences).toHaveBeenCalledTimes(1);
              expect(scan.attemptCount).toBe(2);
              expect(
                scan.plan.sources.map((s) => [
                  s.examinedWindowCount,
                  s.localStop,
                ]),
              ).toEqual([
                [1, 'SOURCE_REQUIREMENT_SATISFIED'],
                [1, 'SOURCE_REQUIREMENT_SATISFIED'],
              ]);
            });

            it('aggregates results from every satisfied source, each with the evidence its attempt examined', async () => {
              const { service, plan } = serviceFor(
                { [URL_A]: pageA, [URL_B]: pageB },
                generative(),
                groundedWithUrls,
                ['MULTI_COMPONENT_EXPERIENCE'],
                atomizedFor(),
              );

              const result = await service.executePlan(plan);

              const web = result.webResults![0];
              expect(web.sourceContentRetrieval!.scan!.satisfiedBy).toEqual([
                { sourceUrl: URL_A, windowOrdinal: 1 },
                { sourceUrl: URL_B, windowOrdinal: 1 },
              ]);
              // No candidate is composed across sources; both survive.
              expect(result.candidates.map((c) => c.name)).toEqual([
                'Walk A',
                'Walk B',
              ]);
              expect(web.candidateCount).toBe(2);
              expect(
                web.candidateDecisions!.map((d) => d.candidate.name),
              ).toEqual(['Walk A', 'Walk B']);
              // Each source's examined window flows on; nothing an attempt
              // examined is replaced by another attempt's substitution.
              const windowA = web.extractionAttempts[1].sourceWindow!.content;
              const windowB = web.extractionAttempts[2].sourceWindow!.content;
              const evidenceFor = (key: string) =>
                result.evidence.filter((e) => e.key === key);
              expect(evidenceFor('ev-1').map((e) => e.snippet)).toEqual(
                expect.arrayContaining([windowA]),
              );
              expect(evidenceFor('ev-2').map((e) => e.snippet)).toEqual(
                expect.arrayContaining([windowB]),
              );
              // Unsubstituted grounded items are emitted once.
              expect(evidenceFor('ev-3')).toHaveLength(1);
            });

            it("keeps an earlier source's result when a later selected source's extraction throws", async () => {
              const atomized = atomizedFor();
              atomized.extract
                .mockImplementationOnce(({ content }: any) =>
                  Promise.resolve({
                    candidates: candidatesIn(content),
                    validationErrors: [],
                    extractionFailures: [],
                    sourceSupportAudits: [],
                    provider: 'gemini',
                    model: 'gemini-x',
                    unit: {
                      contractOutcome: 'ASSEMBLED',
                      providerFailure: null,
                    },
                  }),
                )
                .mockRejectedValueOnce(new Error('extractor timeout'));
              const { service, plan } = serviceFor(
                { [URL_A]: pageA, [URL_B]: pageB },
                generative(),
                groundedWithUrls,
                ['MULTI_COMPONENT_EXPERIENCE'],
                atomized,
              );

              const result = await service.executePlan(plan);

              const web = result.webResults![0];
              expect(web.status).toBe('success');
              expect(web.failedStage).toBeUndefined();
              expect(web.extractionAttempts[2]).toMatchObject({
                status: 'failed',
                scanDecision: 'STOP_EXTRACTION_FAILED',
              });
              expect(web.sourceContentRetrieval!.scan).toMatchObject({
                outcome: 'REQUIREMENT_SATISFIED',
                plan: {
                  examinedSources: [URL_A, URL_B],
                  completion: 'EXTRACTION_FAILED',
                },
              });
              expect(
                web.sourceContentRetrieval!.scan!.plan.sources.map(
                  (s) => s.localStop,
                ),
              ).toEqual([
                'SOURCE_REQUIREMENT_SATISFIED',
                'SOURCE_EXTRACTION_FAILED',
              ]);
              expect(result.candidates.map((c) => c.name)).toEqual(['Walk A']);
            });
          });
        });

        it('skips deep retrieval when MULTI_COMPONENT_EXPERIENCE is already satisfied on the first pass', async () => {
          const search = jest.fn().mockResolvedValue(groundedWithUrls);
          const multiComponentCandidate = {
            name: 'San Telmo complete walk',
            themes: ['history'],
            componentHints: [
              {
                key: 'c1',
                name: 'Plaza Dorrego',
                role: 'venue',
                expectedKind: 'PLACE',
                evidenceKeys: ['ev-1'],
              },
              {
                key: 'c2',
                name: 'Parque Lezama',
                role: 'venue',
                expectedKind: 'PLACE',
                evidenceKeys: ['ev-1'],
              },
            ],
            evidenceKeys: ['ev-1'],
            shortReason: 'Two stops in snippet',
          };

          const extractExperiences = jest.fn().mockResolvedValue({
            candidates: [multiComponentCandidate],
            extractionFailures: [],
            validationErrors: [],
            provider: 'gemini',
            model: 'gemini-x',
            rawOutput: '{"candidates":[...]}',
          });

          const webSourceContentProvider: any = {
            providerName: 'cloudflare',
            retrieve: jest.fn(),
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
            undefined,
            webSourceContentProvider,
          );

          const result = await service.executePlan(multiComponentWebPlan);

          expect(webSourceContentProvider.retrieve).not.toHaveBeenCalled();
          expect(extractExperiences).toHaveBeenCalledTimes(1);
          expect(result.candidates).toHaveLength(1);
          expect(result.webResults?.[0].sourceContentRetrieval).toBeUndefined();
        });

        it('skips deep retrieval when MULTI_COMPONENT_EXPERIENCE was not requested', async () => {
          const search = jest.fn().mockResolvedValue(groundedWithUrls);
          const extractExperiences = jest.fn().mockResolvedValue({
            candidates: [],
            extractionFailures: [],
            validationErrors: [],
            provider: 'gemini',
            model: 'gemini-x',
            rawOutput: '{"candidates":[]}',
          });

          const webSourceContentProvider: any = {
            providerName: 'tavily',
            retrieve: jest.fn(),
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
            undefined,
            webSourceContentProvider,
          );

          await service.executePlan(webPlan);

          expect(webSourceContentProvider.retrieve).not.toHaveBeenCalled();
        });

        it('skips deep retrieval when the extraction itself failed (anti-N7 fail-closed)', async () => {
          const search = jest.fn().mockResolvedValue(groundedWithUrls);
          const extractExperiences = jest.fn().mockResolvedValue({
            candidates: [],
            validationErrors: ['Failed to parse JSON response'],
            extractionFailures: ['Failed to parse JSON response'],
            provider: 'gemini',
            model: 'gemini-x',
            rawOutput: 'bad json',
          });

          const webSourceContentProvider: any = {
            providerName: 'tavily',
            retrieve: jest.fn(),
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
            undefined,
            webSourceContentProvider,
          );

          await service.executePlan(multiComponentWebPlan);

          expect(webSourceContentProvider.retrieve).not.toHaveBeenCalled();
          expect(extractExperiences).toHaveBeenCalledTimes(1);
        });

        describe('candidate-level invalidity vs extraction failure', () => {
          // A fresh fixture per test: deep retrieval rewrites the grounded
          // evidence it is handed, so shared fixtures drift between tests.
          const winesGrounded = () => ({
            provider: 'tavily',
            model: 'n/a',
            groundingStatus: 'applied',
            evidence: [
              {
                key: 'ev-1',
                source: 'wine-outings.example',
                title: 'Wine outings',
                snippet:
                  'The idea is to get on a bus and go on a neatly organized circuit to visit the best wineries and Bodega Alta.',
                url: 'https://wine-outings.example/outings.html',
              },
            ],
            rawOutput: 'grounded raw fixture',
          });

          const venue = (name: string) => ({
            key: name.toLowerCase().replace(/\s+/g, '-'),
            name,
            role: 'venue',
            expectedKind: 'PLACE',
            evidenceKeys: ['ev-1'],
            supportSpan: name,
          });
          const rawCandidate = (name: string, componentHints: unknown[]) => ({
            name,
            themes: ['wine'],
            traits: [] as string[],
            intents: [] as string[],
            componentHints,
            evidenceKeys: ['ev-1'],
            shortReason: 'fixture',
          });

          // Runs the real extraction contract over whatever evidence the
          // service supplies, one raw extractor response per call.
          const extractorReturning = (...rawResponses: unknown[]) => {
            const fn = jest.fn();
            for (const raw of rawResponses) {
              fn.mockImplementationOnce(
                async (request: any, searchResult: any) => ({
                  ...extractExperienceCandidates(
                    raw,
                    searchResult.evidence.map((e: any) => ({
                      key: e.key,
                      title: e.title,
                      text: e.snippet,
                    })),
                    request.maxCandidates,
                  ),
                  provider: 'cloudflare',
                  model: 'qwen-fixture',
                  rawOutput: JSON.stringify(raw),
                }),
              );
            }
            return fn;
          };

          const fullSource =
            'Full circuit: the bus stops at Bodega Alta, then Bodega Baja, then Bodega Media.';
          const deepResponse = {
            candidates: [
              rawCandidate('Wine Route Bus Circuit', [
                venue('Bodega Alta'),
                venue('Bodega Baja'),
              ]),
            ],
          };

          const buildService = (extractExperiences: jest.Mock) => {
            const webSourceContentProvider: any = {
              providerName: 'tavily',
              retrieve: jest.fn().mockResolvedValue({
                provider: 'tavily',
                requestedCount: 1,
                retrievedCount: 1,
                items: [
                  {
                    requestedUrl: 'https://wine-outings.example/outings.html',
                    status: 'retrieved',
                    contentType: 'markdown',
                    content: fullSource,
                    contentChars: fullSource.length,
                    truncated: false,
                    provider: 'tavily',
                    durationMs: 5,
                  },
                ],
                totalDurationMs: 5,
              }),
            };
            const service = new ExperienceAcquisitionService(
              {} as any,
              {} as any,
              { acquire: jest.fn() } as any,
              { acquire: jest.fn() } as any,
              new StructuredExperienceCandidateSynthesizerService(),
              new StructuredCandidateCorroborationService(),
              undefined,
              { search: jest.fn().mockResolvedValue(winesGrounded()) } as any,
              { extractExperiences } as any,
              undefined,
              webSourceContentProvider,
            );
            return { service, webSourceContentProvider };
          };

          it('a candidate rejected for empty componentHints does not suppress deep retrieval (RW4 COLD #4 ev-6)', async () => {
            const extractExperiences = extractorReturning(
              {
                candidates: [rawCandidate('Wine Route Bus Circuit', [])],
              },
              deepResponse,
            );
            const { service, webSourceContentProvider } =
              buildService(extractExperiences);

            const result = await service.executePlan(multiComponentWebPlan);
            const webResult = result.webResults![0];

            // The snippet candidate was rejected at candidate level...
            expect(webResult.extractionAttempts[0]).toMatchObject({
              inputKind: 'grounded_snippets',
              status: 'completed',
              validationErrors: ['Candidate 1: componentHints is required'],
              extractedCandidateCount: 0,
            });
            // ...and deep retrieval still ran on the cited source.
            expect(webSourceContentProvider.retrieve).toHaveBeenCalledWith({
              urls: ['https://wine-outings.example/outings.html'],
            });
            expect(webResult.sourceContentRetrieval).toMatchObject({
              attempted: true,
              reExtractionAttempted: true,
              triggerReason:
                'MULTI_COMPONENT_EXPERIENCE required but initial extraction produced no admissible multi-component candidate',
            });
            expect(extractExperiences).toHaveBeenCalledTimes(2);
            expect(webResult.extractionAttempts[1]).toMatchObject({
              inputKind: 'deep_source_content',
              admittedCandidateCount: 1,
            });
            expect(result.candidates.map((c) => c.name)).toEqual([
              'Wine Route Bus Circuit',
            ]);
          });

          it('a valid single-component candidate beside an invalid one still deep-fetches', async () => {
            const extractExperiences = extractorReturning(
              {
                candidates: [
                  rawCandidate('Wine Route Bus Circuit', []),
                  rawCandidate('Bodega Alta visit', [venue('Bodega Alta')]),
                ],
              },
              deepResponse,
            );
            const { service, webSourceContentProvider } =
              buildService(extractExperiences);

            const result = await service.executePlan(multiComponentWebPlan);
            const webResult = result.webResults![0];

            expect(webResult.extractionAttempts[0]).toMatchObject({
              validationErrors: ['Candidate 1: componentHints is required'],
              extractedCandidateCount: 1,
              admittedCandidateCount: 0,
            });
            expect(webSourceContentProvider.retrieve).toHaveBeenCalledTimes(1);
            expect(extractExperiences).toHaveBeenCalledTimes(2);
          });

          it('an unrecognized extractor envelope stays fail-closed: no deep retrieval', async () => {
            const extractExperiences = extractorReturning({
              unexpected: 'shape',
            });
            const { service, webSourceContentProvider } =
              buildService(extractExperiences);

            const result = await service.executePlan(multiComponentWebPlan);

            expect(webSourceContentProvider.retrieve).not.toHaveBeenCalled();
            expect(extractExperiences).toHaveBeenCalledTimes(1);
            expect(
              result.webResults![0].sourceContentRetrieval,
            ).toBeUndefined();
          });

          it('a thrown extractor failure stays a failed EXTRACTION, never a deep fetch', async () => {
            const extractExperiences = jest
              .fn()
              .mockRejectedValue(new Error('extractor timeout'));
            const { service, webSourceContentProvider } =
              buildService(extractExperiences);

            const result = await service.executePlan(multiComponentWebPlan);

            expect(webSourceContentProvider.retrieve).not.toHaveBeenCalled();
            expect(result.webResults![0]).toMatchObject({
              status: 'failed',
              failedStage: 'EXTRACTION',
            });
          });

          it('an admitted multi-component candidate beside an invalid one keeps skipping deep retrieval', async () => {
            const extractExperiences = extractorReturning({
              candidates: [
                rawCandidate('Wine Route Bus Circuit', []),
                rawCandidate('Wine Route Bus Circuit (named)', [
                  venue('Bodega Alta'),
                  venue('organized circuit'),
                ]),
              ],
            });
            const { service, webSourceContentProvider } =
              buildService(extractExperiences);

            const result = await service.executePlan(multiComponentWebPlan);

            expect(webSourceContentProvider.retrieve).not.toHaveBeenCalled();
            expect(extractExperiences).toHaveBeenCalledTimes(1);
            expect(result.candidates.map((c) => c.name)).toEqual([
              'Wine Route Bus Circuit (named)',
            ]);
          });
        });

        describe('acquisition observability (RW4 canonical-run provenance)', () => {
          // Snapshot at collection time: an earlier test in the enclosing block lets the
          // service replace the shared fixture's evidence with deep content.
          const pristineGrounded = structuredClone(groundedWithUrls);
          const snippetCandidate = {
            name: 'San Telmo partial walk',
            themes: ['history'],
            componentHints: [
              {
                key: 'c1',
                name: 'Plaza Dorrego',
                role: 'venue',
                expectedKind: 'PLACE',
                evidenceKeys: ['ev-1'],
              },
            ],
            evidenceKeys: ['ev-1'],
            shortReason: 'One stop in the snippet',
          };
          const deepCandidate = {
            ...snippetCandidate,
            name: 'San Telmo complete walk',
            componentHints: [
              ...snippetCandidate.componentHints,
              {
                key: 'c2',
                name: 'Parque Lezama',
                role: 'venue',
                expectedKind: 'PLACE',
                evidenceKeys: ['ev-1'],
              },
            ],
            shortReason: 'Two stops in the full article',
          };
          const retrievedContent = {
            provider: 'tavily',
            requestedCount: 2,
            retrievedCount: 1,
            items: [
              {
                requestedUrl: 'https://buenosaires.travel/san-telmo-walk',
                status: 'retrieved',
                contentType: 'markdown',
                content: 'Start at Plaza Dorrego, then walk to Parque Lezama.',
                contentChars: 52,
                truncated: false,
                provider: 'tavily',
              },
            ],
            totalDurationMs: 10,
          };

          const buildService = (
            extractExperiences: jest.Mock,
            retrieve: jest.Mock,
            search = jest
              .fn()
              .mockResolvedValue(structuredClone(pristineGrounded)),
          ) =>
            new ExperienceAcquisitionService(
              {} as any,
              {} as any,
              { acquire: jest.fn() } as any,
              { acquire: jest.fn() } as any,
              new StructuredExperienceCandidateSynthesizerService(),
              new StructuredCandidateCorroborationService(),
              undefined,
              { search } as any,
              { extractExperiences } as any,
              undefined,
              { providerName: 'tavily', retrieve } as any,
            );

          it('keeps the snippet-only attempt when deep re-extraction runs', async () => {
            const extractExperiences = jest
              .fn()
              .mockResolvedValueOnce({
                candidates: [snippetCandidate],
                extractionFailures: [],
                validationErrors: [],
                provider: 'extractor-a',
                model: 'model-a',
                rawOutput: 'RAW-SNIPPET-ATTEMPT',
              })
              .mockResolvedValueOnce({
                candidates: [deepCandidate],
                extractionFailures: [],
                validationErrors: ['deep attempt warning'],
                provider: 'extractor-b',
                model: 'model-b',
                rawOutput: 'RAW-DEEP-ATTEMPT',
              });
            const service = buildService(
              extractExperiences,
              jest.fn().mockResolvedValue(retrievedContent),
            );

            const result = await service.executePlan(multiComponentWebPlan);
            const webResult = result.webResults![0];

            expect(webResult.extractionAttempts).toHaveLength(2);
            expect(webResult.extractionAttempts[0]).toMatchObject({
              inputKind: 'grounded_snippets',
              status: 'completed',
              extractorProvider: 'extractor-a',
              extractorModel: 'model-a',
              rawOutput: 'RAW-SNIPPET-ATTEMPT',
              validationErrors: [],
              extractedCandidateCount: 1,
              admittedCandidateCount: 0,
              candidateDecisions: [
                expect.objectContaining({
                  accepted: false,
                  reason: 'NO_MATCHING_EVIDENCE_REQUIREMENT',
                }),
              ],
            });
            expect(webResult.extractionAttempts[1]).toMatchObject({
              inputKind: 'deep_source_content',
              status: 'completed',
              extractorProvider: 'extractor-b',
              extractorModel: 'model-b',
              rawOutput: 'RAW-DEEP-ATTEMPT',
              validationErrors: ['deep attempt warning'],
              extractedCandidateCount: 1,
              admittedCandidateCount: 1,
            });
            // The flat fields still describe the final attempt.
            expect(webResult).toMatchObject({
              status: 'success',
              extractorRawOutput: 'RAW-DEEP-ATTEMPT',
              extractorModel: 'model-b',
              candidateCount: 1,
            });
            expect(webResult.failedStage).toBeUndefined();
          });

          it('records the search snippet of every considered source without changing selection', async () => {
            const extractExperiences = jest.fn().mockResolvedValue({
              candidates: [snippetCandidate],
              extractionFailures: [],
              validationErrors: [],
              provider: 'extractor-a',
              model: 'model-a',
              rawOutput: '{}',
            });
            const service = buildService(
              extractExperiences,
              jest.fn().mockResolvedValue(retrievedContent),
            );

            const result = await service.executePlan(multiComponentWebPlan);
            const selection = result.webResults![0].deepSourceSelection!;

            expect(selection.selectedUrls).toEqual([
              'https://buenosaires.travel/san-telmo-walk',
              'https://travelblog.com/la-boca',
            ]);
            expect(
              selection.items.map((i) => [
                i.evidenceKey,
                i.snippet,
                i.selected,
                i.decisionReason,
              ]),
            ).toEqual([
              ['ev-1', 'A great walk in San Telmo', true, 'SELECTED'],
              ['ev-2', 'Walk through Caminito', true, 'SELECTED'],
              ['ev-3', 'Walk around cemetery', false, 'BELOW_SELECTION_LIMIT'],
            ]);
            // The audit keeps the search snippet even though ev-1's evidence
            // was replaced by deep content for re-extraction.
            expect(
              extractExperiences.mock.calls[1][1].evidence[0].snippet,
            ).toBe('Start at Plaza Dorrego, then walk to Parque Lezama.');
          });

          it('attributes a snippet-extraction failure to EXTRACTION, keeping the search facts', async () => {
            const extractExperiences = jest
              .fn()
              .mockRejectedValue(
                new Error('The operation was aborted due to timeout'),
              );
            const retrieve = jest.fn();
            const service = buildService(extractExperiences, retrieve);

            const result = await service.executePlan(multiComponentWebPlan);
            const webResult = result.webResults![0];

            expect(retrieve).not.toHaveBeenCalled();
            expect(webResult).toMatchObject({
              status: 'failed',
              failedStage: 'EXTRACTION',
              failureReason: 'The operation was aborted due to timeout',
              groundingStatus: 'applied',
              evidenceKeys: ['ev-1', 'ev-2', 'ev-3'],
              extractionAttempts: [
                {
                  inputKind: 'grounded_snippets',
                  status: 'failed',
                  failureReason: 'The operation was aborted due to timeout',
                  candidateDecisions: [],
                },
              ],
            });
            // Health accounting keys failures by grounded provider: a
            // post-search failure must not name the search provider.
            expect(webResult.groundedProvider).toBeUndefined();
            expect(result.candidates).toHaveLength(0);
          });

          it('keeps the completed snippet attempt when the deep re-extraction fails', async () => {
            const extractExperiences = jest
              .fn()
              .mockResolvedValueOnce({
                candidates: [snippetCandidate],
                extractionFailures: [],
                validationErrors: [],
                provider: 'extractor-a',
                model: 'model-a',
                rawOutput: 'RAW-SNIPPET-ATTEMPT',
              })
              .mockRejectedValueOnce(new Error('extractor timeout'));
            const service = buildService(
              extractExperiences,
              jest.fn().mockResolvedValue(retrievedContent),
            );

            const result = await service.executePlan(multiComponentWebPlan);
            const webResult = result.webResults![0];

            expect(webResult.failedStage).toBe('EXTRACTION');
            expect(webResult.extractionAttempts).toEqual([
              expect.objectContaining({
                inputKind: 'grounded_snippets',
                status: 'completed',
                rawOutput: 'RAW-SNIPPET-ATTEMPT',
              }),
              expect.objectContaining({
                inputKind: 'deep_source_content',
                status: 'failed',
                failureReason: 'extractor timeout',
              }),
            ]);
            expect(webResult.deepSourceSelection?.selectedUrls).toHaveLength(2);
            expect(webResult.sourceContentRetrieval).toMatchObject({
              attempted: true,
              reExtractionAttempted: true,
            });
          });

          it('attributes a content-retrieval failure to SOURCE_FETCH', async () => {
            const extractExperiences = jest.fn().mockResolvedValue({
              candidates: [snippetCandidate],
              extractionFailures: [],
              validationErrors: [],
              provider: 'extractor-a',
              model: 'model-a',
              rawOutput: 'RAW-SNIPPET-ATTEMPT',
            });
            const service = buildService(
              extractExperiences,
              jest.fn().mockRejectedValue(new Error('retrieval 502')),
            );

            const result = await service.executePlan(multiComponentWebPlan);
            const webResult = result.webResults![0];

            expect(extractExperiences).toHaveBeenCalledTimes(1);
            expect(webResult).toMatchObject({
              status: 'failed',
              failedStage: 'SOURCE_FETCH',
              failureReason: 'retrieval 502',
            });
            expect(webResult.extractionAttempts).toHaveLength(1);
            expect(webResult.deepSourceSelection?.selectedUrls).toHaveLength(2);
          });

          it('attributes a thrown search error to SEARCH', async () => {
            const extractExperiences = jest.fn();
            const service = buildService(
              extractExperiences,
              jest.fn(),
              jest.fn().mockRejectedValue(new Error('search 503')),
            );

            const result = await service.executePlan(multiComponentWebPlan);

            expect(extractExperiences).not.toHaveBeenCalled();
            expect(result.webResults![0]).toMatchObject({
              status: 'failed',
              failedStage: 'SEARCH',
              failureReason: 'search 503',
              evidenceKeys: [],
              extractionAttempts: [],
            });
          });

          it('attributes a failed grounding status to SEARCH', async () => {
            const service = buildService(
              jest.fn(),
              jest.fn(),
              jest.fn().mockResolvedValue({
                ...structuredClone(pristineGrounded),
                groundingStatus: 'failed',
                failureReason: 'HTTP 401',
                evidence: undefined,
              }),
            );

            const result = await service.executePlan(multiComponentWebPlan);

            expect(result.webResults![0]).toMatchObject({
              status: 'failed',
              failedStage: 'SEARCH',
              failureReason: 'HTTP 401',
              groundedProvider: 'tavily',
            });
          });
        });

        describe('deep source selection audit (RW4-01)', () => {
          it('proves A & D: multiple grounded sources with different scores and >2 eligible URLs select top 2 with audit reasons', async () => {
            const groundedWithFourSources = {
              provider: 'tavily',
              model: 'n/a',
              groundingStatus: 'applied',
              evidence: [
                {
                  key: 'ev-1',
                  source: 'buenosaires.travel',
                  title: 'San Telmo Walk',
                  snippet: 'A great walk in San Telmo',
                  url: 'https://buenosaires.travel/san-telmo-walk',
                  order: 1,
                },
                {
                  key: 'ev-2',
                  source: 'travelblog.com',
                  title: 'La Boca',
                  snippet: 'La Boca colors',
                  url: 'https://travelblog.com/la-boca',
                  order: 2,
                },
                {
                  key: 'ev-3',
                  source: 'other.com',
                  title: 'Recoleta',
                  snippet: 'Recoleta Cemetery',
                  url: 'https://other.com/recoleta',
                  order: 3,
                },
                {
                  key: 'ev-4',
                  source: 'guide.com',
                  title: 'Palermo',
                  snippet: 'Palermo Soho',
                  url: 'https://guide.com/palermo',
                  order: 4,
                },
              ],
            };

            const singleComponentCandidate = {
              name: 'San Telmo partial walk',
              themes: ['history'],
              componentHints: [
                {
                  key: 'c1',
                  name: 'Plaza Dorrego',
                  role: 'venue',
                  expectedKind: 'PLACE',
                  evidenceKeys: ['ev-1'],
                },
              ],
              evidenceKeys: ['ev-1'],
              shortReason: 'Only one stop in snippet',
            };

            const search = jest.fn().mockResolvedValue(groundedWithFourSources);
            const extractExperiences = jest.fn().mockResolvedValue({
              candidates: [singleComponentCandidate],
              extractionFailures: [],
              validationErrors: [],
              provider: 'gemini',
              model: 'gemini-x',
              rawOutput: '{"candidates":[...]}',
            });

            const webSourceContentProvider: any = {
              providerName: 'tavily',
              retrieve: jest.fn().mockResolvedValue({
                provider: 'tavily',
                items: [
                  {
                    requestedUrl: 'https://buenosaires.travel/san-telmo-walk',
                    status: 'retrieved',
                    content: 'Full article: Plaza Dorrego and Parque Lezama',
                  },
                ],
                totalDurationMs: 60,
              }),
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
              undefined,
              webSourceContentProvider,
            );

            const result = await service.executePlan(multiComponentWebPlan);
            const webResult = result.webResults?.[0];
            expect(webResult?.deepSourceSelection).toBeDefined();

            const selection = webResult!.deepSourceSelection!;
            expect(selection.evidenceCount).toBe(4);
            expect(selection.selectionLimit).toBe(2);
            expect(selection.selectedUrls).toEqual([
              'https://buenosaires.travel/san-telmo-walk',
              'https://travelblog.com/la-boca',
            ]);

            // Matches URLs passed to retrieve
            expect(webSourceContentProvider.retrieve).toHaveBeenCalledWith({
              urls: selection.selectedUrls,
            });

            // Every considered source appears in items in original order
            expect(selection.items).toHaveLength(4);
            expect(selection.items.map((i) => i.evidenceKey)).toEqual([
              'ev-1',
              'ev-2',
              'ev-3',
              'ev-4',
            ]);

            // Item 1: ev-1 (tourContentScore = 15, citedBonus = 1 -> finalScore = 16, rank 1, SELECTED)
            expect(selection.items[0]).toMatchObject({
              evidenceKey: 'ev-1',
              originalRank: 1,
              editorialEligible: true,
              tourContentScore: 15,
              citedCandidateBonus: 1,
              finalScore: 16,
              rankedPosition: 1,
              selected: true,
              decisionReason: 'SELECTED',
            });

            // Item 2: ev-2 (tourContentScore = 5, citedBonus = 0 -> finalScore = 5, rank 2, SELECTED)
            expect(selection.items[1]).toMatchObject({
              evidenceKey: 'ev-2',
              originalRank: 2,
              editorialEligible: true,
              tourContentScore: 5,
              citedCandidateBonus: 0,
              finalScore: 5,
              rankedPosition: 2,
              selected: true,
              decisionReason: 'SELECTED',
            });

            // Item 3: ev-3 (tourContentScore = 5, citedBonus = 0 -> finalScore = 5, rank 3, BELOW_SELECTION_LIMIT)
            expect(selection.items[2]).toMatchObject({
              evidenceKey: 'ev-3',
              originalRank: 3,
              editorialEligible: true,
              tourContentScore: 5,
              citedCandidateBonus: 0,
              finalScore: 5,
              rankedPosition: 3,
              selected: false,
              decisionReason: 'BELOW_SELECTION_LIMIT',
            });

            // Item 4: ev-4 (tourContentScore = 5, citedBonus = 0 -> finalScore = 5, rank 4, BELOW_SELECTION_LIMIT)
            expect(selection.items[3]).toMatchObject({
              evidenceKey: 'ev-4',
              originalRank: 4,
              editorialEligible: true,
              tourContentScore: 5,
              citedCandidateBonus: 0,
              finalScore: 5,
              rankedPosition: 4,
              selected: false,
              decisionReason: 'BELOW_SELECTION_LIMIT',
            });

            // sourceContentRetrieval.selectionAudit refers to the exact same audit
            expect(webResult?.sourceContentRetrieval?.selectionAudit).toBe(
              selection,
            );
          });

          it('proves B: a cited rejected candidate gives +1 bonus and changes selection ranking', async () => {
            // ev-1 has score 15, ev-2 has score 5, ev-3 has score 5.
            // If the rejected candidate cites ev-3, ev-3 gets +1 bonus (finalScore 6) and is ranked ahead of ev-2!
            const groundedEvidence = {
              provider: 'tavily',
              model: 'n/a',
              groundingStatus: 'applied',
              evidence: [
                {
                  key: 'ev-1',
                  source: 'buenosaires.travel',
                  title: 'San Telmo Walk',
                  snippet: 'A great walk in San Telmo',
                  url: 'https://buenosaires.travel/san-telmo-walk',
                },
                {
                  key: 'ev-2',
                  source: 'travelblog.com',
                  title: 'La Boca',
                  snippet: 'La Boca colors',
                  url: 'https://travelblog.com/la-boca',
                },
                {
                  key: 'ev-3',
                  source: 'other.com',
                  title: 'Recoleta',
                  snippet: 'Recoleta Cemetery',
                  url: 'https://other.com/recoleta',
                },
              ],
            };

            const rejectedCitingEv3 = {
              name: 'Recoleta partial walk',
              themes: ['history'],
              componentHints: [
                {
                  key: 'c1',
                  name: 'Cementerio Recoleta',
                  role: 'venue',
                  expectedKind: 'PLACE',
                  evidenceKeys: ['ev-3'],
                },
              ],
              evidenceKeys: ['ev-3'],
              shortReason: 'Only one stop',
            };

            const search = jest.fn().mockResolvedValue(groundedEvidence);
            const extractExperiences = jest.fn().mockResolvedValue({
              candidates: [rejectedCitingEv3],
              extractionFailures: [],
              validationErrors: [],
              provider: 'gemini',
              model: 'gemini-x',
              rawOutput: '{"candidates":[...]}',
            });

            const webSourceContentProvider: any = {
              providerName: 'tavily',
              retrieve: jest.fn().mockResolvedValue({
                provider: 'tavily',
                items: [],
              }),
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
              undefined,
              webSourceContentProvider,
            );

            const result = await service.executePlan(multiComponentWebPlan);
            const selection = result.webResults![0].deepSourceSelection!;

            // ev-3 received +1 bonus and was ranked 2nd ahead of ev-2
            expect(selection.items[2]).toMatchObject({
              evidenceKey: 'ev-3',
              tourContentScore: 5,
              citedCandidateBonus: 1,
              finalScore: 6,
              rankedPosition: 2,
              selected: true,
              decisionReason: 'SELECTED',
            });

            // ev-2 was pushed to rank 3 and excluded by limit
            expect(selection.items[1]).toMatchObject({
              evidenceKey: 'ev-2',
              tourContentScore: 5,
              citedCandidateBonus: 0,
              finalScore: 5,
              rankedPosition: 3,
              selected: false,
              decisionReason: 'BELOW_SELECTION_LIMIT',
            });

            expect(selection.selectedUrls).toEqual([
              'https://buenosaires.travel/san-telmo-walk',
              'https://other.com/recoleta',
            ]);
          });

          it('proves C: non-editorial and invalid URLs are rejected with explicit typed decision reasons', async () => {
            const groundedWithVariousSources = {
              provider: 'tavily',
              model: 'n/a',
              groundingStatus: 'applied',
              evidence: [
                {
                  key: 'ev-invalid',
                  source: 'bad.com',
                  title: 'Invalid URL source',
                  snippet: 'Snippet without valid url',
                  url: 'ftp://not-http.com/path',
                },
                {
                  key: 'ev-non-editorial',
                  source: 'tripadvisor.com',
                  title: 'Tripadvisor Listing',
                  snippet: 'Reviews of attractions',
                  url: 'https://www.tripadvisor.com/Attraction_Review-g312741-d311849',
                },
                {
                  key: 'ev-editorial-1',
                  source: 'buenosaires.travel',
                  title: 'San Telmo Walk',
                  snippet: 'A great walk in San Telmo',
                  url: 'https://buenosaires.travel/san-telmo-walk',
                },
                {
                  key: 'ev-duplicate',
                  source: 'buenosaires.travel',
                  title: 'San Telmo Walk Duplicate',
                  snippet: 'Same URL again',
                  url: 'https://buenosaires.travel/san-telmo-walk',
                },
              ],
            };

            const search = jest
              .fn()
              .mockResolvedValue(groundedWithVariousSources);
            const extractExperiences = jest.fn().mockResolvedValue({
              candidates: [
                {
                  name: 'Partial candidate',
                  themes: ['history'],
                  componentHints: [
                    {
                      key: 'c1',
                      name: 'Stop 1',
                      role: 'venue',
                      expectedKind: 'PLACE',
                      evidenceKeys: ['ev-editorial-1'],
                    },
                  ],
                  evidenceKeys: ['ev-editorial-1'],
                  shortReason: 'Single stop',
                },
              ],
              extractionFailures: [],
              validationErrors: [],
              provider: 'gemini',
              model: 'gemini-x',
              rawOutput: '{"candidates":[...]}',
            });

            const webSourceContentProvider: any = {
              providerName: 'tavily',
              retrieve: jest.fn().mockResolvedValue({
                provider: 'tavily',
                items: [],
              }),
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
              undefined,
              webSourceContentProvider,
            );

            const result = await service.executePlan(multiComponentWebPlan);
            const selection = result.webResults![0].deepSourceSelection!;

            expect(selection.items).toHaveLength(4);

            // Invalid URL
            expect(selection.items[0]).toMatchObject({
              evidenceKey: 'ev-invalid',
              editorialEligible: false,
              selected: false,
              decisionReason: 'INVALID_OR_NON_HTTP_URL',
            });

            // Non-editorial source
            expect(selection.items[1]).toMatchObject({
              evidenceKey: 'ev-non-editorial',
              editorialEligible: false,
              selected: false,
              decisionReason: 'NON_EDITORIAL_SOURCE',
            });

            // Valid editorial source
            expect(selection.items[2]).toMatchObject({
              evidenceKey: 'ev-editorial-1',
              editorialEligible: true,
              selected: true,
              decisionReason: 'SELECTED',
            });

            // Duplicate URL
            expect(selection.items[3]).toMatchObject({
              evidenceKey: 'ev-duplicate',
              editorialEligible: true,
              selected: false,
              decisionReason: 'DUPLICATE_URL',
            });

            expect(selection.selectedUrls).toEqual([
              'https://buenosaires.travel/san-telmo-walk',
            ]);
          });

          it('handles NO_ELIGIBLE_SOURCES when all grounded sources are non-editorial or invalid', async () => {
            const groundedIneligibleOnly = {
              provider: 'tavily',
              model: 'n/a',
              groundingStatus: 'applied',
              evidence: [
                {
                  key: 'ev-tripadvisor',
                  source: 'tripadvisor.com',
                  title: 'Tripadvisor Listing',
                  snippet: 'Reviews',
                  url: 'https://www.tripadvisor.com/Attractions',
                },
                {
                  key: 'ev-invalid',
                  source: 'no-scheme',
                  title: 'No Scheme',
                  snippet: 'Bad URL',
                  url: 'invalid-url',
                },
              ],
            };

            const search = jest.fn().mockResolvedValue(groundedIneligibleOnly);
            const extractExperiences = jest.fn().mockResolvedValue({
              candidates: [
                {
                  name: 'Partial candidate',
                  themes: ['history'],
                  componentHints: [
                    {
                      key: 'c1',
                      name: 'Stop 1',
                      role: 'venue',
                      expectedKind: 'PLACE',
                      evidenceKeys: ['ev-tripadvisor'],
                    },
                  ],
                  evidenceKeys: ['ev-tripadvisor'],
                  shortReason: 'Single stop',
                },
              ],
              extractionFailures: [],
              validationErrors: [],
              provider: 'gemini',
              model: 'gemini-x',
              rawOutput: '{"candidates":[...]}',
            });

            const webSourceContentProvider: any = {
              providerName: 'tavily',
              retrieve: jest.fn(),
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
              undefined,
              webSourceContentProvider,
            );

            const result = await service.executePlan(multiComponentWebPlan);
            const webResult = result.webResults![0];

            expect(webResult.deepSourceSelection).toBeDefined();
            expect(webResult.deepSourceSelection!.selectedUrls).toEqual([]);
            expect(webResult.deepSourceSelection!.items).toHaveLength(2);
            expect(
              webResult.deepSourceSelection!.items.every((i) => !i.selected),
            ).toBe(true);

            // Retrieval transport is NOT called
            expect(webSourceContentProvider.retrieve).not.toHaveBeenCalled();
            // sourceContentRetrieval is undefined
            expect(webResult.sourceContentRetrieval).toBeUndefined();
          });
        });

        describe('grounded evidence observability (forensic reconstruction)', () => {
          const multiEvidenceItems = [
            {
              key: 'ev-1',
              order: 1,
              source: 'buenosaires.travel',
              title: 'San Telmo Traditional Walk',
              url: 'https://buenosaires.travel/san-telmo',
              snippet:
                'Walk through cobblestone streets, antique markets, and historic tango bars in San Telmo.',
              kind: 'organic_result' as const,
            },
            {
              key: 'ev-2',
              order: 2,
              source: 'travelmag.com',
              title: 'Historic Cafes of Buenos Aires',
              url: 'https://travelmag.com/cafes',
              snippet:
                'Visit Cafe Tortoni and other notable traditional bars in the city center.',
              kind: 'organic_result' as const,
            },
            {
              key: 'ev-3',
              order: 3,
              source: 'mendoza-wine.com',
              title: 'Winery Overview',
              url: 'https://mendoza-wine.com/wineries',
              snippet:
                'Bodega Don Manuel Villafane and Bodega El Enemigo offer guided cellar tours.',
              kind: 'organic_result' as const,
            },
            {
              key: 'ev-4',
              order: 4,
              source: 'argentinatravel.org',
              title: 'General Sightseeing Guide',
              url: 'https://argentinatravel.org/guide',
              snippet:
                'General tips for travelers visiting Argentine cities and provinces.',
              kind: 'organic_result' as const,
            },
          ];

          const multiEvidenceGroundedResult = {
            provider: 'tavily',
            model: 'tavily-search',
            groundingStatus: 'applied',
            evidence: multiEvidenceItems.map((item) => ({ ...item })),
            evidenceProvenance: [{ provider: 'tavily' }],
            rawOutput: 'grounded multi-evidence fixture',
          };

          it('1 & 2: records every grounded search item supplied to extraction with exact key, title, URL, snippet, and rank/order', async () => {
            const search = jest
              .fn()
              .mockResolvedValue(multiEvidenceGroundedResult);
            const extractExperiences = jest.fn().mockResolvedValue({
              candidates: [webCandidate],
              extractionFailures: [],
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
            const webResult = result.webResults![0];

            expect(webResult.groundedEvidence).toBeDefined();
            expect(webResult.groundedEvidence).toHaveLength(4);

            // Verifies 1: every evidence item supplied to extraction is recorded
            expect(webResult.groundedEvidence!.map((e) => e.key)).toEqual([
              'ev-1',
              'ev-2',
              'ev-3',
              'ev-4',
            ]);

            // Verifies 2: exact key, title, URL, snippet, rank/order, and provider metadata preserved
            for (let i = 0; i < multiEvidenceItems.length; i++) {
              const expected = multiEvidenceItems[i];
              const actual = webResult.groundedEvidence![i];
              expect(actual.key).toBe(expected.key);
              expect(actual.order).toBe(expected.order);
              expect(actual.title).toBe(expected.title);
              expect(actual.url).toBe(expected.url);
              expect(actual.snippet).toBe(expected.snippet);
              expect(actual.source).toBe(expected.source);
              expect(actual.kind).toBe(expected.kind);
            }
          });

          it('3: evidence remains available when no deep-source fetch occurs and candidate cites only one evidence item', async () => {
            const singleCiteCandidate = {
              ...webCandidate,
              evidenceKeys: ['ev-2'],
              componentHints: [
                {
                  key: 'cafe-tortoni',
                  name: 'Cafe Tortoni',
                  role: 'venue' as const,
                  expectedKind: 'PLACE' as const,
                  evidenceKeys: ['ev-2'],
                },
              ],
            };

            const search = jest
              .fn()
              .mockResolvedValue(multiEvidenceGroundedResult);
            const extractExperiences = jest.fn().mockResolvedValue({
              candidates: [singleCiteCandidate],
              extractionFailures: [],
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
            const webResult = result.webResults![0];

            // No deep source retrieval occurred
            expect(webResult.sourceContentRetrieval).toBeUndefined();

            // Candidate cites only ev-2
            expect(webResult.candidateDecisions![0].candidate).toBeDefined();

            // All 4 evidence items are preserved despite candidate citing only ev-2
            expect(webResult.groundedEvidence).toHaveLength(4);
            expect(
              webResult.groundedEvidence!.find((e) => e.key === 'ev-1')
                ?.snippet,
            ).toBe(multiEvidenceItems[0].snippet);
            expect(
              webResult.groundedEvidence!.find((e) => e.key === 'ev-2')
                ?.snippet,
            ).toBe(multiEvidenceItems[1].snippet);
            expect(
              webResult.groundedEvidence!.find((e) => e.key === 'ev-3')
                ?.snippet,
            ).toBe(multiEvidenceItems[2].snippet);
            expect(
              webResult.groundedEvidence!.find((e) => e.key === 'ev-4')
                ?.snippet,
            ).toBe(multiEvidenceItems[3].snippet);
          });

          it('3 & 4: preserves original search snippet snapshot even when deep-source retrieval mutates grounded.evidence and unselected items are rejected', async () => {
            const candidateWithGap = {
              name: 'Buenos Aires Historic Walk',
              description: 'A multi-stop walking tour',
              themes: ['culture'],
              traits: ['historic'],
              intents: ['walk'],
              suggestedDurationMinutes: 120,
              componentHints: [
                {
                  key: 'san-telmo',
                  name: 'San Telmo',
                  role: 'stop' as const,
                  expectedKind: 'PLACE' as const,
                  evidenceKeys: ['ev-1'],
                },
              ],
              evidenceKeys: ['ev-1'],
              shortReason: 'gap requires second component',
            };

            const searchEvidence = [
              {
                key: 'ev-1',
                order: 1,
                source: 'buenosaires.travel',
                title: 'San Telmo Walk',
                url: 'https://buenosaires.travel/san-telmo-walk',
                snippet: 'Original short search snippet for ev-1.',
              },
              {
                key: 'ev-2',
                order: 2,
                source: 'travelblog.com',
                title: 'La Boca Guide',
                url: 'https://travelblog.com/la-boca',
                snippet: 'Original short search snippet for ev-2.',
              },
              {
                key: 'ev-3',
                order: 3,
                source: 'generic.com',
                title: 'Non-editorial Page',
                url: 'https://generic.com/terms',
                snippet: 'Terms and conditions snippet for ev-3.',
              },
            ];

            const search = jest.fn().mockResolvedValue({
              provider: 'tavily',
              model: 'tavily-search',
              groundingStatus: 'applied',
              evidence: searchEvidence.map((e) => ({ ...e })),
              evidenceProvenance: [{ provider: 'tavily' }],
              rawOutput: 'grounded raw',
            });

            // First extraction returns single component (triggers gap), second extraction returns multi-component
            const extractExperiences = jest
              .fn()
              .mockResolvedValueOnce({
                candidates: [candidateWithGap],
                extractionFailures: [],
                validationErrors: [],
                provider: 'cloudflare',
                model: 'qwen',
                rawOutput: '{"candidates":[]}',
              })
              .mockResolvedValueOnce({
                candidates: [
                  {
                    ...candidateWithGap,
                    componentHints: [
                      {
                        key: 'san-telmo',
                        name: 'San Telmo',
                        role: 'stop' as const,
                        expectedKind: 'PLACE' as const,
                        evidenceKeys: ['ev-1'],
                      },
                      {
                        key: 'la-boca',
                        name: 'La Boca',
                        role: 'stop' as const,
                        expectedKind: 'PLACE' as const,
                        evidenceKeys: ['ev-1'],
                      },
                    ],
                  },
                ],
                extractionFailures: [],
                validationErrors: [],
                provider: 'cloudflare',
                model: 'qwen',
                rawOutput: '{"candidates":[]}',
              });

            const webSourceContentProvider = {
              providerName: 'cloudflare' as const,
              retrieve: jest.fn().mockResolvedValue({
                items: [
                  {
                    url: 'https://buenosaires.travel/san-telmo-walk',
                    status: 'success' as const,
                    content:
                      'Deep page content full text about San Telmo and La Boca walking tour route.'.repeat(
                        10,
                      ),
                  },
                ],
              }),
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
              undefined,
              webSourceContentProvider,
            );

            const result = await service.executePlan({
              destination: { destinationName: 'Buenos Aires' },
              deficits: [
                {
                  dimension: 'intent',
                  key: 'walk',
                  reason: 'r',
                  origin: 'preference_facet',
                },
              ],
              evidenceRequirements: ['MULTI_COMPONENT_EXPERIENCE'],
              breadth: 'focused',
              sourcePlans: [
                {
                  provider: 'web',
                  web: {
                    query: 'Buenos Aires walks',
                    requestedIntents: ['walk'],
                  },
                },
              ],
            });

            const webResult = result.webResults![0];

            // 4. Existing deep source selection audit works intact
            expect(webResult.deepSourceSelection).toBeDefined();
            expect(webResult.deepSourceSelection!.selectedUrls).toEqual([
              'https://buenosaires.travel/san-telmo-walk',
              'https://travelblog.com/la-boca',
            ]);
            expect(webResult.deepSourceSelection!.items).toHaveLength(3);
            expect(
              webResult.deepSourceSelection!.items.find(
                (i) => i.evidenceKey === 'ev-3',
              )?.selected,
            ).toBe(false);

            // 3. groundedEvidence preserved original search snippets, NOT overwritten by deep fetch
            expect(webResult.groundedEvidence).toBeDefined();
            expect(webResult.groundedEvidence).toHaveLength(3);
            expect(webResult.groundedEvidence![0].snippet).toBe(
              'Original short search snippet for ev-1.',
            );
            expect(webResult.groundedEvidence![1].snippet).toBe(
              'Original short search snippet for ev-2.',
            );
            expect(webResult.groundedEvidence![2].snippet).toBe(
              'Terms and conditions snippet for ev-3.',
            );

            // Unselected items (ev-2, ev-3) remain available in groundedEvidence
            expect(webResult.groundedEvidence![1].key).toBe('ev-2');
            expect(webResult.groundedEvidence![2].key).toBe('ev-3');
          });

          it('5: no production decision reads or alters behavior based on groundedEvidence', async () => {
            const search = jest
              .fn()
              .mockResolvedValue(multiEvidenceGroundedResult);
            const extractExperiences = jest.fn().mockResolvedValue({
              candidates: [webCandidate],
              extractionFailures: [],
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

            const resultNormal = await service.executePlan(webPlan);

            // Verify candidates and admission decisions are strictly independent of groundedEvidence
            expect(resultNormal.candidates).toHaveLength(1);
            expect(
              resultNormal.webResults![0].candidateDecisions![0].accepted,
            ).toBe(true);

            // materializeExecution only consumes candidates and context
            const mockResolver = {
              resolve: jest.fn().mockResolvedValue({
                acceptedCount: 1,
                rejectedCount: 0,
                resolved: [
                  {
                    candidate: webCandidate,
                    experienceId: 'exp-1',
                  },
                ],
                geographicValidation: { results: [] },
              }),
            };

            const serviceWithResolver = new ExperienceAcquisitionService(
              {} as any,
              {} as any,
              { acquire: jest.fn() } as any,
              { acquire: jest.fn() } as any,
              new StructuredExperienceCandidateSynthesizerService(),
              new StructuredCandidateCorroborationService(),
              mockResolver as any,
            );

            const resolution = await serviceWithResolver.materializeExecution(
              resultNormal,
              {
                geographicScope: { kind: 'DESTINATION_DEFAULT' } as any,
                geographicGrant: NO_GEOGRAPHIC_GRANT,
              },
            );

            expect(mockResolver.resolve).toHaveBeenCalledTimes(1);
            // resolver received candidates, not groundedEvidence
            expect(mockResolver.resolve.mock.calls[0][0].candidates).toEqual(
              withDefaultGeographicAuthorization(resultNormal.candidates),
            );
            expect(resolution.resolved).toHaveLength(1);
          });
        });
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
          findVerifiedWithinForMatching: jest.fn(),
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
          // Nearby acquisition owns no walk/route_like deficit: DEFAULT.
          candidates: [
            {
              candidate: mockCandidate,
              geographicAuthorization: { kind: 'DEFAULT' },
            },
          ],
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
        expect(catalog.findVerifiedWithinForMatching).not.toHaveBeenCalled();
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
        expect(catalog.findVerifiedWithinForMatching).not.toHaveBeenCalled();
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
            geographicGrant: NO_GEOGRAPHIC_GRANT,
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
            geographicGrant: NO_GEOGRAPHIC_GRANT,
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
            geographicGrant: NO_GEOGRAPHIC_GRANT,
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
            geographicGrant: NO_GEOGRAPHIC_GRANT,
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
            geographicGrant: NO_GEOGRAPHIC_GRANT,
          },
        );

        expect(proposalResolver.resolve).toHaveBeenCalledWith(
          expect.objectContaining({ entityResolutionScope: narrowScope }),
        );
      });

      describe('candidate-scoped geographic authorization (work-unit grant)', () => {
        const hint = (name: string) => ({
          key: name,
          name,
          role: 'venue' as const,
          expectedKind: 'PLACE' as const,
          evidenceKeys: ['ev-1'],
        });
        const candidateOf = (names: string[], intents: string[] = []) => ({
          name: names.join(' + '),
          themes: [] as string[],
          traits: [] as string[],
          intents,
          evidenceKeys: ['ev-1'],
          shortReason: 'grounded',
          componentHints: names.map(hint),
        });
        const materialize = async (grant: any, candidates: any[]) => {
          proposalResolver.resolve.mockResolvedValue({ resolved: [] });
          await buildService(false).materializeExecution(
            { candidates, observations: [], providerResults: {} } as any,
            { geographicGrant: grant },
          );
          return proposalResolver.resolve.mock.calls
            .at(-1)[0]
            .candidates.map((item: any) => item.geographicAuthorization.kind);
        };

        it('A/H: an owning route_like unit authorizes only its multi-component candidates; single places stay DEFAULT', async () => {
          const grant = ownedIntentGrant(
            'DEDICATED_INTENT',
            geographicIntentDeficit('route_like'),
          );
          expect(
            await materialize(grant, [
              candidateOf(['Winery A', 'Winery B']),
              candidateOf(['Winery C']),
            ]),
          ).toEqual(['ROUTE_LIKE', 'DEFAULT']);
        });

        it('J/K: AREA_ROUTE_WALK grants follow the owned deficit intent', async () => {
          expect(
            await materialize(
              ownedIntentGrant(
                'AREA_ROUTE_WALK',
                geographicIntentDeficit('route_like'),
              ),
              [candidateOf(['A', 'B'])],
            ),
          ).toEqual(['ROUTE_LIKE']);
          expect(
            await materialize(
              ownedIntentGrant(
                'AREA_ROUTE_WALK',
                geographicIntentDeficit('walk'),
              ),
              [candidateOf(['A', 'B'])],
            ),
          ).toEqual(['WALK']);
        });

        it('D/E/I: a unit without a grant (generic, planner capacity) leaves every candidate DEFAULT, even self-claimed route_like composites', async () => {
          expect(
            await materialize(NO_GEOGRAPHIC_GRANT, [
              candidateOf(['Winery A', 'Winery B'], ['route_like']),
              candidateOf(['Winery C'], ['walk']),
            ]),
          ).toEqual(['DEFAULT', 'DEFAULT']);
        });
      });
    });
  });

  describe('complete-unit cutover (milestone B, real atomized extractor)', () => {
    const SOB_URL =
      'https://secretsofbuenosaires.com/day-1-self-guided-walking-tour-in-buenos-aires/';
    const SOB_PAGE = readAtomizedFixture('sob-day1-page.md');
    const SOB_UNIT = readAtomizedFixture('sob-day1-unit.md');
    const SOB_RUN = recordedRun('recorded-sob-run1.json');
    /** The C3 grounded search record and free text for this source. */
    const grounded = {
      provider: 'serper',
      model: 'n/a',
      groundingStatus: 'applied',
      evidence: [
        {
          key: 'ev-2',
          source: 'secretsofbuenosaires.com',
          title: 'Day 1 self guided walking tour in Buenos Aires',
          snippet:
            'What you will see: Presidential Palace, Plaza de Mayo, Catedral, old town house, San Telmo, La Boca, tango on the street, Street Defensa, ...',
          url: SOB_URL,
        },
      ],
      rawOutput: 'grounded raw fixture',
    };
    const plan: ExperienceAcquisitionPlan = {
      destination: { destinationName: 'Buenos Aires' },
      deficits: [],
      evidenceRequirements: ['MULTI_COMPONENT_EXPERIENCE'],
      breadth: 'focused',
      sourcePlans: [
        {
          provider: 'web',
          web: {
            query:
              'Quiero recorrer San Telmo a pie por mi cuenta, sin guía, siguiendo un itinerario autoguiado por sus lugares históricos.',
          },
        },
      ],
    };
    const noCandidates = () =>
      jest.fn().mockResolvedValue({
        candidates: [],
        extractionFailures: [],
        validationErrors: [],
        sourceSupportAudits: [],
        provider: 'gemini',
        model: 'gemini-x',
        rawOutput: '{"candidates":[]}',
      });
    const kindOf = (name: string) =>
      name === 'El Caminito' ? 'ROUTE' : 'PLACE';

    function serviceWith(
      extractExperiences: jest.Mock,
      transport: ReturnType<typeof recordedAtomTransport>['transport'],
    ) {
      return new ExperienceAcquisitionService(
        {} as any,
        {} as any,
        { acquire: jest.fn() } as any,
        { acquire: jest.fn() } as any,
        new StructuredExperienceCandidateSynthesizerService(),
        new StructuredCandidateCorroborationService(),
        undefined,
        { search: jest.fn().mockResolvedValue(grounded) } as any,
        { extractExperiences } as any,
        undefined,
        {
          providerName: 'tavily',
          retrieve: jest.fn().mockResolvedValue({
            provider: 'tavily',
            requestedCount: 1,
            retrievedCount: 1,
            items: [
              {
                requestedUrl: SOB_URL,
                status: 'retrieved',
                contentType: 'markdown',
                content: SOB_PAGE,
                contentChars: SOB_PAGE.length,
                provider: 'tavily',
              },
            ],
            totalDurationMs: 10,
          }),
        } as any,
        new AtomizedSourceUnitExtractor(transport, {
          provider: 'gemini',
          model: 'gemini-3.5-flash-lite',
        }),
      );
    }

    it('the complete SECTION_UNIT takes the atomized path only; its candidates flow downstream', async () => {
      const extractExperiences = noCandidates();
      const { transport } = recordedAtomTransport(SOB_RUN, kindOf);
      const result = await serviceWith(
        extractExperiences,
        transport,
      ).executePlan(plan);

      const web = result.webResults![0];
      expect(web.extractionAttempts.map((a) => a.inputKind)).toEqual([
        'grounded_snippets',
        'atomized_source_unit',
      ]);
      const [, atomizedAttempt] = web.extractionAttempts;
      expect(atomizedAttempt.sourceWindow.windowing).toMatchObject({
        selectionStrategy: 'SECTION_UNIT',
        sectionComplete: true,
        windowOrdinal: 1,
      });
      expect(atomizedAttempt.sourceWindow.content).toBe(SOB_UNIT);
      // One composition authority: the generative extractor saw only the
      // grounded snippets, never the complete unit.
      expect(extractExperiences).toHaveBeenCalledTimes(1);
      for (const call of extractExperiences.mock.calls)
        for (const e of call[1].evidence)
          expect(e.snippet).not.toContain(
            'Make a stop at the national history museum',
          );
      expect(atomizedAttempt).toMatchObject({
        status: 'completed',
        scanDecision: 'STOP_REQUIREMENT_SATISFIED',
        extractorProvider: 'gemini',
        extractorModel: 'gemini-3.5-flash-lite',
        atomizedUnit: { contractOutcome: 'ASSEMBLED', atomCount: 182 },
      });
      expect(
        result.candidates.map((c) => c.componentHints.map((h) => h.name)),
      ).toEqual([
        SOB_RUN.spikeSegments[0].mandatory,
        SOB_RUN.spikeSegments[1].mandatory,
      ]);
      expect(web.sourceContentRetrieval?.scan).toMatchObject({
        outcome: 'REQUIREMENT_SATISFIED',
        satisfiedBy: [{ sourceUrl: SOB_URL, windowOrdinal: 1 }],
      });

      // The Generation Trace carries the pre-identity fidelity record.
      const recorder = new GenerationTraceRecorder();
      recordAcquisitionLifecycle(recorder, {
        passNumber: 1,
        workUnit: { kind: 'GENERIC', deficits: [] },
        geographicGrant: NO_GEOGRAPHIC_GRANT,
        plan,
        execution: result,
      });
      const trace = recorder.build({
        canonicalRequest: {},
        result: { status: 'COMPLETED', outcome: 'COMPLETED' },
      } as any);
      const window = trace.steps.find(
        (s) => s.name === 'acquisition.deep_source_window',
      );
      expect(window.description).toMatch(/^Extracción atomizada/);
      const unitStep = trace.steps.find(
        (s) => s.name === 'acquisition.atomized_source_unit',
      );
      expect(unitStep.parentId).toBe(window.parentId);
      expect(unitStep.decision).toMatchObject({
        status: 'PASS',
        outcome: 'ASSEMBLED',
      });
      expect(
        (unitStep.facts as any).segments.map((s: any) =>
          s.mandatoryBeforeIdentity.map((m: any) => m.sourceName),
        ),
      ).toEqual([...SOB_RUN.spikeSegments.map((s) => s.mandatory)]);
      expect(
        trace.steps.filter(
          (s) => s.name === 'acquisition.atomized_source_atoms',
        ),
      ).toHaveLength(4);
    });

    it('a contract fail-closed unit yields no candidates and never falls back to the generative path', async () => {
      const extractExperiences = noCandidates();
      const { transport } = recordedAtomTransport(SOB_RUN, kindOf, {
        kind: () => Promise.resolve('{"members": []}'),
      });
      const result = await serviceWith(
        extractExperiences,
        transport,
      ).executePlan(plan);

      const web = result.webResults![0];
      const unitAttempt = web.extractionAttempts.find(
        (a) => a.inputKind === 'atomized_source_unit',
      );
      expect(unitAttempt).toMatchObject({
        status: 'completed',
        extractedCandidateCount: 0,
        scanDecision: 'CONTINUE_NO_QUALIFYING_CANDIDATE',
        atomizedUnit: { contractOutcome: 'CONTRACT_FAIL_CLOSED' },
      });
      // No generative attempt ever examined the complete unit.
      for (const call of extractExperiences.mock.calls)
        for (const e of call[1].evidence) expect(e.snippet).not.toBe(SOB_UNIT);
      expect(
        web.extractionAttempts.filter(
          (a) =>
            a.inputKind === 'deep_source_content' &&
            a.sourceWindow.windowing.selectionStrategy === 'SECTION_UNIT',
        ),
      ).toEqual([]);
      expect(result.candidates).toEqual([]);
    });

    it('an INVALID_RUN unit is an operational failure on the attempt, not a semantic outcome', async () => {
      const extractExperiences = noCandidates();
      const { transport } = recordedAtomTransport(SOB_RUN, kindOf, {
        batch: (index) =>
          index === 1
            ? Promise.reject(new Error('Gemini request timeout after 25000ms'))
            : undefined,
      });
      const result = await serviceWith(
        extractExperiences,
        transport,
      ).executePlan(plan);
      const unitAttempt = result.webResults![0].extractionAttempts.find(
        (a) => a.inputKind === 'atomized_source_unit',
      );
      expect(unitAttempt).toMatchObject({
        status: 'failed',
        failureReason:
          'INVALID_RUN batch#1: Gemini request timeout after 25000ms',
        atomizedUnit: {
          contractOutcome: 'INVALID_RUN',
          providerFailure: { kind: 'batch', batchIndex: 1 },
        },
      });
      expect(result.candidates).toEqual([]);
    });
  });
});
