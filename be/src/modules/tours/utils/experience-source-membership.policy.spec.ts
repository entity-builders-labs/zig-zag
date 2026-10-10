import { ComponentDeficitReason } from '../interfaces/experience-resolution.interface';
import {
  componentDeficitClass,
  deficitClassification,
  isPartialEligibleDeficit,
  persistableUnresolvedReason,
} from './component-deficit-classification.policy';
import {
  SourceMemberResolution,
  allSourceMembers,
  decideSourceCompositionAdmission,
  distinctResolvedGeoEntityIds,
  distinctResolvedSourceMembers,
  isCompositeMembership,
  resolvedSourceMembers,
  sourceCompositionCompleteness,
  unresolvedSourceMembers,
} from './experience-source-membership.policy';
import { ExperienceComponentResolutionReason } from '@prisma/client';

const resolvedMember = (geoEntityId: string): SourceMemberResolution => ({
  identityStatus: 'RESOLVED',
  geoEntityId,
});
const missing = (
  deficitReason: ComponentDeficitReason = 'NO_CANDIDATE_ACQUIRED',
): SourceMemberResolution => ({ identityStatus: 'UNRESOLVED', deficitReason });

describe('decideSourceCompositionAdmission (PARTIAL composite rule)', () => {
  it('8 members, 6 resolved onto 5 distinct GeoEntities, 2 missing-knowledge members -> PARTIAL', () => {
    const admission = decideSourceCompositionAdmission([
      resolvedMember('A'),
      resolvedMember('B'),
      missing('NO_CANDIDATE_ACQUIRED'),
      resolvedMember('C'),
      resolvedMember('D'),
      resolvedMember('D'),
      missing('AMBIGUOUS_CANDIDATES'),
      resolvedMember('E'),
    ]);
    expect(admission).toEqual({
      admitted: true,
      completeness: 'PARTIAL',
      distinctResolvedGeoEntityIds: ['A', 'B', 'C', 'D', 'E'],
    });
  });

  it('3 members, 2 resolved onto the SAME GeoEntity -> rejected as composite (distinct floor, not a member count)', () => {
    const admission = decideSourceCompositionAdmission([
      resolvedMember('caminito'),
      missing('AMBIGUOUS_CANDIDATES'),
      resolvedMember('caminito'),
    ]);
    expect(admission).toMatchObject({
      admitted: false,
      reason: 'BELOW_DISTINCT_FLOOR',
      distinctResolvedGeoEntityIds: ['caminito'],
    });
  });

  it('only 1 distinct resolved GeoEntity -> rejected', () => {
    expect(
      decideSourceCompositionAdmission([resolvedMember('A'), missing()]),
    ).toMatchObject({ admitted: false, reason: 'BELOW_DISTINCT_FLOOR' });
  });

  it('6 members, 4 resolved, 1 ambiguous, 1 PROVIDER_FAILURE -> rejected (SYSTEM_FAILURE blocks)', () => {
    expect(
      decideSourceCompositionAdmission([
        resolvedMember('A'),
        resolvedMember('B'),
        resolvedMember('C'),
        resolvedMember('D'),
        missing('AMBIGUOUS_CANDIDATES'),
        missing('PROVIDER_FAILURE'),
      ]),
    ).toMatchObject({
      admitted: false,
      reason: 'BLOCKING_DEFICIT',
      blockingReasons: ['PROVIDER_FAILURE'],
    });
  });

  it.each<ComponentDeficitReason>([
    'IDENTITY_CONFLICT',
    'DESTINATION_INCOMPATIBLE',
    'DESTINATION_COMPATIBILITY_UNKNOWN',
    'PROVIDER_FAILURE',
    'IDENTITY_AUTHORITY_UNAVAILABLE',
  ])('one %s member blocks an otherwise qualifying PARTIAL', (reason) => {
    expect(
      decideSourceCompositionAdmission([
        resolvedMember('A'),
        resolvedMember('B'),
        missing(reason),
      ]),
    ).toMatchObject({ admitted: false, reason: 'BLOCKING_DEFICIT' });
  });

  it.each<ComponentDeficitReason>([
    'NO_CANDIDATE_ACQUIRED',
    'CANDIDATE_UNCONFIRMED',
    'AMBIGUOUS_CANDIDATES',
    'CANDIDATE_REJECTED',
  ])('a %s member is PARTIAL-eligible', (reason) => {
    expect(
      decideSourceCompositionAdmission([
        resolvedMember('A'),
        resolvedMember('B'),
        missing(reason),
      ]),
    ).toMatchObject({ admitted: true, completeness: 'PARTIAL' });
  });

  it('a fully resolved composition is COMPLETE regardless of distinct count (single-member and duplicate-member behavior unchanged)', () => {
    expect(decideSourceCompositionAdmission([resolvedMember('A')])).toEqual({
      admitted: true,
      completeness: 'COMPLETE',
      distinctResolvedGeoEntityIds: ['A'],
    });
    expect(
      decideSourceCompositionAdmission([
        resolvedMember('caminito'),
        resolvedMember('caminito'),
      ]),
    ).toMatchObject({ admitted: true, completeness: 'COMPLETE' });
  });

  it('nothing resolved, or no member at all, is never admitted', () => {
    expect(decideSourceCompositionAdmission([missing()])).toMatchObject({
      admitted: false,
      reason: 'NO_RESOLVED_MEMBER',
    });
    expect(decideSourceCompositionAdmission([])).toMatchObject({
      admitted: false,
      reason: 'NO_MEMBERS',
    });
  });

  it('a revoked member (persisted RESOLUTION_REVOKED) is missing knowledge', () => {
    expect(
      decideSourceCompositionAdmission([
        resolvedMember('A'),
        resolvedMember('B'),
        { identityStatus: 'UNRESOLVED', deficitReason: 'RESOLUTION_REVOKED' },
      ]),
    ).toMatchObject({ admitted: true, completeness: 'PARTIAL' });
  });
});

