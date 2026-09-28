import { GenerationTraceRecorder } from './generation-trace-recorder.util';
import {
  recordAcquisitionLifecycle,
  projectEntityResolutionStepInput,
} from './experience-generation-trace.util';

describe('experience-generation-trace.util', () => {
  it('records decomposed acquisition lifecycle steps with proper parentId', () => {
    const recorder = new GenerationTraceRecorder();

    recordAcquisitionLifecycle(recorder, {
      passNumber: 1,
      strategy: 'generic',
      plan: {
        destination: {
          destinationName: 'Buenos Aires',
          latitude: -34.6,
          longitude: -58.38,
          radiusMeters: 5000,
        },
        deficits: [],
        evidenceRequirements: [],
        breadth: 'standard' as any,
        sourcePlans: [
          {
            provider: 'google_places' as const,
            places: { searchTypes: ['cafe'] },
          },
          {
            provider: 'web' as const,
            web: { query: 'cafes' },
          },
        ],
      },
      execution: {
        candidates: [
          {
            name: 'Cafe Tortoni',
            themes: ['cafe'],
            traits: [],
            evidenceKeys: ['ev1'],
            shortReason: 'historic cafe',
            componentHints: [
              {
                key: 'h1',
                name: 'Cafe Tortoni',
                role: 'venue',
                expectedKind: 'PLACE',
                evidenceKeys: ['ev1'],
              },
            ],
          },
        ],
        observations: [],
        evidence: [
          {
            key: 'ev1',
            source: 'web',
            title: 'Cafe Tortoni',
            snippet: 'A historic cafe',
            url: 'https://example.com/tortoni',
          },
        ],
        providerResults: {
          google_places: {
            status: 'success',
            value: [
              {
                provider: 'google_places',
                evidenceKey: 'p1',
                title: 'Places spot',
                sourceUrl: 'https://places.test',
                evidenceType: 'place',
                originationCapabilities: ['venue' as any],
              },
            ],
          },
        },
        webResults: [
          {
            status: 'success',
            query: 'cafes',
            groundedProvider: 'serper',
            evidenceKeys: ['ev1'],
            candidateCount: 1,
            validationErrors: [],
            candidateDecisions: [
              {
                candidate: {
                  name: 'Cafe Tortoni',
                  themes: ['cafe'],
                  traits: [],
                  evidenceKeys: ['ev1'],
                  shortReason: 'historic cafe',
                  componentHints: [],
                },
                accepted: true,
                reason: 'MATCHING_EVIDENCE_REQUIREMENT',
                requestedRequirements: [],
                candidateShapeMatches: [],
              },
            ],
          },
        ],
      },
      resolution: {
        totalCandidates: 1,
        acceptedCount: 1,
        rejectedCount: 0,
        resolved: [
          {
            candidate: {
              name: 'Cafe Tortoni',
              themes: ['cafe'],
              traits: [],
              evidenceKeys: ['ev1'],
              shortReason: 'historic cafe',
              componentHints: [],
            },
            status: 'accepted',
            experienceId: 'exp-tortoni',
            resolvedEntities: [],
            rejectionReasons: [],
          },
        ],
        geographicValidation: {
          acceptedCount: 1,
          rejectedCount: 0,
          results: [
            {
              kind: 'single_point',
              proposalName: 'Cafe Tortoni',
              accepted: true,
              status: 'GEO_VERIFIED',
              strategy: 'venue_centric',
              anchors: [],
              groundedEvidenceKeys: [],
              rejectionReasons: [],
              validatorVersion: 1,
            },
          ],
        },
        classification: [
          {
            experienceId: 'exp-tortoni',
            state: 'classified',
            provider: 'groq',
            model: 'llama3',
            promptVersion: 1,
            themes: ['cafe'],
            intents: ['relax'],
            traits: ['historic'],
            reasoningEvidence: [
              {
                facet: 'theme:cafe',
                evidenceKeys: ['ev1'],
                reason: 'Classic atmosphere',
              },
            ],
          },
        ],
      },
    });

    const trace = recorder.build({
      canonicalRequest: {
        destination: { label: 'Buenos Aires' },
        days: 1,
        intent: { interests: [] },
      },
      result: {
        status: 'COMPLETED',
        outcome: 'SUCCESS',
      },
    });

    expect(trace.steps.length).toBeGreaterThan(5);

    // Parent pass step
    const passStep = trace.steps.find((s) => s.name === 'acquisition.pass');
    expect(passStep).toBeDefined();
    expect(passStep!.id).toBe('acquisition-pass-1-generic');

    // Child steps with parentId
    const planStep = trace.steps.find((s) => s.name === 'acquisition.plan');
    expect(planStep).toBeDefined();
    expect(planStep!.parentId).toBe(passStep!.id);

    const sourceStep = trace.steps.find(
      (s) => s.name === 'acquisition.structured_source',
    );
    expect(sourceStep).toBeDefined();
    expect(sourceStep!.parentId).toBe(passStep!.id);

    const webStep = trace.steps.find(
      (s) => s.name === 'acquisition.web_search',
    );
    expect(webStep).toBeDefined();
    expect(webStep!.parentId).toBe(passStep!.id);

    const entityStep = trace.steps.find((s) => s.name === 'resolution.entity');
    expect(entityStep).toBeDefined();
    expect(entityStep!.parentId).toBe(passStep!.id);

    const geoStep = trace.steps.find((s) => s.name === 'geography.validation');
    expect(geoStep).toBeDefined();
    expect(geoStep!.parentId).toBe(passStep!.id);

    const catalogStep = trace.steps.find(
      (s) => s.name === 'catalog.materialization',
    );
    expect(catalogStep).toBeDefined();
    expect(catalogStep!.parentId).toBe(passStep!.id);

    const classificationStep = trace.steps.find(
      (s) => s.name === 'classification.semantic',
    );
    expect(classificationStep).toBeDefined();
    expect(classificationStep!.parentId).toBe(passStep!.id);
    expect((classificationStep!.facts as any).provider).toBe('groq');
    expect((classificationStep!.facts as any).state).toBe('classified');
  });

  it('records classification degradation failure provenance in native v5 step', () => {
    const recorder = new GenerationTraceRecorder();

    recordAcquisitionLifecycle(recorder, {
      passNumber: 1,
      strategy: 'generic',
      plan: {
        destination: {
          destinationName: 'Buenos Aires',
          latitude: 0,
          longitude: 0,
          radiusMeters: 1000,
        },
        deficits: [],
        evidenceRequirements: [],
        breadth: 'standard' as any,
        sourcePlans: [],
      },
      execution: {
        candidates: [],
        observations: [],
        evidence: [],
        providerResults: {},
      },
      resolution: {
        totalCandidates: 1,
        acceptedCount: 1,
        rejectedCount: 0,
        resolved: [
          {
            candidate: {
              name: 'Degraded Spot',
              themes: [],
              traits: [],
              evidenceKeys: [],
              shortReason: 'degraded',
              componentHints: [],
            },
            status: 'accepted',
            experienceId: 'exp-degraded',
            resolvedEntities: [],
            rejectionReasons: [],
          },
        ],
        geographicValidation: {
          acceptedCount: 0,
          rejectedCount: 0,
          results: [],
        },
        classification: [
          {
            experienceId: 'exp-degraded',
            state: 'degraded',
            provider: 'groq',
            themes: [],
            intents: [],
            traits: [],
            reasoningEvidence: [],
            failure: {
              stage: 'provider_call',
              reason: 'PROVIDER_UNAVAILABLE',
              httpStatus: 503,
              providerStatus: 'UNAVAILABLE',
            },
          },
        ],
      },
    });

    const trace = recorder.build({
      canonicalRequest: {},
      result: {
        status: 'COMPLETED',
        outcome: 'SUCCESS',
      },
    });

    const classificationStep = trace.steps.find(
      (s) => s.name === 'classification.semantic',
    );
    expect(classificationStep).toBeDefined();
    expect(classificationStep!.decision?.status).toBe('WARN');
    expect(classificationStep!.decision?.reasonCodes).toEqual([
      'PROVIDER_UNAVAILABLE',
    ]);
    expect((classificationStep!.facts as any).failure).toMatchObject({
      reason: 'PROVIDER_UNAVAILABLE',
      stage: 'provider_call',
      httpStatus: 503,
      providerStatus: 'UNAVAILABLE',
    });
  });

  it('projects entity resolution step input with candidateTraceKey', () => {
    const input = projectEntityResolutionStepInput({
      totalCandidates: 2,
      acceptedCount: 1,
      rejectedCount: 1,
      resolved: [
        {
          candidate: {
            name: 'Accepted Spot',
            themes: [],
            traits: [],
            evidenceKeys: [],
            shortReason: 'good',
            componentHints: [],
          },
          status: 'accepted',
          experienceId: 'exp-1',
          resolvedEntities: [],
          rejectionReasons: [],
        },
        {
          candidate: {
            name: 'Rejected Spot',
            themes: [],
            traits: [],
            evidenceKeys: [],
            shortReason: 'bad',
            componentHints: [],
          },
          status: 'rejected',
          resolvedEntities: [],
          rejectionReasons: ['NO_RESOLVED_GEO_ENTITIES'],
        },
      ],
      entityResolution: {
        totalCandidates: 2,
        acceptedCount: 1,
        rejectedCount: 1,
        resolved: [],
        forensicAudit: [
          {
            candidateTraceKey: 'candidate:rejected-spot',
            candidateName: 'Rejected Spot',
            candidateEvidenceKeys: [],
            candidateHintKeys: [],
            componentAudits: [],
          },
        ],
      },
    });

    expect(input.name).toBe('resolution.entity');
    expect(input.decision?.status).toBe('PASS');
    expect(input.decision?.outcome).toBe('ENTITIES_RESOLVED');
    expect(input.subjects).toHaveLength(2);
    expect(input.subjects![0].decision.status).toBe('PASS');
    expect(input.subjects![1].decision.status).toBe('FAIL');
    expect(input.subjects![1].decision.reasonCodes).toEqual([
      'NO_RESOLVED_GEO_ENTITIES',
    ]);
  });
});
