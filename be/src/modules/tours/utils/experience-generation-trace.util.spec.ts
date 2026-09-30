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

  it('proves E: records acquisition.deep_source_selection between web_search and source_retrieval without recomputing scores', () => {
    const recorder = new GenerationTraceRecorder();

    const deepSourceSelection = {
      evidenceCount: 3,
      anchorNames: ['san-telmo'],
      selectionLimit: 2,
      selectedUrls: [
        'https://buenosaires.travel/san-telmo-walk',
        'https://travelblog.com/la-boca',
      ],
      items: [
        {
          evidenceKey: 'ev-1',
          title: 'San Telmo Walk',
          url: 'https://buenosaires.travel/san-telmo-walk',
          originalRank: 1,
          editorialEligible: true,
          tourContentScore: 15,
          citedCandidateBonus: 1,
          finalScore: 16,
          rankedPosition: 1,
          selected: true,
          decisionReason: 'SELECTED' as const,
        },
        {
          evidenceKey: 'ev-2',
          title: 'La Boca',
          url: 'https://travelblog.com/la-boca',
          originalRank: 2,
          editorialEligible: true,
          tourContentScore: 5,
          citedCandidateBonus: 0,
          finalScore: 5,
          rankedPosition: 2,
          selected: true,
          decisionReason: 'SELECTED' as const,
        },
        {
          evidenceKey: 'ev-3',
          title: 'Recoleta',
          url: 'https://other.com/recoleta',
          originalRank: 3,
          editorialEligible: true,
          tourContentScore: 5,
          citedCandidateBonus: 0,
          finalScore: 5,
          rankedPosition: 3,
          selected: false,
          decisionReason: 'BELOW_SELECTION_LIMIT' as const,
        },
      ],
    };

    recordAcquisitionLifecycle(recorder, {
      passNumber: 1,
      strategy: 'generic',
      plan: {
        destination: { destinationName: 'Buenos Aires' },
        deficits: [],
        evidenceRequirements: ['MULTI_COMPONENT_EXPERIENCE'],
        breadth: 'focused' as any,
        sourcePlans: [
          {
            provider: 'web' as const,
            web: { query: 'Buenos Aires walks', anchorNames: ['san-telmo'] },
          },
        ],
      },
      execution: {
        candidates: [],
        observations: [],
        evidence: [],
        providerResults: {},
        webResults: [
          {
            status: 'success',
            query: 'Buenos Aires walks',
            groundedProvider: 'tavily',
            evidenceKeys: ['ev-1', 'ev-2', 'ev-3'],
            candidateCount: 1,
            validationErrors: [],
            deepSourceSelection,
            sourceContentRetrieval: {
              attempted: true,
              provider: 'tavily',
              triggerReason: 'gap',
              requestedUrls: [
                'https://buenosaires.travel/san-telmo-walk',
                'https://travelblog.com/la-boca',
              ],
              retrievedUrls: ['https://buenosaires.travel/san-telmo-walk'],
              failedUrls: ['https://travelblog.com/la-boca'],
              items: [],
            },
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
      result: { status: 'COMPLETED', outcome: 'SUCCESS' },
    });

    const webSearchStep = trace.steps.find(
      (s) => s.name === 'acquisition.web_search',
    );
    const selectionStep = trace.steps.find(
      (s) => s.name === 'acquisition.deep_source_selection',
    );
    const retrievalStep = trace.steps.find(
      (s) => s.name === 'acquisition.source_retrieval',
    );

    expect(webSearchStep).toBeDefined();
    expect(selectionStep).toBeDefined();
    expect(retrievalStep).toBeDefined();

    // Verify ordering: web_search -> deep_source_selection -> source_retrieval
    expect(selectionStep!.sequence).toBeGreaterThan(webSearchStep!.sequence);
    expect(retrievalStep!.sequence).toBeGreaterThan(selectionStep!.sequence);

    // Parent ID
    expect(selectionStep!.parentId).toBe('acquisition-pass-1-generic');

    // Step input, decision, facts
    expect(selectionStep!.input).toEqual({
      evidenceCount: 3,
      anchorNames: ['san-telmo'],
      selectionLimit: 2,
    });
    expect(selectionStep!.decision).toEqual({
      status: 'PASS',
      outcome: 'SOURCES_SELECTED',
      reason: '2 fuentes seleccionadas para recuperación profunda.',
    });
    expect((selectionStep!.facts as any).selectedUrls).toEqual([
      'https://buenosaires.travel/san-telmo-walk',
      'https://travelblog.com/la-boca',
    ]);

    // Subjects
    expect(selectionStep!.subjects).toHaveLength(3);
    expect(selectionStep!.subjects![0]).toEqual({
      subject: {
        kind: 'grounded_evidence',
        id: 'ev-1',
        label: 'San Telmo Walk',
        url: 'https://buenosaires.travel/san-telmo-walk',
      },
      decision: {
        status: 'PASS',
        outcome: 'SELECTED',
      },
      facts: {
        evidenceKey: 'ev-1',
        title: 'San Telmo Walk',
        url: 'https://buenosaires.travel/san-telmo-walk',
        originalRank: 1,
        editorialEligible: true,
        tourContentScore: 15,
        citedCandidateBonus: 1,
        finalScore: 16,
        rankedPosition: 1,
        selected: true,
        decisionReason: 'SELECTED',
      },
    });

    // Byte-for-byte agreement between selection and retrieval
    expect((selectionStep!.facts as any).selectedUrls).toEqual(
      (retrievalStep!.facts as any).requestedUrls,
    );
  });

  it('records acquisition.deep_source_selection with WARN/NO_ELIGIBLE_SOURCES when no URLs are eligible', () => {
    const recorder = new GenerationTraceRecorder();

    recordAcquisitionLifecycle(recorder, {
      passNumber: 1,
      strategy: 'generic',
      plan: {
        destination: { destinationName: 'Buenos Aires' },
        deficits: [],
        evidenceRequirements: ['MULTI_COMPONENT_EXPERIENCE'],
        breadth: 'focused' as any,
        sourcePlans: [
          {
            provider: 'web' as const,
            web: { query: 'Buenos Aires walks' },
          },
        ],
      },
      execution: {
        candidates: [],
        observations: [],
        evidence: [],
        providerResults: {},
        webResults: [
          {
            status: 'success',
            query: 'Buenos Aires walks',
            groundedProvider: 'tavily',
            evidenceKeys: ['ev-1'],
            candidateCount: 0,
            validationErrors: [],
            deepSourceSelection: {
              evidenceCount: 1,
              selectionLimit: 2,
              selectedUrls: [],
              items: [
                {
                  evidenceKey: 'ev-1',
                  originalRank: 1,
                  editorialEligible: false,
                  tourContentScore: 0,
                  citedCandidateBonus: 0,
                  finalScore: 0,
                  selected: false,
                  decisionReason: 'NON_EDITORIAL_SOURCE',
                },
              ],
            },
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
      result: { status: 'COMPLETED', outcome: 'SUCCESS' },
    });

    const selectionStep = trace.steps.find(
      (s) => s.name === 'acquisition.deep_source_selection',
    );
    const retrievalStep = trace.steps.find(
      (s) => s.name === 'acquisition.source_retrieval',
    );

    expect(selectionStep).toBeDefined();
    expect(selectionStep!.decision).toEqual({
      status: 'WARN',
      outcome: 'NO_ELIGIBLE_SOURCES',
      reason:
        'No hay fuentes editoriales elegibles para recuperación profunda.',
    });
    // Source retrieval was never attempted, so no retrieval step was recorded
    expect(retrievalStep).toBeUndefined();
  });

  it('proves F: does not fabricate acquisition.deep_source_selection if deep retrieval decision never occurred', () => {
    const recorder = new GenerationTraceRecorder();

    recordAcquisitionLifecycle(recorder, {
      passNumber: 1,
      strategy: 'generic',
      plan: {
        destination: { destinationName: 'Buenos Aires' },
        deficits: [],
        evidenceRequirements: [],
        breadth: 'standard' as any,
        sourcePlans: [
          {
            provider: 'web' as const,
            web: { query: 'Buenos Aires cafe' },
          },
        ],
      },
      execution: {
        candidates: [],
        observations: [],
        evidence: [],
        providerResults: {},
        webResults: [
          {
            status: 'success',
            query: 'Buenos Aires cafe',
            groundedProvider: 'tavily',
            evidenceKeys: ['ev-1'],
            candidateCount: 1,
            validationErrors: [],
            // deepSourceSelection is undefined because no composition gap occurred
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
      result: { status: 'COMPLETED', outcome: 'SUCCESS' },
    });

    const selectionStep = trace.steps.find(
      (s) => s.name === 'acquisition.deep_source_selection',
    );
    const retrievalStep = trace.steps.find(
      (s) => s.name === 'acquisition.source_retrieval',
    );

    expect(selectionStep).toBeUndefined();
    expect(retrievalStep).toBeUndefined();
  });
});
