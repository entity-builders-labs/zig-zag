import {
  AreaRouteWalkAcquisitionInput,
  AreaRouteWalkAcquisitionService,
} from './area-route-walk-acquisition.service';
import { CURRENT_CLASSIFICATION_PROMPT_VERSION } from './experience-classification.service';
import { ResolvedAnchor } from '../interfaces/preference-spec.interface';
import {
  GeographicIntentDeficit,
  GeographicPolicyIntent,
} from '../interfaces/geographic-validation-authorization.interface';

// Cutover M4: classification (grouping-by-canonical-id, evidence-scoping,
// reuse-vs-recompute) is no longer owned by AreaRouteWalkAcquisitionService
// -- it runs inside ExperienceAcquisitionService.materializeExecution()
// (the shared canonical materialization boundary), which is a plain mock
// in this unit spec. That behavior is now exhaustively covered by
// experience-classification-convergence.util.spec.ts. What THIS file still
// owns and must keep proving: warm reuse (modes A/B/C), cold-miss routing,
// the validationScope + owned-deficit geographic grant threaded into
// materializeExecution,
// and the post-check's acceptedIds/semantic-eligibility restriction --
// using classifiedRow()/degradedRow() fixtures to simulate what
// materializeExecution's own classification step would have already
// persisted, never asserting on a classifier this service no longer calls.

function classifiedRow(id: string, intentKey: string) {
  return {
    id,
    intents: [intentKey],
    metadata: {
      intents: [intentKey],
      classification: {
        state: 'classified',
        promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
        modelId: 'groq/qwen',
        themes: [] as string[],
        intents: [intentKey],
        traits: [] as string[],
        reasoningEvidence: [
          {
            facet: `intent:${intentKey}`,
            evidenceKeys: ['ev-1'],
            reason: 'evidence supports it',
          },
        ],
      },
    },
  };
}

function degradedRow(id: string) {
  return {
    id,
    intents: [] as string[],
    metadata: {
      classification: {
        state: 'degraded',
        promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
        modelId: 'groq/qwen',
        themes: [] as string[],
        intents: [] as string[],
        traits: [] as string[],
        reasoningEvidence: [] as Array<{
          facet: string;
          evidenceKeys: string[];
          reason: string;
        }>,
      },
    },
  };
}

function buildMocks() {
  const anchorResolver = {
    resolveArea: jest.fn(),
    resolveRoute: jest.fn(),
  };
  const catalog = {
    findVerifiedMultiComponentInArea: jest.fn(),
    findVerifiedMultiComponentByExactComponent: jest.fn(),
    findVerifiedTourismRouteByName: jest.fn(),
    findVerifiedByIds: jest.fn(),
    applyEvidenceClassification: jest.fn(),
    findClassificationContextById: jest.fn(),
  };
  const acquisitionPlanner = {
    buildAcquisitionPlan: jest.fn(),
  };
  const acquisitionService = {
    executePlan: jest.fn(),
    materializeExecution: jest.fn(),
  };
  const classificationService = {
    classify: jest.fn(),
    getAuditIdentity: jest.fn().mockReturnValue({
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
    }),
  };
  return {
    anchorResolver,
    catalog,
    acquisitionPlanner,
    acquisitionService,
    classificationService,
  };
}

function buildService(mocks: ReturnType<typeof buildMocks>) {
  return new AreaRouteWalkAcquisitionService(
    mocks.catalog as any,
    mocks.acquisitionPlanner as any,
    mocks.acquisitionService as any,
    mocks.classificationService as any,
  );
}

