import {
  buildCandidatePoolStep,
  buildCatalogMaterializationStep,
  buildCoverageAnalysisStep,
  buildDailyPlanningStep,
  buildEmbeddingsStep,
  buildDestinationResolutionStep,
  buildEntityResolutionStep,
  buildGeographicValidationStep,
  buildLlmGenerationStep,
  buildPlacesCrawlStep,
  buildTourCompletenessStep,
  buildTourIntentStep,
} from './generation-trace-builder.util';
import { ActivityKind } from '@prisma/client';
import { ExperienceFormat } from '../interfaces/tour-generation.interface';
import { DailyPlanningSolution } from '../interfaces/daily-planning.interface';

describe('buildTourIntentStep', () => {
  it('traces supplemental intent once and labels walking limits as captured, not enforced', () => {
    const note = 'Prefer street photography';
    const step = buildTourIntentStep({
      contractVersion: 1,
      destination: {
        label: 'Córdoba',
        latitude: -31.42,
        longitude: -64.18,
        scaleHint: 'settlement' as any,
      },
      days: 1,
      budgetLevel: 'low' as any,
      groupType: 'solo' as any,
      intent: {
        interests: ['history'],
        explorationStyle: 'balanced' as any,
        additionalPreferences: note,
      },
      mobility: {
        allowedTransportationModes: ['public_transport' as any],
        maxWalkingDistancePerDayMeters: 2000,
        maxContinuousWalkingDistanceMeters: 500,
        travelPace: 'moderate' as any,
        accessibilityNeeds: [],
      },
      dietaryRestrictions: [],
      startDates: [],
      includeExistingActivities: true,
      skipImageGeneration: true,
      excludeTours: [],
      categories: [],
    });

    expect(step.stage).toBe('tour_intent');
    expect(step.summary).toContain('public_transport');
    expect(step.summary).toContain('todavía no se aplica');
    expect(step.summary?.split(note)).toHaveLength(2);
  });
});
describe('buildTourCompletenessStep', () => {
  it('reports success and no retry when the itinerary is already complete', () => {
    const step = buildTourCompletenessStep(
      { complete: true, issues: [] },
      false,
    );

    expect(step.stage).toBe('tour_completeness');
    expect(step.providerStatus).toBe('success');
    expect(step.degradedReason).toBeUndefined();
    expect(step.tourCompleteness).toEqual({
      complete: true,
      issues: [],
      retryAttempted: false,
    });
  });

  it('surfaces each underfilled day and marks the degraded reason', () => {
    const step = buildTourCompletenessStep(
      {
        complete: false,
        issues: [
          {
            code: 'UNDERFILLED_DAY',
            dayNumber: 1,
            selectedExperienceCount: 2,
            selectedExperienceHours: 2.5,
            viableUnusedCandidateCount: 12,
            travelPace: 'moderate' as any,
            message: 'thin day',
          },
        ],
      },
      true,
    );

    expect(step.providerStatus).toBe('failed');
    expect(step.degradedReason).toBe('underfilled_day');
    expect(step.summary).toContain('Día 1');
    expect(step.summary).toContain('reintentó');
    expect(step.tourCompleteness?.retryAttempted).toBe(true);
  });
});

