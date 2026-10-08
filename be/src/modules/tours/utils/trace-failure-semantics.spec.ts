import { withDefaultGeographicAuthorization } from './geographic-validation-authorization.util';
import { GeoEntityKind } from '@prisma/client';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';
import {
  CandidateResolutionAudit,
  ComponentResolutionAudit,
  ExperienceGeographicValidationResult,
  ExperienceResolutionResponse,
  ResolutionAttemptAudit,
  ResolvedExperienceCandidate,
  ResolvedGeoEntity,
} from '../interfaces/experience-resolution.interface';
import { ExperienceProposalResolverService } from '../services/experience-proposal-resolver.service';
import { buildCompositeComponentResolution } from './component-resolution-facts.util';
import {
  projectCatalogMaterializationStepInput,
  projectEntityResolutionStepInput,
} from './experience-generation-trace.util';
import { traceCandidateKey } from './experience-candidate-correlation.util';

/**
 * Stage 5 trace fidelity: every way a source-backed component can end
 * (nothing acquired, provider failure, acquired-but-not-corroborated,
 * acquired-and-contradicted, ambiguous, conflicted, resolved OUTSIDE,
 * incomplete composition) must stay a distinct, named fact in the trace --
 * never collapsed into `NO_OSM_MATCH` -- and every composite must say why it
 * was or was not persisted / planner-eligible.
 */
const SAN_TELMO: GeoJsonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [-58.373, -34.622],
      [-58.368, -34.622],
      [-58.368, -34.617],
      [-58.373, -34.617],
      [-58.373, -34.622],
    ],
  ],
};
const SAN_TELMO_SCOPE = {
  kind: 'AREA' as const,
  anchorName: 'San Telmo',
  geoEntityId: 'geo-san-telmo',
  geometry: SAN_TELMO,
};

type Hint = ExperienceCandidate['componentHints'][number];
const hint = (key: string, role: Hint['role'] = 'waypoint'): Hint => ({
  key,
  name: key,
  role,
  expectedKind: 'PLACE',
  evidenceKeys: ['ev-1'],
});

const candidateOf = (name: string, hints: Hint[]): ExperienceCandidate => ({
  name,
  themes: ['history'],
  traits: [],
  evidenceKeys: ['ev-1'],
  shortReason: 'evidenced walk',
  componentHints: hints,
});

const resolved = (
  hintKey: string,
  latitude: number,
  longitude: number,
): ResolvedGeoEntity => ({
  hintKey,
  hintName: hintKey,
  provider: 'openstreetmap',
  externalId: `osm:node:${hintKey}`,
  geoEntityId: `geo-${hintKey}`,
  canonicalName: hintKey,
  role: 'waypoint',
  kind: GeoEntityKind.PLACE,
  latitude,
  longitude,
  nameEvidenceMultiplicity: { exactName: 'SINGLE', declaredAlias: 'UNKNOWN' },
  status: 'resolved',
});

const unresolved = (hintKey: string, reason: string): ResolvedGeoEntity => ({
  hintKey,
  hintName: hintKey,
  provider: 'openstreetmap',
  externalId: '',
  role: 'waypoint',
  nameEvidenceMultiplicity: { exactName: 'UNKNOWN', declaredAlias: 'UNKNOWN' },
  status: 'unresolved',
  reason,
});

const attempt = (
  overrides: Partial<ResolutionAttemptAudit>,
): ResolutionAttemptAudit => ({
  strategy: 'LOCAL_OSM_POOL',
  executionStatus: 'completed',
  candidateAcquired: false,
  identityEvidence: [],
  ...overrides,
});

const componentAudit = (
  entity: ResolvedGeoEntity,
  attempts: ResolutionAttemptAudit[],
): ComponentResolutionAudit => ({
  hintKey: entity.hintKey,
  hintName: entity.hintName,
  role: entity.role,
  expectedKind: 'PLACE',
  evidenceKeys: ['ev-1'],
  attempts,
  finalStatus: entity.status,
  finalReason: entity.reason,
  ...(entity.status === 'resolved'
    ? {
        resolvedGeoEntity: {
          geoEntityId: entity.geoEntityId,
          canonicalName: entity.canonicalName,
          provider: entity.provider,
          externalId: entity.externalId,
        },
      }
    : {}),
});

