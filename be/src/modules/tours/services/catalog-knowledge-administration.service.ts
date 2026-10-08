import { Injectable } from '@nestjs/common';
import { ExperienceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@core/database/prisma.service';
import { normalizeGeoName } from '../utils/nominatim-match.util';
import {
  SourceCompositionCompleteness,
  SourceMemberResolution,
  decideSourceCompositionAdmission,
} from '../utils/experience-source-membership.policy';

/**
 * Administrative correction of learned catalog knowledge (backend primitives
 * only; no UI and no role model yet).
 *
 * Two actions, both audited and both atomic:
 *
 *  - REVOKE_VERIFIED_HINT (`revokeVerifiedHintAssertion`): withdraws one
 *    assertion "hint H identifies GeoEntity G". The assertion row is stamped,
 *    never deleted. When no other active assertion supports (H, G), H leaves
 *    G's fast lookup index, and every RESOLVED source member that was linked
 *    to G under the same hint key becomes UNRESOLVED (RESOLUTION_REVOKED).
 *    Each affected Experience is re-judged by the canonical admission rule:
 *    it stays VERIFIED (COMPLETE or PARTIAL) when it still qualifies, and is
 *    ARCHIVED (rows kept) when it no longer does.
 *  - CONFIRM_EXISTING_GEOENTITY (`confirmSourceMember`): links one UNRESOLVED
 *    source member to an existing GeoEntity, records an ADMIN assertion for
 *    the member's hint and adds it to the fast lookup index, so a later
 *    `findGeoEntityCandidatesForHint` returns that GeoEntity as VERIFIED_HINT.
 *    It fails explicitly when the hint is already active on another
 *    GeoEntity: one active hint never silently points at two GeoEntities.
 *
 * LEAVE_UNRESOLVED needs no write. Creating/importing a GeoEntity is out of
 * scope. `actorUserId` is optional: it is recorded when the caller has an
 * authenticated user; authorization is future work.
 *
 * Both actions change an Experience's semantic document, so its embedding is
 * cleared for re-indexing. Existing Tours are never touched: they hold their
 * own `TourExperienceComponent` snapshot.
 */

export type RevokeVerifiedHintResult =
  | { status: 'NOT_FOUND' }
  | { status: 'ALREADY_REVOKED'; revokedAt: Date }
  | {
      status: 'REVOKED';
      assertionId: string;
      geoEntityId: string;
      hintKey: string;
      /** False when another active assertion still supports the pair. */
      removedFromLookupIndex: boolean;
      unresolvedMemberIds: string[];
      experiences: Array<{
        experienceId: string;
        outcome: SourceCompositionCompleteness | 'ARCHIVED';
      }>;
    };

export type ConfirmSourceMemberResult =
  | { status: 'MEMBER_NOT_FOUND' }
  | { status: 'MEMBER_NOT_UNRESOLVED' }
  | { status: 'GEO_ENTITY_NOT_FOUND' }
  | { status: 'EMPTY_HINT_KEY' }
  | {
      /** The member's hint is already active on other GeoEntities. */
      status: 'HINT_OWNED_BY_ANOTHER_GEOENTITY';
      hintKey: string;
      ownerGeoEntityIds: string[];
    }
  | {
      status: 'CONFIRMED';
      componentId: string;
      experienceId: string;
      geoEntityId: string;
      hintKey: string;
      completeness: SourceCompositionCompleteness;
    };

type Tx = Prisma.TransactionClient;

@Injectable()
export class CatalogKnowledgeAdministrationService {
  constructor(private readonly prisma: PrismaService) {}

  async revokeVerifiedHintAssertion(input: {
    assertionId: string;
    actorUserId?: string;
    reason?: string;
  }): Promise<RevokeVerifiedHintResult> {
    return this.prisma.$transaction(async (tx) => {
      const assertion = await tx.geoEntityVerifiedHintAssertion.findUnique({
        where: { id: input.assertionId },
      });
      if (!assertion) return { status: 'NOT_FOUND' as const };
      await this.lockHintKey(tx, assertion.hintKey);
      const current = await tx.geoEntityVerifiedHintAssertion.findUniqueOrThrow(
        { where: { id: assertion.id } },
      );
      if (current.revokedAt) {
        return {
          status: 'ALREADY_REVOKED' as const,
          revokedAt: current.revokedAt,
        };
      }

      await tx.geoEntityVerifiedHintAssertion.update({
        where: { id: current.id },
        data: {
          revokedAt: new Date(),
          revokedByUserId: input.actorUserId ?? null,
          revocationReason: input.reason ?? null,
        },
      });
      const stillSupported = await tx.geoEntityVerifiedHintAssertion.count({
        where: {
          geoEntityId: current.geoEntityId,
          hintKey: current.hintKey,
          revokedAt: null,
        },
      });
      if (stillSupported > 0) {
        return {
          status: 'REVOKED' as const,
          assertionId: current.id,
          geoEntityId: current.geoEntityId,
          hintKey: current.hintKey,
          removedFromLookupIndex: false,
          unresolvedMemberIds: [] as string[],
          experiences: [] as Array<{
            experienceId: string;
            outcome: SourceCompositionCompleteness | 'ARCHIVED';
          }>,
        };
      }

      await this.removeFromLookupIndex(
        tx,
        current.geoEntityId,
        current.hintKey,
      );

      // Source members linked to G under this hint lose their resolution.
      const linked = await tx.experienceComponent.findMany({
        where: {
          geoEntityId: current.geoEntityId,
          resolutionState: 'RESOLVED',
          sourceName: { not: null },
        },
        select: { id: true, experienceId: true, sourceName: true },
      });
      const revokedMembers = linked.filter(
        (member) => normalizeGeoName(member.sourceName!) === current.hintKey,
      );
      if (revokedMembers.length > 0) {
        await tx.experienceComponent.updateMany({
          where: { id: { in: revokedMembers.map((member) => member.id) } },
          data: {
            geoEntityId: null,
            resolutionState: 'UNRESOLVED',
            resolutionReason: 'RESOLUTION_REVOKED',
            resolutionSource: null,
          },
        });
      }

      const experiences: Array<{
        experienceId: string;
        outcome: SourceCompositionCompleteness | 'ARCHIVED';
      }> = [];
      for (const experienceId of [
        ...new Set(revokedMembers.map((member) => member.experienceId)),
      ].sort()) {
        experiences.push({
          experienceId,
          outcome: await this.rejudgeExperience(tx, experienceId),
        });
      }
      return {
        status: 'REVOKED' as const,
        assertionId: current.id,
        geoEntityId: current.geoEntityId,
        hintKey: current.hintKey,
        removedFromLookupIndex: true,
        unresolvedMemberIds: revokedMembers.map((member) => member.id).sort(),
        experiences,
      };
    });
  }

  async confirmSourceMember(input: {
    componentId: string;
    geoEntityId: string;
    actorUserId?: string;
  }): Promise<ConfirmSourceMemberResult> {
    return this.prisma.$transaction(async (tx) => {
      const member = await tx.experienceComponent.findUnique({
        where: { id: input.componentId },
      });
      if (!member) return { status: 'MEMBER_NOT_FOUND' as const };
      const hintKey = normalizeGeoName(member.sourceName ?? '');
      if (!hintKey) return { status: 'EMPTY_HINT_KEY' as const };
      await this.lockHintKey(tx, hintKey);
      const locked = await tx.experienceComponent.findUniqueOrThrow({
        where: { id: member.id },
      });
      if (locked.resolutionState !== 'UNRESOLVED') {
        return { status: 'MEMBER_NOT_UNRESOLVED' as const };
      }
      const geoEntity = await tx.geoEntity.findUnique({
        where: { id: input.geoEntityId },
        select: { id: true },
      });
      if (!geoEntity) return { status: 'GEO_ENTITY_NOT_FOUND' as const };

      const owners = await this.activeHintOwners(tx, hintKey);
      const otherOwners = owners.filter((id) => id !== geoEntity.id);
      if (otherOwners.length > 0) {
        return {
          status: 'HINT_OWNED_BY_ANOTHER_GEOENTITY' as const,
          hintKey,
          ownerGeoEntityIds: otherOwners,
        };
      }

      await tx.experienceComponent.update({
        where: { id: locked.id },
        data: {
          geoEntityId: geoEntity.id,
          resolutionState: 'RESOLVED',
          resolutionReason: null,
          resolutionSource: 'ADMIN',
        },
      });
      await tx.geoEntityVerifiedHintAssertion.createMany({
        data: [
          {
            geoEntityId: geoEntity.id,
            hintName: locked.sourceName!,
            hintKey,
            source: 'ADMIN',
            actorUserId: input.actorUserId ?? null,
          },
        ],
        skipDuplicates: true,
      });
      await tx.$executeRaw`
        UPDATE "geo_entity"
        SET "verifiedHintNames" = array_append("verifiedHintNames", ${locked.sourceName!}),
            "verifiedHintNameKeys" = array_append("verifiedHintNameKeys", ${hintKey}),
            "updatedAt" = NOW()
        WHERE "id" = ${geoEntity.id}
          AND NOT ("verifiedHintNameKeys" @> ARRAY[${hintKey}]::text[])`;

      const outcome = await this.rejudgeExperience(tx, locked.experienceId);
      if (outcome === 'ARCHIVED') {
        // Resolving a member can never disqualify a composition.
        throw new Error(
          `Confirming member ${locked.id} unexpectedly disqualified Experience ${locked.experienceId}`,
        );
      }
      return {
        status: 'CONFIRMED' as const,
        componentId: locked.id,
        experienceId: locked.experienceId,
        geoEntityId: geoEntity.id,
        hintKey,
        completeness: outcome,
      };
    });
  }

  /**
   * GeoEntities whose fast index or active assertions currently carry the
   * key. Both are read so a stale index entry is never silently ignored.
   */
  private async activeHintOwners(tx: Tx, hintKey: string): Promise<string[]> {
    const [indexed, asserted] = await Promise.all([
      tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "geo_entity"
        WHERE "verifiedHintNameKeys" @> ARRAY[${hintKey}]::text[]`,
      tx.geoEntityVerifiedHintAssertion.findMany({
        where: { hintKey, revokedAt: null },
        select: { geoEntityId: true },
      }),
    ]);
    return [
      ...new Set([
        ...indexed.map((row) => row.id),
        ...asserted.map((row) => row.geoEntityId),
      ]),
    ].sort();
  }

  /** Removes one key (and its aligned verbatim name) from the fast index. */
  private async removeFromLookupIndex(
    tx: Tx,
    geoEntityId: string,
    hintKey: string,
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE "geo_entity" g
      SET "verifiedHintNames" = COALESCE((
            SELECT array_agg(hint.name ORDER BY hint.position)
            FROM unnest(g."verifiedHintNames", g."verifiedHintNameKeys")
              WITH ORDINALITY AS hint(name, key, position)
            WHERE hint.key <> ${hintKey}
          ), ARRAY[]::text[]),
          "verifiedHintNameKeys" = COALESCE((
            SELECT array_agg(hint.key ORDER BY hint.position)
            FROM unnest(g."verifiedHintNames", g."verifiedHintNameKeys")
              WITH ORDINALITY AS hint(name, key, position)
            WHERE hint.key <> ${hintKey}
          ), ARRAY[]::text[]),
          "updatedAt" = NOW()
      WHERE g."id" = ${geoEntityId}
        AND g."verifiedHintNameKeys" @> ARRAY[${hintKey}]::text[]`;
  }

  /**
   * Re-applies the canonical admission rule to a persisted Experience after
   * one of its members changed, and clears its embedding (its semantic
   * document changed). A no-longer-admissible Experience is ARCHIVED, never
   * deleted, so its source members stay available for later enrichment.
   */
  private async rejudgeExperience(
    tx: Tx,
    experienceId: string,
  ): Promise<SourceCompositionCompleteness | 'ARCHIVED'> {
    const members = await tx.experienceComponent.findMany({
      where: { experienceId },
      select: {
        geoEntityId: true,
        resolutionState: true,
        resolutionReason: true,
      },
    });
    const admission = decideSourceCompositionAdmission(
      members.map(
        (member): SourceMemberResolution =>
          member.resolutionState === 'UNRESOLVED'
            ? {
                identityStatus: 'UNRESOLVED',
                deficitReason: member.resolutionReason!,
              }
            : {
                identityStatus: 'RESOLVED',
                geoEntityId: member.geoEntityId!,
              },
      ),
    );
    const admitted = !('reason' in admission);
    await tx.experience.update({
      where: { id: experienceId },
      data: {
        ...(admitted ? {} : { status: ExperienceStatus.ARCHIVED }),
        embeddingProvider: null,
        embeddingModel: null,
        embeddingDimensions: null,
        embeddingDocumentVersion: null,
        embeddedAt: null,
      },
    });
    await tx.$executeRaw`UPDATE "experience" SET "embedding" = NULL WHERE "id" = ${experienceId}`;
    return 'reason' in admission ? 'ARCHIVED' : admission.completeness;
  }

  /** Serializes every admin write on one hint key. */
  private async lockHintKey(tx: Tx, hintKey: string): Promise<void> {
    const lock = `verified-hint:${hintKey}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lock}))`;
  }
}
