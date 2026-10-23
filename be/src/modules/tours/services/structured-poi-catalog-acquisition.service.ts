import { Injectable } from '@nestjs/common';
import { IdentityLinkRule, Prisma } from '@prisma/client';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { PrismaService } from '@core/database/prisma.service';
import {
  evaluateChildVisitUnit,
  ParentSiteCandidate,
} from '../admission/parent-site-visit-unit.policy';
import { geometryContainsPoint } from '@integrations/osm/utils/geojson-containment.util';
import {
  ADMISSION_SIGNAL_STRENGTHS,
  DEFAULT_VISIT_UNITS,
  admissionSignal,
  evaluateAdmissionRule,
} from '../admission/structured-admission-policy';
import { evaluateStructuredPlaceAdmissionFacts } from '../admission/structured-place-admission';
import {
  reconcileStructuredRecords,
  ReconciliationRecord,
  STRUCTURED_IDENTITY_RECONCILIATION_VERSION,
} from '../utils/structured-identity-reconciliation.policy';
import { PARENT_SITE_VISIT_UNIT_POLICY_VERSION } from '../admission/parent-site-visit-unit.policy';
import { ExperienceCatalogService } from './experience-catalog.service';
import { StructuredKnowledgePersistenceService } from './structured-knowledge-persistence.service';
import { StructuredPoiCandidate } from '../providers/structured-poi-acquisition.provider';
import {
  AdmissionDecision,
  AdmissionSignalEvidence,
} from '../admission/structured-admission-policy';

function toIdentityLinkRule(basis: string | undefined): IdentityLinkRule {
  switch (basis) {
    case 'IDENTICAL_PROVIDER_ID':
      return IdentityLinkRule.SAME_PROVIDER_ID;
    case 'SHARED_QID':
      return IdentityLinkRule.SHARED_ENCYCLOPEDIC_ID;
    case 'STRUCTURAL_RELATIONSHIP':
      return IdentityLinkRule.PROVIDER_STRUCTURAL_RELATION;
    case 'EXPLICIT_CROSS_LINK':
      return IdentityLinkRule.PROVIDER_CROSS_LINK;
    case 'STRUCTURAL_CORRESPONDENCE':
      return IdentityLinkRule.STRUCTURAL_CORRESPONDENCE;
    default:
      return IdentityLinkRule.FIRST_IDENTITY;
  }
}

function toPersistedAdmissionOutcome(
  decision: AdmissionDecision,
): 'ADMITTED' | 'EXCLUDED_CATEGORY' | 'INSUFFICIENT_ADMISSION_EVIDENCE' {
  if (decision.admitted) return 'ADMITTED';
  if ('reason' in decision) return decision.reason;
  throw new Error('Rejected admission decision is missing its typed reason');
}

export interface StructuredPoiPersistenceResult {
  status: 'SUCCEEDED';
  discoveredCount: number;
  canonicalCount: number;
  persistedCount: number;
  excludedCount: number;
  offeredGeoEntityIds: string[];
  candidateOutcomes: Array<{
    externalId: string;
    admissionOutcome:
      | 'ADMITTED'
      | 'EXCLUDED_CATEGORY'
      | 'INSUFFICIENT_ADMISSION_EVIDENCE'
      | 'IDENTITY_CONFLICT';
    visitUnitOutcome?:
      | 'SUB_FEATURE_OF'
      | 'PARENT_NOT_ADMITTED'
      | 'AMBIGUOUS_PARENT_RELATIONSHIP'
      | 'INDEPENDENTLY_VISITABLE';
    geoEntityId?: string;
  }>;
  possibleDuplicates: ReturnType<
    typeof reconcileStructuredRecords
  >['possibleDuplicates'];
  /** Edge-level visit-unit relation diagnostics (task 39.5). */
  relationDiagnostics: {
    membershipEdges: number;
    membershipMatches: number;
    parentAreasAvailable: number;
    containmentMatches: number;
    containmentWithoutDeclaredClass: number;
    upsertAttempts: number;
    upsertSucceeded: number;
  };
}