const acquired = (
  decision: ResolutionAttemptAudit['verificationDecision'],
): ResolutionAttemptAudit =>
  attempt({
    candidateAcquired: true,
    selectedCandidate: {
      canonicalName: 'Something',
      externalId: 'osm:node:1',
      kind: GeoEntityKind.PLACE,
    },
    identityEvidence: [
      {
        type: 'EXACT_NAME',
        identityMultiplicity: decision === 'AMBIGUOUS' ? 'MULTIPLE' : 'UNKNOWN',
      } as any,
    ],
    verificationDecision: decision,
  });

/** One source-backed candidate: entities + attempts per component. */
function resolutionOf(
  name: string,
  components: Array<[ResolvedGeoEntity, ResolutionAttemptAudit[]]>,
  status: 'accepted' | 'rejected',
  rejectionReasons: string[],
): { resolved: ResolvedExperienceCandidate; audit: CandidateResolutionAudit } {
  const candidate = candidateOf(
    name,
    components.map(([entity]) => hint(entity.hintKey)),
  );
  const entities = components.map(([entity]) => entity);
  const componentAudits = components.map(([entity, attempts]) =>
    componentAudit(entity, attempts),
  );
  const componentResolution = buildCompositeComponentResolution({
    candidate,
    entities,
    componentAudits,
    validationScope: SAN_TELMO_SCOPE,
  });
  return {
    resolved: {
      candidate,
      status,
      resolvedEntities: entities,
      rejectionReasons,
      componentResolution,
    },
    audit: {
      candidateTraceKey: traceCandidateKey(candidate),
      candidateName: name,
      candidateEvidenceKeys: ['ev-1'],
      candidateHintKeys: candidate.componentHints.map((item) => item.key),
      componentAudits,
      componentResolution,
      geographicAuthorization: { kind: 'DEFAULT' },
    },
  };
}

// Inside San Telmo / outside it (Plaza-de-Mayo-shaped point, west of it).
const INSIDE: [number, number] = [-34.62, -58.37];
const OUTSIDE: [number, number] = [-34.6195, -58.3755];

