import { ExperienceGenerationService } from './experience-generation.service';
import { NormalizedPreferenceIntent } from '../interfaces/preference-interpretation.interface';
import {
  DietaryRestriction,
  TourGenerationRequest,
} from '../interfaces/tour-generation.interface';
import {
  PreferenceAssertion,
  UnresolvedPreferenceConcept,
} from '../preferences/preference-assertion.interface';

const REQUEST = {
  contractVersion: 1,
  destination: {
    label: 'Buenos Aires',
    latitude: -34.6037,
    longitude: -58.3816,
  },
  days: 1,
  intent: {
    interests: ['history'],
    intents: [],
    explorationStyle: 'balanced',
    additionalPreferences: 'fixture text',
  },
  mobility: {
    allowedTransportationModes: ['walking'],
    travelPace: 'moderate',
    accessibilityNeeds: [],
  },
  dietaryRestrictions: [],
  startDates: [],
} as unknown as TourGenerationRequest;

function interpreted(
  overrides: Partial<NormalizedPreferenceIntent> = {},
): NormalizedPreferenceIntent {
  return {
    assertions: [],
    unresolvedConcepts: [],
    anchoredPlaces: [],
    softConstraints: [],
    ambiguities: [],
    accessibilityPreferences: [],
    budgetPreferences: [],
    groupPreferences: [],
    positiveSemanticQuery: '',
    notes: [],
    ...overrides,
  };
}

function concept(
  polarity: UnresolvedPreferenceConcept['polarity'],
  constraint: UnresolvedPreferenceConcept['constraint'],
): UnresolvedPreferenceConcept {
  return {
    label: 'religious sites',
    polarity,
    constraint,
    evidence: [{ kind: 'USER_TEXT_SPAN', text: 'fixture' }],
    reason: 'UNRESOLVED_OPEN_CONCEPT',
  };
}

function historyExclusion(
  constraint: PreferenceAssertion['constraint'],
): PreferenceAssertion {
  return {
    target: { dimension: 'theme', key: 'history' },
    polarity: 'EXCLUDE',
    constraint,
    provenance: 'INFERRED',
    importance: 0.7,
    confidence: 0.8,
    evidence: [{ kind: 'USER_TEXT_SPAN', text: 'fixture' }],
  };
}

/**
 * Runs generation up to the first boundary after the hard-constraint gate:
 * destination resolution. A request that passes the gate reaches it (the
 * mock then stops generation); one that fails the gate never does.
 */
function harness(
  request: TourGenerationRequest,
  intent: NormalizedPreferenceIntent,
) {
  const tourUpdates: any[] = [];
  const resolveDestination = jest.fn(async () => {
    throw new Error('STOP_AFTER_GATE');
  });
  const service = Object.assign(
    Object.create(ExperienceGenerationService.prototype),
    {
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      toursService: {
        findOne: jest.fn(async () => ({
          id: 'tour-1',
          prompt: 'fixture',
          metadata: { generationRequest: request },
          experiences: [] as unknown[],
        })),
      },
      updateGenerationStatus: jest.fn(async (): Promise<void> => undefined),
      preferenceInterpreter: {
        interpret: jest.fn(async () => ({
          intent,
          trace: {
            stage: 'preference_interpretation',
            systemPrompt: '',
            userPrompt: '',
            responseSchema: {},
            parsedResponse: intent,
            validationErrors: [] as string[],
            status: 'applied',
            durationMs: 0,
          },
        })),
      },
      destinationResolutionService: { resolveDestination },
      prisma: {
        $transaction: jest.fn(async (callback: any) =>
          callback({
            tour: {
              update: jest.fn(async (args: any) => tourUpdates.push(args)),
            },
          }),
        ),
      },
    },
  ) as ExperienceGenerationService;
  return { service, resolveDestination, tourUpdates };
}

const failedTrace = (tourUpdates: any[]) =>
  tourUpdates[tourUpdates.length - 1].data.metadata.generationTrace;