const areaAnchor: ResolvedAnchor = {
  rawName: 'San Telmo',
  usage: 'geographic_scope',
  kind: 'area',
  priority: 'must',
  status: 'resolved',
  canonicalName: 'San Telmo',
  geoEntityId: 'geo-san-telmo',
  provider: 'openstreetmap',
  geometry: { type: 'Polygon', coordinates: [] },
};
const areaAnchorOsmBoundary = {
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
const areaAnchorWithOsmBoundary: ResolvedAnchor = {
  ...areaAnchor,
  osmBoundary: areaAnchorOsmBoundary,
};
const routeAnchor: ResolvedAnchor = {
  rawName: 'Caminito',
  usage: 'unknown',
  kind: 'route',
  priority: 'must',
  status: 'resolved',
  canonicalName: 'Caminito',
  geoEntityId: 'geo-caminito',
  provider: 'openstreetmap',
  geometry: { type: 'LineString', coordinates: [] },
};
const tourismRouteAnchor: ResolvedAnchor = {
  rawName: 'Ruta del Vino de Mendoza',
  usage: 'named_path',
  priority: 'must',
  status: 'unresolved',
  unresolvedReason: 'NO_CONFIDENT_ROUTE_MATCH',
};

function deficitFor(
  intentKey: GeographicPolicyIntent,
): GeographicIntentDeficit {
  return {
    origin: 'preference_facet',
    dimension: 'intent',
    key: intentKey,
    reason: `Preference facet [intent:${intentKey}] has no strong catalog match yet.`,
  };
}

/** `intentKey` selects the owned deficit; the unit has no other intent input. */
function baseInput(
  overrides: Partial<Omit<AreaRouteWalkAcquisitionInput, 'intentKey'>> & {
    intentKey?: GeographicPolicyIntent;
  } = {},
): AreaRouteWalkAcquisitionInput {
  const { intentKey = 'walk', ...rest } = overrides;
  return {
    anchor: areaAnchor,
    destination: {
      destinationName: 'Buenos Aires',
      latitude: -34.6,
      longitude: -58.4,
      radiusMeters: 20_000,
    },
    geographicScope: {
      kind: 'AREA_BOUNDARY',
      boundary: { id: 'osm:relation:1', name: 'Buenos Aires' } as any,
    },
    deficit: deficitFor(intentKey),
    ...rest,
  };
}

describe('AreaRouteWalkAcquisitionService', () => {
  describe('regional AREA anchor admissibility (spec 2026-10-02 §P2-6)', () => {
    const square = (lon: number, lat: number, d: number) => ({
      type: 'Polygon' as const,
      coordinates: [
        [
          [lon - d, lat - d],
          [lon + d, lat - d],
          [lon + d, lat + d],
          [lon - d, lat + d],
          [lon - d, lat - d],
        ] as [number, number][],
      ],
    });
    const destination = {
      kind: 'AREA_BOUNDARY' as const,
      boundary: {
        id: 'osm:relation:1',
        name: 'Fixture City',
        osmType: 'relation' as const,
        osmId: 1,
        tags: {},
        geometry: square(10, 45, 0.05),
      },
    };
    const regionalAnchor: ResolvedAnchor = {
      ...areaAnchor,
      rawName: 'Fixture Valley',
      canonicalName: 'Fixture Valley',
      geoEntityId: 'geo-valley',
      geometry: square(10, 43.92, 0.25),
    };

    it('I: a WALK unit never uses a user-named AREA anchor that lies beyond the destination -- no reuse lookup, no acquisition', async () => {
      const mocks = buildMocks();
      const result = await buildService(mocks).acquireOrReuse(
        baseInput({
          anchor: regionalAnchor,
          geographicScope: destination,
          intentKey: 'walk',
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          outcome: 'no_result',
          reason: 'anchor_scope_not_admissible',
        }),
      );
      expect(
        mocks.catalog.findVerifiedMultiComponentInArea,
      ).not.toHaveBeenCalled();
      expect(
        mocks.acquisitionPlanner.buildAcquisitionPlan,
      ).not.toHaveBeenCalled();
    });

    it('G: a ROUTE_LIKE unit retrieves catalog Experiences through the regional AREA scope itself (no destination window)', async () => {
      const mocks = buildMocks();
      mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([
        classifiedRow('exp-valley', 'route_like'),
      ]);
      const result = await buildService(mocks).acquireOrReuse(
        baseInput({
          anchor: regionalAnchor,
          geographicScope: destination,
          intentKey: 'route_like',
        }),
      );
      expect(
        mocks.catalog.findVerifiedMultiComponentInArea,
      ).toHaveBeenCalledWith('geo-valley', 'AREA_ANCHORED_ROUTE');
      expect(result).toEqual({ outcome: 'reused', experienceId: 'exp-valley' });
    });
  });

  it('fails closed when an AREA anchor cannot be resolved', async () => {
    const mocks = buildMocks();
    const unresolvedArea: ResolvedAnchor = {
      rawName: areaAnchor.rawName,
      usage: areaAnchor.usage,
      priority: areaAnchor.priority,
      status: 'unresolved',
      unresolvedReason: 'NO_CONFIDENT_GEO_ENTITY_MATCH',
    };
    const service = buildService(mocks);

    const result = await service.acquireOrReuse(
      baseInput({ anchor: unresolvedArea }),
    );

    expect(result).toMatchObject({
      outcome: 'no_result',
      reason: 'anchor_unresolved',
      diagnostics: { anchorResolved: false },
    });
    expect(
      mocks.acquisitionPlanner.buildAcquisitionPlan,
    ).not.toHaveBeenCalled();
    expect(mocks.acquisitionService.executePlan).not.toHaveBeenCalled();
    expect(
      mocks.acquisitionService.materializeExecution,
    ).not.toHaveBeenCalled();
  });

  it('A1: warm AREA hit short-circuits acquisition', async () => {
    const mocks = buildMocks();
    mocks.anchorResolver.resolveArea.mockResolvedValue({
      resolved: true,
      geoEntityId: 'geo-san-telmo',
      geometry: { type: 'Polygon', coordinates: [] },
    });
    mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([
      classifiedRow('exp-warm', 'walk'),
    ]);
    const service = buildService(mocks);

    const result = await service.acquireOrReuse(baseInput());

    expect(result).toEqual({ outcome: 'reused', experienceId: 'exp-warm' });
    expect(
      mocks.acquisitionPlanner.buildAcquisitionPlan,
    ).not.toHaveBeenCalled();
    expect(mocks.acquisitionService.executePlan).not.toHaveBeenCalled();
  });

  it('consumes a resolved AREA identity without re-resolving rawName', async () => {
    const mocks = buildMocks();
    mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([
      classifiedRow('exp-warm', 'walk'),
    ]);
    const service = buildService(mocks);

    await expect(service.acquireOrReuse(baseInput())).resolves.toEqual({
      outcome: 'reused',
      experienceId: 'exp-warm',
    });
    expect(mocks.anchorResolver.resolveArea).not.toHaveBeenCalled();
    expect(mocks.anchorResolver.resolveRoute).not.toHaveBeenCalled();
  });

  it('A2: warm canonical-ROUTE hit short-circuits acquisition', async () => {
    const mocks = buildMocks();
    mocks.anchorResolver.resolveRoute.mockResolvedValue({
      resolved: true,
      geoEntityId: 'geo-caminito',
      geometry: { type: 'LineString', coordinates: [] },
    });
    mocks.catalog.findVerifiedMultiComponentByExactComponent.mockResolvedValue([
      classifiedRow('exp-caminito', 'route_like'),
    ]);
    const service = buildService(mocks);

    const result = await service.acquireOrReuse(
      baseInput({ anchor: routeAnchor, intentKey: 'route_like' }),
    );

    expect(result).toEqual({ outcome: 'reused', experienceId: 'exp-caminito' });
    expect(
      mocks.acquisitionPlanner.buildAcquisitionPlan,
    ).not.toHaveBeenCalled();
  });

  it('A3: warm tourism-route (mode C) hit short-circuits acquisition', async () => {
    const mocks = buildMocks();
    mocks.anchorResolver.resolveRoute.mockResolvedValue({ resolved: false });
    mocks.catalog.findVerifiedTourismRouteByName.mockResolvedValue([
      classifiedRow('exp-ruta', 'route_like'),
    ]);
    const service = buildService(mocks);

    const result = await service.acquireOrReuse(
      baseInput({ anchor: tourismRouteAnchor, intentKey: 'route_like' }),
    );

    expect(result).toEqual({ outcome: 'reused', experienceId: 'exp-ruta' });
    expect(
      mocks.acquisitionPlanner.buildAcquisitionPlan,
    ).not.toHaveBeenCalled();
  });

  it('B: cold miss routes acquisition with the anchor + validationScope + owned-deficit grant', async () => {
    const mocks = buildMocks();
    mocks.anchorResolver.resolveArea.mockResolvedValue({
      resolved: true,
      geoEntityId: 'geo-san-telmo',
      geometry: { type: 'Polygon', coordinates: [] },
    });
    mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([]);
    mocks.acquisitionPlanner.buildAcquisitionPlan.mockReturnValue({
      destination: {},
      deficits: [],
      sourcePlans: [{ provider: 'web', web: { query: 'q' } }],
      breadth: 'focused',
    });
    mocks.acquisitionService.executePlan.mockResolvedValue({
      evidence: [],
      candidates: [],
    });
    mocks.acquisitionService.materializeExecution.mockResolvedValue({
      resolved: [],
    });
    const service = buildService(mocks);

    await service.acquireOrReuse(baseInput());

    expect(mocks.acquisitionPlanner.buildAcquisitionPlan).toHaveBeenCalledWith(
      expect.objectContaining({ anchors: [areaAnchor] }),
    );
    expect(mocks.acquisitionService.materializeExecution).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        validationScope: expect.objectContaining({
          kind: 'AREA',
          geoEntityId: 'geo-san-telmo',
        }),
        geographicGrant: {
          kind: 'OWNED_INTENT',
          intent: 'walk',
          ownedDeficit: deficitFor('walk'),
          workUnit: 'AREA_ROUTE_WALK',
        },
      }),
    );
    expect(
      mocks.acquisitionService.materializeExecution.mock.calls[0][1],
    ).not.toHaveProperty('validationIntent');
  });

  it('forwards semanticQuery and anchors directly into buildAcquisitionPlan without alteration', async () => {
    const mocks = buildMocks();
    mocks.catalog.findVerifiedTourismRouteByName.mockResolvedValue([]);
    mocks.acquisitionPlanner.buildAcquisitionPlan.mockReturnValue({
      destination: {},
      deficits: [],
      sourcePlans: [{ provider: 'web', web: { query: 'q' } }],
      breadth: 'focused',
    });
    mocks.acquisitionService.executePlan.mockResolvedValue({
      evidence: [],
      candidates: [],
    });
    mocks.acquisitionService.materializeExecution.mockResolvedValue({
      resolved: [],
    });
    const service = buildService(mocks);

    await service.acquireOrReuse(
      baseInput({
        anchor: tourismRouteAnchor,
        intentKey: 'route_like',
        semanticQuery: 'wine route with representative wineries',
      }),
    );

    expect(mocks.acquisitionPlanner.buildAcquisitionPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        anchors: [tourismRouteAnchor],
        semanticQuery: 'wine route with representative wineries',
      }),
    );
  });

  it('passes entityResolutionScope narrowed to the resolved AREA anchor’s own OSM boundary (Task A6)', async () => {
    const mocks = buildMocks();
    mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([]);
    mocks.acquisitionPlanner.buildAcquisitionPlan.mockReturnValue({
      destination: {},
      deficits: [],
      sourcePlans: [{ provider: 'web', web: { query: 'q' } }],
      breadth: 'focused',
    });
    mocks.acquisitionService.executePlan.mockResolvedValue({
      evidence: [],
      candidates: [],
    });
    mocks.acquisitionService.materializeExecution.mockResolvedValue({
      resolved: [],
    });
    const service = buildService(mocks);

    await service.acquireOrReuse(
      baseInput({ anchor: areaAnchorWithOsmBoundary }),
    );

    expect(mocks.acquisitionService.materializeExecution).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entityResolutionScope: {
          kind: 'AREA_BOUNDARY',
          boundary: areaAnchorOsmBoundary,
        },
      }),
    );
  });

  it('omits entityResolutionScope when the resolved AREA anchor has no osmBoundary (regression guard: today’s callers, unaffected)', async () => {
    const mocks = buildMocks();
    mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([]);
    mocks.acquisitionPlanner.buildAcquisitionPlan.mockReturnValue({
      destination: {},
      deficits: [],
      sourcePlans: [{ provider: 'web', web: { query: 'q' } }],
      breadth: 'focused',
    });
    mocks.acquisitionService.executePlan.mockResolvedValue({
      evidence: [],
      candidates: [],
    });
    mocks.acquisitionService.materializeExecution.mockResolvedValue({
      resolved: [],
    });
    const service = buildService(mocks);

    await service.acquireOrReuse(baseInput());

    const [, context] =
      mocks.acquisitionService.materializeExecution.mock.calls[0];
    expect(context.entityResolutionScope).toBeUndefined();
  });

  it('B2: mode C (unresolved canonical ROUTE) still passes its route_like grant, but validationScope is undefined', async () => {
    const mocks = buildMocks();
    mocks.anchorResolver.resolveRoute.mockResolvedValue({ resolved: false });
    mocks.catalog.findVerifiedTourismRouteByName.mockResolvedValue([]);
    mocks.acquisitionPlanner.buildAcquisitionPlan.mockReturnValue({
      destination: {},
      deficits: [],
      sourcePlans: [{ provider: 'web', web: { query: 'q' } }],
      breadth: 'focused',
    });
    mocks.acquisitionService.executePlan.mockResolvedValue({
      evidence: [],
      candidates: [],
    });
    mocks.acquisitionService.materializeExecution.mockResolvedValue({
      resolved: [],
    });
    const service = buildService(mocks);

    await service.acquireOrReuse(
      baseInput({ anchor: tourismRouteAnchor, intentKey: 'route_like' }),
    );

    expect(mocks.acquisitionService.materializeExecution).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        validationScope: undefined,
        geographicGrant: {
          kind: 'OWNED_INTENT',
          intent: 'route_like',
          ownedDeficit: deficitFor('route_like'),
          workUnit: 'AREA_ROUTE_WALK',
        },
      }),
    );
  });

  it('C: cold-then-warm second call reuses the same AREA Experience without reacquiring', async () => {
    const mocks = buildMocks();
    mocks.anchorResolver.resolveArea.mockResolvedValue({
      resolved: true,
      geoEntityId: 'geo-san-telmo',
      geometry: { type: 'Polygon', coordinates: [] },
    });
    mocks.acquisitionPlanner.buildAcquisitionPlan.mockReturnValue({
      destination: {},
      deficits: [],
      sourcePlans: [{ provider: 'web', web: { query: 'q' } }],
      breadth: 'focused',
    });
    mocks.acquisitionService.executePlan.mockResolvedValue({
      evidence: [{ key: 'ev-1', source: 'x', snippet: 's' }],
      candidates: [],
    });
    mocks.acquisitionService.materializeExecution.mockResolvedValue({
      resolved: [
        {
          status: 'accepted',
          experienceId: 'exp-1',
          candidate: { evidenceKeys: ['ev-1'] },
        },
      ],
    });

    // Round 1: warm MISS -> acquire -> post-check finds the freshly-
    // classified row (simulating what materializeExecution's own
    // classification step would have already persisted).
    mocks.catalog.findVerifiedMultiComponentInArea
      .mockResolvedValueOnce([]) // round 1 warm check
      .mockResolvedValueOnce([classifiedRow('exp-1', 'walk')]) // round 1 post-check
      .mockResolvedValueOnce([classifiedRow('exp-1', 'walk')]); // round 2 warm check

    const service = buildService(mocks);

    const round1 = await service.acquireOrReuse(baseInput());
    expect(round1).toEqual(
      expect.objectContaining({ outcome: 'acquired', experienceId: 'exp-1' }),
    );
    expect(round1).toHaveProperty('lifecycle.plan');

    const round2 = await service.acquireOrReuse(baseInput());
    expect(round2).toEqual({ outcome: 'reused', experienceId: 'exp-1' });

    expect(mocks.acquisitionPlanner.buildAcquisitionPlan).toHaveBeenCalledTimes(
      1,
    );
    expect(mocks.acquisitionService.executePlan).toHaveBeenCalledTimes(1);
  });

  it('C2: cold-then-warm second call reuses the same canonical-ROUTE Experience without reacquiring', async () => {
    const mocks = buildMocks();
    mocks.anchorResolver.resolveRoute.mockResolvedValue({
      resolved: true,
      geoEntityId: 'geo-caminito',
      geometry: { type: 'LineString', coordinates: [] },
    });
    mocks.acquisitionPlanner.buildAcquisitionPlan.mockReturnValue({
      destination: {},
      deficits: [],
      sourcePlans: [{ provider: 'web', web: { query: 'q' } }],
      breadth: 'focused',
    });
    mocks.acquisitionService.executePlan.mockResolvedValue({
      evidence: [{ key: 'ev-1', source: 'x', snippet: 's' }],
      candidates: [],
    });
    mocks.acquisitionService.materializeExecution.mockResolvedValue({
      resolved: [
        {
          status: 'accepted',
          experienceId: 'exp-caminito',
          candidate: { evidenceKeys: ['ev-1'] },
        },
      ],
    });

    mocks.catalog.findVerifiedMultiComponentByExactComponent
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([classifiedRow('exp-caminito', 'route_like')])
      .mockResolvedValueOnce([classifiedRow('exp-caminito', 'route_like')]);

    const service = buildService(mocks);
    const input = baseInput({ anchor: routeAnchor, intentKey: 'route_like' });

    const round1 = await service.acquireOrReuse(input);
    expect(round1).toEqual(
      expect.objectContaining({
        outcome: 'acquired',
        experienceId: 'exp-caminito',
      }),
    );

    const round2 = await service.acquireOrReuse(input);
    expect(round2).toEqual({ outcome: 'reused', experienceId: 'exp-caminito' });

    expect(mocks.acquisitionService.executePlan).toHaveBeenCalledTimes(1);
  });

  it('C3: tourism-route (mode C) cold-then-warm reuse without reacquiring', async () => {
    const mocks = buildMocks();
    mocks.anchorResolver.resolveRoute.mockResolvedValue({ resolved: false });
    mocks.acquisitionPlanner.buildAcquisitionPlan.mockReturnValue({
      destination: {},
      deficits: [],
      sourcePlans: [{ provider: 'web', web: { query: 'q' } }],
      breadth: 'focused',
    });
    mocks.acquisitionService.executePlan.mockResolvedValue({
      evidence: [
        { key: 'wine-1', source: 'x', snippet: 's1' },
        { key: 'wine-2', source: 'x', snippet: 's2' },
      ],
      candidates: [],
    });
    mocks.acquisitionService.materializeExecution.mockResolvedValue({
      resolved: [
        {
          status: 'accepted',
          experienceId: 'exp-ruta',
          // Matches real B6 shape -- no intents/route_like anywhere in the
          // candidate's own output.
          candidate: { evidenceKeys: ['wine-1', 'wine-2'] },
        },
      ],
    });

    mocks.catalog.findVerifiedTourismRouteByName
      .mockResolvedValueOnce([]) // round 1 warm MISS
      .mockResolvedValueOnce([classifiedRow('exp-ruta', 'route_like')]) // round 1 post-check
      .mockResolvedValueOnce([classifiedRow('exp-ruta', 'route_like')]); // round 2 warm check

    const service = buildService(mocks);
    const input = baseInput({
      anchor: tourismRouteAnchor,
      intentKey: 'route_like',
    });

    const round1 = await service.acquireOrReuse(input);
    expect(round1).toEqual(
      expect.objectContaining({
        outcome: 'acquired',
        experienceId: 'exp-ruta',
      }),
    );

    const round2 = await service.acquireOrReuse(input);
    expect(round2).toEqual({ outcome: 'reused', experienceId: 'exp-ruta' });

    expect(mocks.acquisitionPlanner.buildAcquisitionPlan).toHaveBeenCalledTimes(
      1,
    );
    expect(mocks.acquisitionService.executePlan).toHaveBeenCalledTimes(1);
  });

  it('D: insufficient evidence never persists a fake walk (zero accepted -> no_result)', async () => {
    const mocks = buildMocks();
    mocks.anchorResolver.resolveArea.mockResolvedValue({
      resolved: true,
      geoEntityId: 'geo-san-telmo',
      geometry: { type: 'Polygon', coordinates: [] },
    });
    mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([]);
    mocks.acquisitionPlanner.buildAcquisitionPlan.mockReturnValue({
      destination: {},
      deficits: [],
      sourcePlans: [{ provider: 'web', web: { query: 'q' } }],
      breadth: 'focused',
    });
    mocks.acquisitionService.executePlan.mockResolvedValue({
      evidence: [],
      candidates: [],
    });
    mocks.acquisitionService.materializeExecution.mockResolvedValue({
      resolved: [
        { status: 'rejected', rejectionReasons: ['geographic_incoherence'] },
      ],
    });
    const service = buildService(mocks);

    const result = await service.acquireOrReuse(baseInput());

    expect(result).toEqual(
      expect.objectContaining({
        outcome: 'no_result',
        reason: 'no_accepted_results',
      }),
    );
  });

  it('E: acquisition accepts a candidate, but the post-check geography lookup still finds nothing -> no_result', async () => {
    const mocks = buildMocks();
    mocks.anchorResolver.resolveArea.mockResolvedValue({
      resolved: true,
      geoEntityId: 'geo-san-telmo',
      geometry: { type: 'Polygon', coordinates: [] },
    });
    mocks.acquisitionPlanner.buildAcquisitionPlan.mockReturnValue({
      destination: {},
      deficits: [],
      sourcePlans: [{ provider: 'web', web: { query: 'q' } }],
      breadth: 'focused',
    });
    mocks.acquisitionService.executePlan.mockResolvedValue({
      evidence: [{ key: 'ev-1', source: 'x', snippet: 's' }],
      candidates: [],
    });
    mocks.acquisitionService.materializeExecution.mockResolvedValue({
      resolved: [
        {
          status: 'accepted',
          experienceId: 'exp-1',
          candidate: { evidenceKeys: ['ev-1'] },
        },
      ],
    });
    mocks.catalog.findVerifiedMultiComponentInArea
      .mockResolvedValueOnce([]) // warm
      .mockResolvedValueOnce([]); // post-check -- still nothing
    const service = buildService(mocks);

    const result = await service.acquireOrReuse(baseInput());

    expect(result).toEqual(
      expect.objectContaining({
        outcome: 'no_result',
        reason: 'no_semantically_eligible_result',
      }),
    );
  });

  it('F: an unsupported intentKey (facet undefined) never accidentally warm-matches, in any mode', async () => {
    const mocks = buildMocks();
    mocks.anchorResolver.resolveArea.mockResolvedValue({
      resolved: true,
      geoEntityId: 'geo-san-telmo',
      geometry: { type: 'Polygon', coordinates: [] },
    });
    mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([
      classifiedRow('exp-1', 'walk'),
    ]);
    mocks.catalog.findVerifiedByIds.mockResolvedValue([]);
    mocks.acquisitionPlanner.buildAcquisitionPlan.mockReturnValue({
      destination: {},
      deficits: [],
      sourcePlans: [],
      breadth: 'focused',
    });
    const service = buildService(mocks);

    const result = await service.acquireOrReuse(
      baseInput({ intentKey: 'not_a_real_intent' as any }),
    );

    // No plan sourcePlans -> no_result; the important assertion is that the
    // warm check never matched despite a "compatible" row existing.
    // With no usable facet, the candidate's classification cannot match,
    // yielding no_semantically_eligible_result without refresh or acquisition.
    expect(result).toEqual(
      expect.objectContaining({
        outcome: 'no_result',
        reason: 'no_semantically_eligible_result',
      }),
    );
  });

  it('Q: post-check result is restricted to acceptedIds -- never an unrelated geographically-matching row', async () => {
    const mocks = buildMocks();
    mocks.anchorResolver.resolveArea.mockResolvedValue({
      resolved: true,
      geoEntityId: 'geo-san-telmo',
      geometry: { type: 'Polygon', coordinates: [] },
    });
    mocks.acquisitionPlanner.buildAcquisitionPlan.mockReturnValue({
      destination: {},
      deficits: [],
      sourcePlans: [{ provider: 'web', web: { query: 'q' } }],
      breadth: 'focused',
    });
    mocks.acquisitionService.executePlan.mockResolvedValue({
      evidence: [{ key: 'ev-1', source: 'x', snippet: 's' }],
      candidates: [],
    });
    mocks.acquisitionService.materializeExecution.mockResolvedValue({
      resolved: [
        {
          status: 'accepted',
          experienceId: 'exp-x',
          candidate: { evidenceKeys: ['ev-1'] },
        },
      ],
    });
    // Pre-existing, unrelated, geographically-compatible row Y is ALSO
    // returned by the post-check's geography lookup, alongside this
    // execution's own accepted X.
    mocks.catalog.findVerifiedMultiComponentInArea
      .mockResolvedValueOnce([]) // warm
      .mockResolvedValueOnce([
        classifiedRow('exp-y', 'walk'),
        classifiedRow('exp-x', 'walk'),
      ]); // post-check
    const service = buildService(mocks);

    const result = await service.acquireOrReuse(baseInput());

    expect(result).toEqual(
      expect.objectContaining({ outcome: 'acquired', experienceId: 'exp-x' }),
    );
  });

  it('Q2: post-check returns no_result when geography only finds an unrelated row, never falling back to it', async () => {
    const mocks = buildMocks();
    mocks.anchorResolver.resolveArea.mockResolvedValue({
      resolved: true,
      geoEntityId: 'geo-san-telmo',
      geometry: { type: 'Polygon', coordinates: [] },
    });
    mocks.acquisitionPlanner.buildAcquisitionPlan.mockReturnValue({
      destination: {},
      deficits: [],
      sourcePlans: [{ provider: 'web', web: { query: 'q' } }],
      breadth: 'focused',
    });
    mocks.acquisitionService.executePlan.mockResolvedValue({
      evidence: [{ key: 'ev-1', source: 'x', snippet: 's' }],
      candidates: [],
    });
    mocks.acquisitionService.materializeExecution.mockResolvedValue({
      resolved: [
        {
          status: 'accepted',
          experienceId: 'exp-x',
          candidate: { evidenceKeys: ['ev-1'] },
        },
      ],
    });
    mocks.catalog.findVerifiedMultiComponentInArea
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([classifiedRow('exp-y', 'walk')]); // only the unrelated row
    const service = buildService(mocks);

    const result = await service.acquireOrReuse(baseInput());

    expect(result).toEqual(
      expect.objectContaining({
        outcome: 'no_result',
        reason: 'no_semantically_eligible_result',
      }),
    );
  });

  it('S: a geographically-valid Experience classified into a DIFFERENT intent produces no_result for this request', async () => {
    const mocks = buildMocks();
    mocks.anchorResolver.resolveArea.mockResolvedValue({
      resolved: true,
      geoEntityId: 'geo-san-telmo',
      geometry: { type: 'Polygon', coordinates: [] },
    });
    mocks.acquisitionPlanner.buildAcquisitionPlan.mockReturnValue({
      destination: {},
      deficits: [],
      sourcePlans: [{ provider: 'web', web: { query: 'q' } }],
      breadth: 'focused',
    });
    mocks.acquisitionService.executePlan.mockResolvedValue({
      evidence: [{ key: 'ev-1', source: 'x', snippet: 's' }],
      candidates: [],
    });
    mocks.acquisitionService.materializeExecution.mockResolvedValue({
      resolved: [
        {
          status: 'accepted',
          experienceId: 'exp-food',
          candidate: { evidenceKeys: ['ev-1'] },
        },
      ],
    });
    // The materialized row was genuinely classified as 'food', not the
    // requested 'walk' -- still valid, persisted catalog knowledge, just
    // not a successful result for THIS request.
    mocks.catalog.findVerifiedMultiComponentInArea
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([classifiedRow('exp-food', 'food')]);
    const service = buildService(mocks);

    const result = await service.acquireOrReuse(
      baseInput({ intentKey: 'walk' }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        outcome: 'no_result',
        reason: 'no_semantically_eligible_result',
      }),
    );
  });

  it('T: a degraded classification never satisfies post-check OR a subsequent warm check', async () => {
    const mocks = buildMocks();
    mocks.anchorResolver.resolveArea.mockResolvedValue({
      resolved: true,
      geoEntityId: 'geo-san-telmo',
      geometry: { type: 'Polygon', coordinates: [] },
    });
    mocks.acquisitionPlanner.buildAcquisitionPlan.mockReturnValue({
      destination: {},
      deficits: [],
      sourcePlans: [{ provider: 'web', web: { query: 'q' } }],
      breadth: 'focused',
    });
    mocks.acquisitionService.executePlan.mockResolvedValue({
      evidence: [{ key: 'ev-1', source: 'x', snippet: 's' }],
      candidates: [],
    });
    mocks.acquisitionService.materializeExecution.mockResolvedValue({
      resolved: [
        {
          status: 'accepted',
          experienceId: 'exp-1',
          candidate: { evidenceKeys: ['ev-1'] },
        },
      ],
    });
    mocks.catalog.findVerifiedMultiComponentInArea
      .mockResolvedValueOnce([]) // round 1 warm
      .mockResolvedValueOnce([degradedRow('exp-1')]) // round 1 post-check
      .mockResolvedValueOnce([degradedRow('exp-1')]) // round 2 warm check
      .mockResolvedValueOnce([degradedRow('exp-1')]); // round 2 post-check (re-attempted acquisition)
    mocks.catalog.findVerifiedByIds.mockResolvedValue([
      {
        id: 'exp-1',
        canonicalName: 'Test Experience',
        evidence: [
          {
            id: 'ev-1',
            source: 'serper',
            snippet: 'Some evidence',
          },
        ],
      },
    ]);
    mocks.classificationService.classify.mockResolvedValue({
      themes: [] as string[],
      intents: [] as string[],
      traits: [] as string[],
      reasoningEvidence: [] as Array<{
        facet: string;
        evidenceKeys: string[];
        reason: string;
      }>,
      modelId: 'groq/qwen',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      state: 'degraded',
      failure: {
        stage: 'provider_call',
        reason: 'PROVIDER_UNAVAILABLE',
        httpStatus: 503,
        providerStatus: 'UNAVAILABLE',
      },
    });
    const service = buildService(mocks);

    const round1 = await service.acquireOrReuse(baseInput());
    expect(round1).toEqual(
      expect.objectContaining({
        outcome: 'no_result',
        reason: 'no_semantically_eligible_result',
      }),
    );

    // Round 2 -- geography would find it, but the degraded classification
    // must still reject it, both at the warm check AND after re-attempting
    // acquisition.
    const round2 = await service.acquireOrReuse(baseInput());
    expect(round2.outcome).not.toBe('reused');
  });

  describe('Classification refresh (warm reuse with degraded classification)', () => {
    it('T2: existing Experience + valid classification -> direct reuse (no classifier call)', async () => {
      const mocks = buildMocks();
      mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([
        classifiedRow('exp-warm', 'walk'),
      ]);
      const service = buildService(mocks);

      const result = await service.acquireOrReuse(baseInput());

      expect(result).toEqual({ outcome: 'reused', experienceId: 'exp-warm' });
      expect(mocks.classificationService.classify).not.toHaveBeenCalled();
      expect(
        mocks.acquisitionPlanner.buildAcquisitionPlan,
      ).not.toHaveBeenCalled();
      expect(mocks.acquisitionService.executePlan).not.toHaveBeenCalled();
    });

    it('T3: degraded warm classification -> refresh -> matching facet', async () => {
      const mocks = buildMocks();
      mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([
        degradedRow('exp-degraded'),
      ]);
      const refreshedMetadata = {
        ...degradedRow('exp-degraded').metadata,
        classification: {
          state: 'classified',
          promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
          modelId: 'groq/qwen',
          themes: ['history'],
          intents: ['walk'],
          traits: [] as string[],
          reasoningEvidence: [
            {
              facet: 'intent:walk',
              evidenceKeys: ['ev-1'],
              reason: 'evidence supports walking route',
            },
          ],
        },
      };
      mocks.catalog.findVerifiedByIds.mockResolvedValue([
        {
          id: 'exp-degraded',
          canonicalName: 'Caminito Walking Tour',
          metadata: refreshedMetadata,
        },
      ]);
      mocks.catalog.findClassificationContextById.mockResolvedValue({
        experienceId: 'exp-degraded',
        canonicalName: 'Caminito Walking Tour',
        metadata: degradedRow('exp-degraded').metadata,
        evidence: [
          {
            key: 'ev-1',
            source: 'serper',
            snippet: 'Caminito is a colorful street museum in La Boca',
          },
        ],
      });
      mocks.classificationService.classify.mockResolvedValue({
        themes: ['history'],
        intents: ['walk'],
        traits: [] as string[],
        reasoningEvidence: [
          {
            facet: 'intent:walk',
            evidenceKeys: ['ev-1'],
            reason: 'evidence supports walking route',
          },
        ],
        modelId: 'groq/qwen',
        promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
        state: 'classified',
      });
      const service = buildService(mocks);

      const result = await service.acquireOrReuse(baseInput());

      expect(result.outcome).toBe('classification_refreshed');
      if (result.outcome === 'classification_refreshed') {
        expect(result.experienceId).toBe('exp-degraded');
        expect(result.refreshResult.state).toBe('classified');
      }
      expect(mocks.classificationService.classify).toHaveBeenCalledTimes(1);
      expect(mocks.classificationService.classify).toHaveBeenCalledWith(
        'Caminito Walking Tour',
        [
          {
            key: 'ev-1',
            source: 'serper',
            snippet: 'Caminito is a colorful street museum in La Boca',
          },
        ],
      );
      expect(mocks.catalog.applyEvidenceClassification).toHaveBeenCalledWith(
        'exp-degraded',
        expect.objectContaining({ state: 'classified' }),
      );
      expect(
        mocks.acquisitionPlanner.buildAcquisitionPlan,
      ).not.toHaveBeenCalled();
      expect(mocks.acquisitionService.executePlan).not.toHaveBeenCalled();
    });

    it('T4: refresh succeeds but wrong facet -> rejected', async () => {
      const mocks = buildMocks();
      mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([
        degradedRow('exp-degraded'),
      ]);
      const refreshedMetadata = {
        ...degradedRow('exp-degraded').metadata,
        classification: {
          state: 'classified',
          promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
          modelId: 'groq/qwen',
          themes: ['food'],
          intents: ['food'],
          traits: [] as string[],
          reasoningEvidence: [
            {
              facet: 'intent:food',
              evidenceKeys: ['ev-1'],
              reason: 'evidence supports food tour',
            },
          ],
        },
      };
      mocks.catalog.findVerifiedByIds.mockResolvedValue([
        {
          id: 'exp-degraded',
          canonicalName: 'Caminito Walking Tour',
          metadata: refreshedMetadata,
        },
      ]);
      mocks.catalog.findClassificationContextById.mockResolvedValue({
        experienceId: 'exp-degraded',
        canonicalName: 'Caminito Walking Tour',
        metadata: degradedRow('exp-degraded').metadata,
        evidence: [
          {
            key: 'ev-1',
            source: 'serper',
            snippet: 'Caminito is a colorful street museum in La Boca',
          },
        ],
      });
      mocks.classificationService.classify.mockResolvedValue({
        themes: ['food'],
        intents: ['food'],
        traits: [] as string[],
        reasoningEvidence: [
          {
            facet: 'intent:food',
            evidenceKeys: ['ev-1'],
            reason: 'evidence supports food tour',
          },
        ],
        modelId: 'groq/qwen',
        promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
        state: 'classified',
      });
      const service = buildService(mocks);

      const result = await service.acquireOrReuse(baseInput());

      expect(result).toEqual(
        expect.objectContaining({
          outcome: 'no_result',
          reason: 'no_semantically_eligible_result',
        }),
      );
      expect(mocks.classificationService.classify).toHaveBeenCalledTimes(1);
      expect(
        mocks.acquisitionPlanner.buildAcquisitionPlan,
      ).not.toHaveBeenCalled();
      expect(mocks.acquisitionService.executePlan).not.toHaveBeenCalled();
    });

    it('T5: multiple geographic candidates - first wrong facet, second correct', async () => {
      const mocks = buildMocks();
      mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([
        degradedRow('exp-food'),
        degradedRow('exp-walk'),
      ]);
      mocks.catalog.findVerifiedByIds.mockImplementation(
        async (ids: string[]) =>
          ids.map((id) => {
            const isFood = id.includes('food');
            return {
              id,
              canonicalName: `Experience ${id}`,
              metadata: {
                ...degradedRow(id).metadata,
                classification: {
                  state: 'classified',
                  promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
                  modelId: 'groq/qwen',
                  themes: isFood ? ['food'] : ['history'],
                  intents: isFood ? ['food'] : ['walk'],
                  traits: [] as string[],
                  reasoningEvidence: [
                    {
                      facet: `intent:${isFood ? 'food' : 'walk'}`,
                      evidenceKeys: ['ev-1'],
                      reason: 'evidence supports it',
                    },
                  ],
                },
              },
            };
          }),
      );
      mocks.catalog.findClassificationContextById.mockImplementation(
        async (id: string) => ({
          experienceId: id,
          canonicalName: `Experience ${id}`,
          metadata: degradedRow(id).metadata,
          evidence: [
            {
              key: 'ev-1',
              source: 'serper',
              snippet: 'Some evidence',
            },
          ],
        }),
      );
      mocks.classificationService.classify.mockImplementation(
        async (name: string) => {
          if (name.includes('exp-food')) {
            return {
              themes: ['food'],
              intents: ['food'],
              traits: [] as string[],
              reasoningEvidence: [
                {
                  facet: 'intent:food',
                  evidenceKeys: ['ev-1'],
                  reason: 'evidence supports food tour',
                },
              ],
              modelId: 'groq/qwen',
              promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
              state: 'classified',
            };
          }
          return {
            themes: ['history'],
            intents: ['walk'],
            traits: [] as string[],
            reasoningEvidence: [
              {
                facet: 'intent:walk',
                evidenceKeys: ['ev-1'],
                reason: 'evidence supports walking route',
              },
            ],
            modelId: 'groq/qwen',
            promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
            state: 'classified',
          };
        },
      );
      const service = buildService(mocks);

      const result = await service.acquireOrReuse(baseInput());

      expect(result.outcome).toBe('classification_refreshed');
      if (result.outcome === 'classification_refreshed') {
        expect(result.experienceId).toBe('exp-walk');
      }
      expect(mocks.classificationService.classify).toHaveBeenCalledTimes(2);
      expect(
        mocks.acquisitionPlanner.buildAcquisitionPlan,
      ).not.toHaveBeenCalled();
      expect(mocks.acquisitionService.executePlan).not.toHaveBeenCalled();
    });

    it('T6: degraded provider failure -> no false reuse, no acquisition', async () => {
      const mocks = buildMocks();
      mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([
        degradedRow('exp-degraded'),
      ]);
      const refreshedMetadata = {
        ...degradedRow('exp-degraded').metadata,
        classification: {
          state: 'degraded',
          promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
          modelId: 'groq/qwen',
          themes: [] as string[],
          intents: [] as string[],
          traits: [] as string[],
          reasoningEvidence: [] as Array<{
            facet: string;
            evidenceKeys: string[];
            reason: string;
          }>,
        },
      };
      mocks.catalog.findVerifiedByIds.mockResolvedValue([
        {
          id: 'exp-degraded',
          canonicalName: 'Caminito Walking Tour',
          metadata: refreshedMetadata,
        },
      ]);
      mocks.catalog.findClassificationContextById.mockResolvedValue({
        experienceId: 'exp-degraded',
        canonicalName: 'Caminito Walking Tour',
        metadata: degradedRow('exp-degraded').metadata,
        evidence: [
          {
            key: 'ev-1',
            source: 'serper',
            snippet: 'Caminito is a colorful street museum in La Boca',
          },
        ],
      });
      mocks.classificationService.classify.mockResolvedValue({
        themes: [] as string[],
        intents: [] as string[],
        traits: [] as string[],
        reasoningEvidence: [] as Array<{
          facet: string;
          evidenceKeys: string[];
          reason: string;
        }>,
        modelId: 'groq/qwen',
        promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
        state: 'degraded',
        failure: {
          stage: 'provider_call',
          reason: 'PROVIDER_UNAVAILABLE',
          httpStatus: 503,
          providerStatus: 'UNAVAILABLE',
        },
      });
      const service = buildService(mocks);

      const result = await service.acquireOrReuse(baseInput());

      expect(result).toEqual(
        expect.objectContaining({
          outcome: 'no_result',
          reason: 'classification_refresh_failed',
        }),
      );
      expect(mocks.classificationService.classify).toHaveBeenCalledTimes(1);
      expect(mocks.catalog.applyEvidenceClassification).toHaveBeenCalledWith(
        'exp-degraded',
        expect.objectContaining({ state: 'degraded' }),
      );
      expect(
        mocks.acquisitionPlanner.buildAcquisitionPlan,
      ).not.toHaveBeenCalled();
      expect(mocks.acquisitionService.executePlan).not.toHaveBeenCalled();
    });

    it('T7: insufficient persisted evidence -> typed outcome', async () => {
      const mocks = buildMocks();
      mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([
        degradedRow('exp-degraded'),
      ]);
      mocks.catalog.findVerifiedByIds.mockResolvedValue([
        {
          id: 'exp-degraded',
          canonicalName: 'Caminito Walking Tour',
          metadata: degradedRow('exp-degraded').metadata,
        },
      ]);
      mocks.catalog.findClassificationContextById.mockResolvedValue({
        experienceId: 'exp-degraded',
        canonicalName: 'Caminito Walking Tour',
        metadata: degradedRow('exp-degraded').metadata,
        evidence: [],
      });
      const service = buildService(mocks);

      const result = await service.acquireOrReuse(baseInput());

      expect(result).toEqual(
        expect.objectContaining({
          outcome: 'no_result',
          reason: 'insufficient_persisted_evidence',
        }),
      );
      expect(mocks.classificationService.classify).not.toHaveBeenCalled();
      expect(
        mocks.acquisitionPlanner.buildAcquisitionPlan,
      ).not.toHaveBeenCalled();
      expect(mocks.acquisitionService.executePlan).not.toHaveBeenCalled();
    });

    it('T8: true catalog miss -> normal acquisition path still executes', async () => {
      const mocks = buildMocks();
      mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([]);
      mocks.acquisitionPlanner.buildAcquisitionPlan.mockReturnValue({
        destination: {},
        deficits: [],
        sourcePlans: [{ provider: 'web', web: { query: 'q' } }],
        breadth: 'focused',
      });
      mocks.acquisitionService.executePlan.mockResolvedValue({
        evidence: [],
        candidates: [],
      });
      mocks.acquisitionService.materializeExecution.mockResolvedValue({
        resolved: [],
      });
      const service = buildService(mocks);

      const result = await service.acquireOrReuse(baseInput());

      expect(result).toEqual(
        expect.objectContaining({
          outcome: 'no_result',
          reason: 'no_accepted_results',
        }),
      );
      expect(mocks.classificationService.classify).not.toHaveBeenCalled();
      expect(mocks.acquisitionPlanner.buildAcquisitionPlan).toHaveBeenCalled();
      expect(mocks.acquisitionService.executePlan).toHaveBeenCalled();
    });
  });

  describe('WARM refresh outcome provenance (O1-O7)', () => {
    it('O1: provider unavailable remains observable with audit trail', async () => {
      const mocks = buildMocks();
      mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([
        degradedRow('exp-degraded'),
      ]);
      mocks.catalog.findVerifiedByIds.mockResolvedValue([
        {
          id: 'exp-degraded',
          canonicalName: 'Caminito Walking Tour',
          metadata: degradedRow('exp-degraded').metadata,
        },
      ]);
      mocks.catalog.findClassificationContextById.mockResolvedValue({
        experienceId: 'exp-degraded',
        canonicalName: 'Caminito Walking Tour',
        metadata: degradedRow('exp-degraded').metadata,
        evidence: [
          {
            key: 'ev-1',
            source: 'serper',
            snippet: 'Caminito is a colorful street museum in La Boca',
          },
        ],
      });
      mocks.classificationService.classify.mockResolvedValue({
        themes: [] as string[],
        intents: [] as string[],
        traits: [] as string[],
        reasoningEvidence: [] as Array<{
          facet: string;
          evidenceKeys: string[];
          reason: string;
        }>,
        modelId: 'groq/qwen',
        promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
        state: 'degraded',
        failure: {
          stage: 'provider_call',
          reason: 'PROVIDER_UNAVAILABLE',
          httpStatus: 503,
          providerStatus: 'UNAVAILABLE',
        },
      });
      const service = buildService(mocks);

      const result = await service.acquireOrReuse(baseInput());

      expect(result.outcome).toBe('no_result');
      if (result.outcome === 'no_result') {
        expect(result.reason).toBe('classification_refresh_failed');
        expect(result.classificationRefresh).toBeDefined();
        expect(result.classificationRefresh!.attempts).toHaveLength(1);
        expect(result.classificationRefresh!.attempts[0]).toEqual({
          experienceId: 'exp-degraded',
          outcome: 'degraded',
          provider: 'groq',
          model: 'qwen/qwen3.8-27b',
          failure: {
            stage: 'provider_call',
            reason: 'PROVIDER_UNAVAILABLE',
            httpStatus: 503,
            providerStatus: 'UNAVAILABLE',
          },
        });
      }
      expect(mocks.classificationService.classify).toHaveBeenCalledTimes(1);
      expect(mocks.catalog.applyEvidenceClassification).toHaveBeenCalledWith(
        'exp-degraded',
        expect.objectContaining({ state: 'degraded' }),
      );
      expect(
        mocks.acquisitionPlanner.buildAcquisitionPlan,
      ).not.toHaveBeenCalled();
      expect(mocks.acquisitionService.executePlan).not.toHaveBeenCalled();
    });

    it('O2: insufficient persisted evidence remains observable', async () => {
      const mocks = buildMocks();
      mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([
        degradedRow('exp-degraded'),
      ]);
      mocks.catalog.findVerifiedByIds.mockResolvedValue([
        {
          id: 'exp-degraded',
          canonicalName: 'Caminito Walking Tour',
          metadata: degradedRow('exp-degraded').metadata,
        },
      ]);
      mocks.catalog.findClassificationContextById.mockResolvedValue({
        experienceId: 'exp-degraded',
        canonicalName: 'Caminito Walking Tour',
        metadata: degradedRow('exp-degraded').metadata,
        evidence: [],
      });
      const service = buildService(mocks);

      const result = await service.acquireOrReuse(baseInput());

      expect(result.outcome).toBe('no_result');
      if (result.outcome === 'no_result') {
        expect(result.reason).toBe('insufficient_persisted_evidence');
        expect(result.classificationRefresh).toBeDefined();
        expect(result.classificationRefresh!.attempts).toHaveLength(1);
        expect(result.classificationRefresh!.attempts[0]).toEqual({
          experienceId: 'exp-degraded',
          outcome: 'insufficient_evidence',
        });
      }
      expect(mocks.classificationService.classify).not.toHaveBeenCalled();
      expect(
        mocks.acquisitionPlanner.buildAcquisitionPlan,
      ).not.toHaveBeenCalled();
      expect(mocks.acquisitionService.executePlan).not.toHaveBeenCalled();
    });

    it('O3: real semantic mismatch wins', async () => {
      const mocks = buildMocks();
      mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([
        degradedRow('exp-degraded'),
      ]);
      mocks.catalog.findVerifiedByIds.mockResolvedValue([
        {
          id: 'exp-degraded',
          canonicalName: 'Caminito Walking Tour',
          metadata: degradedRow('exp-degraded').metadata,
        },
      ]);
      mocks.catalog.findClassificationContextById.mockResolvedValue({
        experienceId: 'exp-degraded',
        canonicalName: 'Caminito Walking Tour',
        metadata: degradedRow('exp-degraded').metadata,
        evidence: [
          {
            key: 'ev-1',
            source: 'serper',
            snippet: 'Caminito is a colorful street museum in La Boca',
          },
        ],
      });
      mocks.classificationService.classify.mockResolvedValue({
        themes: ['food'],
        intents: ['food'],
        traits: [] as string[],
        reasoningEvidence: [
          {
            facet: 'intent:food',
            evidenceKeys: ['ev-1'],
            reason: 'evidence supports food tour',
          },
        ],
        modelId: 'groq/qwen',
        promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
        state: 'classified',
      });
      const service = buildService(mocks);

      const result = await service.acquireOrReuse(baseInput());

      expect(result.outcome).toBe('no_result');
      if (result.outcome === 'no_result') {
        expect(result.reason).toBe('no_semantically_eligible_result');
        expect(result.classificationRefresh).toBeDefined();
        expect(result.classificationRefresh!.attempts).toHaveLength(1);
        expect(result.classificationRefresh!.attempts[0]).toEqual({
          experienceId: 'exp-degraded',
          outcome: 'classified_mismatch',
          provider: 'groq',
          model: 'qwen/qwen3.8-27b',
        });
      }
      expect(
        mocks.acquisitionPlanner.buildAcquisitionPlan,
      ).not.toHaveBeenCalled();
      expect(mocks.acquisitionService.executePlan).not.toHaveBeenCalled();
    });

    it('O4: semantic mismatch takes precedence over later provider failure', async () => {
      const mocks = buildMocks();
      mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([
        degradedRow('exp-food'),
        degradedRow('exp-walk'),
      ]);
      mocks.catalog.findVerifiedByIds.mockImplementation(
        async (ids: string[]) =>
          ids.map((id) => ({
            id,
            canonicalName: `Experience ${id}`,
            metadata: degradedRow(id).metadata,
          })),
      );
      mocks.catalog.findClassificationContextById.mockImplementation(
        async (id: string) => ({
          experienceId: id,
          canonicalName: `Experience ${id}`,
          metadata: degradedRow(id).metadata,
          evidence: [
            {
              key: 'ev-1',
              source: 'serper',
              snippet: 'Some evidence',
            },
          ],
        }),
      );
      mocks.classificationService.classify.mockImplementation(
        async (name: string) => {
          if (name.includes('exp-food')) {
            return {
              themes: ['food'],
              intents: ['food'],
              traits: [] as string[],
              reasoningEvidence: [
                {
                  facet: 'intent:food',
                  evidenceKeys: ['ev-1'],
                  reason: 'evidence supports food tour',
                },
              ],
              modelId: 'groq/qwen',
              promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
              state: 'classified',
            };
          }
          return {
            themes: [] as string[],
            intents: [] as string[],
            traits: [] as string[],
            reasoningEvidence: [] as Array<{
              facet: string;
              evidenceKeys: string[];
              reason: string;
            }>,
            modelId: 'groq/qwen',
            promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
            state: 'degraded',
            failure: {
              stage: 'provider_call',
              reason: 'PROVIDER_UNAVAILABLE',
              httpStatus: 503,
              providerStatus: 'UNAVAILABLE',
            },
          };
        },
      );
      const service = buildService(mocks);

      const result = await service.acquireOrReuse(baseInput());

      expect(result.outcome).toBe('no_result');
      if (result.outcome === 'no_result') {
        expect(result.reason).toBe('no_semantically_eligible_result');
        expect(result.classificationRefresh).toBeDefined();
        expect(result.classificationRefresh!.attempts).toHaveLength(2);
        expect(result.classificationRefresh!.attempts[0]).toEqual({
          experienceId: 'exp-food',
          outcome: 'classified_mismatch',
          provider: 'groq',
          model: 'qwen/qwen3.8-27b',
        });
        expect(result.classificationRefresh!.attempts[1]).toEqual({
          experienceId: 'exp-walk',
          outcome: 'degraded',
          provider: 'groq',
          model: 'qwen/qwen3.8-27b',
          failure: {
            stage: 'provider_call',
            reason: 'PROVIDER_UNAVAILABLE',
            httpStatus: 503,
            providerStatus: 'UNAVAILABLE',
          },
        });
      }
      expect(
        mocks.acquisitionPlanner.buildAcquisitionPlan,
      ).not.toHaveBeenCalled();
      expect(mocks.acquisitionService.executePlan).not.toHaveBeenCalled();
    });

    it('O5: provider failure when another candidate eventually matches', async () => {
      const mocks = buildMocks();
      mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([
        degradedRow('exp-fail'),
        degradedRow('exp-walk'),
      ]);
      mocks.catalog.findVerifiedByIds.mockImplementation(
        async (ids: string[]) =>
          ids.map((id) => ({
            id,
            canonicalName: `Experience ${id}`,
            metadata: degradedRow(id).metadata,
          })),
      );
      mocks.catalog.findClassificationContextById.mockImplementation(
        async (id: string) => ({
          experienceId: id,
          canonicalName: `Experience ${id}`,
          metadata: degradedRow(id).metadata,
          evidence: [
            {
              key: 'ev-1',
              source: 'serper',
              snippet: 'Some evidence',
            },
          ],
        }),
      );
      mocks.classificationService.classify.mockImplementation(
        async (name: string) => {
          if (name.includes('exp-fail')) {
            return {
              themes: [] as string[],
              intents: [] as string[],
              traits: [] as string[],
              reasoningEvidence: [] as Array<{
                facet: string;
                evidenceKeys: string[];
                reason: string;
              }>,
              modelId: 'groq/qwen',
              promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
              state: 'degraded',
              failure: {
                stage: 'provider_call',
                reason: 'PROVIDER_UNAVAILABLE',
                httpStatus: 503,
                providerStatus: 'UNAVAILABLE',
              },
            };
          }
          return {
            themes: ['history'],
            intents: ['walk'],
            traits: [] as string[],
            reasoningEvidence: [
              {
                facet: 'intent:walk',
                evidenceKeys: ['ev-1'],
                reason: 'evidence supports walking route',
              },
            ],
            modelId: 'groq/qwen',
            promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
            state: 'classified',
          };
        },
      );
      const service = buildService(mocks);

      const result = await service.acquireOrReuse(baseInput());

      expect(result.outcome).toBe('classification_refreshed');
      if (result.outcome === 'classification_refreshed') {
        expect(result.experienceId).toBe('exp-walk');
        expect(result.classificationRefresh).toBeDefined();
        expect(result.classificationRefresh!.attempts).toHaveLength(2);
        expect(result.classificationRefresh!.attempts[0]).toEqual({
          experienceId: 'exp-fail',
          outcome: 'degraded',
          provider: 'groq',
          model: 'qwen/qwen3.8-27b',
          failure: {
            stage: 'provider_call',
            reason: 'PROVIDER_UNAVAILABLE',
            httpStatus: 503,
            providerStatus: 'UNAVAILABLE',
          },
        });
        expect(result.classificationRefresh!.attempts[1]).toEqual({
          experienceId: 'exp-walk',
          outcome: 'classified_match',
          provider: 'groq',
          model: 'qwen/qwen3.8-27b',
        });
      }
      expect(
        mocks.acquisitionPlanner.buildAcquisitionPlan,
      ).not.toHaveBeenCalled();
      expect(mocks.acquisitionService.executePlan).not.toHaveBeenCalled();
    });

    it('O6: existing valid direct reuse unchanged', async () => {
      const mocks = buildMocks();
      mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([
        classifiedRow('exp-warm', 'walk'),
      ]);
      const service = buildService(mocks);

      const result = await service.acquireOrReuse(baseInput());

      expect(result).toEqual({ outcome: 'reused', experienceId: 'exp-warm' });
      expect(mocks.classificationService.classify).not.toHaveBeenCalled();
      expect(
        mocks.acquisitionPlanner.buildAcquisitionPlan,
      ).not.toHaveBeenCalled();
      expect(mocks.acquisitionService.executePlan).not.toHaveBeenCalled();
    });

    it('O7: true catalog miss unchanged', async () => {
      const mocks = buildMocks();
      mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([]);
      mocks.acquisitionPlanner.buildAcquisitionPlan.mockReturnValue({
        destination: {},
        deficits: [],
        sourcePlans: [{ provider: 'web', web: { query: 'q' } }],
        breadth: 'focused',
      });
      mocks.acquisitionService.executePlan.mockResolvedValue({
        evidence: [],
        candidates: [],
      });
      mocks.acquisitionService.materializeExecution.mockResolvedValue({
        resolved: [],
      });
      const service = buildService(mocks);

      const result = await service.acquireOrReuse(baseInput());

      expect(result.outcome).toBe('no_result');
      if (result.outcome === 'no_result') {
        expect(result.reason).toBe('no_accepted_results');
      }
      expect(mocks.classificationService.classify).not.toHaveBeenCalled();
      expect(mocks.acquisitionPlanner.buildAcquisitionPlan).toHaveBeenCalled();
      expect(mocks.acquisitionService.executePlan).toHaveBeenCalled();
    });
  });

  describe('Classifier-owned WARM eligibility (F1-F8)', () => {
    it('F1: successful refresh appears in audit with classified_match', async () => {
      const mocks = buildMocks();
      mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([
        degradedRow('exp-a'),
        degradedRow('exp-b'),
      ]);
      mocks.catalog.findVerifiedByIds.mockImplementation(
        async (ids: string[]) =>
          ids.map((id) => ({
            id,
            canonicalName: `Experience ${id}`,
            metadata: degradedRow(id).metadata,
          })),
      );
      mocks.catalog.findClassificationContextById.mockImplementation(
        async (id: string) => ({
          experienceId: id,
          canonicalName: `Experience ${id}`,
          metadata: degradedRow(id).metadata,
          evidence: [
            {
              key: 'ev-1',
              source: 'serper',
              snippet: 'Grounding evidence',
            },
          ],
        }),
      );
      mocks.classificationService.classify.mockImplementation(
        async (name: string) => {
          if (name.includes('exp-a')) {
            return {
              themes: [] as string[],
              intents: [] as string[],
              traits: [] as string[],
              reasoningEvidence: [] as Array<{
                facet: string;
                evidenceKeys: string[];
                reason: string;
              }>,
              modelId: 'groq/qwen',
              promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
              state: 'degraded',
              failure: {
                stage: 'provider_call',
                reason: 'PROVIDER_UNAVAILABLE',
                httpStatus: 503,
                providerStatus: 'UNAVAILABLE',
              },
            };
          }
          return {
            themes: ['history'],
            intents: ['walk'],
            traits: [] as string[],
            reasoningEvidence: [
              {
                facet: 'intent:walk',
                evidenceKeys: ['ev-1'],
                reason: 'walking evidence',
              },
            ],
            modelId: 'groq/qwen',
            promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
            state: 'classified',
          };
        },
      );
      const service = buildService(mocks);

      const result = await service.acquireOrReuse(baseInput());

      expect(result.outcome).toBe('classification_refreshed');
      if (result.outcome === 'classification_refreshed') {
        expect(result.experienceId).toBe('exp-b');
        expect(result.classificationRefresh).toBeDefined();
        expect(result.classificationRefresh!.attempts).toEqual([
          {
            experienceId: 'exp-a',
            outcome: 'degraded',
            provider: 'groq',
            model: 'qwen/qwen3.8-27b',
            failure: {
              stage: 'provider_call',
              reason: 'PROVIDER_UNAVAILABLE',
              httpStatus: 503,
              providerStatus: 'UNAVAILABLE',
            },
          },
          {
            experienceId: 'exp-b',
            outcome: 'classified_match',
            provider: 'groq',
            model: 'qwen/qwen3.8-27b',
          },
        ]);
        expect(
          (result.classificationRefresh!.attempts[1] as any).failure,
        ).toBeUndefined();
      }
    });

    it('F2: valid wrong-facet candidate is NOT refreshed', async () => {
      const mocks = buildMocks();
      mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([
        classifiedRow('exp-food', 'food'),
      ]);
      const service = buildService(mocks);

      const result = await service.acquireOrReuse(baseInput());

      expect(result.outcome).toBe('no_result');
      if (result.outcome === 'no_result') {
        expect(result.reason).toBe('no_semantically_eligible_result');
      }
      expect(mocks.classificationService.classify).not.toHaveBeenCalled();
      expect(
        mocks.catalog.findClassificationContextById,
      ).not.toHaveBeenCalled();
      expect(
        mocks.acquisitionPlanner.buildAcquisitionPlan,
      ).not.toHaveBeenCalled();
      expect(mocks.acquisitionService.executePlan).not.toHaveBeenCalled();
    });

    it('F3: valid wrong-facet + no evidence still semantic mismatch', async () => {
      const mocks = buildMocks();
      mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([
        classifiedRow('exp-food', 'food'),
      ]);
      mocks.catalog.findClassificationContextById.mockResolvedValue({
        experienceId: 'exp-food',
        canonicalName: 'Food Experience',
        metadata: classifiedRow('exp-food', 'food').metadata,
        evidence: [],
      });
      const service = buildService(mocks);

      const result = await service.acquireOrReuse(baseInput());

      expect(result.outcome).toBe('no_result');
      if (result.outcome === 'no_result') {
        expect(result.reason).toBe('no_semantically_eligible_result');
      }
      expect(mocks.classificationService.classify).not.toHaveBeenCalled();
      expect(
        mocks.catalog.findClassificationContextById,
      ).not.toHaveBeenCalled();
    });

    it('F4: legacy archetype cannot override valid classification', async () => {
      const mocks = buildMocks();
      const row = classifiedRow('exp-archetype', 'food');
      (row.metadata as any).archetypes = ['walk'];
      mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([row]);
      const service = buildService(mocks);

      const result = await service.acquireOrReuse(baseInput());

      expect(result.outcome).toBe('no_result');
      if (result.outcome === 'no_result') {
        expect(result.reason).toBe('no_semantically_eligible_result');
      }
      expect(mocks.classificationService.classify).not.toHaveBeenCalled();
    });

    it('F5: legacy archetype cannot override refreshed classification', async () => {
      const mocks = buildMocks();
      const row = degradedRow('exp-degraded-with-archetype');
      (row.metadata as any).archetypes = ['walk'];

      mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([row]);
      mocks.catalog.findVerifiedByIds.mockResolvedValue([
        {
          id: 'exp-degraded-with-archetype',
          canonicalName: 'Caminito Tour',
          metadata: row.metadata,
        },
      ]);
      mocks.catalog.findClassificationContextById.mockResolvedValue({
        experienceId: 'exp-degraded-with-archetype',
        canonicalName: 'Caminito Tour',
        metadata: row.metadata,
        evidence: [
          {
            key: 'ev-1',
            source: 'serper',
            snippet: 'Food market in Caminito',
          },
        ],
      });
      mocks.classificationService.classify.mockResolvedValue({
        themes: ['food'],
        intents: ['food'],
        traits: [] as string[],
        reasoningEvidence: [
          {
            facet: 'intent:food',
            evidenceKeys: ['ev-1'],
            reason: 'food market',
          },
        ],
        modelId: 'groq/qwen',
        promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
        state: 'classified',
      });
      const service = buildService(mocks);

      const result = await service.acquireOrReuse(baseInput());

      expect(result.outcome).toBe('no_result');
      if (result.outcome === 'no_result') {
        expect(result.reason).toBe('no_semantically_eligible_result');
        expect(result.classificationRefresh).toBeDefined();
        expect(result.classificationRefresh!.attempts).toEqual([
          {
            experienceId: 'exp-degraded-with-archetype',
            outcome: 'classified_mismatch',
            provider: 'groq',
            model: 'qwen/qwen3.8-27b',
          },
        ]);
      }
    });

    it('F6: positive direct reuse still works with classifier 0 calls', async () => {
      const mocks = buildMocks();
      const row = classifiedRow('exp-walk', 'walk');
      (row.metadata as any).archetypes = ['food'];
      mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([row]);
      const service = buildService(mocks);

      const result = await service.acquireOrReuse(baseInput());

      expect(result).toEqual({ outcome: 'reused', experienceId: 'exp-walk' });
      expect(mocks.classificationService.classify).not.toHaveBeenCalled();
      expect(
        mocks.catalog.findClassificationContextById,
      ).not.toHaveBeenCalled();
    });

    it('F7: positive refresh still works with classified_match in audit', async () => {
      const mocks = buildMocks();
      mocks.catalog.findVerifiedMultiComponentInArea.mockResolvedValue([
        degradedRow('exp-refresh-walk'),
      ]);
      mocks.catalog.findVerifiedByIds.mockResolvedValue([
        {
          id: 'exp-refresh-walk',
          canonicalName: 'Walking Tour',
          metadata: degradedRow('exp-refresh-walk').metadata,
        },
      ]);
      mocks.catalog.findClassificationContextById.mockResolvedValue({
        experienceId: 'exp-refresh-walk',
        canonicalName: 'Walking Tour',
        metadata: degradedRow('exp-refresh-walk').metadata,
        evidence: [
          {
            key: 'ev-1',
            source: 'serper',
            snippet: 'Historic walking route',
          },
        ],
      });
      mocks.classificationService.classify.mockResolvedValue({
        themes: ['history'],
        intents: ['walk'],
        traits: [] as string[],
        reasoningEvidence: [
          {
            facet: 'intent:walk',
            evidenceKeys: ['ev-1'],
            reason: 'walking route',
          },
        ],
        modelId: 'groq/qwen',
        promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
        state: 'classified',
      });
      const service = buildService(mocks);

      const result = await service.acquireOrReuse(baseInput());

      expect(result.outcome).toBe('classification_refreshed');
      if (result.outcome === 'classification_refreshed') {
        expect(result.experienceId).toBe('exp-refresh-walk');
        expect(result.classificationRefresh).toBeDefined();
        expect(result.classificationRefresh!.attempts).toEqual([
          {
            experienceId: 'exp-refresh-walk',
            outcome: 'classified_match',
            provider: 'groq',
            model: 'qwen/qwen3.8-27b',
          },
        ]);
      }
    });
  });
});
