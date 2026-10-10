import { GeoEntityKind } from '@prisma/client';
import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';
import {
  ComponentResolutionAudit,
  ResolutionAttemptAudit,
  ResolvedGeoEntity,
} from '../interfaces/experience-resolution.interface';
import {
  buildCompositeComponentResolution,
  compositionAdmissionOf,
  sourceMemberResolutions,
} from './component-resolution-facts.util';
import { decideSourceCompositionAdmission } from './experience-source-membership.policy';

/**
 * Deficit reasons traced to their producing branch, and the admission they
 * lead to. The resolver and `buildCompositeOutcome` read the same facts.
 */
type Hint = ExperienceCandidate['componentHints'][number];
const hint = (key: string): Hint => ({
  key,
  name: key,
  role: 'waypoint',
  expectedKind: 'PLACE',
  evidenceKeys: ['ev-1'],
});
const resolved = (
  key: string,
  geoEntityId = `geo-${key}`,
): ResolvedGeoEntity => ({
  hintKey: key,
  hintName: key,
  provider: 'openstreetmap',
  externalId: `osm:node:${key}`,
  geoEntityId,
  canonicalName: key,
  role: 'waypoint',
  kind: GeoEntityKind.PLACE,
  latitude: -34.62,
  longitude: -58.37,
  nameEvidenceMultiplicity: { exactName: 'SINGLE', declaredAlias: 'UNKNOWN' },
  status: 'resolved',
});
const unresolved = (key: string, reason: string): ResolvedGeoEntity => ({
  hintKey: key,
  hintName: key,
  provider: 'openstreetmap',
  externalId: '',
  role: 'waypoint',
  nameEvidenceMultiplicity: { exactName: 'UNKNOWN', declaredAlias: 'UNKNOWN' },
  status: 'unresolved',
  reason,
});
const attempt = (
  overrides: Partial<ResolutionAttemptAudit> = {},
): ResolutionAttemptAudit => ({
  strategy: 'LOCAL_OSM_POOL',
  executionStatus: 'completed',
  candidateAcquired: false,
  identityEvidence: [],
  ...overrides,
});
const audit = (
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
});

function admissionOf(
  members: Array<[ResolvedGeoEntity, ResolutionAttemptAudit[]]>,
) {
  const hints = members.map(([entity]) => hint(entity.hintKey));
  const entities = members.map(([entity]) => entity);
  const componentAudits = members.map(([entity, attempts]) =>
    audit(entity, attempts),
  );
  const fromResolver = decideSourceCompositionAdmission(
    sourceMemberResolutions({ hints, entities, componentAudits }),
  );
  const resolution = buildCompositeComponentResolution({
    candidate: {
      name: 'Walk',
      themes: [],
      traits: [],
      evidenceKeys: ['ev-1'],
      shortReason: 'walk',
      componentHints: hints,
    },
    entities,
    componentAudits,
  });
  // The resolver seam and the trace facts never disagree.
  expect(compositionAdmissionOf(resolution)).toEqual(fromResolver);
  return { admission: fromResolver, resolution };
}

const verified = attempt({
  candidateAcquired: true,
  verificationDecision: 'VERIFIED',
});

