# Partial composite persistence: pre-implementation investigation (2026-10-07)

Track `preference-first-selection`, HEAD `c5df4d5f`. Investigation only: no
production code, schema, or test expectation changed. No live provider call
was made, and C3 was not run.

Files:

| File | Content |
| --- | --- |
| `simulate-partial-rule.cjs` | Read-only simulator. Usage: `node simulate-partial-rule.cjs <run>/identity-analysis.json ['{"<hint>":{"status":"unresolved","verdict":"AMBIGUOUS"}}']`. |
| `simulation-c3-idretry2-cold.txt` | Output over the latest live run, as-run and with HEAD identity overrides. |

## Verdict

`READY_FOR_DESIGN_DECISIONS`. Partial persistence is feasible in the
single-table shape. Before coding, the owner must decide D1–D7 (end of this
document). Two premises of the brief do not hold at HEAD:

1. **National Bank is not unresolved automatically.** At HEAD it is still
   VERIFIED (false) as `Edificio First National Bank of Boston`
   (RW4-ID-FALSE-VERIFY-2, see `../rw4-functional-composite-campaign-2026-10-05/identity-false-verify-2-2026-10-07/impact-matrix-after.json`).
   With partial persistence, the PLANNER_CAPACITY Day 1 composite would
   persist with that wrong component as a routable stop. Its hint is also
   already in `verifiedHintNameKeys` of that wrong GeoEntity in any catalog
   that ran C3. An admin confirmation to Banco Nación would then make the
   key MULTIPLE, so `CATALOG_VERIFIED_HINT` would return AMBIGUOUS, not
   VERIFIED (`identity-verifier.service.ts:132-137`).
2. **Enrichment does not reach existing tours.** A Tour freezes its
   components in `TourExperienceComponent` (`tour-experience-snapshot.util.ts`),
   and `tours.service.ts` reads that snapshot. Enrichment of a shared
   Experience affects only Tours materialized after it. Versioning is still
   deferred, but a Tour-level snapshot already exists.

## 1. Schema feasibility

Current (`be/prisma/schema.prisma:157`):

```prisma
model ExperienceComponent {
  id, experienceId, geoEntityId String (NOT NULL), order Int?, role String?,
  required Boolean @default(true)
  geoEntity GeoEntity @relation(onDelete: Restrict)
  @@unique([experienceId, geoEntityId])
  @@index([geoEntityId])
}
```

Unresolved source members cannot be persisted today. `persistVerifiedExperience`
writes only `dedupedComponents` (resolved, deduped by GeoEntity;
`experience-proposal-resolver.service.ts:651`).

Minimum migration (same table, one authority):

| Field | Type | Why |
| --- | --- | --- |
| `geoEntityId` | `String?` | No GeoEntity for an unresolved member. FK stays `Restrict`. |
| `sourceName` | `String` | Verbatim hint text (`ComponentResolutionFact.hintName`). Needed for audit and for admin hint learning. |
| `resolutionState` | enum `RESOLVED \| UNRESOLVED` | Explicit state. AMBIGUOUS/CONFLICTED stay in the reason. A `CHECK` ties it to `geoEntityId` nullness. |
| `resolutionReason` | `ComponentDeficitReason?` (enum) | Reuses the existing typed reason. Null when RESOLVED. |
| `resolutionProvenance` | enum `AUTOMATIC \| ADMIN` (or a manual-resolution audit row, D5) | Lets a manual link be audited. |

Existing fields reused: `order` (source order, null without evidenced order),
`role`, `required`. `hintKey` is not needed; it is a per-run key.
`ExperienceEvidence` keeps source provenance at Experience level, and
per-member `evidenceKeys` are run-scoped. That is a limitation, not a new
table.

Unique constraint under PostgreSQL NULL semantics: `@@unique([experienceId,
geoEntityId])` allows many NULL rows per Experience (NULLs are distinct), so
unresolved rows are safe. It still forbids two **resolved** source members
that map to one GeoEntity. The live trace has that case: "Caminito" and
"Caminito Street", the latter a `CATALOG_ROUTE_VARIANT` of the same entity.
Today the resolver collapses them. To keep "source defined N" exactly, the
unique key must become per source member (D2).

Backfill: existing rows have no source hint text. Filling `sourceName` from
`GeoEntity.name` would invent a source fact. Under the early-stage deletion
rule, prefer resetting dev catalogs (D6).

### Readers that assume `geoEntityId != null` / `geoEntity` present

