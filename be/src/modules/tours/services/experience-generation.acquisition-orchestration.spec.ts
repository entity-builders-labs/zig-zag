import { ExperienceGenerationService } from './experience-generation.service';
import { GenerationTraceRecorder } from '../utils/generation-trace-recorder.util';
import { AcquisitionExecutionLedger } from '../utils/acquisition-source-plan-fingerprint.util';
import { GeographicScope } from '../interfaces/experience-resolution.interface';
import { ExperienceAcquisitionPlan } from '../interfaces/experience-acquisition-plan.interface';

describe('ExperienceGenerationService acquisition orchestration (validationIntent derivation)', () => {
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

  it('derives validationIntent: "route_like" when plan has preference_facet route_like deficit', async () => {
    const plan = createPlan([
      {
        origin: 'preference_facet',
        dimension: 'intent',
        key: 'route_like',
        reason: 'needed',
      },
    ]);

    await (generationService as any).executeAndMaterializeAcquisitionPlan(
      plan,
      1,
      {
        destinationName: 'Test Destination',
        destinationCountryCode: 'AR',
        geographicScope: dummyScope,
      },
      traceRecorder,
      providerState,
      executionLedger,
      'generic',
    );

    expect(mockExperienceAcquisition.materializeExecution).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        destinationName: 'Test Destination',
        validationIntent: 'route_like',
      }),
    );
  });

  it('derives validationIntent: "walk" when plan has preference_facet walk deficit', async () => {
    const plan = createPlan([
      {
        origin: 'preference_facet',
        dimension: 'intent',
        key: 'walk',
        reason: 'needed',
      },
    ]);

    await (generationService as any).executeAndMaterializeAcquisitionPlan(
      plan,
      1,
      {
        destinationName: 'Test Destination',
        destinationCountryCode: 'AR',
        geographicScope: dummyScope,
      },
      traceRecorder,
      providerState,
      executionLedger,
      'generic',
    );

    expect(mockExperienceAcquisition.materializeExecution).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        destinationName: 'Test Destination',
        validationIntent: 'walk',
      }),
    );
  });

  it('derives validationIntent: undefined when plan has no route_like or walk deficits', async () => {
    const plan = createPlan([
      {
        origin: 'preference_facet',
        dimension: 'theme',
        key: 'wine',
        reason: 'needed',
      },
    ]);

    await (generationService as any).executeAndMaterializeAcquisitionPlan(
      plan,
      1,
      {
        destinationName: 'Test Destination',
        destinationCountryCode: 'AR',
        geographicScope: dummyScope,
      },
      traceRecorder,
      providerState,
      executionLedger,
      'generic',
    );

    expect(mockExperienceAcquisition.materializeExecution).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        destinationName: 'Test Destination',
        validationIntent: undefined,
      }),
    );
  });

  it('fails closed with validationIntent: undefined and logs warning when plan contains mixed intent deficits (both route_like and walk)', async () => {
    const plan = createPlan([
      {
        origin: 'preference_facet',
        dimension: 'intent',
        key: 'route_like',
        reason: 'needed',
      },
      {
        origin: 'preference_facet',
        dimension: 'intent',
        key: 'walk',
        reason: 'needed',
      },
    ]);

    await (generationService as any).executeAndMaterializeAcquisitionPlan(
      plan,
      1,
      {
        destinationName: 'Test Destination',
        destinationCountryCode: 'AR',
        geographicScope: dummyScope,
      },
      traceRecorder,
      providerState,
      executionLedger,
      'generic',
    );

    expect(mockExperienceAcquisition.materializeExecution).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        destinationName: 'Test Destination',
        validationIntent: undefined,
      }),
    );
    expect((generationService as any).logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Unsupported mixed intent deficits'),
    );
  });
});