describe('ExperienceGenerationService hard-constraint gate (task 25.4)', () => {
  it('ends a typed vegan restriction with HARD_EXCLUSION_UNENFORCEABLE before destination resolution', async () => {
    const { service, resolveDestination, tourUpdates } = harness(
      { ...REQUEST, dietaryRestrictions: [DietaryRestriction.VEGAN] },
      interpreted(),
    );

    await expect(service.generateTourExperiences('tour-1')).rejects.toThrow(
      /HARD_EXCLUSION_UNENFORCEABLE/,
    );
    expect(resolveDestination).not.toHaveBeenCalled();
    const trace = failedTrace(tourUpdates);
    expect(trace.result.outcome).toBe('HARD_EXCLUSION_UNENFORCEABLE');
    expect(trace.result.facts.unenforceableHardConstraints).toEqual([
      expect.objectContaining({
        target: { dimension: 'dietary_suitability', key: 'vegan' },
        missingKnowledge: 'CLASSIFICATION_COMPLETENESS',
      }),
    ]);
  });

  it('ends a HARD unresolved exclusion with HARD_EXCLUSION_UNENFORCEABLE (unknown is never compatible)', async () => {
    const { service, resolveDestination, tourUpdates } = harness(
      REQUEST,
      interpreted({ unresolvedConcepts: [concept('EXCLUDE', 'HARD')] }),
    );

    await expect(service.generateTourExperiences('tour-1')).rejects.toThrow(
      /HARD_EXCLUSION_UNENFORCEABLE/,
    );
    expect(resolveDestination).not.toHaveBeenCalled();
    expect(failedTrace(tourUpdates).result.outcome).toBe(
      'HARD_EXCLUSION_UNENFORCEABLE',
    );
  });

  it('lets an INCLUDE unresolved concept and a SOFT exclusion through to destination resolution', async () => {
    const { service, resolveDestination, tourUpdates } = harness(
      REQUEST,
      interpreted({
        unresolvedConcepts: [
          concept('INCLUDE', 'SOFT'),
          concept('EXCLUDE', 'SOFT'),
        ],
      }),
    );

    await expect(service.generateTourExperiences('tour-1')).rejects.toThrow(
      /STOP_AFTER_GATE/,
    );
    expect(resolveDestination).toHaveBeenCalledTimes(1);
    expect(failedTrace(tourUpdates).result.outcome).toBe('GENERATION_FAILED');
  });

  it('stops INCLUDE + HARD EXCLUDE of one target with AMBIGUOUS_HARD_CONSTRAINT before destination resolution', async () => {
    // REQUEST selects the history interest (structured DIRECT INCLUDE).
    const { service, resolveDestination, tourUpdates } = harness(
      REQUEST,
      interpreted({ assertions: [historyExclusion('HARD')] }),
    );

    await expect(service.generateTourExperiences('tour-1')).rejects.toThrow(
      /AMBIGUOUS_HARD_CONSTRAINT/,
    );
    expect(resolveDestination).not.toHaveBeenCalled();
    const trace = failedTrace(tourUpdates);
    expect(trace.result.outcome).toBe('AMBIGUOUS_HARD_CONSTRAINT');
    expect(trace.result.facts.ambiguousHardConstraints).toEqual([
      expect.objectContaining({
        target: { dimension: 'theme', key: 'history' },
        blocking: true,
        include: expect.objectContaining({
          provenance: 'DIRECT',
          evidence: [
            {
              kind: 'STRUCTURED_SELECTION',
              field: 'intent.interests',
              value: 'history',
            },
          ],
        }),
        exclude: expect.objectContaining({
          constraint: 'HARD',
          provenance: 'INFERRED',
          evidence: [{ kind: 'USER_TEXT_SPAN', text: 'fixture' }],
        }),
      }),
    ]);
    const step = trace.steps.find(
      (candidate: any) => candidate.name === 'preference.hard_constraints',
    );
    expect(step.decision.outcome).toBe('AMBIGUOUS_HARD_CONSTRAINT');
  });

  it('neutralizes INCLUDE + SOFT EXCLUDE of one target and continues to destination resolution', async () => {
    const { service, resolveDestination, tourUpdates } = harness(
      REQUEST,
      interpreted({ assertions: [historyExclusion('SOFT')] }),
    );

    await expect(service.generateTourExperiences('tour-1')).rejects.toThrow(
      /STOP_AFTER_GATE/,
    );
    expect(resolveDestination).toHaveBeenCalledTimes(1);
    const intentStep = failedTrace(tourUpdates).steps.find(
      (candidate: any) => candidate.name === 'request.intent',
    );
    const polarityRule = intentStep.rules.find(
      (rule: any) => rule.id === 'INTENT-POLARITY-001',
    );
    expect(polarityRule.status).toBe('WARN');
    expect(polarityRule.facts.conflicts).toEqual([
      expect.objectContaining({
        target: { dimension: 'theme', key: 'history' },
        blocking: false,
        includeProvenance: 'DIRECT',
        excludeProvenance: 'INFERRED',
        excludeEvidence: [{ kind: 'USER_TEXT_SPAN', text: 'fixture' }],
      }),
    ]);
    expect(intentStep.facts.facets).toEqual([]);
  });
});
