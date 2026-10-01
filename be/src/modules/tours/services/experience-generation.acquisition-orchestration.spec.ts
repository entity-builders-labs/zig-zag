import { ExperienceGenerationService } from './experience-generation.service';
import { GenerationTraceRecorder } from '../utils/generation-trace-recorder.util';
import { AcquisitionExecutionLedger } from '../utils/acquisition-source-plan-fingerprint.util';
import { GeographicScope } from '../interfaces/experience-resolution.interface';
import { ExperienceAcquisitionPlan } from '../interfaces/experience-acquisition-plan.interface';
import { RequestedFacet } from '../interfaces/preference-spec.interface';
import {
  deriveRequestValidationIntent,
  validationIntentOf,
} from '../utils/request-validation-intent.util';

describe('ExperienceGenerationService acquisition orchestration (request-level validationIntent propagation)', () => {
  let generationService: ExperienceGenerationService;
  let mockExperienceAcquisition: {
    executePlan: jest.Mock;
    materializeExecution: jest.Mock;
  };
  let traceRecorder: GenerationTraceRecorder;
  let providerState: { attempted: Set<string>; failed: Set<string> };
  let executionLedger: AcquisitionExecutionLedger;
  const dummyScope: GeographicScope = {
    kind: 'AREA_BOUNDARY',
    boundary: {
      id: 'relation-100',
      osmType: 'relation',
      osmId: 100,
      name: 'Test Destination',
      geometry: { type: 'Polygon', coordinates: [] },
      tags: {},
    },
  };

  const createPlan = (
    deficits: ExperienceAcquisitionPlan['deficits'],
  ): ExperienceAcquisitionPlan => ({
    destination: { destinationName: 'Test Destination' },
    deficits,
    evidenceRequirements: [],
    sourcePlans: [],
    breadth: 'focused',
  });

  beforeEach(() => {
    mockExperienceAcquisition = {
      executePlan: jest.fn().mockResolvedValue({
        candidates: [{ title: 'Component A' }],
        observations: [],
        providerResults: {},
        webResults: [],
      }),
      materializeExecution: jest.fn().mockResolvedValue({
        resolved: [],
        accepted: [],
        rejected: [],
      }),
    };
    generationService = Object.assign(
      Object.create(ExperienceGenerationService.prototype),
      {
        experienceAcquisition: mockExperienceAcquisition,
        logger: {
          log: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          debug: jest.fn(),
        },
      },
    );
    traceRecorder = new GenerationTraceRecorder();
    providerState = { attempted: new Set(), failed: new Set() };
    executionLedger = { executedSourcePlanFingerprints: new Set() };
  });

  const facet = (dimension: string, key: string): RequestedFacet => ({
    dimension,
    key,
    weight: 1,
    source: 'wizard',
    required: false,
  });

  // The generic partition of a route_like request: the request's own
  // intent:route_like deficit was routed to area_route_walk, so the generic
  // plan carries only theme:wine + intent:visit (canonical COLD #7 shape).
  const genericPartitionPlan = () =>
    createPlan([
      {
        origin: 'preference_facet',
        dimension: 'theme',
        key: 'wine',
        reason: 'needed',
      },
      {
        origin: 'preference_facet',
        dimension: 'intent',
        key: 'visit',
        reason: 'needed',
      },
    ]);

  const execute = (
    plan: ExperienceAcquisitionPlan,
    facets: RequestedFacet[],
    strategy: 'generic' | 'planner_capacity' = 'generic',
  ) =>
    (generationService as any).executeAndMaterializeAcquisitionPlan(
      plan,
      1,
      {
        destinationName: 'Test Destination',
        destinationCountryCode: 'AR',
        geographicScope: dummyScope,
        validationIntent: validationIntentOf(
          deriveRequestValidationIntent(facets),
        ),
      },
      traceRecorder,
      providerState,
      executionLedger,
      strategy,
    );

  const materializedValidationIntent = () =>
    mockExperienceAcquisition.materializeExecution.mock.calls[0][1]
      .validationIntent;

  it('Case A: generic pass preserves request route_like although the generic plan has no route_like deficit', async () => {
    await execute(genericPartitionPlan(), [
      facet('theme', 'wine'),
      facet('intent', 'visit'),
      facet('intent', 'route_like'),
    ]);

    expect(mockExperienceAcquisition.materializeExecution).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        destinationName: 'Test Destination',
        validationIntent: 'route_like',
      }),
    );
  });

  it('Case B: generic pass preserves request walk although the generic plan has no walk deficit', async () => {
    await execute(genericPartitionPlan(), [
      facet('theme', 'wine'),
      facet('intent', 'walk'),
    ]);

    expect(materializedValidationIntent()).toBe('walk');
  });

  it('Case C: no request geographic intent yields undefined', async () => {
    await execute(genericPartitionPlan(), [
      facet('theme', 'wine'),
      facet('intent', 'visit'),
    ]);

    expect(materializedValidationIntent()).toBeUndefined();
  });

  it('Case D: mixed walk + route_like request fails closed to undefined', async () => {
    await execute(genericPartitionPlan(), [
      facet('intent', 'walk'),
      facet('intent', 'route_like'),
    ]);

    expect(materializedValidationIntent()).toBeUndefined();
  });

  it('never re-derives intent from strategy-local plan deficits', async () => {
    const planWithRouteDeficit = createPlan([
      {
        origin: 'preference_facet',
        dimension: 'intent',
        key: 'route_like',
        reason: 'needed',
      },
    ]);

    await execute(planWithRouteDeficit, [facet('theme', 'wine')]);

    expect(materializedValidationIntent()).toBeUndefined();
  });

  it('Case E: the same request intent reaches materialization unchanged across acquisition strategies', async () => {
    const facets = [facet('theme', 'wine'), facet('intent', 'route_like')];

    await execute(genericPartitionPlan(), facets, 'generic');
    await execute(
      createPlan([
        {
          origin: 'global_capacity',
          reason: 'planner residual capacity',
          currentEligibleCount: 3,
          requiredEligibleCount: 4,
        },
      ]),
      facets,
      'planner_capacity',
    );

    const intents =
      mockExperienceAcquisition.materializeExecution.mock.calls.map(
        ([, context]) => context.validationIntent,
      );
    expect(intents).toEqual(['route_like', 'route_like']);
  });
});