| Reader | Location | Effect of nullable component |
| --- | --- | --- |
| Tour snapshot materialization | `tour-experience-snapshot.util.ts:63` | Dereferences `component.geoEntity.name`. Crash, or a null POI in the frozen tour. `TourExperienceComponent.geoEntityId` is NOT NULL. |
| Tour read / presentation | `tours.service.ts:231`, `experience-presentation.util.ts` | Reads the snapshot. Safe if the snapshot stays resolved-only. |
| Experience projection (centroid) | `experience-catalog.service.ts:801` (`projectVerifiedExperienceRow`), `:908` (`findById`) | `item.geoEntity.latitude` throws on null. |
| Detail API → FE | `findById` → `fe/components/tour-details/CompositeExperienceDetail.tsx:68-73,357` | FE dereferences `c.geoEntity.latitude/name`. Crash. |
| Embedding document | `experience-embedding-indexer.service.ts:81` | `component.geoEntity.name` throws. |
| Generation prompt / media outbox | `experience-generation.service.ts:152,255,1907-1913` | Uses `?.`, so safe. `components[0]` may be unresolved and yield a 0,0 fallback. |
| Planner capacity count | `experience-generation.service.ts:476` | Uses `?.`, so safe. |
| Spatial footprint / duration / travel | `spatial-footprint.util.ts:69,100`, `planning-candidate-normalizer.service.ts:43-58` | `geoEntity ?? component` drops unresolved members. But `componentFootprints.length >= 2` start/end logic must see resolved members only. Safe by accident; it must be explicit. |
| Composition / ranking | `experience-composition.service.ts:69` (`components.length === 1` bare AREA/ROUTE), `preference-strong-match.util.ts:68`, `experience-preference-evaluator.util.ts:207`, `tour-destination-eligibility.policy.ts:36`, `candidate-overlap-filter.util.ts:96` | `?.` guards. **Counts** (`length`) would include unresolved members. |
| Catalog geographic retrieval (PostGIS) | `experience-catalog.service.ts:433-460` | Inner join on `geo_entity` drops NULL rows. Correct. |
| Composite retrieval by count | `:622` (`components.length > 1` + `component.geoEntity.kind`), `:654` (`_count.components > 1`), `:686` (`components.length > 1`) | Throws on null `geoEntity`. A row count overstates distinct resolved members, so a 1-resolved + N-unresolved row would pass as composite. |
| `findVerifiedWithin` scan | `:340-395` | Through the projection. Throws. |
| Refill anchor density | `catalog-refill-anchor-planner.service.ts:171` | Uses `experience.latitude`, not components. Unaffected. |
| Tour location search | `tour-location.service.ts:27` | `geoEntity` relation filter excludes NULL. Safe. |
| Dedupe | `experience-dedupe.util.ts:247-262,375-378` | **Hazard.** `new Set(components.map(c => c.geoEntityId))` puts `null` in both sets, so two unrelated PARTIAL Experiences share a fake member, and `componentOverlap > 0` adds `shared_geo_entities`. Must use resolved members only. |
| Persistence identity locks / existing lookup | `experience-catalog.service.ts:1554-1580` | Same `null` hazard in `componentIds` and in the advisory lock key. |
| SAME-dedupe merge | `experience-catalog.service.ts:1633-1716` | Never touches components. A later COLD run that resolves more members of the same source **cannot** move PARTIAL → COMPLETE. Only an explicit enrichment path can. |
| Persist order | `experience-proposal-resolver.service.ts:697-703` | `order = index + 1` over the **resolved** subset. With unresolved members this would renumber source order. Must use `ComponentResolutionFact.sourceOrder`. |

### Proposed single policy (not implemented)

One pure module, for example `experience-component-membership.policy.ts`, owns
membership semantics. Every reader above goes through it:

```ts
resolvedComponents(components)          // resolutionState RESOLVED && geoEntity present, in source order
distinctResolvedGeoEntityIds(components)
isCompositeMembership(components)       // distinctResolvedGeoEntityIds(...).length >= 2
compositionCompleteness(components)     // 'COMPLETE' | 'PARTIAL'
```

The PostGIS boundary keeps its inner join, which is the SQL form of the same
predicate. The dedupe `isStandaloneCompositeComparison` already counts
distinct GeoEntities, which is the same rule.

## 2. Completeness representation