describe('composite admission from component facts', () => {
  it('CANDIDATE_REJECTED (every acquired candidate disproven, no stronger contradiction) is PARTIAL-eligible', () => {
    const { admission, resolution } = admissionOf([
      [resolved('A'), [verified]],
      [resolved('B'), [verified]],
      [
        unresolved('Mafalda', 'UNCONFIRMED_MATCH'),
        [
          attempt({
            candidateAcquired: true,
            verificationDecision: 'REJECTED',
            verificationRule: 'QID_LINK_MISMATCH',
          }),
        ],
      ],
    ]);
    expect(resolution.components[2].deficit?.reason).toBe('CANDIDATE_REJECTED');
    expect(admission).toMatchObject({
      admitted: true,
      completeness: 'PARTIAL',
    });
  });

  it('IDENTITY_CONFLICT blocks PARTIAL', () => {
    const { admission, resolution } = admissionOf([
      [resolved('A'), [verified]],
      [resolved('B'), [verified]],
      [unresolved('C', 'IDENTITY_CONFLICT'), [verified]],
    ]);
    expect(resolution.components[2].deficit?.reason).toBe('IDENTITY_CONFLICT');
    expect(admission).toMatchObject({
      admitted: false,
      reason: 'BLOCKING_DEFICIT',
    });
  });

  it.each(['DESTINATION_INCOMPATIBLE', 'DESTINATION_COMPATIBILITY_UNKNOWN'])(
    '%s blocks PARTIAL',
    (reason) => {
      const { admission, resolution } = admissionOf([
        [resolved('A'), [verified]],
        [resolved('B'), [verified]],
        [unresolved('Area', reason), [attempt()]],
      ]);
      expect(resolution.components[2].deficit?.reason).toBe(reason);
      expect(admission).toMatchObject({
        admitted: false,
        reason: 'BLOCKING_DEFICIT',
      });
    },
  );

  it('PROVIDER_FAILURE blocks PARTIAL (SYSTEM_FAILURE)', () => {
    const { admission, resolution } = admissionOf([
      [resolved('A'), [verified]],
      [resolved('B'), [verified]],
      [
        unresolved('C', 'PROVIDER_FAILURE'),
        [attempt({ executionStatus: 'failed', failureReason: 'timeout' })],
      ],
    ]);
    expect(resolution.components[2].deficit).toEqual({
      reason: 'PROVIDER_FAILURE',
      classification: 'OPERATIONAL_FAILURE',
    });
    expect(admission).toMatchObject({
      admitted: false,
      reason: 'BLOCKING_DEFICIT',
    });
  });

  it('D4: a candidate left undecided because Wikidata was unavailable is IDENTITY_AUTHORITY_UNAVAILABLE (SYSTEM_FAILURE) and blocks PARTIAL', () => {
    const { admission, resolution } = admissionOf([
      [resolved('A'), [verified]],
      [resolved('B'), [verified]],
      [
        unresolved('C', 'UNCONFIRMED_MATCH'),
        [
          attempt({
            candidateAcquired: true,
            verificationDecision: 'INSUFFICIENT_EVIDENCE',
            verificationRule: 'WIKIDATA_UNAVAILABLE',
          }),
        ],
      ],
    ]);
    expect(resolution.components[2].deficit).toEqual({
      reason: 'IDENTITY_AUTHORITY_UNAVAILABLE',
      classification: 'OPERATIONAL_FAILURE',
    });
    expect(admission).toMatchObject({
      admitted: false,
      reason: 'BLOCKING_DEFICIT',
      blockingReasons: ['IDENTITY_AUTHORITY_UNAVAILABLE'],
    });
  });

  it('an undecided candidate without an authority failure stays CANDIDATE_UNCONFIRMED (eligible)', () => {
    const { admission, resolution } = admissionOf([
      [resolved('A'), [verified]],
      [resolved('B'), [verified]],
      [
        unresolved('C', 'UNCONFIRMED_MATCH'),
        [
          attempt({
            candidateAcquired: true,
            verificationDecision: 'INSUFFICIENT_EVIDENCE',
            verificationRule: 'NO_DECISIVE_EVIDENCE',
          }),
        ],
      ],
    ]);
    expect(resolution.components[2].deficit?.reason).toBe(
      'CANDIDATE_UNCONFIRMED',
    );
    expect(admission).toMatchObject({
      admitted: true,
      completeness: 'PARTIAL',
    });
  });

  it('two source members resolving to one GeoEntity count once toward the distinct floor', () => {
    const { admission } = admissionOf([
      [resolved('Caminito', 'geo-caminito'), [verified]],
      [
        unresolved('Don Carlos', 'AMBIGUOUS'),
        [
          attempt({
            candidateAcquired: true,
            verificationDecision: 'AMBIGUOUS',
          }),
        ],
      ],
      [resolved('Caminito Street', 'geo-caminito'), [verified]],
    ]);
    expect(admission).toMatchObject({
      admitted: false,
      reason: 'BELOW_DISTINCT_FLOOR',
      distinctResolvedGeoEntityIds: ['geo-caminito'],
    });
  });
});
