import {
  GenerationTraceRecorder,
  TRACE_LIMITS,
} from '../generation-trace-recorder.util';
import { recordAcquisitionLifecycle } from './acquisition-audit';
import { projectComponentIdentityStepInputs } from './resolution-audit';
import {
  CandidateResolutionAudit,
  ComponentResolutionAudit,
  ResolutionAttemptAudit,
} from '../../interfaces/experience-resolution.interface';
import { ownedIntentGrant } from '../geographic-validation-authorization.util';
import {
  geographicIntentDeficit,
  ownedAuthorization,
} from '../../fixtures/geographic-authorization.fixture';

/**
 * COLD #11 observability prerequisite: the compact per-component identity
 * step must stay bounded for a realistic heavy composite even when the full
 * `resolution.entity` payload overflows the step limit (COLD #10: 67,856
 * chars, truncated).
 */
const LONG = 'x'.repeat(400);

function attempt(
  strategy: ResolutionAttemptAudit['strategy'],
  index: number,
): ResolutionAttemptAudit {
  return {
    strategy,
    executionStatus: 'completed',
    provider: strategy === 'PLACES' ? 'geoapify' : 'nominatim',
    query: `Bodega component ${index} ${LONG}`,
    providerResultCount: 10,
    candidateAcquired: true,
    selectedCandidate: {
      canonicalName: `Bodega Candidate ${index} ${'y'.repeat(60)}`,
      externalId: `geoapify:${index}`,
      kind: 'PLACE',
      identities: Array.from({ length: 6 }, (_, i) => ({
        namespace: 'osm',
        id: `node/${index}${i}`,
      })) as any,
      latitude: -33.4 - index / 100,
      longitude: -69.2 + index / 100,
    },
    placeSearch: {
      resultCount: 10,
      viableCount: 1,
      rejected: Array.from({ length: 9 }, (_, i) => ({
        name: `Rejected winery ${i} ${LONG}`,
        reason: 'DESTINATION_INCOMPATIBLE' as const,
        destinationReason: 'OUTSIDE_ROUTE_DESTINATION_RADIUS' as const,
      })),
      searchScope: { kind: 'ROUTE_SCALE', radiusMeters: 80_000 },
    },
    identityEvidence: Array.from({ length: 25 }, (_, i) => ({
      kind: 'NAME_SIMILARITY',
      detail: `${LONG}-${i}`,
    })) as any,
    verificationDecision: 'REJECTED' as any,
    destinationCompatibility: {
      verdict: 'COMPATIBLE',
      reason: 'WITHIN_ROUTE_DESTINATION_RADIUS',
    },
  };
}

function heavyAudit(componentCount: number): CandidateResolutionAudit {
  const componentAudits: ComponentResolutionAudit[] = Array.from(
    { length: componentCount },
    (_, index) => ({
      hintKey: `c${index}`,
      hintName: `Bodega ${index}`,
      role: 'venue',
      expectedKind: 'PLACE',
      evidenceKeys: Array.from({ length: 20 }, (_, i) => `ev-${i}`),
      attempts: (
        [
          'CATALOG_REUSE',
          'LOCAL_OSM_POOL',
          'NOMINATIM',
          'PLACES',
          'TRUSTED_OBSERVATION_REUSE',
        ] as ResolutionAttemptAudit['strategy'][]
      ).map((strategy) => attempt(strategy, index)),
      finalStatus: 'unresolved',
      finalReason: 'NO_CANDIDATE_ACQUIRED',
    }),
  );
  return {
    candidateTraceKey: 'candidate:uco-like',
    candidateName: 'Regional Wine Itinerary',
    candidateEvidenceKeys: ['ev-1'],
    candidateHintKeys: componentAudits.map((c) => c.hintKey),
    componentAudits,
    geographicAuthorization: ownedAuthorization('route_like'),
  };
}

function resolutionWith(audits: CandidateResolutionAudit[]) {
  return {
    totalCandidates: audits.length,
    acceptedCount: 0,
    rejectedCount: audits.length,
    resolved: audits.map((audit) => ({
      candidate: {
        name: audit.candidateName,
        themes: [] as string[],
        traits: [] as string[],
        evidenceKeys: ['ev-1'],
        shortReason: 'grounded',
        componentHints: audit.componentAudits.map((component) => ({
          key: component.hintKey,
          name: component.hintName,
          role: 'venue' as const,
          expectedKind: 'PLACE' as const,
          evidenceKeys: ['ev-1'],
        })),
      },
      status: 'rejected' as const,
      resolvedEntities: [] as unknown[],
      rejectionReasons: ['NO_CANDIDATE_ACQUIRED'],
    })),
    entityResolution: {
      totalCandidates: audits.length,
      acceptedCount: 0,
      rejectedCount: audits.length,
      resolved: [] as unknown[],
      forensicAudit: audits,
    },
    geographicValidation: {
      results: [] as unknown[],
      acceptedCount: 0,
      rejectedCount: 0,
    },
  };
}

