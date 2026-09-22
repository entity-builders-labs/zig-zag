import {
  buildAcquisitionStep,
  buildCandidatePoolStep,
  buildCatalogMaterializationStep,
  buildDailyPlanningStep,
  buildEmbeddingsStep,
  buildDestinationResolutionStep,
  buildEntityResolutionStep,
  buildGeographicValidationStep,
  buildLlmGenerationStep,
  buildPlacesCrawlStep,
  traceCandidateKey,
  buildTourCompletenessStep,
  buildTourIntentStep,
} from './generation-trace-builder.util';
import { DailyPlanningSolution } from '../interfaces/daily-planning.interface';
import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';
import { GeographicValidationStatus } from '../interfaces/geographic-validation.interface';

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
      includeExistingExperiences: true,
      skipImageGeneration: true,
      excludeTours: [],
      categories: [],
    });

    expect(step.stage).toBe('tour_intent');
    expect(step.summary).toContain('public_transport');
    expect(step.summary).toContain('Temas: history');
    expect(step.summary?.split(note)).toHaveLength(2);
  });
});

describe('traceCandidateKey', () => {
  const candidate = (orderedByEvidence = false) => ({
    name: 'Historic District Walk',
    themes: ['history'],
    traits: [] as string[],
    componentHints: [
      {
        key: 'b',
        name: 'Stop B',
        role: 'waypoint' as const,
        expectedKind: 'PLACE' as const,
        required: true,
        evidenceKeys: ['e'],
      },
      {
        key: 'a',
        name: 'Stop A',
        role: 'waypoint' as const,
        expectedKind: 'PLACE' as const,
        required: true,
        evidenceKeys: ['e'],
      },
    ],
    evidenceKeys: ['z', 'a'],
    shortReason: 'test',
    orderedByEvidence,
  });

  it('ignores evidence and non-semantic hint iteration order, preserving semantic order only when grounded', () => {
    const first = candidate();
    const second = {
      ...candidate(),
      evidenceKeys: ['a', 'z'],
      componentHints: [...first.componentHints].reverse(),
    };
    expect(traceCandidateKey(first)).toBe(traceCandidateKey(second));
    expect(traceCandidateKey(candidate(true))).not.toBe(
      traceCandidateKey({
        ...candidate(true),
        componentHints: [...candidate(true).componentHints].reverse(),
      }),
    );
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
          experiences: [
            {
              experienceId: 'a',
              startMinutesFromMidnight: 540,
              endMinutesFromMidnight: 600,
            },
          ],
          totalExperienceMinutes: 60,
          totalTravelMinutes: 5,
          totalWalkingMinutes: 5,
          utilizationMinutes: 65,
        },
      ],
      unselected: [
        { experienceId: 'b', reasons: ['DAILY_TIME_CAPACITY_EXCEEDED'] },
      ],
      score: 1,
      metadata: {
        solver: 'GreedyDailyPlanningSolver',
        approximateTravel: true,
        iterations: 3,
        residualCapacity: [
          { dayNumber: 1, availableMinutes: 42, meaningful: true },
        ],
      },
    };

    const step = buildDailyPlanningStep(solution);

    expect(step.stage).toBe('daily_planning');
    expect(step.summary).toContain('GreedyDailyPlanningSolver');
    expect(step.summary).toContain('1');
    expect(step.outputs?.residualCapacity).toEqual(
      solution.metadata.residualCapacity,
    );
    expect(step.dailyPlanning?.residualCapacity).toEqual(
      solution.metadata.residualCapacity,
    );
    expect(step.providerStatus).toBeUndefined();
    expect(step.degradedReason).toBeUndefined();
    expect(step.dailyPlanning).toEqual({
      solver: 'GreedyDailyPlanningSolver',
      dayCount: 1,
      selectedCount: 1,
      unselectedCount: 1,
      approximateTravel: true,
      iterations: 3,
      residualCapacity: solution.metadata.residualCapacity,
      score: 1,
      days: [
        {
          dayNumber: 1,
          experienceCount: 1,
          totalExperienceMinutes: 60,
          totalTravelMinutes: 5,
          totalWalkingMinutes: 5,
          utilizationMinutes: 65,
        },
      ],
    });
  });

  it('flags a degraded outcome when no experiences were selected across any day', () => {
    const solution: DailyPlanningSolution = {
      days: [
        {
          dayNumber: 1,
          experiences: [],
          totalExperienceMinutes: 0,
          totalTravelMinutes: 0,
          totalWalkingMinutes: 0,
          utilizationMinutes: 0,
        },
      ],
      unselected: [
        { experienceId: 'a', reasons: ['DAILY_TIME_CAPACITY_EXCEEDED'] },
        { experienceId: 'b', reasons: ['OPENING_HOURS_INCOMPATIBLE'] },
      ],
      score: 0,
      metadata: {
        solver: 'GreedyDailyPlanningSolver',
        approximateTravel: false,
      },
    };

    const step = buildDailyPlanningStep(solution);

    expect(step.providerStatus).toBe('failed');
    expect(step.degradedReason).toBe('no_experiences_selected');
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
          candidate: {
            ...proposal('Casa Histórica'),
            traits: [],
            componentHints: [
              {
                key: 'hint-1',
                name: 'Casa Histórica',
                role: 'venue',
                expectedKind: 'PLACE',
                required: true,
                evidenceKeys: [],
              },
            ],
          },
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
      totalCandidates: 1,
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
    expect(step.entityResolutionAudit?.[0].hints[0]).toMatchObject({
      role: 'venue',
      resolvedGeoEntity: { provider: 'osm' },
    });
    expect(
      step.entityResolutionAudit?.[0].hints[0].resolvedGeoEntity,
    ).not.toHaveProperty('kind');
  });

  it('surfaces each rejected proposal with its reasons and marks the step degraded', () => {
    const step = buildEntityResolutionStep({
      resolved: [
        {
          candidate: {
            ...proposal('Plaza Ambigua'),
            traits: [],
            componentHints: [],
          },
          status: 'rejected',
          resolvedEntities: [],
          rejectionReasons: ['area_ambiguous'],
        },
      ],
      totalCandidates: 1,
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
      totalCandidates: 1,
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
    expect(step.summary).toContain('1 propuesta(s) verificadas');
    expect(
      step.geographicValidationAudit?.[0].components.every(
        (component) => component.relation !== 'offending',
      ),
    ).toBe(true);
  });

  it('projects the canonical offending component and does not infer it from anchors', () => {
    const candidate = {
      name: 'Historic District Walk',
      themes: ['history'],
      traits: [] as string[],
      componentHints: [
        {
          key: 'inside',
          name: 'Stop Inside',
          role: 'waypoint',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['ev'],
        },
        {
          key: 'outside',
          name: 'Stop Outside',
          role: 'waypoint',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['ev'],
        },
      ],
      evidenceKeys: ['ev'],
      shortReason: 'test',
    };
    const entities = [
      {
        hintKey: 'inside',
        hintName: 'Stop Inside',
        role: 'waypoint',
        provider: 'osm',
        externalId: 'inside',
        status: 'resolved',
      },
      {
        hintKey: 'outside',
        hintName: 'Stop Outside',
        role: 'waypoint',
        provider: 'osm',
        externalId: 'outside',
        status: 'resolved',
      },
    ];
    const step = buildGeographicValidationStep({
      resolved: [
        {
          candidate,
          status: 'accepted',
          resolvedEntities: entities,
          rejectionReasons: [],
        } as any,
      ],
      totalCandidates: 1,
      acceptedCount: 0,
      rejectedCount: 1,
      geographicValidation: {
        results: [
          {
            proposalName: candidate.name,
            kind: 'EXPERIENCE',
            status: 'REJECTED' as GeographicValidationStatus,
            accepted: false,
            validatorVersion: 1,
            groundedEvidenceKeys: ['ev'],
            rejectionReasons: ['external_scope_mismatch'],
            anchors: [entities[0]] as any,
            decisionEntities: [
              {
                hintKey: 'inside',
                geoEntityId: 'inside',
                relation: 'evaluated',
              },
              {
                hintKey: 'outside',
                geoEntityId: 'outside',
                relation: 'offending',
              },
            ],
          },
        ],
        acceptedCount: 0,
        rejectedCount: 1,
        resolved: [
          {
            candidate,
            status: 'accepted',
            resolvedEntities: entities,
            rejectionReasons: [],
          } as any,
        ],
      },
    });
    expect(step.geographicValidationAudit?.[0].components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hintName: 'Stop Inside',
          relation: 'evaluated',
        }),
        expect.objectContaining({
          hintName: 'Stop Outside',
          relation: 'offending',
        }),
      ]),
    );
  });

  it('correlates same-name candidates by the guaranteed batch order, not proposalName', () => {
    const candidate = (suffix: 'a' | 'b') => ({
      name: 'Historic District Walk',
      themes: ['history'],
      intents: ['walk'],
      traits: [] as string[],
      evidenceKeys: [`web:${suffix}`],
      shortReason: 'grounded route',
      componentHints: [
        {
          key: `${suffix}-1`,
          name: `Stop ${suffix.toUpperCase()} 1`,
          role: 'waypoint' as const,
          expectedKind: 'PLACE' as const,
          required: true,
          evidenceKeys: [`web:${suffix}`],
        },
        {
          key: `${suffix}-2`,
          name: `Stop ${suffix.toUpperCase()} 2`,
          role: 'waypoint' as const,
          expectedKind: 'PLACE' as const,
          required: true,
          evidenceKeys: [`web:${suffix}`],
        },
      ],
    });
    const resolved = (suffix: 'a' | 'b') => ({
      candidate: candidate(suffix),
      status: 'accepted' as const,
      resolvedEntities: [1, 2].map((number) => ({
        hintKey: `${suffix}-${number}`,
        hintName: `Stop ${suffix.toUpperCase()} ${number}`,
        role: 'waypoint' as const,
        provider: 'osm',
        externalId: `${suffix}-${number}`,
        geoEntityId: `${suffix}-${number}`,
        status: 'resolved' as const,
      })),
      rejectionReasons: [] as string[],
    });
    const step = buildGeographicValidationStep({
      resolved: [resolved('a'), resolved('b')],
      totalCandidates: 2,
      acceptedCount: 1,
      rejectedCount: 1,
      geographicValidation: {
        results: [
          {
            proposalName: 'Historic District Walk',
            kind: 'EXPERIENCE',
            status: 'GEO_VERIFIED',
            accepted: true,
            validatorVersion: 1,
            groundedEvidenceKeys: ['web:a'],
            anchors: [resolved('a').resolvedEntities[0]],
            rejectionReasons: [],
          },
          {
            proposalName: 'Historic District Walk',
            kind: 'EXPERIENCE',
            status: 'REJECTED',
            accepted: false,
            validatorVersion: 1,
            groundedEvidenceKeys: ['web:b'],
            anchors: [resolved('b').resolvedEntities[0]],
            decisionEntities: [
              {
                hintKey: 'b-2',
                geoEntityId: 'b-2',
                relation: 'offending',
              },
            ],
            rejectionReasons: ['external_scope_mismatch'],
          },
        ],
        acceptedCount: 1,
        rejectedCount: 1,
        resolved: [resolved('a'), resolved('b')],
      },
    });

    const [first, second] = step.geographicValidationAudit!;
    expect(first.candidateTraceKey).toBe(
      traceCandidateKey(resolved('a').candidate),
    );
    expect(second.candidateTraceKey).toBe(
      traceCandidateKey(resolved('b').candidate),
    );
    expect(first.candidateTraceKey).not.toBe(second.candidateTraceKey);
    expect(first.components.map((component) => component.hintName)).toEqual([
      'Stop A 1',
      'Stop A 2',
    ]);
    expect(second.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hintName: 'Stop B 2',
          relation: 'offending',
        }),
      ]),
    );
    expect(second.rejectionReasons).toEqual(['external_scope_mismatch']);
  });
});