describe('buildDailyPlanningStep', () => {
  it('summarizes a solved solution into a trace step', () => {
    const solution: DailyPlanningSolution = {
      days: [
        {
          dayNumber: 1,
          activities: [
            {
              activityId: 'a',
              startMinutesFromMidnight: 540,
              endMinutesFromMidnight: 600,
            },
          ],
          totalActivityMinutes: 60,
          totalTravelMinutes: 5,
          totalWalkingMinutes: 5,
          utilizationMinutes: 65,
        },
      ],
      unselected: [
        { activityId: 'b', reasons: ['DAILY_TIME_CAPACITY_EXCEEDED'] },
      ],
      score: 1,
      metadata: {
        solver: 'GreedyDailyPlanningSolver',
        approximateTravel: true,
        iterations: 3,
      },
    };

    const step = buildDailyPlanningStep(solution);

    expect(step.stage).toBe('daily_planning');
    expect(step.summary).toContain('GreedyDailyPlanningSolver');
    expect(step.summary).toContain('1');
    expect(step.providerStatus).toBeUndefined();
    expect(step.degradedReason).toBeUndefined();
    expect(step.dailyPlanning).toEqual({
      solver: 'GreedyDailyPlanningSolver',
      dayCount: 1,
      selectedCount: 1,
      unselectedCount: 1,
      approximateTravel: true,
      iterations: 3,
      score: 1,
      days: [
        {
          dayNumber: 1,
          activityCount: 1,
          totalActivityMinutes: 60,
          totalTravelMinutes: 5,
          totalWalkingMinutes: 5,
          utilizationMinutes: 65,
        },
      ],
    });
  });

  it('flags a degraded outcome when no activities were selected across any day', () => {
    const solution: DailyPlanningSolution = {
      days: [
        {
          dayNumber: 1,
          activities: [],
          totalActivityMinutes: 0,
          totalTravelMinutes: 0,
          totalWalkingMinutes: 0,
          utilizationMinutes: 0,
        },
      ],
      unselected: [
        { activityId: 'a', reasons: ['DAILY_TIME_CAPACITY_EXCEEDED'] },
        { activityId: 'b', reasons: ['OPENING_HOURS_INCOMPATIBLE'] },
      ],
      score: 0,
      metadata: {
        solver: 'GreedyDailyPlanningSolver',
        approximateTravel: false,
      },
    };

    const step = buildDailyPlanningStep(solution);

    expect(step.providerStatus).toBe('failed');
    expect(step.degradedReason).toBe('no_activities_selected');
    expect(step.dailyPlanning?.iterations).toBeUndefined();
  });
});

describe('buildEntityResolutionStep', () => {
  const proposal = (name: string) => ({
    name,
    kind: 'POI' as any,
    themes: ['history'],
    traits: [] as string[],
    componentHints: [] as any[],
    entityHints: [] as any[],
    suggestedDurationMinutes: 90,
    shortReason: 'test',
    evidenceKeys: [] as string[],
  });

  it('reports accepted proposals with resolved entities ready for geographic validation', () => {
    const step = buildEntityResolutionStep({
      resolved: [
        {
          proposal: { ...proposal('Casa Histórica'), traits: [], componentHints: [] },
          status: 'accepted',
          resolvedEntities: [
            {
              hintKey: 'hint-1',
              hintName: 'Casa Histórica',
              role: 'venue',
              expectedType: 'museum',
              provider: 'osm',
              canonicalName: 'Casa Histórica',
              status: 'resolved',
              latitude: -34.62,
              longitude: -58.37,
            },
          ],
          rejectionReasons: [],
          experienceId: 'experience-1',
        },
      ],
      totalProposals: 1,
      acceptedCount: 1,
      rejectedCount: 0,
    });

    expect(step.stage).toBe('entity_resolution');
    expect(step.providerStatus).toBe('success');
    expect(step.degradedReason).toBeUndefined();
    expect(step.summary).toContain(
      'Esta etapa no decide coherencia geográfica ni persiste la composite',
    );
    expect(step.decision?.outcome).toBe(
      'ENTITIES_READY_FOR_GEOGRAPHIC_VALIDATION',
    );
    expect(step.resolution?.acceptedCount).toBe(1);
  });

  it('surfaces each rejected proposal with its reasons and marks the step degraded', () => {
    const step = buildEntityResolutionStep({
      resolved: [
        {
          proposal: { ...proposal('Plaza Ambigua'), traits: [], componentHints: [] },
          status: 'rejected',
          resolvedEntities: [],
          rejectionReasons: ['area_ambiguous'],
        },
      ],
      totalProposals: 1,
      acceptedCount: 0,
      rejectedCount: 1,
    });

    expect(step.providerStatus).toBe('failed');
    expect(step.degradedReason).toBe('no_proposals_resolved');
    expect(step.summary).toContain('Plaza Ambigua: area_ambiguous');
  });
});