describe('resolution.component_identity compact audit', () => {
  it('projects exactly the per-component diagnosis facts, with coordinates and the candidate authorization', () => {
    const [step] = projectComponentIdentityStepInputs(
      resolutionWith([heavyAudit(3)]) as any,
      {
        strategy: 'dedicated_intent',
        passNumber: 1,
        workUnitKind: 'DEDICATED_INTENT',
      },
    );
    const facts = step.facts as any;
    expect(facts.candidateTraceKey).toBe('candidate:uco-like');
    expect(facts.geographicAuthorization).toEqual({
      kind: 'ROUTE_LIKE',
      workUnit: 'DEDICATED_INTENT',
      ownedDeficit: 'intent:route_like',
      admittedAs: 'MULTI_COMPONENT_EXPERIENCE',
    });
    expect(facts.acquisitionContext.workUnitKind).toBe('DEDICATED_INTENT');
    const component = facts.components[0];
    expect(component).toEqual(
      expect.objectContaining({
        hintKey: 'c0',
        name: 'Bodega 0',
        strategiesAttempted: [
          'CATALOG_REUSE',
          'LOCAL_OSM_POOL',
          'NOMINATIM',
          'PLACES',
          'TRUSTED_OBSERVATION_REUSE',
        ],
        candidateAcquired: true,
        selectedCandidate: expect.objectContaining({
          provider: 'nominatim',
          latitude: -33.4,
          longitude: -69.2,
        }),
        identityVerdict: 'REJECTED',
        destinationCompatibility: {
          verdict: 'COMPATIBLE',
          reason: 'WITHIN_ROUTE_DESTINATION_RADIUS',
        },
        finalStatus: 'unresolved',
        finalReason: 'NO_CANDIDATE_ACQUIRED',
      }),
    );
    // No raw evidence / rejected-place payloads.
    expect(JSON.stringify(step)).not.toContain('NAME_SIMILARITY');
    expect(JSON.stringify(step)).not.toContain('Rejected winery');
  });

  it('only single-component candidates are skipped', () => {
    expect(
      projectComponentIdentityStepInputs(
        resolutionWith([heavyAudit(1)]) as any,
        { strategy: 'generic', passNumber: 1, workUnitKind: 'GENERIC' },
      ),
    ).toEqual([]);
  });

  it('stays comfortably under the 48k step limit for a heavy composite whose full resolution.entity step is truncated', () => {
    const recorder = new GenerationTraceRecorder();
    const unit = {
      kind: 'DEDICATED_INTENT' as const,
      deficit: geographicIntentDeficit('route_like'),
    };
    recordAcquisitionLifecycle(recorder, {
      passNumber: 1,
      workUnit: unit,
      geographicGrant: ownedIntentGrant('DEDICATED_INTENT', unit.deficit),
      plan: {
        destination: { destinationName: 'Mendoza' },
        deficits: [unit.deficit],
        evidenceRequirements: ['MULTI_COMPONENT_EXPERIENCE'],
        breadth: 'focused',
        sourcePlans: [],
      },
      execution: {
        candidates: [],
        observations: [],
        providerResults: {},
        webResults: [],
      } as any,
      resolution: resolutionWith([heavyAudit(6), heavyAudit(6)]) as any,
    });
    const trace = recorder.build({
      canonicalRequest: {},
      result: { status: 'COMPLETED', outcome: 'COMPLETED' },
    } as any);

    const entityStep: any = trace.steps.find(
      (step) => step.name === 'resolution.entity',
    );
    // The full forensic payload overflows (the COLD #10 failure mode) ...
    expect(entityStep.facts).toEqual(
      expect.objectContaining({ truncated: true }),
    );

    const compactSteps: any[] = trace.steps.filter(
      (step) => step.name === 'resolution.component_identity',
    );
    expect(compactSteps).toHaveLength(2);
    for (const step of compactSteps) {
      // ... while each compact per-candidate step is intact and bounded.
      expect(step.facts.truncated).toBeUndefined();
      expect(step.facts.components).toHaveLength(6);
      expect(JSON.stringify(step).length).toBeLessThan(
        TRACE_LIMITS.maxStepPayloadChars / 2,
      );
    }
  });
});
