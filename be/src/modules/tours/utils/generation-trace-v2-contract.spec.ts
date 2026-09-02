import {
  buildDiscoveryStep,
  buildEntityResolutionStep,
  buildTourCompletenessStep,
} from './generation-trace-builder.util';
import { DiscoveryResponse } from '../interfaces/activity-discovery.interface';
import { ExperienceResolutionResponse } from '../interfaces/experience-resolution.interface';

describe('GenerationTrace V2 decision audit coverage', () => {
  it('records grounded discovery provenance and the resolution handoff', () => {
    const result: DiscoveryResponse = {
      proposals: [
        {
          name: 'Whale watching excursion',
          kind: 'EXPERIENCE',
          themes: ['nature', 'wildlife'],
          entityHints: [
            {
              key: 'venue-1',
              name: 'Whale watching excursion',
              role: 'venue',
              expectedType: 'tour_operator',
              required: true,
              evidenceKeys: ['e1'],
            },
          ],
          suggestedDurationMinutes: 240,
          shortReason: 'Matches the requested marine wildlife intent.',
          evidenceKeys: ['e1'],
        },
      ],
      provider: 'gemini',
      model: 'gemini-test',
      groundingStatus: 'applied',
      groundingProvider: 'serpapi',
      groundingModel: 'google_ai_mode',
      groundingEvidence: [
        {
          key: 'e1',
          source: 'search',
          snippet: 'Grounded evidence for a real whale watching excursion.',
        },
      ],
      searchTrace: [
        {
          query: 'real whale watching experiences near Puerto Madryn',
          targetKind: 'EXPERIENCE' as any,
          provider: 'serpapi',
          model: 'google_ai_mode',
          groundingStatus: 'applied',
          evidenceCount: 1,
        },
      ],
    };

    const step = buildDiscoveryStep(result);

    expect(step.component).toBe('ExperienceDiscoveryService');
    expect(
      step.rules?.find((rule) => rule.ruleId === 'DISC-GROUNDED-001')?.result,
    ).toBe('PASS');
    expect(step.decision?.outcome).toBe('PROPOSALS_READY_FOR_RESOLUTION');
    expect(step.decision?.triggeredActions).toContain('RESOLVE_ENTITIES');
    expect(step.candidateDecisions?.[0]).toEqual(
      expect.objectContaining({
        name: 'Whale watching excursion',
        status: 'ELIGIBLE',
        reasonCodes: ['PROPOSAL_PENDING_RESOLUTION'],
      }),
    );
  });

  it('keeps entity resolution rejection reasons attached to the rejected candidate', () => {
    const result: ExperienceResolutionResponse = {
      totalProposals: 1,
      acceptedCount: 0,
      rejectedCount: 1,
      resolved: [
        {
          proposal: {
            name: 'Invented route',
            themes: ['history'],
            traits: [],
            componentHints: [],
            entityHints: [],
            suggestedDurationMinutes: 90,
            shortReason: 'test',
            evidenceKeys: ['e1'],
          },
          status: 'rejected',
          resolvedEntities: [],
          rejectionReasons: ['missing_required_hint'],
        },
      ],
    };

    const step = buildEntityResolutionStep(result);

    expect(step.decision?.outcome).toBe('NO_PROPOSALS_RESOLVED');
    expect(step.decision?.reasonCodes).toContain('missing_required_hint');
    expect(step.candidateDecisions?.[0]).toEqual(
      expect.objectContaining({
        name: 'Invented route',
        status: 'REJECTED',
        reasonCodes: ['missing_required_hint'],
      }),
    );
  });

  it('records completeness shortfall as a warning instead of hiding it behind completed status', () => {
    const step = buildTourCompletenessStep(
      {
        complete: false,
        issues: [
          {
            code: 'UNDERFILLED_DAY',
            dayNumber: 2,
            selectedExperienceCount: 1,
            selectedExperienceHours: 1.5,
            viableUnusedCandidateCount: 2,
            travelPace: 'moderate' as any,
            message:
              'Day 2 is underfilled while viable unused candidates remain.',
          },
        ],
      },
      false,
    );

    expect(step.status).toBe('WARN');
    expect(step.decision?.outcome).toBe('TOUR_UNDERFILLED');
    expect(step.decision?.reasonCodes).toContain('UNDERFILLED_DAY');
    expect(
      step.rules?.find((rule) => rule.ruleId === 'COMP-DAY-USAGE-001')?.result,
    ).toBe('WARN');
  });

});