describe('buildGeographicValidationStep', () => {
  it('reports GEO_VERIFIED proposals ready for materialization', () => {
    const step = buildGeographicValidationStep({
      resolved: [],
      totalProposals: 1,
      acceptedCount: 1,
      rejectedCount: 0,
      geographicValidation: {
        results: [
          {
            proposalName: 'Paseo San Telmo',
            kind: 'NEIGHBORHOOD_WALK' as any,
            status: 'GEO_VERIFIED',
            strategy: 'component_defined',
            accepted: true,
            validatorVersion: 1,
            groundedEvidenceKeys: ['ev1'],
            anchors: [
              {
                hintKey: 'a1',
                hintName: 'Plaza',
                role: 'venue',
                expectedType: 'square',
                provider: 'osm',
                externalId: 'w1',
                status: 'resolved',
              },
            ],
            rejectionReasons: [],
          },
        ],
        acceptedCount: 1,
        rejectedCount: 0,
      },
    });

    expect(step.stage).toBe('geographic_validation');
    expect(step.status).toBe('PASS');
    expect(step.decision?.outcome).toBe('GEO_VERIFIED_PROPOSALS_READY');
    expect(step.summary).toContain('1 propuesta(s) GEO_VERIFIED');
  });
});

describe('buildCatalogMaterializationStep', () => {
  it('reports materialized activities persisted in catalog', () => {
    const step = buildCatalogMaterializationStep({
      resolved: [
        {
          proposal: {
            name: 'Paseo San Telmo',
            kind: 'NEIGHBORHOOD_WALK' as any,
            themes: [],
            traits: [],
            componentHints: [],
            entityHints: [],
            suggestedDurationMinutes: 120,
            shortReason: 'test',
            evidenceKeys: [],
          },
          status: 'accepted',
          resolvedEntities: [],
          rejectionReasons: [],
          experienceId: 'experience-1',
        },
      ],
      totalProposals: 1,
      acceptedCount: 1,
      rejectedCount: 0,
    });

    expect(step.stage).toBe('catalog_materialization');
    expect(step.status).toBe('PASS');
    expect(step.decision?.outcome).toBe('VERIFIED_EXPERIENCES_MATERIALIZED');
    expect(step.summary).toContain(
      '1 propuesta(s) geográficamente verificadas',
    );
  });
});