@Injectable()
export class StructuredPoiCatalogAcquisitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: ExperienceCatalogService,
    private readonly knowledge: StructuredKnowledgePersistenceService,
  ) {}

  /**
   * The encyclopedic admission evidence previously recorded for the items
   * whose lookup is UNAVAILABLE in this run. A resolved observation (KNOWN or
   * NOT_FOUND) always replaces it; nothing is invented when no prior
   * evaluation exists.
   */
  private async retainedEncyclopedicEvidence(
    geoEntityId: string,
    group: readonly StructuredPoiCandidate[],
  ): Promise<
    Array<AdmissionSignalEvidence & { provider: string; externalId: string }>
  > {
    const unavailable = new Set(
      group.flatMap((candidate) =>
        candidate.entityFacts?.status === 'UNAVAILABLE'
          ? [candidate.entityFacts.qid]
          : [],
      ),
    );
    if (unavailable.size === 0) return [];
    const prior = await this.prisma.geoEntityAdmission.findUnique({
      where: { geoEntityId },
      select: { evidence: true },
    });
    const recorded = (prior?.evidence as { signalEvidence?: unknown } | null)
      ?.signalEvidence;
    if (!Array.isArray(recorded)) return [];
    return recorded.flatMap((entry) => {
      const fact = entry as Partial<
        AdmissionSignalEvidence & { provider: string; externalId: string }
      >;
      return fact.provider === 'wikidata' &&
        typeof fact.externalId === 'string' &&
        unavailable.has(fact.externalId) &&
        typeof fact.signal === 'string' &&
        fact.signal in ADMISSION_SIGNAL_STRENGTHS &&
        typeof fact.field === 'string' &&
        (typeof fact.value === 'string' || typeof fact.value === 'number')
        ? [
            {
              signal: fact.signal,
              field: fact.field,
              value: fact.value,
              provider: fact.provider,
              externalId: fact.externalId,
            },
          ]
        : [];
    });
  }

  async persist(
    candidates: readonly StructuredPoiCandidate[],
  ): Promise<StructuredPoiPersistenceResult> {
    const byId = new Map(
      candidates.map((candidate) => [candidate.evidenceKey, candidate]),
    );
    const identityMemberOfIds = new Map<string, string[]>();
    for (const relation of byId.values()) {
      for (const memberId of relation.identityMemberIds ?? []) {
        identityMemberOfIds.set(memberId, [
          ...(identityMemberOfIds.get(memberId) ?? []),
          relation.evidenceKey,
        ]);
      }
    }
    const records: ReconciliationRecord[] = [...byId.values()].map(
      (candidate) => {
        const facts = candidate.admissionFacts;
        const point =
          candidate.osmGeometry.type === 'Point'
            ? {
                kind: 'POINT' as const,
                latitude: candidate.osmGeometry.coordinates[1],
                longitude: candidate.osmGeometry.coordinates[0],
              }
            : undefined;
        return {
          id: candidate.evidenceKey,
          providerId: candidate.evidenceKey,
          osmType: candidate.osmType,
          qid: candidate.canonicalIdentity?.wikidataQid,
          names: [candidate.title],
          geometry: point,
          canonicalClass: facts.placeClasses[0],
          memberOfIds: identityMemberOfIds.get(candidate.evidenceKey),
        };
      },
    );
    const reconciled = reconcileStructuredRecords(records);
    const rootById = new Map(records.map((record) => [record.id, record.id]));
    const findRoot = (id: string): string => {
      let root = rootById.get(id) ?? id;
      while (rootById.get(root) !== root) root = rootById.get(root)!;
      return root;
    };
    for (const merge of reconciled.merges) {
      for (const mergedId of merge.merged) {
        const childRoot = findRoot(mergedId);
        const keptRoot = findRoot(merge.kept);
        for (const [id, root] of rootById) {
          if (root === childRoot) rootById.set(id, keptRoot);
        }
        rootById.set(mergedId, keptRoot);
      }
    }

    const groups = new Map<string, StructuredPoiCandidate[]>();
    for (const candidate of byId.values()) {
      const root = findRoot(candidate.evidenceKey);
      groups.set(root, [...(groups.get(root) ?? []), candidate]);
    }
    const persistedIds = new Map<string, string>();
    const admissionByGeoEntityId = new Map<string, boolean>();
    const admissionRecordByGeoEntityId = new Map<
      string,
      ReturnType<typeof evaluateStructuredPlaceAdmissionFacts>
    >();
    const admissionEvidenceByGeoEntityId = new Map<
      string,
      NonNullable<
        Parameters<
          StructuredKnowledgePersistenceService['upsertAdmission']
        >[2]['signalEvidence']
      >
    >();
    const candidateOutcomes: StructuredPoiPersistenceResult['candidateOutcomes'] =
      [];
    let persistedCount = 0;

    for (const [root, group] of groups) {
      group.sort((a, b) => a.evidenceKey.localeCompare(b.evidenceKey));
      const representative =
        group.find((candidate) => candidate.osmType !== 'node') ?? group[0];
      const identities = group.flatMap((candidate) => [
        { provider: 'openstreetmap', externalId: candidate.evidenceKey },
        ...(candidate.canonicalIdentity?.wikidataQid
          ? [
              {
                provider: 'wikidata',
                externalId: candidate.canonicalIdentity.wikidataQid,
              },
            ]
          : []),
      ]);
      const saved = await this.catalog.upsertGeoEntityWithIdentities({
        name: representative.title,
        kind: 'PLACE',
        identities,
        latitude: representative.geo?.latitude,
        longitude: representative.geo?.longitude,
        geometry: representative.osmGeometry as GeoJsonGeometry,
      });
      if (saved.status === 'IDENTITY_CONFLICT') {
        candidateOutcomes.push(
          ...group.map((candidate) => ({
            externalId: candidate.evidenceKey,
            admissionOutcome: 'IDENTITY_CONFLICT' as const,
          })),
        );
        continue;
      }
      const geoEntityId = saved.geoEntity.id;
      persistedCount++;
      for (const candidate of group)
        persistedIds.set(candidate.evidenceKey, geoEntityId);

      for (const identity of identities) {
        const merge = reconciled.merges.find(
          (item) =>
            item.kept === root &&
            (item.merged.includes(identity.externalId) ||
              identity.externalId === candidateQidFor(identity, group)),
        );
        await this.prisma.geoEntityIdentity.update({
          where: {
            provider_externalId: {
              provider: identity.provider,
              externalId: identity.externalId,
            },
          },
          data: {
            linkRule:
              identity.provider === 'wikidata'
                ? IdentityLinkRule.SHARED_ENCYCLOPEDIC_ID
                : identity.externalId === root
                  ? IdentityLinkRule.FIRST_IDENTITY
                  : toIdentityLinkRule(merge?.basis),
            linkPolicyVersion: STRUCTURED_IDENTITY_RECONCILIATION_VERSION,
            linkEvidence: {
              mergeBasis: merge?.basis ?? 'FIRST_IDENTITY',
              evidence: merge?.evidence ?? [identity.externalId],
            } as Prisma.InputJsonValue,
          },
        });
      }

      const evaluations = group.map((candidate) =>
        evaluateStructuredPlaceAdmissionFacts({
          osmFacts: candidate.admissionFacts,
          wikidataFacts:
            candidate.entityFacts?.status === 'KNOWN'
              ? candidate.entityFacts.admission
              : undefined,
        }),
      );
      // Unavailable is not absence: an encyclopedic lookup that failed this
      // run keeps the evidence the previous evaluation recorded for that
      // item, so a provider outage cannot revoke an admission (C17).
      const retainedEvidence = await this.retainedEncyclopedicEvidence(
        geoEntityId,
        group,
      );
      const signals = [
        ...new Set([
          ...evaluations.flatMap((item) => item.signals),
          ...retainedEvidence.map((fact) => fact.signal),
        ]),
      ];
      const exclusions = [
        ...new Set(evaluations.flatMap((item) => item.exclusions)),
      ];
      const admission = {
        policyVersion: evaluations[0].policyVersion,
        signals,
        exclusions,
        signalEvidence: evaluations
          .flatMap((evaluation, index) => [
            ...evaluation.signalEvidence.map((fact) => ({
              ...fact,
              provider: 'openstreetmap',
              externalId: group[index].evidenceKey,
            })),
            ...evaluation.encyclopedicSignalEvidence.map((fact) => ({
              ...fact,
              provider: 'wikidata',
              externalId: group[index].entityFacts!.qid,
            })),
          ])
          .concat(retainedEvidence),
        // Provider-attributed above; nothing remains unattributed.
        encyclopedicSignalEvidence: [] as AdmissionSignalEvidence[],
        decision: evaluateAdmissionRule(
          signals.map(admissionSignal),
          exclusions,
        ),
      };
      admissionByGeoEntityId.set(geoEntityId, admission.decision.admitted);
      admissionRecordByGeoEntityId.set(geoEntityId, admission);
      admissionEvidenceByGeoEntityId.set(geoEntityId, admission.signalEvidence);
      const persistedOutcome = toPersistedAdmissionOutcome(admission.decision);
      candidateOutcomes.push(
        ...group.map((candidate) => ({
          externalId: candidate.evidenceKey,
          geoEntityId,
          admissionOutcome: persistedOutcome,
        })),
      );
    }

    const subFeatureEntityIds = new Set<string>();
    const relationDiagnostics: StructuredPoiPersistenceResult['relationDiagnostics'] =
      {
        membershipEdges: [...byId.values()].reduce(
          (total, parent) => total + (parent.memberIds?.length ?? 0),
          0,
        ),
        membershipMatches: 0,
        parentAreasAvailable: 0,
        containmentMatches: 0,
        containmentWithoutDeclaredClass: 0,
        upsertAttempts: 0,
        upsertSucceeded: 0,
      };
    // Design C5 basis (2): parent-site areas for geometric containment.
    const parentAreas = [...byId.values()].flatMap((parent) =>
      parent.parentAreaGeometry && parent.visitUnitFacts.parentClass
        ? [
            {
              parent,
              parentClass: parent.visitUnitFacts.parentClass,
              area: parent.parentAreaGeometry,
              bbox: geometryBounds(parent.parentAreaGeometry),
            },
          ]
        : [],
    );
    relationDiagnostics.parentAreasAvailable = parentAreas.length;
    for (const child of byId.values()) {
      const childId = persistedIds.get(child.evidenceKey);
      const childFacts = child.visitUnitFacts;
      if (!childId || !childFacts.childClass) continue;
      const parents: Array<{
        candidate: StructuredPoiCandidate;
        policyInput: ParentSiteCandidate;
      }> = [];
      for (const parent of byId.values()) {
        if (!parent.memberIds?.includes(child.evidenceKey)) continue;
        const parentId = persistedIds.get(parent.evidenceKey);
        const parentClass = parent.visitUnitFacts.parentClass;
        if (!parentId || !parentClass || parentId === childId) continue;
        relationDiagnostics.membershipMatches++;
        parents.push({
          candidate: parent,
          policyInput: {
            parentId,
            parentClass,
            basis: { kind: 'EXPLICIT_PROVIDER_RELATIONSHIP' },
          },
        });
      }
      const point =
        child.osmGeometry.type === 'Point'
          ? child.osmGeometry.coordinates
          : undefined;
      for (const { parent, parentClass, area, bbox } of point
        ? parentAreas
        : []) {
        const parentId = persistedIds.get(parent.evidenceKey);
        if (!parentId || parentId === childId) continue;
        if (parents.some((item) => item.policyInput.parentId === parentId)) {
          continue;
        }
        const [longitude, latitude] = point!;
        if (
          longitude < bbox.minLon ||
          longitude > bbox.maxLon ||
          latitude < bbox.minLat ||
          latitude > bbox.maxLat ||
          !geometryContainsPoint(area, longitude, latitude)
        ) {
          continue;
        }
        // Containment establishes a relationship only with a declared
        // (child class, parent class) relationship class (C5); otherwise it
        // is the CONTAINMENT_WITHOUT_RELATIONSHIP diagnostic.
        if (!DEFAULT_VISIT_UNITS[`${childFacts.childClass}:${parentClass}`]) {
          relationDiagnostics.containmentWithoutDeclaredClass++;
          continue;
        }
        relationDiagnostics.containmentMatches++;
        parents.push({
          candidate: parent,
          policyInput: {
            parentId,
            parentClass,
            basis: { kind: 'CONTAINMENT' },
          },
        });
      }
      if (parents.length === 0) continue;
      const outcome = evaluateChildVisitUnit({
        childClass: childFacts.childClass,
        parents: parents.map((parent) => parent.policyInput),
        perInstanceEvidence: childFacts.perInstanceEvidence,
        parentAdmitted: new Map(
          parents.map(({ policyInput }) => [
            policyInput.parentId,
            admissionByGeoEntityId.get(policyInput.parentId) === true,
          ]),
        ),
      });
      const classification =
        outcome.outcome === 'SUB_FEATURE_OF' ||
        outcome.outcome === 'PARENT_NOT_ADMITTED'
          ? outcome.visitUnit
          : outcome.outcome === 'INDEPENDENTLY_VISITABLE'
            ? 'CHILD_INDEPENDENTLY_VISITABLE'
            : outcome.outcome === 'AMBIGUOUS_PARENT_RELATIONSHIP'
              ? 'AMBIGUOUS_PARENT_RELATIONSHIP'
              : undefined;
      const childOutcome = candidateOutcomes.find(
        (item) => item.externalId === child.evidenceKey,
      );
      if (childOutcome && outcome.outcome !== 'NO_PARENT_RELATIONSHIP') {
        childOutcome.visitUnitOutcome = outcome.outcome;
      }
      for (const parent of parents) {
        const parentId = parent.policyInput.parentId;
        const contained = parent.policyInput.basis.kind === 'CONTAINMENT';
        relationDiagnostics.upsertAttempts++;
        await this.knowledge.upsertRelation({
          childId,
          parentId,
          evidenceSource: contained
            ? 'DECLARED_CONTAINMENT'
            : 'PROVIDER_SITE_MEMBERSHIP',
          evidence: {
            provider: 'openstreetmap',
            parent: parent.candidate.evidenceKey,
            member: child.evidenceKey,
            basis: parent.policyInput.basis.kind,
            ...(contained
              ? {
                  relationshipClass: `${childFacts.childClass}:${parent.policyInput.parentClass}`,
                }
              : {}),
          },
          visitUnitClassification: classification,
          classificationVersion: PARENT_SITE_VISIT_UNIT_POLICY_VERSION,
        });
        relationDiagnostics.upsertSucceeded++;
      }
      if (outcome.outcome === 'SUB_FEATURE_OF') {
        subFeatureEntityIds.add(childId);
      }
    }

    // Persist C14 knowledge only after identity and visit-unit decisions.
    for (const group of groups.values()) {
      group.sort((a, b) => a.evidenceKey.localeCompare(b.evidenceKey));
      const geoEntityId = persistedIds.get(group[0].evidenceKey);
      const admission = geoEntityId
        ? admissionRecordByGeoEntityId.get(geoEntityId)
        : undefined;
      if (!geoEntityId || !admission) continue;
      const representative =
        group.find((candidate) => candidate.osmType !== 'node') ?? group[0];
      const identities = group.flatMap((candidate) => [
        { provider: 'openstreetmap', externalId: candidate.evidenceKey },
        ...(candidate.canonicalIdentity?.wikidataQid
          ? [
              {
                provider: 'wikidata',
                externalId: candidate.canonicalIdentity.wikidataQid,
              },
            ]
          : []),
      ]);
      await this.knowledge.upsertAdmission(geoEntityId, admission, {
        provider: 'openstreetmap',
        externalId: representative.evidenceKey,
        identities,
        signalEvidence: admissionEvidenceByGeoEntityId.get(geoEntityId),
      });
      await this.knowledge.replaceProminenceEvidence(
        geoEntityId,
        prominenceObservation(group),
      );
      const hoursCandidate = group.find(
        (candidate) => candidate.openingHoursEvidence,
      );
      if (hoursCandidate?.openingHoursEvidence) {
        await this.knowledge.upsertOpeningHours(geoEntityId, {
          source: 'openstreetmap',
          sourceRecordRef: hoursCandidate.evidenceKey,
          sourceRaw: hoursCandidate.openingHoursEvidence,
        });
      }
      const durationFacts = group.flatMap((candidate) =>
        candidate.visitDurationEvidence
          ? [
              {
                externalId: candidate.evidenceKey,
                typicalMinutes: candidate.visitDurationEvidence.typicalMinutes,
                rawValue: candidate.visitDurationEvidence.rawValue,
                field: candidate.visitDurationEvidence.field,
              },
            ]
          : [],
      );
      const durationValues = [
        ...new Set(durationFacts.map((fact) => fact.typicalMinutes)),
      ];
      if (durationFacts.length > 0) {
        const isConflicting = durationValues.length > 1;
        const durationRecord = {
          geoEntityId,
          status: isConflicting
            ? ('CONFLICTING' as const)
            : ('RESOLVED' as const),
          minMinutes: null as number | null,
          typicalMinutes: isConflicting ? null : durationValues[0],
          maxMinutes: null as number | null,
          authorityClass: 'STRUCTURED_PROVIDER' as const,
          evidenceQuality: 'DIRECT_STRUCTURED_FACT',
          evidence: {
            provider: 'openstreetmap',
            facts: durationFacts,
          },
          resolverVersion: 'structured-poi-duration-v1',
          resolvedAt: new Date(),
        };
        await this.prisma.geoEntityVisitDuration.upsert({
          where: { geoEntityId },
          create: durationRecord,
          update: durationRecord,
        });
      }
    }

    const offeredGeoEntityIds = new Set<string>();
    let excludedCount = 0;
    for (const id of byId.keys()) {
      const geoEntityId = persistedIds.get(id);
      if (
        !geoEntityId ||
        admissionByGeoEntityId.get(geoEntityId) !== true ||
        subFeatureEntityIds.has(geoEntityId)
      ) {
        excludedCount++;
        continue;
      }
      offeredGeoEntityIds.add(geoEntityId);
    }

    return {
      status: 'SUCCEEDED',
      discoveredCount: candidates.length,
      canonicalCount: reconciled.canonical.length,
      persistedCount,
      excludedCount,
      offeredGeoEntityIds: [...offeredGeoEntityIds].sort(),
      candidateOutcomes: candidateOutcomes.sort((a, b) =>
        a.externalId.localeCompare(b.externalId),
      ),
      possibleDuplicates: reconciled.possibleDuplicates,
      relationDiagnostics,
    };
  }
}

