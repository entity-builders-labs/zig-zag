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
} from '../admission/structured-admission-policy';

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
        rule: 'structured-admission-v1',
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
        rule: 'structured-admission-v1',
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
}
