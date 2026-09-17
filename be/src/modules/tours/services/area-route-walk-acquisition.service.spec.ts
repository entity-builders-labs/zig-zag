import {
  AreaRouteWalkAcquisitionInput,
  AreaRouteWalkAcquisitionService,
} from './area-route-walk-acquisition.service';
import { CURRENT_CLASSIFICATION_PROMPT_VERSION } from './experience-classification.service';
import { ResolvedAnchor } from '../interfaces/preference-spec.interface';
import { PreferenceFacetDeficit } from '../interfaces/experience-acquisition-plan.interface';

// Cutover M4: classification (grouping-by-canonical-id, evidence-scoping,
// reuse-vs-recompute) is no longer owned by AreaRouteWalkAcquisitionService
// -- it runs inside ExperienceAcquisitionService.materializeExecution()
// (the shared canonical materialization boundary), which is a plain mock
// in this unit spec. That behavior is now exhaustively covered by
// experience-classification-convergence.util.spec.ts. What THIS file still
// owns and must keep proving: warm reuse (modes A/B/C), cold-miss routing,
// the validationScope/validationIntent threaded into materializeExecution,
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
  };
  const acquisitionPlanner = {
    buildAcquisitionPlan: jest.fn(),
  };
  const acquisitionService = {
    executePlan: jest.fn(),
    materializeExecution: jest.fn(),
  };
  return {
    anchorResolver,
    catalog,
    acquisitionPlanner,
    acquisitionService,
  };
}

function buildService(mocks: ReturnType<typeof buildMocks>) {
  return new AreaRouteWalkAcquisitionService(
    mocks.catalog as any,
    mocks.acquisitionPlanner as any,
    mocks.acquisitionService as any,
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

function deficitFor(intentKey: 'walk' | 'route_like'): PreferenceFacetDeficit {
  return {
    origin: 'preference_facet',
    dimension: 'intent',
    key: intentKey,
    reason: `Preference facet [intent:${intentKey}] has no strong catalog match yet.`,
  };
}

function baseInput(
  overrides: Partial<AreaRouteWalkAcquisitionInput> = {},
): AreaRouteWalkAcquisitionInput {
  const intentKey = overrides.intentKey ?? 'walk';
  return {
    anchor: areaAnchor,
    intentKey,
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
    ...overrides,
  };
}

describe('AreaRouteWalkAcquisitionService', () => {
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

  it('B: cold miss routes acquisition with the anchor + validationScope/validationIntent', async () => {
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
        validationIntent: 'walk',
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

  it('B2: mode C (unresolved canonical ROUTE) still passes validationIntent, but validationScope is undefined', async () => {
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
        validationIntent: 'route_like',
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
    expect(result).toEqual(
      expect.objectContaining({
        outcome: 'no_result',
        reason: 'no_source_plan',
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
});