describe('component deficit classification authority', () => {
  const reasons: ComponentDeficitReason[] = [
    'NO_CANDIDATE_ACQUIRED',
    'CANDIDATE_UNCONFIRMED',
    'CANDIDATE_REJECTED',
    'AMBIGUOUS_CANDIDATES',
    'IDENTITY_CONFLICT',
    'PROVIDER_FAILURE',
    'IDENTITY_AUTHORITY_UNAVAILABLE',
    'DESTINATION_INCOMPATIBLE',
    'DESTINATION_COMPATIBILITY_UNKNOWN',
  ];

  it('classifies every runtime deficit on the composition axis', () => {
    expect(
      Object.fromEntries(
        reasons.map((reason) => [reason, componentDeficitClass(reason)]),
      ),
    ).toEqual({
      NO_CANDIDATE_ACQUIRED: 'MISSING_KNOWLEDGE',
      CANDIDATE_UNCONFIRMED: 'MISSING_KNOWLEDGE',
      CANDIDATE_REJECTED: 'MISSING_KNOWLEDGE',
      AMBIGUOUS_CANDIDATES: 'MISSING_KNOWLEDGE',
      IDENTITY_CONFLICT: 'CONTRADICTORY_EVIDENCE',
      PROVIDER_FAILURE: 'SYSTEM_FAILURE',
      IDENTITY_AUTHORITY_UNAVAILABLE: 'SYSTEM_FAILURE',
      DESTINATION_INCOMPATIBLE: 'CONTRADICTORY_EVIDENCE',
      DESTINATION_COMPATIBILITY_UNKNOWN: 'UNKNOWN',
    });
  });

  it('keeps the research axis unchanged for existing reasons and puts authority unavailability with operational failure', () => {
    expect(deficitClassification('AMBIGUOUS_CANDIDATES')).toBe(
      'KNOWLEDGE_DEFICIT',
    );
    expect(deficitClassification('PROVIDER_FAILURE')).toBe(
      'OPERATIONAL_FAILURE',
    );
    expect(deficitClassification('IDENTITY_AUTHORITY_UNAVAILABLE')).toBe(
      'OPERATIONAL_FAILURE',
    );
    expect(deficitClassification('CANDIDATE_REJECTED')).toBe(
      'PENDING_CLASSIFICATION',
    );
  });

  it('the persisted reason enum is exactly the PARTIAL-eligible set (no blocking reason can be stored)', () => {
    const persistable = reasons.filter(
      (reason) => persistableUnresolvedReason(reason) !== undefined,
    );
    expect(persistable).toEqual(reasons.filter(isPartialEligibleDeficit));
    expect(Object.values(ExperienceComponentResolutionReason).sort()).toEqual(
      [...persistable, 'RESOLUTION_REVOKED'].sort(),
    );
  });
});

describe('source membership reads', () => {
  const experience = {
    components: [
      {
        id: 'm3',
        geoEntityId: null as string | null,
        resolutionState: 'UNRESOLVED' as const,
        sourcePosition: 2,
      },
      {
        id: 'm1',
        geoEntityId: 'A',
        resolutionState: 'RESOLVED' as const,
        sourcePosition: 0,
      },
      {
        id: 'm4',
        geoEntityId: 'A',
        resolutionState: 'RESOLVED' as const,
        sourcePosition: 3,
      },
      {
        id: 'm2',
        geoEntityId: 'B',
        resolutionState: 'RESOLVED' as const,
        sourcePosition: 1,
      },
    ],
  };

  it('orders by source position and splits resolved / unresolved without renumbering', () => {
    expect(allSourceMembers(experience).map((m) => m.id)).toEqual([
      'm1',
      'm2',
      'm3',
      'm4',
    ]);
    expect(resolvedSourceMembers(experience).map((m) => m.id)).toEqual([
      'm1',
      'm2',
      'm4',
    ]);
    expect(unresolvedSourceMembers(experience).map((m) => m.id)).toEqual([
      'm3',
    ]);
  });

  it('counts DISTINCT resolved GeoEntities and exposes one navigable member per GeoEntity', () => {
    expect(distinctResolvedGeoEntityIds(experience)).toEqual(['A', 'B']);
    expect(distinctResolvedSourceMembers(experience).map((m) => m.id)).toEqual([
      'm1',
      'm2',
    ]);
    expect(isCompositeMembership(experience)).toBe(true);
    expect(sourceCompositionCompleteness(experience)).toBe('PARTIAL');
  });

  it('a row count is not a place count: 1 resolved GeoEntity + unresolved rows is not a composite', () => {
    expect(
      isCompositeMembership({
        components: [
          { geoEntityId: 'A', resolutionState: 'RESOLVED' },
          {
            geoEntityId: null as string | null,
            resolutionState: 'UNRESOLVED' as const,
          },
          { geoEntityId: 'A', resolutionState: 'RESOLVED' },
        ],
      }),
    ).toBe(false);
  });

  it('legacy rows (no state, no position) are RESOLVED and COMPLETE, in stored order', () => {
    const legacy = {
      components: [{ geoEntityId: 'X' }, { geoEntityId: 'Y' }],
    };
    expect(distinctResolvedGeoEntityIds(legacy)).toEqual(['X', 'Y']);
    expect(sourceCompositionCompleteness(legacy)).toBe('COMPLETE');
  });
});