describe('buildPlacesCrawlStep', () => {
  it('reports the actual Geoapify provider and cache provenance', () => {
    const step = buildPlacesCrawlStep([{ id: 'a1', name: 'Museo' }], {
      provider: 'geoapify',
      cacheStatus: 'hit',
      requestedCount: 20,
      receivedCount: 4,
      acceptedCount: 1,
      rejectedCountByReason: { existing_activity: 3 },
    });

    expect(step.stage).toBe('places_crawl');
    expect(step.label).toContain('Geoapify');
    expect(step.label).not.toContain('Google');
    expect(step.summary).toContain('cache hit');
    expect(step.candidates?.[0].source).toBe('geoapify');
    expect(step.placesProvenance?.acceptedCount).toBe(1);
  });

  it('surfaces rejected candidates by name, not just an aggregate count', () => {
    const step = buildPlacesCrawlStep([{ id: 'a1', name: 'Museo Admitido' }], {
      provider: 'google',
      cacheStatus: 'miss-live',
      requestedCount: 5,
      receivedCount: 2,
      acceptedCount: 1,
      rejectedCountByReason: { outside_destination_boundary: 1 },
      rejectedCandidates: [
        {
          id: 'place-2',
          name: 'Casa Histórica - Museo Nacional de la Independencia',
          reasons: ['outside_destination_boundary'],
        },
      ],
    });

    const rejected = step.candidates?.find(
      (c) => c.name === 'Casa Histórica - Museo Nacional de la Independencia',
    );
    expect(rejected).toEqual(
      expect.objectContaining({
        offered: false,
        chosen: false,
        detail: 'rechazado: outside_destination_boundary',
      }),
    );
    expect(step.candidates?.find((c) => c.name === 'Museo Admitido')).toEqual(
      expect.objectContaining({ offered: true }),
    );
  });

  it('reports a strict Google cache miss as a failure without claiming results', () => {
    const step = buildPlacesCrawlStep(
      [],
      {
        provider: 'google',
        cacheStatus: 'strict-miss',
        requestedCount: 20,
        receivedCount: 0,
        acceptedCount: 0,
        rejectedCountByReason: {},
      },
      true,
    );

    expect(step.label).toContain('Google Places');
    expect(step.summary).toContain('falló');
    expect(step.summary).toContain('strict cache miss');
    expect(step.summary).not.toContain('encontró');
  });

  it('reports provider request failures separately from rejected candidate results', () => {
    const step = buildPlacesCrawlStep([], {
      provider: 'google',
      cacheStatus: 'miss-live',
      requestedCount: 320,
      receivedCount: 55,
      acceptedCount: 8,
      rejectedCountByReason: {
        out_of_area: 46,
        existing_activity: 1,
        provider_request_failed: 13,
      },
    });

    expect(step.summary).toContain('Rechazos totales registrados: 47');
    expect(step.summary).toContain(
      'Motivos registrados (un candidato puede tener más de uno): existing_activity=1; out_of_area=46',
    );
    expect(step.summary).toContain('13 consulta(s) al proveedor fallaron');
    expect(step.summary).not.toContain('provider_request_failed=13');
    expect(step.summary).not.toContain('Rechazos totales registrados: 60');
  });

  it('includes provider primary type and catalog category in candidate details', () => {
    const step = buildPlacesCrawlStep(
      [
        {
          id: 'place-1',
          name: 'Museo de la Ciudad',
          type: 'cultural',
          rating: 4.6,
          ratingCount: 125,
          metadata: {
            placesProvider: 'google',
            providerPrimaryType: 'museum',
          },
        },
      ],
      {
        provider: 'google',
        cacheStatus: 'miss-live',
        requestedCount: 1,
        receivedCount: 1,
        acceptedCount: 1,
        rejectedCountByReason: {},
      },
    );

    expect(step.candidates?.[0].detail).toBe(
      'tipo proveedor museum · categoría cultural · rating 4.6/5 (125 reviews)',
    );
  });

  it('reports anchors, bounded provider calls, validation, deduplication and embeddings', () => {
    const step = buildPlacesCrawlStep([], {
      provider: 'google',
      cacheStatus: 'miss-live',
      requestedCount: 20,
      receivedCount: 12,
      acceptedCount: 5,
      rejectedCount: 7,
      seedReceivedCount: 4,
      coverageReceivedCount: 8,
      operationGeographyRejectedCount: 1,
      validatedCount: 6,
      identityValidCount: 6,
      admittedCount: 6,
      deduplicatedCount: 2,
      existingCount: 1,
      persistedCount: 5,
      embeddedCount: 5,
      providerCallCount: 4,
      anchors: [
        {
          id: 'casco',
          label: 'Casco Antiguo',
          latitude: 1,
          longitude: 2,
          radiusMeters: 2500,
        },
        {
          id: 'triana',
          label: 'Triana',
          latitude: 1,
          longitude: 3,
          radiusMeters: 2500,
        },
      ],
      operations: [
        {
          operationId: 'seed:tourist-attractions',
          purpose: 'destination_seed',
          providerOperation: 'text',
          category: 'visitor_landmarks',
          textQuery: 'top tourist attractions in Test City',
          includedType: 'tourist_attraction',
          strictTypeFiltering: false,
          geographicConstraint: {
            kind: 'circle',
            circle: {
              center: { latitude: 1, longitude: 2 },
              radius: 2500,
            },
          },
          resultBudget: 10,
          preferredTime: 'day',
          supported: true,
          status: 'succeeded',
          receivedCount: 4,
          rejectedCountByReason: {},
        },
        {
          operationId: 'coverage:casco:visitor_landmarks',
          purpose: 'geographic_coverage',
          providerOperation: 'nearby',
          category: 'visitor_landmarks',
          requestedPrimaryTypes: ['tourist_attraction'],
          rankPreference: 'POPULARITY',
          geographicConstraint: {
            kind: 'circle',
            circle: {
              center: { latitude: 1, longitude: 2 },
              radius: 2500,
            },
          },
          resultBudget: 10,
          anchorId: 'casco',
          preferredTime: 'day',
          supported: true,
          status: 'succeeded',
          receivedCount: 8,
          rejectedCountByReason: {},
        },
      ],
      rejectedCountByReason: {
        duplicate_result: 2,
        existing_activity: 1,
        generic_name: 4,
      },
    });

    expect(step.summary).toContain(
      '2 punto(s) de cobertura geográfica para distribuir las consultas',
    );
    expect(step.summary).toContain('Casco Antiguo, Triana');
    expect(step.summary).toContain('no implican relevancia turística');
    expect(step.summary).toContain('4 consulta(s) acotadas');
    expect(step.summary).toContain('1 Google Places Text Search');
    expect(step.summary).toContain('1 Nearby Search');
    expect(step.summary).toContain('semilla recibió 4');
    expect(step.summary).toContain('cobertura recibió 8');
    expect(step.summary).toContain('geografía de operación rechazó 1');
    expect(step.summary).toContain('la unión eliminó 2 duplicado(s)');
    expect(step.summary).toContain('identidad válida 6');
    expect(step.summary).toContain('admisión aprobada 6');
    expect(step.summary).toContain('1 ya existía(n)');
    expect(step.summary).toContain('persistió 5 nuevo(s)');
    expect(step.summary).toContain('indexó 5 embedding(s)');
    expect(step.summary).toContain('Rechazos totales registrados: 7');
    expect(step.summary).toContain(
      'Motivos registrados (un candidato puede tener más de uno): duplicate_result=2; existing_activity=1; generic_name=4',
    );
    expect(step.summary).not.toContain('consultar motivos');
  });
});