describe('GenerationTrace v4 geometry projection', () => {
  it('keeps geometry type visible while excluding full coordinate arrays from every lifecycle step', () => {
    const largeGeometry = {
      type: 'MultiPolygon',
      coordinates: Array.from({ length: 1000 }, () => [
        [
          [1, 2],
          [3, 4],
          [1, 2],
        ],
      ]),
    };
    const candidate = {
      name: 'Historic District Walk',
      themes: ['history'],
      traits: [] as string[],
      intents: ['walk'],
      evidenceKeys: ['web:walk'],
      shortReason: 'grounded route',
      componentHints: [
        {
          key: 'stop-a',
          name: 'Stop A',
          role: 'waypoint' as const,
          expectedKind: 'PLACE' as const,
          required: true,
          evidenceKeys: ['web:walk'],
        },
      ],
    };
    const entity = {
      hintKey: 'stop-a',
      hintName: 'Stop A',
      role: 'waypoint' as const,
      provider: 'osm',
      externalId: 'stop-a',
      geoEntityId: 'geo-stop-a',
      canonicalName: 'Stop A',
      latitude: -34.6,
      longitude: -58.4,
      geometry: largeGeometry,
      status: 'resolved' as const,
    };
    const resolvedEntry = {
      candidate,
      status: 'accepted' as const,
      resolvedEntities: [entity],
      rejectionReasons: [] as string[],
      experienceId: 'experience-1',
    };
    const validation = {
      proposalName: candidate.name,
      kind: 'EXPERIENCE',
      status: 'GEO_VERIFIED' as const,
      accepted: true,
      strategy: 'component_defined' as const,
      validatorVersion: 1,
      groundedEvidenceKeys: ['web:walk'],
      anchors: [entity],
      canonicalEntity: entity,
      coherence: {
        centroid: { latitude: -34.6, longitude: -58.4 },
        radiusMeters: 10,
        maxPairwiseDistanceMeters: 20,
      },
      rejectionReasons: [] as string[],
    };
    const resolution = {
      resolved: [resolvedEntry],
      totalCandidates: 1,
      acceptedCount: 1,
      rejectedCount: 0,
      geographicValidation: {
        results: [validation],
        acceptedCount: 1,
        rejectedCount: 0,
        resolved: [resolvedEntry],
      },
      materialization: { resolved: [resolvedEntry] },
    };
    const trace = {
      version: 4 as const,
      steps: [
        buildAcquisitionStep({
          passNumber: 1,
          plan: {
            sourcePlans: [{ provider: 'web', web: { query: 'walk' } }],
            deficits: [{ reason: 'missing' }],
          },
          execution: {
            observations: [
              {
                provider: 'web',
                evidenceKey: 'web:walk',
                title: 'Walk',
                originationCapabilities: [],
                geo: {
                  latitude: -34.6,
                  longitude: -58.4,
                  geometry: largeGeometry,
                },
              },
            ],
            candidates: [candidate],
            providerResults: { web: { status: 'success' } },
          },
        }),
        buildEntityResolutionStep(resolution),
        buildGeographicValidationStep(resolution),
        buildCatalogMaterializationStep(resolution),
      ],
      hallucinatedCount: 0,
      duplicateCount: 0,
    };

    const serialized = JSON.stringify(trace);
    expect(serialized).not.toContain('coordinates');
    expect(serialized).toContain('MultiPolygon');
    expect(serialized).not.toMatch(
      /\bcoordinates\b|\bgeometryCoordinates\b|\bpolygonCoordinates\b/,
    );
  });
});

