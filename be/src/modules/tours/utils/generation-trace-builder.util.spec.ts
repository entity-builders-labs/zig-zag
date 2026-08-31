import {
  buildCandidatePoolStep,
  buildCoverageAnalysisStep,
  buildDbSearchStep,
  buildDestinationResolutionStep,
  buildEmbeddingsStep,
  buildEntityResolutionStep,
  buildPlacesCrawlStep,
  buildTourIntentStep,
} from './generation-trace-builder.util';
import { ExperienceFormat } from '../interfaces/tour-generation.interface';
import { ActivityKind } from '@prisma/client';

describe('generation-trace-builder.util', () => {
  describe('buildTourIntentStep', () => {
    it('captures canonical intent and mobility values', () => {
      const step = buildTourIntentStep({
        contractVersion: 1,
        destination: {
          label: 'Buenos Aires',
          latitude: -34.6,
          longitude: -58.4,
          radiusMeters: 20000,
        },
        days: 2,
        intent: {
          interests: ['history'],
          experienceFormats: [ExperienceFormat.POINT_VISITS],
          explorationStyle: 'balanced',
          additionalPreferences: 'evitar iglesias',
        },
        mobility: {
          allowedTransportationModes: ['walking'],
          maxWalkingDistancePerDayMeters: 10000,
          maxContinuousWalkingDistanceMeters: 3000,
          travelPace: 'moderate',
          accessibilityNeeds: [],
        },
        startDates: [],
      } as any);

      expect(step.stage).toBe('tour_intent');
      expect(step.summary).toContain('history');
      expect(step.inputs).toMatchObject({
        days: 2,
        additionalPreferences: 'evitar iglesias',
      });
    });
  });

  describe('buildDbSearchStep', () => {
    it('records real catalog candidates', () => {
      const step = buildDbSearchStep(
        [{ id: 'a1', name: 'Museo', rating: 4.5, ratingCount: 10 }],
        10,
      );
      expect(step.stage).toBe('db_search');
      expect(step.outputs).toMatchObject({ candidateCount: 1 });
      expect(step.candidates?.[0]).toMatchObject({ id: 'a1', offered: true });
    });
  });

  describe('buildPlacesCrawlStep', () => {
    it('records provider provenance', () => {
      const step = buildPlacesCrawlStep(
        [],
        {
          provider: 'geoapify',
          cacheStatus: 'miss-live',
          requestedCount: 10,
          receivedCount: 3,
          acceptedCount: 2,
          rejectedCountByReason: {},
        } as any,
        false,
      );
      expect(step.stage).toBe('places_crawl');
      expect(step.inputs).toMatchObject({ provider: 'geoapify' });
    });
  });

  describe('buildEntityResolutionStep', () => {
    it('keeps explicit rejection reasons', () => {
      const step = buildEntityResolutionStep({
        totalProposals: 1,
        acceptedCount: 0,
        rejectedCount: 1,
        resolved: [
          {
            status: 'rejected',
            proposal: {
              name: 'Route',
              kind: 'ROUTE',
              themes: ['history'],
              entityHints: [],
              suggestedDurationMinutes: 60,
              shortReason: 'x',
              evidenceKeys: [],
            },
            resolvedEntities: [],
            rejectionReasons: ['unresolved_street'],
          },
        ],
      } as any);
      expect(step.summary).toContain('unresolved_street');
      expect(step.decision?.reasonCodes).toContain('unresolved_street');
    });
  });

  describe('buildCandidatePoolStep', () => {
    it('reports requested point visits from POI candidates', () => {
      const scoreBreakdown = {
        semanticSimilarity: 0.8,
        qualityBonus: 0.1,
        proximityBonus: 0.1,
        diversityBonus: 0,
        totalScore: 1,
      };
      const step = buildCandidatePoolStep({
        initialCatalogCount: 7,
        postAcquisitionCatalogCount: 7,
        eligibleCount: 7,
        requestedThemes: [],
        formatAvailability: [
          {
            format: ExperienceFormat.POINT_VISITS,
            fullPoolCount: 7,
            llmWindowCount: 7,
          },
        ],
        droppedForFamilyCapCount: 0,
        offeredCandidates: Array.from({ length: 7 }, (_, index) => ({
          id: `poi-${index}`,
          name: `POI ${index}`,
          kind: ActivityKind.POI,
          traceSource: 'db' as const,
          scoreBreakdown,
        })),
      });
      expect(step.outputs).toMatchObject({
        byKind: { POI: 7 },
      });
      expect(step.inputs).toMatchObject({
        requestedFormatAvailability: [
          {
            format: ExperienceFormat.POINT_VISITS,
            fullPoolCount: 7,
            llmWindowCount: 7,
          },
        ],
      });
    });
  });

  describe('buildEmbeddingsStep', () => {
    it('makes measured coverage explicit rather than implying the whole pool was semantically ranked', () => {
      const step = buildEmbeddingsStep(
        {
          status: 'applied',
          eligibleCandidateCount: 120,
          indexedCandidateCount: 100,
          identity: {
            provider: 'bedrock',
            model: 'test',
            dimensions: 256,
            documentVersion: 1,
          },
        },
        15,
      );

      expect(step.summary).toContain('solicitado y aplicado');
      expect(step.summary).toContain('100 tenían un vector compatible');
      expect(step.semanticRanking).toMatchObject({
        status: 'applied',
        provider: 'bedrock',
        dimensions: 256,
      });
    });
  });
});