Derive it. Completeness is deterministic from persisted rows: COMPLETE iff
every source-member row is RESOLVED. It needs no column. The only consumer that
could want a column is a backoffice "list PARTIAL Experiences" query. That is
`components: { some: { resolutionState: 'UNRESOLVED' } }`, served by an index
on `(resolutionState)` or `(experienceId, resolutionState)`. No demonstrated
requirement justifies a second source of truth.

One caveat: derivation assumes every source member is persisted. If D2 keeps
the collapse of same-GeoEntity duplicates, the derived "source defined N"
undercounts, though completeness itself stays correct.

## 3. Historical impact matrix

Every assertion of `INCOMPLETE_SOURCE_COMPOSITION` or equivalent rejection:

| # | Spec / case | Src | Res | Distinct | Unresolved reasons | Current | Proposed | Class |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `required-geographic-authority.spec.ts:333` six-stop A–F, C/E missing | 6 | 4 | 4 | 2× NO_CANDIDATE_ACQUIRED | rejected, validator not called, not persisted | PARTIAL → validator on A/B/D/F → persisted | INTENTIONAL_PRODUCT_CHANGE |
| 2 | `partial-composite-isolation.integration-spec.ts:133` A–F, C/E | 6 | 4 | 4 | 2× NO_CANDIDATE_ACQUIRED | rejected, 0 Experiences | PARTIAL persisted, planner-visible | INTENTIONAL_PRODUCT_CHANGE |
| 3 | same file `:230` later complete A-B after partial | 2 | 2 | 2 | — | 1 Experience "Walk A-B" | Partial A–F now exists too. Dedupe of A-B vs A-B-D-F (shared A/B, similar names) must yield NEW, never SAME/AMBIGUOUS. **Unverified** | RISK: must stay NEW, else UNRELATED_REGRESSION (D7) |
| 4 | same file `:253` A-B-C, B AMBIGUOUS | 3 | 2 | 2 | AMBIGUOUS_CANDIDATES | rejected | PARTIAL persisted, B kept unresolved | INTENTIONAL_PRODUCT_CHANGE |
| 5 | `geographic-source-composition.spec.ts:926` homonyms, a unresolved, b resolved | 2 | 1 | 1 | AMBIGUOUS/unconfirmed | rejected `INCOMPLETE_SOURCE_COMPOSITION` | unchanged (below floor) | unchanged |
| 6 | same file `:892`, `:916`, `:948` (lone outside match, DEFAULT ceiling, non-exact name) | 2 | 1 | 1 | REJECTED / no admission | rejected | unchanged (below floor) | unchanged |
| 7 | `trace-failure-semantics.spec.ts:274` A–G entity trace | 7 | 2 | 2 | AMBIGUOUS, NO_OSM_MATCH, PROVIDER_FAILURE, INSUFFICIENT, REJECTED | rejected (fixture) | still rejected: PROVIDER_FAILURE is SYSTEM_FAILURE (§4), and D is OUTSIDE | unchanged |
| 8 | same file `:466` "Partial walk" A,B + C NO_OSM_MATCH, `buildCompositeOutcome` | 3 | 2 | 2 | NO_CANDIDATE_ACQUIRED | NOT_EVALUATED / NOT_PERSISTED | `buildCompositeOutcome` must evaluate geography for an admitted PARTIAL. The fixture encodes the replaced rule. Keep its assertion on a new below-floor fixture | INTENTIONAL_PRODUCT_CHANGE |
| 9 | `component-resolution-facts.util.spec.ts:204,260` `sourceCompositionComplete: false` | 4 / 2 | 3 / 1 | — | CANDIDATE_REJECTED / AMBIGUOUS | fact false | fact still false. It is a completeness fact, not admission | unchanged |
| 10 | `generation-trace-v2-contract.spec.ts:41` | 1 | 0 | 0 | — | trace-shape fixture | unchanged | unchanged |

Total: 4 intentional changes (1, 2, 4, 8), 1 interaction risk to prove (3),
and the rest unchanged. Keep `INCOMPLETE_SOURCE_COMPOSITION` as the rejection
reason for every non-admitted incomplete composite (below floor or ineligible
deficit), so cases 5–7 need no expectation change. If an ineligible deficit
needs its own reason, add it beside that reason; do not replace it.

## 4. Unresolved-reason classification

Typed reasons are `ComponentDeficitReason`
(`experience-resolution.interface.ts:635`), derived only in
`componentDeficitReason` (`component-resolution-facts.util.ts:203`) from
`ResolvedGeoEntity.reason` (an untyped `string`) plus the attempt audit.