describe('Stage 5 trace failure semantics', () => {
  describe('component deficit reasons', () => {
    const facts = (
      components: Array<[ResolvedGeoEntity, ResolutionAttemptAudit[]]>,
    ) =>
      resolutionOf('walk', components, 'rejected', [])!.resolved
        .componentResolution!.components;

    it('separates not-corroborated from contradicted identity', () => {
      const [unconfirmed, contradicted] = facts([
        [
          unresolved('not-corroborated', 'UNCONFIRMED_MATCH'),
          [acquired('INSUFFICIENT_EVIDENCE')],
        ],
        [
          unresolved('contradicted', 'UNCONFIRMED_MATCH'),
          [acquired('REJECTED')],
        ],
      ]);
      expect(unconfirmed.deficit).toEqual({
        reason: 'CANDIDATE_UNCONFIRMED',
        classification: 'PENDING_CLASSIFICATION',
      });
      expect(contradicted.deficit).toEqual({
        reason: 'CANDIDATE_REJECTED',
        classification: 'PENDING_CLASSIFICATION',
      });
    });

    it('one contradicted attempt among unconfirmed ones is not a contradiction of the component', () => {
      const [mixed] = facts([
        [
          unresolved('mixed', 'UNCONFIRMED_MATCH'),
          [acquired('REJECTED'), acquired('INSUFFICIENT_EVIDENCE')],
        ],
      ]);
      expect(mixed.deficit?.reason).toBe('CANDIDATE_UNCONFIRMED');
    });

    it('a provider timeout is an OPERATIONAL_FAILURE, never a KNOWLEDGE_DEFICIT', () => {
      const result = resolutionOf(
        'walk',
        [
          [
            unresolved('timeout', 'PROVIDER_FAILURE'),
            [
              attempt({
                strategy: 'PLACES',
                executionStatus: 'failed',
                failureReason: 'timeout of 8000ms exceeded',
              }),
            ],
          ],
        ],
        'rejected',
        ['PROVIDER_FAILURE'],
      ).resolved.componentResolution!;
      expect(result.components[0].deficit).toEqual({
        reason: 'PROVIDER_FAILURE',
        classification: 'OPERATIONAL_FAILURE',
      });
      expect(result.coverage.openResearchDeficits).toEqual([]);
    });

    it('a resolved OUTSIDE component is resolved identity + outside geography, not unresolved', () => {
      const [outside] = facts([
        [resolved('plaza', ...OUTSIDE), [acquired('VERIFIED')]],
      ]);
      expect(outside.identityStatus).toBe('RESOLVED');
      expect(outside.deficit).toBeUndefined();
      expect(outside.resolved).toMatchObject({
        geoEntityId: 'geo-plaza',
        canonicalGeometry: 'POINT',
        geographicRelation: 'OUTSIDE',
      });
      expect(outside.resolved?.distanceToBoundaryMeters).toBeGreaterThan(0);
    });
  });

  describe('entity_resolution trace step', () => {
    // A-B-C-D-E-F-G: every distinct terminal state in one source composite.
    const composite = resolutionOf(
      'San Telmo Historic Walk',
      [
        [resolved('A', ...INSIDE), [acquired('VERIFIED')]],
        [unresolved('B', 'UNCONFIRMED_MATCH'), [acquired('AMBIGUOUS')]],
        [unresolved('C', 'NO_OSM_MATCH'), [attempt({})]],
        [resolved('D', ...OUTSIDE), [acquired('VERIFIED')]],
        [
          unresolved('E', 'PROVIDER_FAILURE'),
          [attempt({ strategy: 'PLACES', executionStatus: 'failed' })],
        ],
        [
          unresolved('F', 'UNCONFIRMED_MATCH'),
          [acquired('INSUFFICIENT_EVIDENCE')],
        ],
        [unresolved('G', 'UNCONFIRMED_MATCH'), [acquired('REJECTED')]],
      ],
      'rejected',
      ['INCOMPLETE_SOURCE_COMPOSITION'],
    );
    const response: ExperienceResolutionResponse = {
      totalCandidates: 1,
      acceptedCount: 0,
      rejectedCount: 1,
      resolved: [composite.resolved],
      entityResolution: {
        totalCandidates: 1,
        acceptedCount: 0,
        rejectedCount: 1,
        resolved: [composite.resolved],
        forensicAudit: [composite.audit],
      },
    };
    const step = projectEntityResolutionStepInput(response);
    const facts = step.facts as any;
    const decision = facts.entityResolutionAudit[0];
    const byKey = Object.fromEntries(
      decision.hints.map((item: any) => [item.key, item]),
    );

    it('keeps every source component, including the unresolved ones, in the audit', () => {
      expect(decision.hints.map((item: any) => item.key)).toEqual([
        'A',
        'B',
        'C',
        'D',
        'E',
        'F',
        'G',
      ]);
      expect(decision.coverage).toMatchObject({
        totalComponents: 7,
        identityResolvedComponents: 2,
        geographicallyAcceptedComponents: 1,
        unresolvedComponents: 4,
        ambiguousComponents: 1,
        openResearchDeficits: ['B'],
        sourceCompositionComplete: false,
      });
    });

    it('gives each terminal state a distinct typed fact', () => {
      const signature = (key: string) => {
        const item = byKey[key];
        return [
          item.identityStatus,
          item.geography?.geographicRelation ?? null,
          item.deficit?.reason ?? null,
          item.deficit?.classification ?? null,
        ];
      };
      expect(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(signature)).toEqual([
        ['RESOLVED', 'INSIDE', null, null],
        ['AMBIGUOUS', null, 'AMBIGUOUS_CANDIDATES', 'KNOWLEDGE_DEFICIT'],
        ['UNRESOLVED', null, 'NO_CANDIDATE_ACQUIRED', 'PENDING_CLASSIFICATION'],
        ['RESOLVED', 'OUTSIDE', null, null],
        ['UNRESOLVED', null, 'PROVIDER_FAILURE', 'OPERATIONAL_FAILURE'],
        ['UNRESOLVED', null, 'CANDIDATE_UNCONFIRMED', 'PENDING_CLASSIFICATION'],
        ['UNRESOLVED', null, 'CANDIDATE_REJECTED', 'PENDING_CLASSIFICATION'],
      ]);
    });

    it('preserves the ambiguity evidence without choosing a winner', () => {
      expect(byKey.B.resolvedGeoEntity).toBeUndefined();
      expect(byKey.B.geography).toBeUndefined();
      expect(byKey.B.attempts?.[0]).toMatchObject({
        candidateAcquired: true,
        verificationDecision: 'AMBIGUOUS',
        identityEvidence: [
          expect.objectContaining({ identityMultiplicity: 'MULTIPLE' }),
        ],
      });
    });

    it('names every component and its outcome in the human summary', () => {
      for (const fragment of [
        'A=RESOLVED/INSIDE',
        'B=AMBIGUOUS/AMBIGUOUS_CANDIDATES',
        'C=UNRESOLVED/NO_CANDIDATE_ACQUIRED',
        'D=RESOLVED/OUTSIDE',
        'E=UNRESOLVED/PROVIDER_FAILURE',
        'F=UNRESOLVED/CANDIDATE_UNCONFIRMED',
        'G=UNRESOLVED/CANDIDATE_REJECTED',
        'resueltos 2/7',
      ]) {
        expect(step.description).toContain(fragment);
      }
      const rejected = step.subjects!.find(
        (item: any) => item.subject.label === 'San Telmo Historic Walk',
      )!;
      expect(rejected.decision.reason).toContain(
        'C=UNRESOLVED/NO_CANDIDATE_ACQUIRED',
      );
    });
  });

  describe('catalog_materialization composite outcome', () => {
    // INTENTIONAL_PRODUCT_CHANGE: PARTIAL_COMPOSITE_POLICY.
    // Old fixture/expectation: "Partial walk" (A, B resolved; C
    // NO_CANDIDATE_ACQUIRED) was a rejected candidate, never evaluated,
    // persisted or planner-eligible. It qualifies for PARTIAL (2 distinct
    // resolved GeoEntities, C is MISSING_KNOWLEDGE), so the resolver now
    // admits it: the fixture reflects that run (validated, persisted). The
    // old "never evaluated" assertion moves, unchanged, onto incomplete
    // compositions that do NOT qualify: below the distinct floor, and with a
    // SYSTEM_FAILURE member.
    const partial = resolutionOf(
      'Partial walk',
      [
        [resolved('A', ...INSIDE), [acquired('VERIFIED')]],
        [resolved('B', ...INSIDE), [acquired('VERIFIED')]],
        [unresolved('C', 'NO_OSM_MATCH'), [attempt({})]],
      ],
      'accepted',
      [],
    );
    const belowFloor = resolutionOf(
      'Below-floor walk',
      [
        [resolved('A', ...INSIDE), [acquired('VERIFIED')]],
        [unresolved('C', 'NO_OSM_MATCH'), [attempt({})]],
      ],
      'rejected',
      ['INCOMPLETE_SOURCE_COMPOSITION'],
    );
    const blocked = resolutionOf(
      'Provider-failed walk',
      [
        [resolved('A', ...INSIDE), [acquired('VERIFIED')]],
        [resolved('B', ...INSIDE), [acquired('VERIFIED')]],
        [
          unresolved('E', 'PROVIDER_FAILURE'),
          [attempt({ executionStatus: 'failed', failureReason: 'timeout' })],
        ],
      ],
      'rejected',
      ['INCOMPLETE_SOURCE_COMPOSITION'],
    );
    const complete = resolutionOf(
      'Complete walk',
      [
        [resolved('A', ...INSIDE), [acquired('VERIFIED')]],
        [resolved('B', ...INSIDE), [acquired('VERIFIED')]],
      ],
      'accepted',
      [],
    );
    const geoRejected = resolutionOf(
      'Scattered walk',
      [
        [resolved('A', ...INSIDE), [acquired('VERIFIED')]],
        [resolved('D', ...OUTSIDE), [acquired('VERIFIED')]],
      ],
      'accepted',
      [],
    );
    const validation = (
      name: string,
      accepted: boolean,
    ): ExperienceGeographicValidationResult => ({
      proposalName: name,
      kind: 'NEIGHBORHOOD_WALK',
      status: accepted ? 'GEO_VERIFIED' : 'REJECTED',
      accepted,
      strategy: accepted ? 'canonical_area' : undefined,
      anchors: [],
      groundedEvidenceKeys: ['ev-1'],
      rejectionReasons: accepted ? [] : ['OUTSIDE_VALIDATION_SCOPE'],
      validatorVersion: 3,
    });
    const finalResolved: ResolvedExperienceCandidate[] = [
      { ...partial.resolved, experienceId: 'exp-2', dedupeDecision: 'NEW' },
      belowFloor.resolved,
      blocked.resolved,
      { ...complete.resolved, experienceId: 'exp-1', dedupeDecision: 'NEW' },
      {
        ...geoRejected.resolved,
        status: 'rejected',
        rejectionReasons: ['OUTSIDE_VALIDATION_SCOPE'],
      },
    ];
    const step = projectCatalogMaterializationStepInput({
      totalCandidates: 5,
      acceptedCount: 2,
      rejectedCount: 3,
      resolved: finalResolved,
      geographicValidation: {
        results: [
          validation('Partial walk', true),
          validation('Complete walk', true),
          validation('Scattered walk', false),
        ],
        acceptedCount: 2,
        rejectedCount: 1,
        resolved: [partial.resolved, complete.resolved, geoRejected.resolved],
      },
      materialization: { resolved: finalResolved },
    });
    const facts = step.facts as any;
    const outcome = (name: string) =>
      facts.materializationAudit.find(
        (item: any) => item.candidateName === name,
      )!.compositeOutcome;

    it('an admitted PARTIAL composite is evaluated geographically, persisted and planner-eligible', () => {
      expect(outcome('Partial walk')).toEqual({
        coverage: expect.objectContaining({
          totalComponents: 3,
          identityResolvedComponents: 2,
          unresolvedComponents: 1,
          resolutionRatio: 2 / 3,
          sourceCompositionComplete: false,
        }),
        geographicDecision: { status: 'ACCEPTED', strategy: 'canonical_area' },
        persistence: {
          status: 'PERSISTED',
          experienceId: 'exp-2',
          dedupeDecision: 'NEW',
        },
        plannerEligible: true,
      });
    });

    it.each([
      ['Below-floor walk', 2, 1],
      ['Provider-failed walk', 3, 2],
    ])(
      'a non-admitted incomplete composite (%s) is never evaluated, persisted or planner-eligible, and says why',
      (name, totalComponents, identityResolvedComponents) => {
        expect(outcome(name)).toEqual({
          coverage: expect.objectContaining({
            totalComponents,
            identityResolvedComponents,
            unresolvedComponents: 1,
            sourceCompositionComplete: false,
          }),
          geographicDecision: {
            status: 'NOT_EVALUATED',
            reason: 'INCOMPLETE_SOURCE_COMPOSITION',
          },
          persistence: {
            status: 'NOT_PERSISTED',
            reasons: ['INCOMPLETE_SOURCE_COMPOSITION'],
          },
          plannerEligible: false,
        });
      },
    );

    it('a complete, geographically accepted composite is persisted and planner-eligible', () => {
      expect(outcome('Complete walk')).toMatchObject({
        coverage: { sourceCompositionComplete: true, resolutionRatio: 1 },
        geographicDecision: { status: 'ACCEPTED', strategy: 'canonical_area' },
        persistence: {
          status: 'PERSISTED',
          experienceId: 'exp-1',
          dedupeDecision: 'NEW',
        },
        plannerEligible: true,
      });
    });

    it('a complete but geographically rejected composite carries the validator reasons', () => {
      expect(outcome('Scattered walk')).toMatchObject({
        geographicDecision: {
          status: 'REJECTED',
          reasons: ['OUTSIDE_VALIDATION_SCOPE'],
        },
        persistence: {
          status: 'NOT_PERSISTED',
          reasons: ['OUTSIDE_VALIDATION_SCOPE'],
        },
        plannerEligible: false,
      });
    });

    it('an AMBIGUOUS_DEDUPE outcome names the conflicting Experiences and the dedupe signals', () => {
      const dedupe = projectCatalogMaterializationStepInput({
        totalCandidates: 1,
        acceptedCount: 0,
        rejectedCount: 1,
        resolved: [],
        geographicValidation: {
          results: [validation('Complete walk', true)],
          acceptedCount: 1,
          rejectedCount: 0,
          resolved: [complete.resolved],
        },
        materialization: {
          resolved: [
            {
              ...complete.resolved,
              status: 'rejected',
              rejectionReasons: ['AMBIGUOUS_DEDUPE'],
              dedupeCandidates: ['exp-composite'],
              dedupeEvidence: {
                nameSimilarity: 0.2,
                semanticSimilarity: 0.4,
                componentOverlap: 0.5,
                roleAwareComponentOverlap: 0.5,
                distanceKm: 0.1,
                provenanceOverlap: 0,
                conceptOverlap: 0,
                orderConflict: false,
                structure: {
                  relation: 'PARTIAL_OVERLAP',
                  containment: null,
                  sharedResolvedGeoEntityIds: ['geo-a'],
                  sourceMemberCounts: { incoming: 2, existing: 2 },
                },
                sourceRelation: 'SOURCE_UNKNOWN',
                decisiveEvidence: 'PARTIAL_OVERLAP_IDENTITY_UNRESOLVED',
                reasons: ['identity_signals_conflict_or_are_incomplete'],
              },
            },
          ],
        },
      });
      const dedupeFacts = dedupe.facts as any;
      expect(
        dedupeFacts.materializationAudit[0].compositeOutcome,
      ).toMatchObject({
        geographicDecision: { status: 'ACCEPTED' },
        persistence: {
          status: 'NOT_PERSISTED',
          reasons: ['AMBIGUOUS_DEDUPE'],
          dedupe: {
            conflictingExperienceIds: ['exp-composite'],
            evidence: {
              structuralRelation: 'PARTIAL_OVERLAP',
              sourceRelation: 'SOURCE_UNKNOWN',
              sharedResolvedGeoEntities: ['geo-a'],
              sourceMemberCounts: { incoming: 2, existing: 2 },
              decisiveEvidence: 'PARTIAL_OVERLAP_IDENTITY_UNRESOLVED',
              componentOverlap: 0.5,
              nameSimilarity: 0.2,
              semanticScore: 0.4,
              reasons: ['identity_signals_conflict_or_are_incomplete'],
            },
          },
        },
        plannerEligible: false,
      });
    });

    it('states each composite decision in the summary', () => {
      expect(step.description).toContain(
        'Partial walk: 2/3 componentes resueltos, composición incompleta → geografía ACCEPTED, persistida, elegible para planner',
      );
      expect(step.description).toContain(
        'Below-floor walk: 1/2 componentes resueltos, composición incompleta → no evaluada geográficamente, no persistida, no elegible para planner',
      );
      expect(step.description).toContain(
        'Complete walk: 2/2 componentes resueltos, composición completa → geografía ACCEPTED, persistida, elegible para planner',
      );
    });
  });
});

