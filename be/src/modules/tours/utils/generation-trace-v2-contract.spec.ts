import {
  buildDiscoveryStep,
  buildEntityResolutionStep,
  buildTourCompletenessStep,
  buildGeographicValidationStep,
} from './generation-trace-builder.util';
import { ExperienceResolutionResponse } from '../interfaces/experience-resolution.interface';
import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';
import {
  GeographicValidationStatus,
  GeographicDecisionReason,
} from '../interfaces/geographic-validation.interface';

describe('GenerationTrace V2 decision audit coverage', () => {
  it('projects the actual entity-resolution attempt chain without fabricated strategies', () => {
    const result: any = {
      totalCandidates: 1,
      acceptedCount: 0,
      rejectedCount: 1,
      resolved: [
        {
          candidate: {
            name: 'Farmacia la Estrella',
            themes: [],
            traits: [],
            evidenceKeys: ['e1'],
            shortReason: 'test',
            componentHints: [
              {
                key: 'h1',
                name: 'Farmacia la Estrella',
                role: 'venue',
                expectedKind: 'PLACE',
                required: true,
                evidenceKeys: ['e1'],
              },
            ],
          },
          status: 'rejected',
          resolvedEntities: [],
          rejectionReasons: ['UNRESOLVED_REQUIRED_COMPONENT'],
          forensicAudit: {
            candidateName: 'Farmacia la Estrella',
            candidateEvidenceKeys: ['e1'],
            candidateHintKeys: ['h1'],
            componentAudits: [
              {
                hintKey: 'h1',
                hintName: 'Farmacia la Estrella',
                role: 'venue',
                expectedKind: 'PLACE',
                required: true,
                evidenceKeys: ['e1'],
                attempts: [
                  {
                    strategy: 'LOCAL_OSM_POOL',
                    executionStatus: 'completed',
                    provider: 'openstreetmap',
                    poolCandidateCount: 1,
                    candidateAcquired: true,
                    selectedCandidate: {
                      canonicalName: 'Farmacia la Estrella',
                      externalId: 'osm:node:1',
                      kind: 'PLACE',
                    },
                    identityEvidence: [{ type: 'WIKIDATA_UNAVAILABLE' }],
                    verificationDecision: 'INSUFFICIENT_EVIDENCE',
                  },
                  {
                    strategy: 'NOMINATIM',
                    executionStatus: 'completed',
                    provider: 'nominatim',
                    candidateAcquired: false,
                    identityEvidence: [],
                  },
                ],
                finalStatus: 'unresolved',
                finalReason: 'UNCONFIRMED_MATCH',
              },
            ],
          },
        },
      ],
      forensicAudit: [
        {
          candidateTraceKey: 'candidate:farmacia-la-estrella',
          candidateName: 'Farmacia la Estrella',
          candidateEvidenceKeys: ['e1'],
          candidateHintKeys: ['h1'],
          componentAudits: [
            {
              hintKey: 'h1',
              hintName: 'Farmacia la Estrella',
              role: 'venue',
              expectedKind: 'PLACE',
              required: true,
              evidenceKeys: ['e1'],
              attempts: [
                {
                  strategy: 'LOCAL_OSM_POOL',
                  executionStatus: 'completed',
                  provider: 'openstreetmap',
                  poolCandidateCount: 1,
                  candidateAcquired: true,
                  selectedCandidate: {
                    canonicalName: 'Farmacia la Estrella',
                    externalId: 'osm:node:1',
                    kind: 'PLACE',
                  },
                  identityEvidence: [{ type: 'WIKIDATA_UNAVAILABLE' }],
                  verificationDecision: 'INSUFFICIENT_EVIDENCE',
                },
                {
                  strategy: 'NOMINATIM',
                  executionStatus: 'completed',
                  provider: 'nominatim',
                  candidateAcquired: false,
                  identityEvidence: [],
                },
              ],
              finalStatus: 'unresolved',
              finalReason: 'UNCONFIRMED_MATCH',
            },
          ],
        },
      ],
    };

    result.entityResolution = {
      totalCandidates: result.totalCandidates,
      acceptedCount: result.acceptedCount,
      rejectedCount: result.rejectedCount,
      resolved: result.resolved,
      forensicAudit: result.forensicAudit,
    };
    delete result.forensicAudit;
    const step = buildEntityResolutionStep(result);
    const hint = step.entityResolutionAudit?.[0].hints[0];
    expect(hint?.attempts).toHaveLength(2);
    expect(hint?.attempts?.[0].verificationDecision).toBe(
      'INSUFFICIENT_EVIDENCE',
    );
    expect(hint?.attempts?.[0].candidateAcquired).toBe(true);
    expect(hint?.attempts?.[1].candidateAcquired).toBe(false);
    expect(
      hint?.attempts?.some((attempt) => attempt.strategy === 'PLACES'),
    ).toBe(false);
  });

  it('records grounded discovery provenance and the resolution handoff', () => {
    const result: any = {
      candidates: [
        {
          name: 'Whale watching excursion',
          themes: ['nature', 'wildlife'],
          componentHints: [
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
    expect(step.decision?.outcome).toBe('CANDIDATES_READY_FOR_RESOLUTION');
    expect(step.decision?.triggeredActions).toContain('RESOLVE_ENTITIES');
    expect(step.candidateDecisions?.[0]).toEqual(
      expect.objectContaining({
        name: 'Whale watching excursion',
        status: 'ELIGIBLE',
        reasonCodes: ['CANDIDATE_PENDING_RESOLUTION'],
      }),
    );
  });

  it('keeps entity resolution rejection reasons attached to the rejected candidate', () => {
    const result: ExperienceResolutionResponse = {
      totalCandidates: 1,
      acceptedCount: 0,
      rejectedCount: 1,
      resolved: [
        {
          candidate: {
            name: 'Invented route',
            themes: ['history'],
            traits: [],
            componentHints: [],
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

  it('preserves forensic geographic decision evidence in trace contract', () => {
    const candidate: ExperienceCandidate = {
      name: 'Historic Walk',
      themes: ['history'],
      traits: [],
      evidenceKeys: ['ev'],
      shortReason: 'test',
      componentHints: [
        {
          key: 'v1',
          name: 'Venue 1',
          role: 'venue',
          expectedKind: 'PLACE',
          evidenceKeys: ['ev'],
        },
        {
          key: 'v2',
          name: 'Venue 2',
          role: 'venue',
          expectedKind: 'PLACE',
          evidenceKeys: ['ev'],
        },
      ],
    };
    const entities = [
      {
        hintKey: 'v1',
        hintName: 'Venue 1',
        role: 'venue',
        provider: 'osm',
        externalId: 'v1',
        geoEntityId: 'geo-v1',
        status: 'resolved',
      },
      {
        hintKey: 'v2',
        hintName: 'Venue 2',
        role: 'venue',
        provider: 'osm',
        externalId: 'v2',
        geoEntityId: 'geo-v2',
        status: 'resolved',
      },
    ];
    const validation = {
      proposalName: candidate.name,
      kind: 'EXPERIENCE',
      status: 'REJECTED' as GeographicValidationStatus,
      accepted: false,
      validatorVersion: 1,
      groundedEvidenceKeys: ['ev'],
      rejectionReasons: ['destination_mismatch'],
      anchors: [entities[0]] as any,
      decisionEntities: [
        {
          hintKey: 'v1',
          geoEntityId: 'geo-v1',
          relation: 'evaluated' as const,
        },
        {
          hintKey: 'v2',
          geoEntityId: 'geo-v2',
          relation: 'offending' as const,
          decisionReason:
            'OUTSIDE_DESTINATION_BOUNDARY' as GeographicDecisionReason,
          distanceToBoundaryMeters: 83.4,
        },
      ],
    };
    const resolution = {
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
        results: [validation],
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
        validationIntent: 'walk' as const,
        destinationBoundary: {
          name: 'San Telmo',
          externalId: 'osm:relation:2223069',
        },
      },
      validationIntent: 'walk' as const,
      destinationBoundary: {
        name: 'San Telmo',
        externalId: 'osm:relation:2223069',
      },
    };

    const step = buildGeographicValidationStep(resolution);

    // Native audit preserves forensic fields
    const audit = step.geographicValidationAudit![0];
    expect(audit.validationIntent).toBe('walk');
    expect(audit.destinationBoundary).toEqual({
      name: 'San Telmo',
      externalId: 'osm:relation:2223069',
    });

    const offending = audit.components.find((c) => c.relation === 'offending');
    expect(offending).toBeDefined();
    expect(offending!.decisionReason).toBe('OUTSIDE_DESTINATION_BOUNDARY');
    expect(offending!.distanceToBoundaryMeters).toBe(83.4);

    // Trace must not contain raw boundary geometry
    const serialized = JSON.stringify(step);
    expect(serialized).not.toContain('coordinates');
  });
});
