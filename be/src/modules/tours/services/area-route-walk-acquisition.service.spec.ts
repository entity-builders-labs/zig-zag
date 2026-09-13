import {
  AreaRouteWalkAcquisitionInput,
  AreaRouteWalkAcquisitionService,
} from './area-route-walk-acquisition.service';
import { CURRENT_CLASSIFICATION_PROMPT_VERSION } from './experience-classification.service';
import { AnchoredPlace } from '../interfaces/preference-spec.interface';
import { PreferenceFacetDeficit } from '../interfaces/experience-acquisition-plan.interface';

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
    findVerifiedMultiComponentCoveredByArea: jest.fn(),
    findVerifiedMultiComponentByExactComponent: jest.fn(),
    findVerifiedTourismRouteByName: jest.fn(),
    findVerifiedByIds: jest.fn(),
    applyEvidenceClassification: jest.fn().mockResolvedValue(undefined),
  };
  const acquisitionPlanner = {
    buildAcquisitionPlan: jest.fn(),
  };
  const acquisitionService = {
    executePlan: jest.fn(),
    materializeExecution: jest.fn(),
  };
  const classifier = {
    classify: jest.fn(),
  };
  return {
    anchorResolver,
    catalog,
    acquisitionPlanner,
    acquisitionService,
    classifier,
  };
}

function buildService(mocks: ReturnType<typeof buildMocks>) {
  return new AreaRouteWalkAcquisitionService(
    mocks.anchorResolver as any,
    mocks.catalog as any,
    mocks.acquisitionPlanner as any,
    mocks.acquisitionService as any,
    mocks.classifier as any,
  );
}

const areaAnchor: AnchoredPlace = {
  rawName: 'San Telmo',
  kind: 'area',
  priority: 'must',
};
const routeAnchor: AnchoredPlace = {
  rawName: 'Caminito',
  kind: 'route',
  priority: 'must',
};
const tourismRouteAnchor: AnchoredPlace = {
  rawName: 'Ruta del Vino de Mendoza',
  kind: 'route',
  priority: 'must',
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
    destinationBoundary: { id: 'osm:relation:1', name: 'Buenos Aires' },
    deficit: deficitFor(intentKey),
    ...overrides,
  };
}

