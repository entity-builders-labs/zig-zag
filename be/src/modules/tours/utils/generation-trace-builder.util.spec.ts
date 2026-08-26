import {
  buildCoverageAnalysisStep,
  buildEmbeddingsStep,
  buildDestinationResolutionStep,
  buildLlmGenerationStep,
  buildPlacesCrawlStep,
  buildTourCompletenessStep,
  buildTourIntentStep,
} from './generation-trace-builder.util';

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
        experienceFormats: ['neighborhood_walks' as any],
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
    expect(step.summary).toContain('neighborhood_walks');
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
            selectedActivityCount: 2,
            selectedActivityHours: 2.5,
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
  it('reports analyzed vs eligible vs offered counts and the explicit PR6 decision', () => {
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
        status: 'unsupported_until_pr7',
        deployableBoundary: 'catalog_quality_only_until_pr7',
        reason: 'PR 6 boundary',
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
        deployableInPr6: true,
        deficits: [],
      },
    });

    expect(step.stage).toBe('coverage_analysis');
    expect(step.summary).toContain('Analizados 15 candidatos');
    expect(step.summary).toContain('elegibles 4');
    expect(step.summary).toContain('ofrecidos al LLM 4');
    expect(step.summary).toContain('places_text_search');
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
