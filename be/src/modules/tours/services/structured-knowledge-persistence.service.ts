import { Injectable } from '@nestjs/common';
import {
  AdmissionOutcome,
  AdmissionSignal,
  AdmissionExclusion,
  IdentityLinkRule,
  OpeningHoursStatus,
  VisitUnitClassification,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '@core/database/prisma.service';
import {
  StructuredPlaceAdmissionRecord,
  rejectionReason,
} from '../admission/structured-place-admission';
import {
  AdmissionExclusionClass,
  AdmissionSignalEvidence,
  isAdmissionExclusionPersisted,
  isRouteExclusion,
  STRUCTURED_ADMISSION_POLICY_VERSION,
} from '../admission/structured-admission-policy';
import {
  ProminenceEvidenceFact,
  STRUCTURED_PROMINENCE_POLICY_VERSION,
} from '../prominence/structured-prominence.policy';

/**
 * Persists the GeoEntity-keyed structured knowledge of design C14 (task 39.1):
 * GeoEntityAdmission, GeoEntityRelation, GeoEntityOpeningHours and the
 * GeoEntityIdentity link evidence. Typed outcomes + provenance only; no LLM,
 * web search or page fetch on this path, and no preference/duration/hours in
 * the admission decision (those come from the canonical policies).
 */

export interface OpeningHoursInput {
  timezone?: string;
  /** Versioned typed schedule document; null means UNKNOWN status. */
  schedule?: unknown;
  scheduleVersion?: number;
  source: string;
  sourceRecordRef?: string;
  sourceRaw?: string;
  parserVersion?: string;
}

export interface RelationInput {
  childId: string;
  parentId: string;
  evidenceSource:
    | 'PROVIDER_SITE_MEMBERSHIP'
    | 'ENCYCLOPEDIC_PART_OF'
    | 'DECLARED_CONTAINMENT';
  evidence: unknown;
  visitUnitClassification?: VisitUnitClassification;
  classificationVersion?: string;
}

export interface IdentityLinkInput {
  linkRule: IdentityLinkRule;
  linkPolicyVersion: string;
  linkEvidence: unknown;
}

export interface AdmissionProvenance {
  provider: string;
  externalId?: string;
  identities?: Array<{ provider: string; externalId: string }>;
  signalEvidence?: Array<
    AdmissionSignalEvidence & { provider: string; externalId: string }
  >;
}

function toAdmissionOutcome(
  record: StructuredPlaceAdmissionRecord,
): AdmissionOutcome {
  if (record.decision.admitted) return 'ADMITTED';
  return rejectionReason(record) === 'EXCLUDED_CATEGORY'
    ? 'EXCLUDED_CATEGORY'
    : 'INSUFFICIENT_ADMISSION_EVIDENCE';
}

/** Canonical exclusion class → persisted exclusion (SUB_FEATURE is derived). */
function toAdmissionExclusion(
  klass: AdmissionExclusionClass,
): AdmissionExclusion | undefined {
  if (!isAdmissionExclusionPersisted(klass)) return undefined;
  if (isRouteExclusion(klass)) return 'ROAD_OR_ROUTE_AS_PLACE';
  return klass as AdmissionExclusion;
}

@Injectable()
export class StructuredKnowledgePersistenceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Upserts the 1:1 GeoEntityAdmission row for a PLACE GeoEntity. */
  async upsertAdmission(
    geoEntityId: string,
    record: StructuredPlaceAdmissionRecord,
    provenance: AdmissionProvenance,
  ): Promise<void> {
    const evidence = {
      provider: provenance.provider,
      ...(provenance.externalId ? { externalId: provenance.externalId } : {}),
      ...(provenance.identities ? { identities: provenance.identities } : {}),
      signalEvidence:
        provenance.signalEvidence ??
        (provenance.externalId
          ? record.signalEvidence.map((fact) => ({
              ...fact,
              provider: provenance.provider,
              externalId: provenance.externalId!,
            }))
          : []),
      signals: record.signals,
      exclusions: record.exclusions,
      policyVersion: record.policyVersion,
    } as unknown as Prisma.InputJsonValue;
    await this.prisma.geoEntityAdmission.upsert({
      where: { geoEntityId },
      create: {
        geoEntityId,
        outcome: toAdmissionOutcome(record),
        rule: STRUCTURED_ADMISSION_POLICY_VERSION,
        signals: record.signals as AdmissionSignal[],
        exclusions: record.exclusions
          .map(toAdmissionExclusion)
          .filter((e): e is AdmissionExclusion => e !== undefined),
        policyVersion: record.policyVersion,
        evidence,
        evaluatedAt: new Date(),
      },
      update: {
        outcome: toAdmissionOutcome(record),
        rule: STRUCTURED_ADMISSION_POLICY_VERSION,
        signals: record.signals as AdmissionSignal[],
        exclusions: record.exclusions
          .map(toAdmissionExclusion)
          .filter((e): e is AdmissionExclusion => e !== undefined),
        policyVersion: record.policyVersion,
        evidence,
        evaluatedAt: new Date(),
      },
    });
  }

  /** Upserts an N:M PART_OF relation between two GeoEntities. */
  async upsertRelation(input: RelationInput): Promise<void> {
    await this.prisma.geoEntityRelation.upsert({
      where: {
        childId_parentId_type: {
          childId: input.childId,
          parentId: input.parentId,
          type: 'PART_OF',
        },
      },
      create: {
        childId: input.childId,
        parentId: input.parentId,
        type: 'PART_OF',
        evidenceSource: input.evidenceSource,
        evidence: input.evidence as object,
        visitUnitClassification: input.visitUnitClassification,
        classificationVersion: input.classificationVersion,
        evaluatedAt: new Date(),
      },
      update: {
        evidenceSource: input.evidenceSource,
        evidence: input.evidence as object,
        visitUnitClassification: input.visitUnitClassification,
        classificationVersion: input.classificationVersion,
        evaluatedAt: new Date(),
      },
    });
  }

  /** Upserts the 1:1 GeoEntityOpeningHours row for a GeoEntity. */
  async upsertOpeningHours(
    geoEntityId: string,
    input: OpeningHoursInput,
  ): Promise<void> {
    const status: OpeningHoursStatus =
      input.schedule !== undefined ? 'KNOWN' : 'UNKNOWN';
    await this.prisma.geoEntityOpeningHours.upsert({
      where: { geoEntityId },
      create: {
        geoEntityId,
        status,
        timezone: input.timezone,
        schedule: input.schedule as object | undefined,
        scheduleVersion: input.scheduleVersion,
        source: input.source,
        sourceRecordRef: input.sourceRecordRef,
        sourceRaw: input.sourceRaw,
        parserVersion: input.parserVersion,
        retrievedAt: new Date(),
      },
      update: {
        status,
        timezone: input.timezone,
        schedule: input.schedule as object | undefined,
        scheduleVersion: input.scheduleVersion,
        source: input.source,
        sourceRecordRef: input.sourceRecordRef,
        sourceRaw: input.sourceRaw,
        parserVersion: input.parserVersion,
        retrievedAt: new Date(),
      },
    });
  }

  /** Records the merge decision on a GeoEntityIdentity attachment. */
  async attachIdentityLink(
    identityId: string,
    link: IdentityLinkInput,
  ): Promise<void> {
    await this.prisma.geoEntityIdentity.update({
      where: { id: identityId },
      data: {
        linkRule: link.linkRule,
        linkPolicyVersion: link.linkPolicyVersion,
        linkEvidence: link.linkEvidence as object,
      },
    });
  }

  /**
   * Replaces the GeoEntity's prominence evidence for exactly the source
   * records whose observation completed (design C17, task 39.3). Rows of
   * other records — including an encyclopedic item whose lookup was
   * unavailable this run — are left untouched; an empty observation stores
   * nothing (UNKNOWN), never a zero or negative row. Identity, admission and
   * Experience state are not read or written here.
   */
  async replaceProminenceEvidence(
    geoEntityId: string,
    observation: {
      observedSources: Array<{
        sourceProvider: string;
        sourceRecordId: string;
      }>;
      facts: readonly ProminenceEvidenceFact[];
    },
  ): Promise<void> {
    const observed = new Set(
      observation.observedSources.map(
        (source) => `${source.sourceProvider}|${source.sourceRecordId}`,
      ),
    );
    const facts = observation.facts.filter((fact) =>
      observed.has(`${fact.sourceProvider}|${fact.sourceRecordId}`),
    );
    const keyOf = (fact: {
      kind: string;
      sourceProvider: string;
      sourceRecordId: string;
      fieldPath: string;
    }) =>
      [
        fact.kind,
        fact.sourceProvider,
        fact.sourceRecordId,
        fact.fieldPath,
      ].join('|');
    const wanted = new Map(facts.map((fact) => [keyOf(fact), fact]));
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.geoEntityProminenceEvidence.findMany({
        where: {
          geoEntityId,
          OR: observation.observedSources.map((source) => ({
            sourceProvider: source.sourceProvider,
            sourceRecordId: source.sourceRecordId,
          })),
        },
        select: {
          id: true,
          kind: true,
          sourceProvider: true,
          sourceRecordId: true,
          fieldPath: true,
        },
      });
      const stale = existing.filter((row) => !wanted.has(keyOf(row)));
      if (stale.length > 0) {
        await tx.geoEntityProminenceEvidence.deleteMany({
          where: { id: { in: stale.map((row) => row.id) } },
        });
      }
      for (const fact of wanted.values()) {
        const data = {
          providerIdentity: fact.providerIdentity,
          numericValue: fact.numericValue ?? null,
          textValue: fact.textValue ?? null,
          languageCode: fact.languageCode ?? null,
          authority: fact.authority ?? null,
          designationLevel: fact.designationLevel ?? null,
          heritageScope: fact.heritageScope ?? null,
          providerMetric: fact.providerMetric ?? null,
          comparisonScope: fact.comparisonScope ?? null,
          observedAt: fact.observedAt,
          policyVersion: STRUCTURED_PROMINENCE_POLICY_VERSION,
        };
        await tx.geoEntityProminenceEvidence.upsert({
          where: {
            geoEntityId_kind_sourceProvider_sourceRecordId_fieldPath: {
              geoEntityId,
              kind: fact.kind,
              sourceProvider: fact.sourceProvider,
              sourceRecordId: fact.sourceRecordId,
              fieldPath: fact.fieldPath,
            },
          },
          create: {
            geoEntityId,
            kind: fact.kind,
            sourceProvider: fact.sourceProvider,
            sourceRecordId: fact.sourceRecordId,
            fieldPath: fact.fieldPath,
            ...data,
          },
          update: data,
        });
      }
    });
  }
}
