import { ExperienceGenerationService } from './experience-generation.service';
import { GenerationTraceRecorder } from '../utils/generation-trace-recorder.util';
import { AcquisitionExecutionLedger } from '../utils/acquisition-source-plan-fingerprint.util';
import { GeographicScope } from '../interfaces/experience-resolution.interface';
import {
  AcquisitionDeficit,
  ExperienceAcquisitionPlan,
} from '../interfaces/experience-acquisition-plan.interface';
import {
  DedicatedIntentWorkUnit,
  GenericWorkUnit,
  partitionDeficitsIntoWorkUnits,
  PlannerCapacityWorkUnit,
} from '../utils/acquisition-strategy-selector.util';
import { geographicIntentDeficit } from '../fixtures/geographic-authorization.fixture';

/**
 * Geographic authorization is owned by the acquisition work unit that
 * produced an execution -- never derived once for the whole tour request
 * (docs/superpowers/specs/2026-10-02-geographic-validation-authorization-review.md).
 * These cases prove the shared generic/dedicated/planner seam hands
 * materialization exactly that unit's grant.
 */
describe('ExperienceGenerationService acquisition orchestration (work-unit geographic grant)', () => {
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

  const wine: AcquisitionDeficit = {
    origin: 'preference_facet',
    dimension: 'theme',
    key: 'wine',
    reason: 'needed',
  };
  const visit: AcquisitionDeficit = {
    origin: 'preference_facet',
    dimension: 'intent',
    key: 'visit',
    reason: 'needed',
  };

  const execute = (
    unit: GenericWorkUnit | DedicatedIntentWorkUnit | PlannerCapacityWorkUnit,
  ) =>
    (generationService as any).executeAndMaterializeAcquisitionPlan(
      createPlan(unit.kind === 'GENERIC' ? unit.deficits : [unit.deficit]),
      1,
      {
        destinationName: 'Test Destination',
        destinationCountryCode: 'AR',
        geographicScope: dummyScope,
      },
      traceRecorder,
      providerState,
      executionLedger,
      unit,
    );

  const materializedContexts = () =>
    mockExperienceAcquisition.materializeExecution.mock.calls.map(
      ([, context]) => context,
    );

  it('D: the generic wine+visit unit grants NONE although route_like is open in the same pass (COLD #7 shape)', async () => {
    const units = partitionDeficitsIntoWorkUnits(
      [wine, visit, geographicIntentDeficit('route_like')],
      [],
    );
    const generic = units.find(
      (unit): unit is GenericWorkUnit => unit.kind === 'GENERIC',
    )!;

    await execute(generic);

    expect(materializedContexts()[0]).toEqual(
      expect.objectContaining({
        destinationName: 'Test Destination',
        geographicGrant: { kind: 'NONE' },
      }),
    );
    expect(materializedContexts()[0]).not.toHaveProperty('validationIntent');
  });

  it('A: a DEDICATED_INTENT route_like unit grants route_like from its own owned deficit', async () => {
    const routeLike = geographicIntentDeficit('route_like');

    await execute({ kind: 'DEDICATED_INTENT', deficit: routeLike });

    expect(materializedContexts()[0].geographicGrant).toEqual({
      kind: 'OWNED_INTENT',
      intent: 'route_like',
      ownedDeficit: routeLike,
      workUnit: 'DEDICATED_INTENT',
    });
  });

  it('B: a DEDICATED_INTENT walk unit grants walk from its own owned deficit', async () => {
    const walk = geographicIntentDeficit('walk');

    await execute({ kind: 'DEDICATED_INTENT', deficit: walk });

    expect(materializedContexts()[0].geographicGrant).toEqual({
      kind: 'OWNED_INTENT',
      intent: 'walk',
      ownedDeficit: walk,
      workUnit: 'DEDICATED_INTENT',
    });
  });

  it('C: walk + route_like + visit execute as independent units, each with its own grant -- no MIXED_UNSUPPORTED', async () => {
    const units = partitionDeficitsIntoWorkUnits(
      [
        geographicIntentDeficit('walk'),
        geographicIntentDeficit('route_like'),
        visit,
      ],
      [],
    );

    for (const unit of units) {
      if (unit.kind === 'AREA_ROUTE_WALK') throw new Error('no anchor given');
      await execute(unit);
    }

    expect(
      materializedContexts().map((context) =>
        context.geographicGrant.kind === 'NONE'
          ? 'NONE'
          : `${context.geographicGrant.workUnit}:${context.geographicGrant.intent}`,
      ),
    ).toEqual(['DEDICATED_INTENT:walk', 'DEDICATED_INTENT:route_like', 'NONE']);
    expect(
      mockExperienceAcquisition.executePlan.mock.calls.map(([plan]) =>
        plan.deficits.map((deficit: AcquisitionDeficit) =>
          deficit.origin === 'preference_facet'
            ? `${deficit.dimension}:${deficit.key}`
            : deficit.origin,
        ),
      ),
    ).toEqual([['intent:walk'], ['intent:route_like'], ['intent:visit']]);
  });

  it('I: a PLANNER_CAPACITY unit grants NONE even when the tour requested route_like', async () => {
    await execute({
      kind: 'PLANNER_CAPACITY',
      deficit: {
        origin: 'global_capacity',
        reason: 'planner residual capacity',
        currentEligibleCount: 3,
        requiredEligibleCount: 4,
      },
    });

    expect(materializedContexts()[0].geographicGrant).toEqual({ kind: 'NONE' });
  });

  it('records each unit with its own strategy label, work unit and grant in the trace', async () => {
    await execute({
      kind: 'DEDICATED_INTENT',
      deficit: geographicIntentDeficit('route_like'),
    });
    await execute({ kind: 'GENERIC', deficits: [wine, visit] });

    const trace = traceRecorder.build({
      canonicalRequest: {},
      result: { status: 'COMPLETED', outcome: 'COMPLETED' },
    } as any);
    const passes = trace.steps.filter(
      (step: any) => step.name === 'acquisition.pass',
    );
    expect(passes.map((step: any) => step.id)).toEqual([
      'acquisition-pass-1-dedicated_intent-route-like',
      'acquisition-pass-1-generic',
    ]);
    expect(passes.map((step: any) => step.facts.geographicGrant)).toEqual([
      {
        kind: 'OWNED_INTENT',
        intent: 'route_like',
        workUnit: 'DEDICATED_INTENT',
        ownedDeficit: 'intent:route_like',
      },
      { kind: 'NONE' },
    ]);
  });
});