| Deficit reason | Producing branch | What it says | Class | PARTIAL-eligible |
| --- | --- | --- | --- | --- |
| `NO_CANDIDATE_ACQUIRED` | resolver `:1726-1749`, `OSM_QUERY_EMPTY` / `NO_OSM_MATCH`; also every per-candidate admission filter (`STRUCTURALLY_INCOMPATIBLE`, `OUTSIDE_EXPERIENCE_SCOPE`, candidate-level `DESTINATION_INCOMPATIBLE`, `CANDIDATE_COARSER_THAN_DESTINATION`) that empties the pool | Nothing admissible found | MISSING_KNOWLEDGE | yes |
| `CANDIDATE_UNCONFIRMED` | `unconfirmedEntity` (`UNCONFIRMED_MATCH`) with verdicts INSUFFICIENT_EVIDENCE (`NO_DECISIVE_EVIDENCE`, `NAME_UNIQUENESS_UNKNOWN`, `WIKIDATA_UNAVAILABLE`) | A candidate exists but is not corroborated | MISSING_KNOWLEDGE (`WIKIDATA_UNAVAILABLE` is operational, see D4) | yes |
| `AMBIGUOUS_CANDIDATES` | verdict AMBIGUOUS (`NAME_COLLISION`, `MATERIAL_COMPETITOR_KNOWN`, `STRUCTURED_ROUTE`, `CATALOG_ROUTE_VARIANT`, `CATALOG_VERIFIED_HINT`, `CONTEXTUAL_CORRESPONDENCE`); route `reason: 'AMBIGUOUS'` | Several real objects, no winner | MISSING_KNOWLEDGE (already `KNOWLEDGE_DEFICIT`) | yes |
| `CANDIDATE_REJECTED` | every acquired verdict REJECTED: `IDENTITY_CONTRADICTION` (WIKIDATA_QID / LOCALITY / PHYSICAL_KIND), `QID_LINK_MISMATCH` | The **candidate** is disproven, not the source member | MISSING_KNOWLEDGE (candidate-level contradiction) | yes, but see D3 |
| `IDENTITY_CONFLICT` | `persistVerifiedCandidate` → `identityConflictEntity` (`:2129-2142`): strong identities owned by 2+ GeoEntities | Catalog integrity conflict | CONTRADICTORY_EVIDENCE (catalog) | **no** |
| `DESTINATION_INCOMPATIBLE` | `areaDestinationBlock` INCOMPATIBLE (`:1705-1722`), only for an AREA hint whose match lies outside or is coarser than the destination | The source's own area is elsewhere | CONTRADICTORY_EVIDENCE (source-level) | **no** |
| `DESTINATION_COMPATIBILITY_UNKNOWN` | `areaDestinationBlock` UNKNOWN | Destination geography unknown | UNKNOWN | **no** |
| `PROVIDER_FAILURE` | lookup failed / attempt `executionStatus: failed` (`OSM_PROVIDER_FAILED`, `PROVIDER_FAILURE`) | "Not found" is unproven | SYSTEM_FAILURE (already `OPERATIONAL_FAILURE`) | **no** |
| (INVALID_SOURCE_COMPONENT) | not produced as a typed fact | Descriptive non-names such as "big building with columns" and "oldest neighborhood of the capital city" arrive as `NO_CANDIDATE_ACQUIRED` | — | indistinguishable today (D3) |

The hypothesis holds with one refinement. A rejected candidate is a
**candidate-level** contradiction. It never attaches a wrong entity (no
GeoEntity is linked) and says nothing against the source member, so it belongs
with MISSING_KNOWLEDGE. Source-level contradiction (`DESTINATION_INCOMPATIBLE`)
and catalog conflict (`IDENTITY_CONFLICT`) block.

Single authority: extend the existing `deficitClassification` (today
`KNOWLEDGE_DEFICIT | OPERATIONAL_FAILURE | PENDING_CLASSIFICATION`). Do not
add a parallel string list. Proposal: one total, typed
`partialCompositionEligibility(reason: ComponentDeficitReason)` beside it,
an exhaustive switch with no default. The resolver admission seam
(`experience-proposal-resolver.service.ts:1821-1834`) and `buildCompositeOutcome`
both call it. `ResolvedGeoEntity.reason?: string` stays the untyped input;
typing it is natural-scope debt to record.

Geography is a separate axis. A RESOLVED member that is OUTSIDE is not
unresolved. The unchanged composite geographic validator still judges the
resolved subset, which `validate` currently never sees for incomplete
compositions.