describe('buildCoverageAnalysisStep', () => {
  it('reports analyzed vs eligible vs offered counts and the acquisition decision without implementation-phase terminology', () => {
    const step = buildCoverageAnalysisStep({
      status: 'insufficient',
      analyzedCandidateCount: 15,
      eligibleCandidateCount: 4,
      offeredCandidateCount: 4,
      usableCandidateCount: 4,
      requiredCandidateCount: 8,
      requestedThemeCoverage: [],
      kindCoverage: [],
      sourceCoverage: [],
      geographicCoverage: {
        distinctClusterCount: 1,
        thresholdKilometers: 2,
      },
      semanticCoverage: {
        status: 'unavailable',
        eligibleCandidateCount: 4,
        indexedCandidateCount: 0,
        reason: 'Ollama is offline',
      },
      destinationKnowledge: {
        status: 'discovery_supported',
        coverageBoundary: 'catalog_and_grounded_discovery',
        reason: 'Catalog coverage may be expanded through grounded discovery.',
      },
      providerHealth: { status: 'healthy' },
      deficits: [
        {
          reason: 'missing_requested_theme',
          severity: 'blocking',
          message: 'Falta cobertura para beach.',
        },
      ],
      decision: {
        action: 'places_text_search',
        reason: 'missing_requested_theme',
        requiresAdditionalDiscovery: false,
        deficits: [],
      },
    });

    expect(step.stage).toBe('coverage_analysis');
    expect(step.summary).toContain('Analizados 15 candidatos');
    expect(step.summary).toContain('elegibles 4');
    expect(step.summary).toContain('ofrecidos al LLM 4');
    expect(step.summary).toContain('places_text_search');
    expect(step.summary).not.toContain('PR 6');
    expect(step.summary).not.toContain('PR 7');
    expect(step.coverageReport?.decision.action).toBe('places_text_search');
  });
});

describe('destination trace step', () => {
  it('reports that a selected specific point was deliberately not widened', () => {
    const step = buildDestinationResolutionStep('Caminito, Buenos Aires', {
      scale: 'point',
      pointReason: 'specific_point_hint',
      attemptedQueries: [],
    });

    expect(step.stage).toBe('destination_resolution');
    expect(step.decision?.outcome).toBe('USE_POINT_RADIUS');
  });
});