describe('AreaRouteWalkAcquisitionService', () => {
  it('A1: warm AREA hit short-circuits acquisition', async () => {
    const mocks = buildMocks();
    mocks.anchorResolver.resolveArea.mockResolvedValue({
      resolved: true,
      geoEntityId: 'geo-san-telmo',
      geometry: { type: 'Polygon', coordinates: [] },
    });
    mocks.catalog.findVerifiedMultiComponentCoveredByArea.mockResolvedValue([
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
    mocks.catalog.findVerifiedMultiComponentCoveredByArea.mockResolvedValue([]);
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
    mocks.catalog.findVerifiedByIds.mockResolvedValue([
      { id: 'exp-1', canonicalName: 'San Telmo Historical Walk' },
    ]);
    mocks.classifier.classify.mockResolvedValue({
      state: 'classified',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      modelId: 'groq/qwen',
      themes: [],
      intents: ['walk'],
      traits: [],
      reasoningEvidence: [
        { facet: 'intent:walk', evidenceKeys: ['ev-1'], reason: 'r' },
      ],
    });

    // Round 1: warm MISS -> acquire -> post-check finds the freshly-
    // classified row (simulating what applyEvidenceClassification's real
    // write would produce).
    mocks.catalog.findVerifiedMultiComponentCoveredByArea
      .mockResolvedValueOnce([]) // round 1 warm check
      .mockResolvedValueOnce([classifiedRow('exp-1', 'walk')]) // round 1 post-check
      .mockResolvedValueOnce([classifiedRow('exp-1', 'walk')]); // round 2 warm check

    const service = buildService(mocks);

    const round1 = await service.acquireOrReuse(baseInput());
    expect(round1).toEqual({ outcome: 'acquired', experienceId: 'exp-1' });

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
    mocks.catalog.findVerifiedByIds.mockResolvedValue([
      { id: 'exp-caminito', canonicalName: 'Caminito Route' },
    ]);
    mocks.classifier.classify.mockResolvedValue({
      state: 'classified',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      modelId: 'groq/qwen',
      themes: [],
      intents: ['route_like'],
      traits: [],
      reasoningEvidence: [
        { facet: 'intent:route_like', evidenceKeys: ['ev-1'], reason: 'r' },
      ],
    });

    mocks.catalog.findVerifiedMultiComponentByExactComponent
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([classifiedRow('exp-caminito', 'route_like')])
      .mockResolvedValueOnce([classifiedRow('exp-caminito', 'route_like')]);

    const service = buildService(mocks);
    const input = baseInput({ anchor: routeAnchor, intentKey: 'route_like' });

    const round1 = await service.acquireOrReuse(input);
    expect(round1).toEqual({
      outcome: 'acquired',
      experienceId: 'exp-caminito',
    });

    const round2 = await service.acquireOrReuse(input);
    expect(round2).toEqual({ outcome: 'reused', experienceId: 'exp-caminito' });

    expect(mocks.acquisitionService.executePlan).toHaveBeenCalledTimes(1);
  });

  it('C3: tourism-route (mode C) cold-then-warm reuse via REAL classification convergence, no faked state', async () => {
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
    mocks.catalog.findVerifiedByIds.mockResolvedValue([
      { id: 'exp-ruta', canonicalName: 'Ruta del Vino de Mendoza' },
    ]);
    mocks.classifier.classify.mockResolvedValue({
      state: 'classified',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      modelId: 'groq/qwen',
      themes: [],
      intents: ['route_like'],
      traits: [],
      reasoningEvidence: [
        { facet: 'intent:route_like', evidenceKeys: ['wine-1'], reason: 'r' },
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
    expect(round1).toEqual({ outcome: 'acquired', experienceId: 'exp-ruta' });
    expect(mocks.classifier.classify).toHaveBeenCalledWith(
      'Ruta del Vino de Mendoza',
      expect.arrayContaining([
        expect.objectContaining({ key: 'wine-1' }),
        expect.objectContaining({ key: 'wine-2' }),
      ]),
    );
    expect(mocks.catalog.applyEvidenceClassification).toHaveBeenCalledWith(
      'exp-ruta',
      expect.objectContaining({ intents: ['route_like'] }),
    );

    const round2 = await service.acquireOrReuse(input);
    expect(round2).toEqual({ outcome: 'reused', experienceId: 'exp-ruta' });

    expect(mocks.acquisitionPlanner.buildAcquisitionPlan).toHaveBeenCalledTimes(
      1,
    );
    expect(mocks.acquisitionService.executePlan).toHaveBeenCalledTimes(1);
    expect(mocks.classifier.classify).toHaveBeenCalledTimes(1);
  });

  it('D: insufficient evidence never persists a fake walk (zero accepted -> no_result, no classification)', async () => {
    const mocks = buildMocks();
    mocks.anchorResolver.resolveArea.mockResolvedValue({
      resolved: true,
      geoEntityId: 'geo-san-telmo',
      geometry: { type: 'Polygon', coordinates: [] },
    });
    mocks.catalog.findVerifiedMultiComponentCoveredByArea.mockResolvedValue([]);
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

    expect(result).toEqual({ outcome: 'no_result' });
    expect(mocks.classifier.classify).not.toHaveBeenCalled();
    expect(mocks.catalog.applyEvidenceClassification).not.toHaveBeenCalled();
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
    mocks.catalog.findVerifiedByIds.mockResolvedValue([
      { id: 'exp-1', canonicalName: 'San Telmo Historical Walk' },
    ]);
    mocks.classifier.classify.mockResolvedValue({
      state: 'classified',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      modelId: 'groq/qwen',
      themes: [],
      intents: ['walk'],
      traits: [],
      reasoningEvidence: [
        { facet: 'intent:walk', evidenceKeys: ['ev-1'], reason: 'r' },
      ],
    });
    mocks.catalog.findVerifiedMultiComponentCoveredByArea
      .mockResolvedValueOnce([]) // warm
      .mockResolvedValueOnce([]); // post-check -- still nothing
    const service = buildService(mocks);

    const result = await service.acquireOrReuse(baseInput());

    expect(result).toEqual({ outcome: 'no_result' });
  });

  it('F: an unsupported intentKey (facet undefined) never accidentally warm-matches, in any mode', async () => {
    const mocks = buildMocks();
    mocks.anchorResolver.resolveArea.mockResolvedValue({
      resolved: true,
      geoEntityId: 'geo-san-telmo',
      geometry: { type: 'Polygon', coordinates: [] },
    });
    mocks.catalog.findVerifiedMultiComponentCoveredByArea.mockResolvedValue([
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
    expect(result).toEqual({ outcome: 'no_result' });
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
    mocks.catalog.findVerifiedByIds.mockResolvedValue([
      { id: 'exp-x', canonicalName: 'San Telmo Historical Walk' },
    ]);
    mocks.classifier.classify.mockResolvedValue({
      state: 'classified',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      modelId: 'groq/qwen',
      themes: [],
      intents: ['walk'],
      traits: [],
      reasoningEvidence: [
        { facet: 'intent:walk', evidenceKeys: ['ev-1'], reason: 'r' },
      ],
    });
    // Pre-existing, unrelated, geographically-compatible row Y is ALSO
    // returned by the post-check's geography lookup, alongside this
    // execution's own accepted X.
    mocks.catalog.findVerifiedMultiComponentCoveredByArea
      .mockResolvedValueOnce([]) // warm
      .mockResolvedValueOnce([
        classifiedRow('exp-y', 'walk'),
        classifiedRow('exp-x', 'walk'),
      ]); // post-check
    const service = buildService(mocks);

    const result = await service.acquireOrReuse(baseInput());

    expect(result).toEqual({ outcome: 'acquired', experienceId: 'exp-x' });
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
    mocks.catalog.findVerifiedByIds.mockResolvedValue([
      { id: 'exp-x', canonicalName: 'San Telmo Historical Walk' },
    ]);
    mocks.classifier.classify.mockResolvedValue({
      state: 'classified',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      modelId: 'groq/qwen',
      themes: [],
      intents: ['walk'],
      traits: [],
      reasoningEvidence: [
        { facet: 'intent:walk', evidenceKeys: ['ev-1'], reason: 'r' },
      ],
    });
    mocks.catalog.findVerifiedMultiComponentCoveredByArea
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([classifiedRow('exp-y', 'walk')]); // only the unrelated row
    const service = buildService(mocks);

    const result = await service.acquireOrReuse(baseInput());

    expect(result).toEqual({ outcome: 'no_result' });
  });

  it('R1: classifies exactly ONCE per canonical experienceId when two accepted candidates converge onto it', async () => {
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
      evidence: [
        { key: 'a1', source: 'x', snippet: 's' },
        { key: 'a2', source: 'x', snippet: 's' },
        { key: 'b1', source: 'x', snippet: 's' },
        { key: 'b2', source: 'x', snippet: 's' },
      ],
      candidates: [],
    });
    mocks.acquisitionService.materializeExecution.mockResolvedValue({
      resolved: [
        {
          status: 'accepted',
          experienceId: 'exp-x',
          candidate: { evidenceKeys: ['a1', 'a2'] },
        },
        {
          status: 'accepted',
          experienceId: 'exp-x',
          candidate: { evidenceKeys: ['b1', 'b2'] },
        },
      ],
    });
    mocks.catalog.findVerifiedByIds.mockResolvedValue([
      { id: 'exp-x', canonicalName: 'San Telmo Historical Walk' },
    ]);
    mocks.classifier.classify.mockResolvedValue({
      state: 'classified',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      modelId: 'groq/qwen',
      themes: [],
      intents: ['walk'],
      traits: [],
      reasoningEvidence: [
        { facet: 'intent:walk', evidenceKeys: ['a1'], reason: 'r' },
      ],
    });
    mocks.catalog.findVerifiedMultiComponentCoveredByArea
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([classifiedRow('exp-x', 'walk')]);
    const service = buildService(mocks);

    await service.acquireOrReuse(baseInput());

    expect(mocks.classifier.classify).toHaveBeenCalledTimes(1);
    expect(mocks.classifier.classify).toHaveBeenCalledWith(
      'San Telmo Historical Walk',
      expect.arrayContaining([
        expect.objectContaining({ key: 'a1' }),
        expect.objectContaining({ key: 'a2' }),
        expect.objectContaining({ key: 'b1' }),
        expect.objectContaining({ key: 'b2' }),
      ]),
    );
    expect(mocks.catalog.applyEvidenceClassification).toHaveBeenCalledTimes(1);
  });

  it('R2: cross-Experience evidence isolation -- no evidence crosses between two distinct accepted Experiences', async () => {
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
      evidence: [
        { key: 'a1', source: 'x', snippet: 's' },
        { key: 'a2', source: 'x', snippet: 's' },
        { key: 'b1', source: 'x', snippet: 's' },
        { key: 'y1', source: 'x', snippet: 's' },
        { key: 'y2', source: 'x', snippet: 's' },
      ],
      candidates: [],
    });
    mocks.acquisitionService.materializeExecution.mockResolvedValue({
      resolved: [
        {
          status: 'accepted',
          experienceId: 'exp-x',
          candidate: { evidenceKeys: ['a1', 'a2'] },
        },
        {
          status: 'accepted',
          experienceId: 'exp-x',
          candidate: { evidenceKeys: ['b1'] },
        },
        {
          status: 'accepted',
          experienceId: 'exp-y',
          candidate: { evidenceKeys: ['y1', 'y2'] },
        },
      ],
    });
    mocks.catalog.findVerifiedByIds
      .mockResolvedValueOnce([{ id: 'exp-x', canonicalName: 'X Walk' }])
      .mockResolvedValueOnce([{ id: 'exp-y', canonicalName: 'Y Walk' }]);
    mocks.classifier.classify.mockResolvedValue({
      state: 'classified',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      modelId: 'groq/qwen',
      themes: [],
      intents: ['walk'],
      traits: [],
      reasoningEvidence: [
        { facet: 'intent:walk', evidenceKeys: ['a1'], reason: 'r' },
      ],
    });
    mocks.catalog.findVerifiedMultiComponentCoveredByArea
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([classifiedRow('exp-x', 'walk')]);
    const service = buildService(mocks);

    await service.acquireOrReuse(baseInput());

    expect(mocks.classifier.classify).toHaveBeenCalledTimes(2);
    const xCall = mocks.classifier.classify.mock.calls.find(
      (call) => call[0] === 'X Walk',
    );
    const yCall = mocks.classifier.classify.mock.calls.find(
      (call) => call[0] === 'Y Walk',
    );
    expect(xCall?.[1].map((e: any) => e.key).sort()).toEqual([
      'a1',
      'a2',
      'b1',
    ]);
    expect(yCall?.[1].map((e: any) => e.key).sort()).toEqual(['y1', 'y2']);
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
    mocks.catalog.findVerifiedByIds.mockResolvedValue([
      { id: 'exp-food', canonicalName: 'San Telmo Food Crawl' },
    ]);
    // Evidence genuinely supports 'food', not the requested 'walk'.
    mocks.classifier.classify.mockResolvedValue({
      state: 'classified',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      modelId: 'groq/qwen',
      themes: [],
      intents: ['food'],
      traits: [],
      reasoningEvidence: [
        { facet: 'intent:food', evidenceKeys: ['ev-1'], reason: 'r' },
      ],
    });
    mocks.catalog.findVerifiedMultiComponentCoveredByArea
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([classifiedRow('exp-food', 'food')]); // classified, but the WRONG intent
    const service = buildService(mocks);

    const result = await service.acquireOrReuse(
      baseInput({ intentKey: 'walk' }),
    );

    expect(result).toEqual({ outcome: 'no_result' });
    // The Experience was still classified and persisted -- just not a
    // successful result for THIS request.
    expect(mocks.catalog.applyEvidenceClassification).toHaveBeenCalled();
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
    mocks.catalog.findVerifiedByIds.mockResolvedValue([
      { id: 'exp-1', canonicalName: 'San Telmo Historical Walk' },
    ]);
    mocks.classifier.classify.mockResolvedValue({
      state: 'degraded',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      modelId: 'groq/qwen',
      themes: [],
      intents: [],
      traits: [],
      reasoningEvidence: [],
    });
    mocks.catalog.findVerifiedMultiComponentCoveredByArea
      .mockResolvedValueOnce([]) // round 1 warm
      .mockResolvedValueOnce([degradedRow('exp-1')]) // round 1 post-check
      .mockResolvedValueOnce([degradedRow('exp-1')]) // round 2 warm check
      .mockResolvedValueOnce([degradedRow('exp-1')]); // round 2 post-check (re-attempted acquisition)
    const service = buildService(mocks);

    const round1 = await service.acquireOrReuse(baseInput());
    expect(round1).toEqual({ outcome: 'no_result' });

    // Round 2 -- geography would find it, but the degraded classification
    // must still reject it, both at the warm check AND after re-attempting
    // acquisition.
    const round2 = await service.acquireOrReuse(baseInput());
    expect(round2.outcome).not.toBe('reused');
  });
});
