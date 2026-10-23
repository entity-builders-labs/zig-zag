/*
 * Version-tolerant helpers for run-catalog-smoke.ts, so the same harness
 * measures the pre-change HEAD and the post-change workstream. Diagnostics
 * only; nothing here feeds production decisions.
 */
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { OsmPlacesService } from '../../be/src/modules/integrations/osm/services/osm-places.service';
import { osmTagsToVisitUnitFacts } from '../../be/src/modules/integrations/osm/utils/osm-admission-adapter';
import { WikidataApiService } from '../../be/src/modules/integrations/wikidata/services/wikidata-api.service';
import { StructuredPoiAcquisitionProvider } from '../../be/src/modules/tours/providers/structured-poi-acquisition.provider';
import { ExperienceAcquisitionPlannerService } from '../../be/src/modules/tours/services/experience-acquisition-planner.service';

export function buildStructuredPoiProvider(
  osmPlaces: OsmPlacesService,
  config: ConfigService,
): StructuredPoiAcquisitionProvider {
  // The production wiring injects the identity-linked encyclopedic provider
  // (task 39.3); the pre-39.3 constructor ignores the extra argument.
  const Provider = StructuredPoiAcquisitionProvider as unknown as new (
    ...args: unknown[]
  ) => StructuredPoiAcquisitionProvider;
  return new Provider(osmPlaces, new WikidataApiService(config));
}

export function buildPlan(
  planner: ExperienceAcquisitionPlannerService,
  destination: Record<string, unknown>,
) {
  return planner.buildAcquisitionPlan({
    destination: destination as any,
    deficits: [
      {
        origin: 'global_capacity',
        reason: 'Destination catalog has candidate-supply capacity gap',
        currentEligibleCount: 0,
        requiredEligibleCount: 1,
      },
    ],
  } as any);
}

export async function readProminence(prisma: any) {
  const [{ exists }] = await prisma.$queryRaw(
    Prisma.sql`SELECT to_regclass('geo_entity_prominence_evidence') IS NOT NULL AS exists`,
  );
  const rows: any[] = exists
    ? await prisma.$queryRaw(
        Prisma.sql`SELECT "geoEntityId", kind::text AS kind, "sourceProvider", "sourceRecordId", "fieldPath", "numericValue", "textValue", "designationLevel", "authority" FROM geo_entity_prominence_evidence`,
      )
    : [];
  const byGeoEntityId: Record<string, any[]> = {};
  for (const row of rows) {
    (byGeoEntityId[row.geoEntityId] ??= []).push({
      kind: row.kind,
      source: `${row.sourceProvider}:${row.sourceRecordId}`,
      field: row.fieldPath,
      value: row.numericValue ?? row.textValue ?? row.designationLevel,
      authority: row.authority ?? undefined,
    });
  }
  return {
    implemented: Boolean(exists),
    byGeoEntityId,
    summary(composedEntityIds: string[]) {
      const known = composedEntityIds.filter((id) => byGeoEntityId[id]?.length);
      const kinds: Record<string, number> = {};
      for (const id of composedEntityIds) {
        for (const kind of new Set((byGeoEntityId[id] ?? []).map((r) => r.kind))) {
          kinds[kind] = (kinds[kind] ?? 0) + 1;
        }
      }
      return {
        implemented: Boolean(exists),
        persistedFacts: rows.length,
        composedKnown: known.length,
        composedUnknown: composedEntityIds.length - known.length,
        composedByEvidenceKind: kinds,
      };
    },
  };
}

type Candidate = {
  id: string;
  name: string;
  osmType: string;
  tags: Record<string, string>;
  geometry: { type: string };
  memberIds?: string[];
};