## 5. Acceptance rule simulation

Rule: `distinct resolved GeoEntities >= 2 AND every unresolved member is
PARTIAL-eligible`, then the unchanged geographic validator. Input: the latest
live run `c3-idretry2-cold` (`simulation-c3-idretry2-cold.txt`). "Distinct"
is approximated by selected-record name and coordinates, because trace
GeoEntity ids are absent.

| Unit | Experience | Src | Res | Distinct | Unresolved (class) | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| AREA_ROUTE_WALK | Agus part 1 of 3 | 14 | 4 | 4 | 4 AMBIG, 5 UNCONF, 1 NONE | **PARTIAL** → validator. Obelisco and Casa Rosada are OUTSIDE San Telmo but inside the destination, so likely accepted (`composite-geographic-validation.service.ts:412-460`) |
| AREA_ROUTE_WALK | Agus part 2 of 3 (Caminito, Don Carlos, Caminito Street) | 3 | 2 | **1** | 1 AMBIG | REJECT, below floor (two hints → one GeoEntity) |
| AREA_ROUTE_WALK | **Secrets Day 1 Plaza de Mayo → San Telmo** | 12 | 8 | 8 | 3 AMBIG (Plaza de Mayo, Cabildo, Estados Unidos), 1 NONE (Paseo Colón) | **PARTIAL** → validator |
| AREA_ROUTE_WALK | La Boca (El Caminito, La Bombonera) | 2 | 0 | 0 | 1 UNCONF, 1 AMBIG | REJECT, below floor |
| GENERIC | argentina4u "Tour Description" | 6 | 2 | 2 | 2 UNCONF, 1 NONE, 1 REJECTED (Mafalda, QID_LINK_MISMATCH) | **PARTIAL** → validator (relies on CANDIDATE_REJECTED eligibility, D3) |
| PLANNER_CAPACITY | Agus/SOB Day 1 part 1 of 2 | 19 | 8 at HEAD (9 as run) | 8 | 4 AMBIG (+Club Atlético at HEAD), 2 UNCONF, 1 REJECTED, 3 NONE | **PARTIAL** → validator. **Includes National Bank → First National Bank of Boston as a routable stop** |
| PLANNER_CAPACITY | Day 1 part 2 of 2 | 2 | 0 | 0 | 1 NONE, 1 AMBIG | REJECT, below floor |

The earlier RW3 La Boca Experience (4/4 components) is COMPLETE, so that path
is unchanged.

No case in this run hits an ineligible deficit. The ineligible classes are
covered only by unit fixtures (case 7).

## Owner decisions required before coding

- **D1. National Bank exposure.** Partial persistence would put the known
  false VERIFIED into a persisted, planner-visible Experience, and the admin
  path would then produce a MULTIPLE verified-hint key. Choose:
  - (a) gate this milestone on RW4-ID-FALSE-VERIFY-2;
  - (b) include an admin "unlink + forget hint" operation (a third action,
    `REJECT_CURRENT_LINK`);
  - (c) accept the exposure with the C3 catalog reset as the only mitigation.

  Recommendation: (b). The brief's National Bank lifecycle is unreachable
  without it.
- **D2. Same-GeoEntity duplicates.** Change the unique key to one row per
  source member, so "source defined N" is exact and readers count distinct
  GeoEntities through the policy. Or keep the collapse and accept an
  undercount.
- **D3. CANDIDATE_REJECTED eligibility.** Treat it as eligible (recommended,
  candidate-level), or as blocking (stricter, which drops argentina4u).
  Whether to type descriptive non-name members as INVALID_SOURCE_COMPONENT is
  a separate extraction concern, out of scope.
- **D4. `WIKIDATA_UNAVAILABLE`.** Today it folds into CANDIDATE_UNCONFIRMED,
  although it is operational. Split it to SYSTEM_FAILURE (one new deficit
  reason) or accept it.
- **D5. Admin provenance shape.** Use a column on the member plus a small
  `GeoEntityVerifiedHintProvenance` record (hint, key, GeoEntity, source
  ADMIN, timestamp, actor). A `User` model exists, but this investigation
  found no admin role. Whether `actorUserId` is meaningful is the owner's
  call.
- **D6. Dev catalog reset vs backfill** of `sourceName` for existing rows.
- **D7. Case 3 dedupe.** Prove that a complete sub-composite never dedupes
  SAME into a PARTIAL super-composite. Add it to the implementation
  acceptance as a non-regression test before any production change.