describe('buildCatalogMaterializationStep', () => {
  it('reports materialized experiences persisted in catalog', () => {
    const step = buildCatalogMaterializationStep({
      resolved: [
        {
          candidate: {
            name: 'Paseo San Telmo',
            themes: [],
            traits: [],
            componentHints: [],
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
      totalCandidates: 1,
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

describe('buildAcquisitionStep', () => {
  const basePlan = {
    sourcePlans: [{ provider: 'wikivoyage' }, { provider: 'web' }],
    deficits: [{ dimension: 'trait', key: 'craft beer', reason: 'r' }],
  };

  it('names the real routed sources and reports structured + web candidate counts', () => {
    const step = buildAcquisitionStep({
      passNumber: 1,
      acquisitionContext: { strategy: 'generic', passNumber: 1 },
      plan: basePlan,
      execution: {
        observations: [{}, {}],
        candidates: [{}, {}, {}],
        providerResults: { wikivoyage: { status: 'success' } },
        webResults: [
          {
            status: 'success',
            query: 'BA craft beer',
            groundedProvider: 'tavily',
            groundingStatus: 'applied',
            evidenceKeys: ['ev-1'],
            extractorProvider: 'gemini',
            validationErrors: [],
            candidateCount: 1,
          },
        ],
        structuredCandidateCount: 2,
        webCandidateCount: 1,
      },
    });

    expect(step.stage).toBe('discovery');
    expect(step.status).toBe('PASS');
    expect(step.component).toBe('ExperienceAcquisitionService');
    expect(step.acquisitionContext).toEqual({
      strategy: 'generic',
      passNumber: 1,
    });
    expect(step.summary).toMatch(/wikivoyage, web/);
    expect(step.outputs).toMatchObject({
      observationCount: 2,
      structuredCandidateCount: 2,
      webCandidateCount: 1,
      candidateCount: 3,
    });
    expect((step.outputs as any).webResults[0]).toMatchObject({
      status: 'success',
      groundedProvider: 'tavily',
      extractorProvider: 'gemini',
      candidateCount: 1,
    });
  });

  it('flags an isolated source failure as WARN, and all-failed as FAIL', () => {
    const warn = buildAcquisitionStep({
      passNumber: 1,
      plan: basePlan,
      execution: {
        observations: [],
        candidates: [],
        providerResults: {
          wikivoyage: { status: 'failed', failureReason: 'x' },
        },
        webResults: [
          {
            status: 'success',
            query: 'q',
            evidenceKeys: [],
            validationErrors: [],
            candidateCount: 0,
          },
        ],
      },
    });
    expect(warn.status).toBe('WARN');

    const fail = buildAcquisitionStep({
      passNumber: 2,
      plan: basePlan,
      execution: {
        observations: [],
        candidates: [],
        providerResults: { wikivoyage: { status: 'failed' } },
        webResults: [
          {
            status: 'failed',
            query: 'q',
            evidenceKeys: [],
            validationErrors: [],
            candidateCount: 0,
            failureReason: 'boom',
          },
        ],
      },
    });
    expect(fail.status).toBe('FAIL');
    expect(fail.providerStatus).toBe('failed');
  });

  it('keeps the source-to-candidate forensic chain typed, bounded, and serializable', () => {
    const candidate: Partial<ExperienceCandidate> = {
      name: 'Historic District Walk',
      themes: ['history'],
      traits: [],
      intents: ['walk'],
      evidenceKeys: ['wikivoyage:stop-a', 'web:a'],
      shortReason: 'grounded route',
      componentHints: [
        {
          key: 'stop-a',
          name: 'Stop A',
          role: 'waypoint',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['web:a'],
        },
        {
          key: 'stop-b',
          name: 'Stop B',
          role: 'waypoint',
          expectedKind: 'PLACE',
          required: true,
          evidenceKeys: ['web:b'],
        },
      ],
    };
    const step = buildAcquisitionStep({
      passNumber: 1,
      acquisitionContext: {
        strategy: 'area_route_walk',
        passNumber: 1,
        anchor: {
          rawName: 'Historic District',
          usage: 'unknown',
          kind: 'area',
          priority: 'must',
        },
      },
      plan: {
        sourcePlans: [
          { provider: 'wikivoyage', wikivoyage: { sections: ['SEE'] } },
          {
            provider: 'web',
            web: {
              query: 'Historic District walking tour',
              anchorNames: ['Historic District'],
              requestedThemes: ['history'],
              requestedIntents: ['walk'],
              semanticQuery: 'historic',
            },
          },
        ],
        deficits: [
          {
            origin: 'preference_facet',
            dimension: 'intent',
            key: 'walk',
            reason: 'missing',
          },
        ],
      },
      execution: {
        observations: [
          {
            provider: 'wikivoyage',
            evidenceKey: 'wikivoyage:stop-a',
            title: 'Stop A',
            originationCapabilities: [],
            description: 'A concise history',
            evidenceType: 'editorial',
            geo: {
              latitude: 1,
              longitude: 2,
              geometry: {
                type: 'MultiPolygon',
                coordinates: Array.from({ length: 1000 }, () => [
                  [
                    [1, 2],
                    [3, 4],
                    [1, 2],
                  ],
                ]),
              },
            },
          },
        ],
        candidates: [candidate],
        providerResults: {
          wikivoyage: { status: 'success', failureReason: undefined },
          osm: { status: 'success' },
        },
        evidence: [
          {
            key: 'web:a',
            source: 'web',
            title: 'Route article',
            url: 'https://example.test/a',
            snippet: 'Stop A then Stop B',
          },
          {
            key: 'web:b',
            source: 'web',
            title: 'Stops',
            url: 'https://example.test/b',
            snippet: 'Historic route',
          },
        ],
        webResults: [
          {
            status: 'success',
            query: 'Historic District walking tour',
            groundedProvider: 'tavily',
            groundedModel: 'search',
            groundingStatus: 'applied',
            evidenceKeys: ['web:a', 'web:b'],
            extractorProvider: 'ollama',
            extractorModel: 'llama',
            validationErrors: [],
            candidateCount: 1,
          },
        ],
      },
    });

    expect(step.acquisitionContext).toEqual({
      strategy: 'area_route_walk',
      passNumber: 1,
      anchor: {
        rawName: 'Historic District',
        usage: 'unknown',
        kind: 'area',
        priority: 'must',
      },
    });
    expect(step.acquisition?.acquisitionContext?.strategy).toBe(
      'area_route_walk',
    );

    expect(step.acquisition?.deficits[0]).toMatchObject({
      dimension: 'intent',
      key: 'walk',
    });
    expect(step.acquisition?.sourcePlans).toHaveLength(2);
    expect(step.acquisition?.sourcePlans[1].web).toMatchObject({
      query: 'Historic District walking tour',
      anchorNames: ['Historic District'],
    });
    expect(step.acquisition?.sourcePlans[1].web?.evidence).toHaveLength(2);
    expect(step.acquisition?.candidates[0]).toMatchObject({
      name: 'Historic District Walk',
      origin: 'mixed',
      evidenceKeys: ['wikivoyage:stop-a', 'web:a'],
    });
    expect(step.acquisition?.candidates[0].componentHints).toHaveLength(2);
    expect(JSON.stringify(step)).not.toContain('coordinates');
    expect(JSON.stringify(step)).toContain('MultiPolygon');
    expect(JSON.stringify(step)).not.toContain('authorization:secret');
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
      'All experiences fit public-transport zones and opening hours.',
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
          name: 'History Museum',
          matchedThemes: ['history'],
          traceSource: 'db',
          scoreBreakdown: breakdown(),
        },
        {
          id: 'poi-refill',
          name: 'Plaza Central',
          traceSource: 'google_places',
          scoreBreakdown: breakdown(),
        },
        {
          id: 'walk-discovery',
          name: 'San Telmo Historic Walk',
          matchedThemes: ['history'],
          traceSource: 'discovery',
          scoreBreakdown: breakdown(),
        },
      ],
      requestedThemes: ['history'],
    });

    expect(step.stage).toBe('candidate_pool');
    expect(step.candidatePool?.bySource).toEqual({
      catalog: 1,
      refill: 1,
      discovery: 1,
    });
    expect(step.candidatePool?.llmWindowCount).toBe(3);

    const byId = new Map(step.candidates?.map((c) => [c.id, c]));
    expect(byId.get('poi-catalog')?.coverageContribution?.themes).toEqual([
      'history',
    ]);
    expect(byId.get('poi-refill')?.coverageContribution?.themes).toEqual([]);
    expect(byId.get('walk-discovery')?.source).toBe('discovery');
    expect(byId.get('walk-discovery')?.coverageContribution?.themes).toEqual([
      'history',
    ]);
  });

  it('surfaces the Experience-native source counts in the summary', () => {
    const step = buildCandidatePoolStep({
      initialCatalogCount: 5,
      postAcquisitionCatalogCount: 5,
      eligibleCount: 5,
      offeredCandidates: [
        {
          id: 'poi-1',
          name: 'Museo',
          traceSource: 'db',
          scoreBreakdown: breakdown(),
        },
      ],
      requestedThemes: [],
    });

    expect(step.summary).toContain('1 candidato(s) reales');
    expect(step.candidatePool?.bySource).toEqual({
      catalog: 1,
      refill: 0,
      discovery: 0,
    });
  });
});