export function diagnoseEdges(
  candidates: Candidate[],
  outcomes: Array<{ externalId: string; geoEntityId?: string }>,
  relations: Array<{ childId: string; parentId: string }>,
) {
  const byKey = new Map(candidates.map((c) => [c.id, c]));
  const facts = new Map(
    candidates.map((c) => [c.id, osmTagsToVisitUnitFacts(c.tags)]),
  );
  const geoByKey = new Map(outcomes.map((o) => [o.externalId, o.geoEntityId]));
  const persisted = new Set(relations.map((r) => `${r.childId}|${r.parentId}`));
  const childClassCounts: Record<string, number> = {};
  const parentClassCounts: Record<string, number> = {};
  const childTagBasis: Record<string, number> = {};
  for (const c of candidates) {
    const f = facts.get(c.id)!;
    if (f.childClass) {
      childClassCounts[f.childClass] = (childClassCounts[f.childClass] ?? 0) + 1;
      const basis = c.tags.tourism === 'artwork'
        ? 'tourism=artwork'
        : c.tags.historic === 'memorial'
          ? 'historic=memorial'
          : c.tags.amenity
            ? `amenity=${c.tags.amenity}`
            : c.tags.shop
              ? 'shop=*'
              : c.tags.craft
                ? 'craft=*'
                : `historic=${c.tags.historic}`;
      childTagBasis[basis] = (childTagBasis[basis] ?? 0) + 1;
    }
    if (f.parentClass) {
      parentClassCounts[f.parentClass] = (parentClassCounts[f.parentClass] ?? 0) + 1;
    }
  }
  const parentGeometry: Record<string, Record<string, number>> = {};
  for (const c of candidates) {
    const f = facts.get(c.id)!;
    if (!f.parentClass) continue;
    const key = `${c.osmType}:${c.geometry.type}`;
    parentGeometry[f.parentClass] ??= {};
    parentGeometry[f.parentClass][key] = (parentGeometry[f.parentClass][key] ?? 0) + 1;
  }

  const edges: any[] = [];
  const decisionCounts: Record<string, number> = {};
  const memberTypes: Record<string, number> = {};
  let relationsWithMembers = 0;
  for (const parent of candidates) {
    if (!parent.memberIds?.length) continue;
    relationsWithMembers++;
    const parentClass = facts.get(parent.id)?.parentClass;
    for (const memberId of parent.memberIds) {
      const memberType = memberId.split(':')[1];
      memberTypes[memberType] = (memberTypes[memberType] ?? 0) + 1;
      const member = byKey.get(memberId);
      const childClass = member ? facts.get(memberId)?.childClass : undefined;
      const childGeo = geoByKey.get(memberId);
      const parentGeo = geoByKey.get(parent.id);
      const decision = !member
        ? 'MEMBER_NOT_A_DISCOVERED_CANDIDATE'
        : !childClass
          ? 'MEMBER_HAS_NO_CHILD_CLASS'
          : !parentClass
            ? 'PARENT_HAS_NO_PARENT_CLASS'
            : !childGeo || !parentGeo
              ? 'IDENTITY_NOT_PERSISTED'
              : childGeo === parentGeo
                ? 'SAME_CANONICAL_ENTITY'
                : 'MATCH';
      decisionCounts[decision] = (decisionCounts[decision] ?? 0) + 1;
      edges.push({
        parent: parent.id,
        parentName: parent.name,
        parentClass: parentClass ?? null,
        member: memberId,
        memberName: member?.name ?? null,
        childClass: childClass ?? null,
        childGeoEntityId: childGeo ?? null,
        parentGeoEntityId: parentGeo ?? null,
        decision,
        relationPersisted:
          childGeo && parentGeo ? persisted.has(`${childGeo}|${parentGeo}`) : false,
      });
    }
  }
  return {
    childClassFacts: childClassCounts,
    childClassTagBasis: childTagBasis,
    parentClassFacts: parentClassCounts,
    parentGeometryByClass: parentGeometry,
    relationsWithMembers,
    membershipEdges: edges.length,
    memberTypes,
    edgeDecisions: decisionCounts,
    persistedRelations: relations.length,
    sampleEdges: edges.filter((e) => e.decision !== 'MEMBER_NOT_A_DISCOVERED_CANDIDATE').slice(0, 40),
    sampleUnmatchedEdges: edges.filter((e) => e.decision === 'MEMBER_NOT_A_DISCOVERED_CANDIDATE').slice(0, 10),
  };
}

export function explainOrder(utility: any, aId: string, bId: string) {
  const a = utility.byId.get(aId)?.breakdown;
  const b = utility.byId.get(bId)?.breakdown;
  if (!a || !b) return null;
  const levels: Array<[string, (x: any) => unknown]> = [
    ['DIRECT_EVIDENCE', (x) => x.directEvidence],
    ['INFERRED_EVIDENCE', (x) => x.inferredEvidence],
    ['DIRECT_AVOIDANCE', (x) => x.avoidance?.directConflict],
    ['INFERRED_AVOIDANCE', (x) => x.avoidance?.inferredConflict],
    ['SOFT_ANCHOR', (x) => x.softAnchor],
    ['SEMANTIC', (x) => JSON.stringify(x.semantic)],
    ['PROMINENCE', (x) => JSON.stringify(x.prominence ?? null)],
    ['GENERIC_QUALITY', (x) => JSON.stringify(x.quality)],
  ];
  for (const [level, read] of levels) {
    if (JSON.stringify(read(a)) !== JSON.stringify(read(b))) {
      return { decidedBy: level, a: read(a), b: read(b) };
    }
  }
  return { decidedBy: 'CANONICAL_IDENTITY_TIE_BREAK' };
}