/**
 * The prominence evidence observed for one canonical group, and the source
 * records whose observation this run completed. Only those records' rows are
 * replaced: an UNAVAILABLE encyclopedic lookup keeps previously persisted
 * evidence untouched (unavailable is not absence).
 */
function prominenceObservation(group: readonly StructuredPoiCandidate[]) {
  const observedSources = new Map<
    string,
    { sourceProvider: string; sourceRecordId: string }
  >();
  const facts = group.flatMap((candidate) => {
    observedSources.set(`openstreetmap|${candidate.evidenceKey}`, {
      sourceProvider: 'openstreetmap',
      sourceRecordId: candidate.evidenceKey,
    });
    const entity = candidate.entityFacts;
    if (entity && entity.status !== 'UNAVAILABLE') {
      observedSources.set(`wikidata|${entity.qid}`, {
        sourceProvider: 'wikidata',
        sourceRecordId: entity.qid,
      });
    }
    return [
      ...candidate.prominenceEvidence,
      ...(entity?.status === 'KNOWN' ? entity.prominence : []),
    ];
  });
  return { observedSources: [...observedSources.values()], facts };
}

function geometryBounds(geometry: GeoJsonGeometry) {
  const points: number[][] =
    geometry.type === 'Polygon'
      ? geometry.coordinates.flat()
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates.flat(2)
        : [];
  return {
    minLon: Math.min(...points.map((p) => p[0])),
    maxLon: Math.max(...points.map((p) => p[0])),
    minLat: Math.min(...points.map((p) => p[1])),
    maxLat: Math.max(...points.map((p) => p[1])),
  };
}

function candidateQidFor(
  identity: { provider: string; externalId: string },
  group: readonly StructuredPoiCandidate[],
): string | undefined {
  return identity.provider === 'wikidata' &&
    group.some(
      (candidate) =>
        candidate.canonicalIdentity?.wikidataQid === identity.externalId,
    )
    ? identity.externalId
    : undefined;
}