describe('buildEmbeddingsStep', () => {
  it('does not claim semantic ranking was applied when the provider failed', () => {
    const step = buildEmbeddingsStep(
      {
        status: 'unavailable',
        eligibleCandidateCount: 120,
        indexedCandidateCount: 0,
        reason: 'Ollama is offline',
      },
      15,
    );

    expect(step.summary).toContain('solicitado pero no aplicado');
    expect(step.summary).toContain('calidad y proximidad');
    expect(step.semanticRanking?.status).toBe('unavailable');
  });

  it('reports actual query application and compatible index identity', () => {
    const step = buildEmbeddingsStep(
      {
        status: 'applied',
        eligibleCandidateCount: 120,
        indexedCandidateCount: 100,
        identity: {
          provider: 'bedrock',
          model: 'amazon.titan-embed-text-v2:0',
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
        reason: 'El catálogo puede ampliarse mediante búsqueda grounded.',
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
    expect(step.summary).not.toMatch(/PR\s*\d+/);
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

    expect(step.summary).toContain('lugar o dirección específica');
    expect(step.summary).toContain('no se amplía');
    expect(step.summary).not.toContain('no resolvió');
  });

  it('records normalized destination attempts and the coordinate mismatch reason', () => {
    const step = buildDestinationResolutionStep('Montevideo', {
      scale: 'point',
      attemptedQueries: ['forward:Montevideo', 'reverse:-34.905900,-56.191300'],
      degradationReason: 'candidate_mismatched_coordinates',
    });

    expect(step.summary).toContain('reverse:-34.905900,-56.191300');
    expect(step.summary).toContain('no coincidían con las coordenadas');
  });

  it('distinguishes a matched settlement node from its hydrated administrative boundary', () => {
    const step = buildDestinationResolutionStep('San Juan, Argentina', {
      scale: 'area',
      boundary: {
        id: 'osm:relation:3465536',
        name: 'Capital',
        osmType: 'relation',
        osmId: 3465536,
        geometry: { type: 'Point', coordinates: [-68.53, -31.53] },
        tags: { name: 'Capital', admin_level: '5' },
      },
      settlementResult: { displayName: 'San Juan, Argentina' },
      attemptedQueries: [
        'forward:San Juan, Argentina',
        'containing-boundary:-31.535107,-68.538594',
      ],
    });

    expect(step.summary).toContain('se identificó como San Juan, Argentina');
    expect(step.summary).toContain('límite administrativo contenedor Capital');
    expect(step.summary).not.toContain('ciudad: Capital');
  });

  it('describes a direct city relation as a search boundary without claiming neighborhood exploration', () => {
    const step = buildDestinationResolutionStep('La Rioja, Argentina', {
      scale: 'area',
      boundary: {
        id: 'osm:relation:123',
        name: 'La Rioja',
        osmType: 'relation',
        osmId: 123,
        geometry: { type: 'Point', coordinates: [-66.85, -29.41] },
        tags: { name: 'La Rioja', admin_level: '8' },
      },
      attemptedQueries: ['forward:La Rioja, Argentina'],
    });

    expect(step.summary).toContain(
      'Se usa ese límite real para acotar la recuperación y adquisición de candidatos',
    );
    expect(step.summary).not.toContain('exploran');
    expect(step.summary).not.toContain('barrios');
  });
});

describe('buildLlmGenerationStep', () => {
  it('labels model reasoning as unverified rather than deterministic evidence', () => {
    const step = buildLlmGenerationStep(
      'All activities fit public-transport zones and opening hours.',
    );

    expect(step.label).toContain('no verificada');
    expect(step.summary).toContain('no constituyen verificación');
    expect(step.summary).toContain('transporte');
    expect(step.summary).toContain('horarios');
  });
});

describe('buildCandidatePoolStep', () => {
  function breakdown(overrides: Partial<Record<string, any>> = {}) {
    return {
      semanticSimilarity: 0.5,
      qualityBonus: 0.1,
      proximityBonus: 0.05,
      diversityBonus: 0,
      totalScore: 0.65,
      ...overrides,
    };
  }

  it('tags each candidate with its real source, counts by kind/source, and only the theme-matching candidate gets a coverage contribution', () => {
    const step = buildCandidatePoolStep({
      initialCatalogCount: 40,
      postAcquisitionCatalogCount: 42,
      eligibleCount: 42,
      offeredCandidates: [
        {
          id: 'poi-catalog',
          name: 'Museo Histórico',
          kind: ActivityKind.POI,
          type: 'museum',
          traceSource: 'db',
          scoreBreakdown: breakdown(),
        },
        {
          id: 'poi-refill',
          name: 'Plaza Central',
          kind: ActivityKind.POI,
          type: 'plaza',
          traceSource: 'google_places',
          scoreBreakdown: breakdown(),
        },
        {
          id: 'walk-discovery',
          name: 'San Telmo Historic Walk',
          kind: ActivityKind.NEIGHBORHOOD_WALK,
          type: 'walk',
          traceSource: 'discovery',
          scoreBreakdown: breakdown(),
        },
      ],
      requestedThemes: ['history'],
      formatAvailability: [
        {
          format: ExperienceFormat.NEIGHBORHOOD_WALKS,
          fullPoolCount: 1,
          llmWindowCount: 1,
        },
      ],
      droppedForFamilyCapCount: 0,
    });

    expect(step.stage).toBe('candidate_pool');
    expect(step.candidatePool?.bySource).toEqual({
      catalog: 1,
      refill: 1,
      discovery: 1,
    });
    expect(step.candidatePool?.byKind).toEqual({
      [ActivityKind.POI]: 2,
      [ActivityKind.NEIGHBORHOOD_WALK]: 1,
    });
    expect(step.candidatePool?.llmWindowCount).toBe(3);

    const byId = new Map(step.candidates?.map((c) => [c.id, c]));
    expect(byId.get('poi-catalog')?.coverageContribution?.themes).toEqual([
      'history',
    ]);
    expect(byId.get('poi-refill')?.coverageContribution?.themes).toEqual([]);
    expect(byId.get('walk-discovery')?.source).toBe('discovery');
    expect(
      byId.get('walk-discovery')?.coverageContribution?.experienceFormat,
    ).toBe(ExperienceFormat.NEIGHBORHOOD_WALKS);
  });

  it('surfaces a dropped-for-family-cap count in the summary when variants were capped', () => {
    const step = buildCandidatePoolStep({
      initialCatalogCount: 5,
      postAcquisitionCatalogCount: 5,
      eligibleCount: 5,
      offeredCandidates: [
        {
          id: 'poi-1',
          name: 'Museo',
          kind: ActivityKind.POI,
          traceSource: 'db',
          scoreBreakdown: breakdown(),
        },
      ],
      requestedThemes: [],
      formatAvailability: [],
      droppedForFamilyCapCount: 2,
    });

    expect(step.summary).toContain('2 variante(s) adicional(es)');
    expect(step.candidatePool?.droppedForFamilyCapCount).toBe(2);
  });
});