describe('Stage 5 resolver summary fidelity', () => {
  const boundary: any = {
    id: 'osm:relation:1',
    name: 'San Juan',
    osmType: 'relation',
    osmId: 1,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-68.6, -31.6],
          [-68.4, -31.6],
          [-68.4, -31.4],
          [-68.6, -31.4],
          [-68.6, -31.6],
        ],
      ],
    },
    tags: { boundary: 'administrative' },
  };
  const evidence = [
    {
      key: 'ev-1',
      source: 'guide',
      title: 'San Juan highlights',
      snippet: 'Casa Vieja is a historic house in San Juan.',
    },
  ];
  const resolverWith = (placesApi: any, nominatim: any) =>
    new ExperienceProposalResolverService(
      {
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:99',
              name: 'Unrelated Kiosk',
              osmType: 'node',
              osmId: 99,
              geometry: { type: 'Point', coordinates: [-68.5, -31.5] },
              tags: {},
            },
          ],
        }),
      } as any,
      {
        findGeoEntityCandidatesForHint: jest
          .fn()
          .mockResolvedValue({ candidates: [] }),
      } as any,
      { validate: jest.fn() } as any,
      undefined,
      nominatim,
      placesApi,
    );

  it('a provider failure with nothing acquired is PROVIDER_FAILURE, never NO_OSM_MATCH', async () => {
    const service = resolverWith(
      {
        provider: 'geoapify',
        searchText: jest
          .fn()
          .mockRejectedValue(new Error('timeout of 8000ms exceeded')),
      },
      { search: jest.fn().mockResolvedValue([]) },
    );
    const result = await service.resolve({
      destinationName: 'San Juan',
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
      candidates: withDefaultGeographicAuthorization([
        {
          name: 'Visit Casa Vieja',
          themes: ['history'],
          traits: [],
          evidenceKeys: ['ev-1'],
          shortReason: 'evidenced',
          componentHints: [
            {
              key: 'casa',
              name: 'Casa Vieja',
              role: 'venue',
              expectedKind: 'PLACE',
              evidenceKeys: ['ev-1'],
            },
          ],
        },
      ]),
      evidence,
    });

    const [candidate] = result.entityResolution!.resolved;
    expect(candidate.status).toBe('rejected');
    expect(candidate.rejectionReasons).toEqual(['PROVIDER_FAILURE']);
    expect(candidate.componentResolution!.components[0].deficit).toEqual({
      reason: 'PROVIDER_FAILURE',
      classification: 'OPERATIONAL_FAILURE',
    });
    const [audit] = result.entityResolution!.forensicAudit[0].componentAudits;
    expect(audit.finalReason).toBe('PROVIDER_FAILURE');
    expect(audit.attempts.map((item) => item.strategy)).toContain('PLACES');
  });

  it('a candidate summary lists every distinct component reason instead of masking them', async () => {
    // First hint: Places times out (PROVIDER_FAILURE). Second hint: every
    // provider answered and nothing matched (NO_OSM_MATCH). A single
    // precedence-picked reason would hide one of the two facts.
    const service = resolverWith(
      {
        provider: 'geoapify',
        searchText: jest
          .fn()
          .mockRejectedValueOnce(new Error('timeout of 8000ms exceeded'))
          .mockResolvedValue({ data: [] }),
      },
      { search: jest.fn().mockResolvedValue([]) },
    );
    const result = await service.resolve({
      destinationName: 'San Juan',
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
      candidates: withDefaultGeographicAuthorization([
        {
          name: 'Two stops',
          themes: ['history'],
          traits: [],
          evidenceKeys: ['ev-1'],
          shortReason: 'evidenced',
          componentHints: [
            {
              key: 'casa',
              name: 'Casa Vieja',
              role: 'venue',
              expectedKind: 'PLACE',
              evidenceKeys: ['ev-1'],
            },
            {
              key: 'kiosk',
              name: 'Kiosko Nuevo',
              role: 'venue',
              expectedKind: 'PLACE',
              evidenceKeys: ['ev-1'],
            },
          ],
        },
      ]),
      evidence,
    });
    const [candidate] = result.entityResolution!.resolved;
    expect(
      result.entityResolution!.forensicAudit[0].componentAudits.map(
        (item) => item.finalReason,
      ),
    ).toEqual(['PROVIDER_FAILURE', 'NO_OSM_MATCH']);
    expect(candidate.rejectionReasons).toEqual([
      'PROVIDER_FAILURE',
      'NO_OSM_MATCH',
    ]);
  });
});
