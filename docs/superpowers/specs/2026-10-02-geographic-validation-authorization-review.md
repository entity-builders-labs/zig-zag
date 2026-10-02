# Geographic validation authorization — architecture review

Status: **Part I (§§1–13) — ACCEPTED, IMPLEMENTED** by `4da75fac`
(work-unit authorization) and observed in canonical COLD #11. **Part II
(§§P2-1–P2-16, below) — ARCHITECTURE CORRECTION / ACTIVE CONTRACT, not
implemented**: separates authorization from geographic scope, destination
relation and identity search scope, and audits every geographic distance
threshold. Part II supersedes every Part I statement that treats the
destination-centered "route-scale" circle (80 km) as a valid domain.
Part I written on branch `feat/preference-first-selection` at `fda878a3`.
Trigger: canonical COLD #10 (RW4).

Question: which authoritative relationship proves that **this** admitted
candidate may use a wider (walk / route-like) geographic validation policy,
when one tour request legitimately asks for several Experience intents,
without reading `candidate.intents` and without granting route scale to every
multi-component candidate whenever `route_like` happens to be open?

Invariant this review optimizes for:

> A wider geographic validation policy is granted only when an authoritative
> acquisition context proves that this specific materialization is allowed to
> use it.

## 1. Concepts kept separate

| Concept | Meaning | Code owner today |
| --- | --- | --- |
| REQUEST NEED | which Experience facets the user asked for and which are still open | `PreferenceSpec.facets` → coverage → `AcquisitionDeficit[]` (`PreferenceFacetDeficit`) |
| ACQUISITION WORK UNIT | one acquisition execution and the deficits it exclusively owns | `partitionDeficitsByStrategy` → one `AREA_ROUTE_WALK` unit per routed deficit, or the coalesced generic plan; planner-capacity plan |
| EVIDENCE REQUIREMENT | the structural candidate shape an execution admits | `deriveAcquisitionEvidenceRequirements` → `SINGLE_PLACE` / `MULTI_COMPONENT_EXPERIENCE` |
| VALIDATION AUTHORIZATION | which geographic policy a materialization may use | today: `validationIntent` (request-global for generic/planner, `intentKey` for AREA_ROUTE_WALK) |
| CANDIDATE SEMANTICS | what the source/extractor says the candidate is | `ExperienceCandidate.intents/themes/componentHints` (never authority) |

The defect class this review closes is letting one of these substitute for
another: request need for authorization (COLD #10), evidence requirement for
authorization (the earlier draft of this review), candidate semantics for
authorization (already excluded).

## 2. Provenance chain (code truth)

| Step | Code | What exists | What is lost |
| --- | --- | --- | --- |
| Requested facets | `PreferenceSpec.facets` | `intent:walk`, `intent:route_like`, themes, with `source` | — (says what was asked, not what is open) |
| Open deficits | `PreferenceCoverageResult.acquisitionDeficits` | one `PreferenceFacetDeficit` per open facet; `GlobalCapacityDeficit` (dimensionless) | — |
| Work-unit assignment | `partitionDeficitsByStrategy` (`utils/acquisition-strategy-selector.util.ts:122`) | each deficit goes to **exactly one** owner: walk/route_like + exactly one area/route/named-path anchor → its own `AREA_ROUTE_WALK` unit (`deficit`, `intentKey`); everything else → `generic[]` | nothing lost: ownership is explicit and exclusive. A deficit routed to AREA_ROUTE_WALK is **not** owned by generic |
| Plan construction | `ExperienceAcquisitionPlanner.buildAcquisitionPlan` (`experience-acquisition-planner.service.ts:104`) | generic: **all** generic deficits coalesced into one plan, one web query (`webKeywords` union, `requestedIntents`/`requestedThemes` union), one requirement set | **earliest provenance loss**: after coalescing, no execution output can be attributed to one deficit |
| Requirement derivation | `deriveAcquisitionEvidenceRequirements` (`utils/acquisition-evidence-requirement.util.ts:9`) | union of shapes | cause: `intent:walk`, `intent:route_like`, every theme/trait, unknown intents and `global_capacity` all add `MULTI_COMPONENT_EXPERIENCE` |
| Web admission | `decideAdmission` → `WebCandidateAdmissionDecision` (`experience-acquisition.service.ts:803,321`) | `requestedRequirements`, `candidateShapeMatches`, `accepted` | which deficit the matched shape served (unknowable in a coalesced plan). Decisions go to the trace; `ExecuteAcquisitionPlanResult.candidates` is bare. Non-web candidates (Wikivoyage, Places) are never shape-checked here |
| Materialization context | `executeAndMaterializeAcquisitionPlan` (`experience-generation.service.ts:613`; callers 1181 generic, 1582 planner_capacity) | `validationIntent: requestValidationIntent` from `deriveRequestValidationIntent(preferenceSpec.facets)` (line 841) | the need/work-unit link: authority now comes from requested *facets*, not owned *deficits* |
| AREA_ROUTE_WALK materialization | `area-route-walk-acquisition.service.ts:522-529` | `validationIntent: input.intentKey` + `validationScope` from its own routed deficit/anchor | per-candidate shape: applied to every candidate of the execution, including single places from Wikivoyage `DO` |
| Resolver | `ExperienceProposalResolver.resolve` (`experience-proposal-resolver.service.ts:337,380,607`) | one `validationIntent` for the whole batch → `routeScale = validationIntent === 'route_like'` | per-candidate distinction |
| Validator | `CompositeGeographicValidationService` (`composite-geographic-validation.service.ts:400,743`) | `routeScale = hasCanonicalRouteComponent \|\| validationIntent === 'route_like'`; AREA scope: walk/route_like → `AREA_ANCHORED_ROUTE` else `AREA_CONTAINED` | — |

Candidate self-description is already excluded: `validationIntent` is never
read from `proposal.intents` (`composite-geographic-validation.service.ts:739`,
`experience-resolution.interface.ts:602-610`).

## 3. The provenance gap: why "open route_like + MULTI_COMPONENT" is not authority

The earlier draft proposed, for generic/planner candidates, an
`ADMITTED_SHAPE` grant: *route_like is open in this pass* AND *candidate
satisfies `MULTI_COMPONENT_EXPERIENCE`* ⇒ route scale. This is **rejected**:

1. **The requirement does not name its cause.** In a generic plan for
   `theme:wine` + `intent:visit`, `deriveAcquisitionEvidenceRequirements`
   yields `{SINGLE_PLACE, MULTI_COMPONENT_EXPERIENCE}` — the multi-component
   requirement comes from `theme:wine`, not from any route-like need. A
   multi-component wine candidate satisfies it for the theme's sake.
2. **The open need is owned elsewhere.** When an anchor exists, the open
   `route_like` deficit was assigned by `partitionDeficitsByStrategy` to an
   AREA_ROUTE_WALK unit. Letting generic also act on it creates a second,
   unowned authority over one deficit — exactly the dual authority the
   partition exists to prevent.
3. **The generic execution was never looking for route-like Experiences.**
   With no walk/route_like deficit, the generic web query omits the
   route/area anchor names (`isWalkOrRouteLikeDeficit`, planner line 240)
   and the `scenic routes`/`tours` keywords; `requestedIntents` lacks
   `route_like`. Nothing in that execution's inputs or admission ties the
   candidate to route-like demand.
4. **Even with route_like in the generic plan (no anchor), coalescing makes
   attribution impossible.** One query and one requirement union serve
   wine, visit and route_like at once; adding provenance tags to
   requirements (`MULTI_COMPONENT_EXPERIENCE ← {route_like, theme:wine}`)
   would still not say which cause *this* candidate satisfied, because
   satisfying the shape satisfies it for every cause simultaneously.

Therefore "open route_like" + "multi-component shape" is a co-occurrence, not
a relationship. It is insufficient authority in every case where the
execution also owns any non-policy deficit.

## 4. Lost-information point

- **Earliest loss: `buildAcquisitionPlan` coalescing several deficits into
  one `ExperienceAcquisitionPlan`** (one query, one requirement union via
  `deriveAcquisitionEvidenceRequirements`). From there on no candidate can
  be attributed to a specific deficit. `partitionDeficitsByStrategy` does
  **not** lose provenance — it is the correct ownership boundary (the earlier
  draft's claim that partitioning was the loss point is withdrawn).
- Second: `ExecuteAcquisitionPlanResult.candidates` drops admission
  decisions, so the shape check that was performed is not available at
  materialization.
- Third: `ExperienceProposalResolver.resolve` accepts one `validationIntent`
  per batch, so even a correct per-candidate decision cannot be expressed.
- Separately, `deriveRequestValidationIntent` replaces work-unit ownership
  with a request-facet singleton for generic and planner-capacity
  (`MIXED_UNSUPPORTED` for walk + route_like; `route_like` facet already
  satisfied by the catalog still widens later batches; single venues in a
  generic batch get `routeScale=true` at identity time).

## 5. Final recommended architecture — owned-intent work-unit authorization

**A wider geographic policy is authorized only by an acquisition work unit
that exclusively owns exactly one open walk/route_like deficit, and only for
the candidates that work unit admitted as `MULTI_COMPONENT_EXPERIENCE`.
Policy-bearing intent deficits are never coalesced with other deficits.
Everything else validates under the default destination policy.**

```text
authorization owner          = the acquisition work unit that exclusively owns
                               one open PreferenceFacetDeficit intent:walk or
                               intent:route_like (assigned by
                               partitionDeficitsByStrategy, the single routing
                               owner)
authorization representation = WorkUnitGeographicGrant on the work unit;
                               GeographicValidationAuthorization per candidate
                               (DEFAULT | WALK | ROUTE_LIKE, the non-default
                               variants carrying the owning grant)
authorization derivation     = (1) work-unit grant: partitionDeficitsByStrategy
point                          narrows the deficit once and creates the unit;
                               (2) candidate authorization:
                               ExperienceAcquisitionService.materializeExecution,
                               from the unit's grant x
                               candidateSatisfiesEvidenceRequirement(candidate,
                               'MULTI_COMPONENT_EXPERIENCE')
candidate/work-unit          = a candidate belongs to exactly one execution of
relationship                   exactly one work unit; it can only inherit that
                               unit's grant, never another unit's, never the
                               request's
materialization propagation  = partition → work unit (grant) →
path                           buildAcquisitionPlan(deficits: [that one deficit])
                               → executePlan → materializeExecution(execution,
                               { grant }) → AuthorizedCandidate[] →
                               ExperienceProposalResolver.resolve (per-candidate
                               routeScale) → CompositeGeographicValidationService
                               (per-candidate policy)
default/fail-closed behavior = DEFAULT destination compatibility for: generic
                               (coalesced) units, planner_capacity units,
                               single-place/single-component candidates in any
                               unit, any candidate whose unit has no grant.
                               deriveRequestValidationIntent / MIXED_UNSUPPORTED
                               / validationIntentOf are deleted (one authority)
```

Required routing change (the only acquisition-model change): a walk/route_like
deficit that does not qualify for AREA_ROUTE_WALK (no anchor, or 2+ relevant
anchors) no longer joins the coalesced generic plan; it becomes its own
`DEDICATED_INTENT` work unit (generic pipeline, `deficits: [thatDeficit]`).
Its plan's requirement set is then derived from that single deficit
(`MULTI_COMPONENT_EXPERIENCE`), its query carries the intent keywords, and
every admission in it is attributable to that deficit. This is the smallest
model that makes attribution exact; per-requirement provenance tagging was
rejected because it cannot disambiguate coalesced executions (§3.4).

Why the candidate-level shape gate stays even inside an owning unit: a
walk or route_like plan also routes Wikivoyage `DO`
(`constants/acquisition-source-routing.ts:62-69`), whose candidates are not
shape-checked by web admission and may be single venues. A single venue is not a walk or a route;
it gets DEFAULT (single venues inside an AREA scope then use
`AREA_CONTAINED`, the stricter policy). The gate reuses the canonical
predicate `candidateSatisfiesEvidenceRequirement`; no second shape policy.

### 5.1 Typed sketch

```ts
/** Intents whose geographic policy differs from the destination default. */
type GeographicPolicyIntent = 'walk' | 'route_like';

/** An OPEN requested deficit for a policy-bearing intent. Narrowed once,
 *  in partitionDeficitsByStrategy; never constructed from facets,
 *  candidates or extractor output. */
interface GeographicIntentDeficit extends PreferenceFacetDeficit {
  dimension: 'intent';
  key: GeographicPolicyIntent;
}

/** Work units produced by partitionDeficitsByStrategy (plus the planner). */
type AcquisitionWorkUnit =
  | {
      kind: 'AREA_ROUTE_WALK';
      deficit: GeographicIntentDeficit;
      anchor: CanonicalAreaRouteAnchor | UnresolvedNamedPathAnchor;
      anchorMode: AreaRouteWalkAnchor['mode'];
    }
  | { kind: 'DEDICATED_INTENT'; deficit: GeographicIntentDeficit }
  | {
      kind: 'GENERIC';
      /** Never contains a GeographicIntentDeficit (enforced by the partition). */
      deficits: Exclude<AcquisitionDeficit, GeographicIntentDeficit>[];
    }
  | { kind: 'PLANNER_CAPACITY'; deficit: GlobalCapacityDeficit };

/** What a work unit may grant. Only the two owning kinds can produce one. */
type WorkUnitGeographicGrant =
  | { kind: 'NONE' }
  | {
      kind: 'OWNED_INTENT';
      intent: GeographicPolicyIntent;
      ownedDeficit: GeographicIntentDeficit;
      workUnit: 'AREA_ROUTE_WALK' | 'DEDICATED_INTENT';
    };

function grantOf(unit: AcquisitionWorkUnit): WorkUnitGeographicGrant {
  switch (unit.kind) {
    case 'AREA_ROUTE_WALK':
    case 'DEDICATED_INTENT':
      return {
        kind: 'OWNED_INTENT',
        intent: unit.deficit.key,
        ownedDeficit: unit.deficit,
        workUnit: unit.kind,
      };
    case 'GENERIC':
    case 'PLANNER_CAPACITY':
      return { kind: 'NONE' };
  }
}

/** Per-candidate authorization. Non-default variants can only be built from
 *  an OWNED_INTENT grant plus the canonical shape predicate. */
type GeographicValidationAuthorization =
  | { kind: 'DEFAULT' }
  | {
      kind: 'WALK' | 'ROUTE_LIKE';
      authorizedBy: Extract<WorkUnitGeographicGrant, { kind: 'OWNED_INTENT' }>;
      admittedAs: 'MULTI_COMPONENT_EXPERIENCE';
    };

function authorizeCandidate(
  grant: WorkUnitGeographicGrant,
  candidate: ExperienceCandidate,
): GeographicValidationAuthorization {
  if (grant.kind === 'NONE') return { kind: 'DEFAULT' };
  if (!candidateSatisfiesEvidenceRequirement(candidate, 'MULTI_COMPONENT_EXPERIENCE'))
    return { kind: 'DEFAULT' };
  return {
    kind: grant.intent === 'walk' ? 'WALK' : 'ROUTE_LIKE',
    authorizedBy: grant,
    admittedAs: 'MULTI_COMPONENT_EXPERIENCE',
  };
}

/** What materialization hands to the resolver: the pair travels together,
 *  so a candidate cannot reach resolve() without an explicit authorization. */
interface AuthorizedCandidate {
  candidate: ExperienceCandidate;
  geographicAuthorization: GeographicValidationAuthorization;
}
```

Notes on the type:

- `ExperienceCandidate` has no authorization field (the extractor builds it);
  `candidate.intents`/`themes`/names are not parameters of `authorizeCandidate`.
- No request-level input exists anywhere in the chain; there is no
  `Set<intent>` to pick the widest from.
- `ExperienceResolutionRequest.validationIntent` is replaced by
  per-candidate `AuthorizedCandidate[]`; `validationScope` stays work-unit
  level (only AREA_ROUTE_WALK sets it).
- A WALK authorization without an AREA `validationScope` (DEDICATED_INTENT
  walk) behaves like DEFAULT in today's validator (walk only changes the AREA
  policy at `composite-geographic-validation.service.ts:400`; `routeScale` is
  route_like-only). It is still typed as WALK so the trace states what was
  authorized and why.

### 5.2 Authority matrix

| Actor | May authorize | Never authorizes |
| --- | --- | --- |
| AREA_ROUTE_WALK unit (`intentKey=route_like`) | ROUTE_LIKE for its own multi-component admitted candidates, plus its ROUTE/AREA `validationScope` | single places it surfaces; any other unit's candidates |
| AREA_ROUTE_WALK unit (`intentKey=walk`) | WALK for its own multi-component admitted candidates, plus its AREA/ROUTE `validationScope` | route scale; single places |
| DEDICATED_INTENT unit (route_like / walk, no single anchor) | ROUTE_LIKE / WALK for its own multi-component admitted candidates; no `validationScope` | single places; other units |
| GENERIC (coalesced) unit | nothing — DEFAULT for every candidate | anything wider, even when route_like is open elsewhere in the same pass |
| PLANNER_CAPACITY unit | nothing — DEFAULT | inheriting any request facet; `preferredFacets` are ranking hints only |
| Request (`PreferenceSpec.facets`) | declares needs → deficits | any candidate's geography directly |
| Candidate self-description (`intents`, themes, name, component count alone, LLM classification) | nothing | anything |

### 5.3 Mandatory scenarios

| | Open deficits | Work unit | Candidate | Authorization | Authoritative link |
| --- | --- | --- | --- | --- | --- |
| A | `intent:route_like` (+ anchor) | AREA_ROUTE_WALK(route_like) | multi-component, admitted | ROUTE_LIKE | unit owns the deficit × shape |
| B | `intent:walk` (+ anchor) | AREA_ROUTE_WALK(walk) | multi-component | WALK (+ AREA scope → `AREA_ANCHORED_ROUTE`) | unit owns the deficit × shape |
| C | `intent:walk`, `intent:route_like` | two units (AREA_ROUTE_WALK each, or DEDICATED_INTENT each without a single anchor) | per unit | WALK in one, ROUTE_LIKE in the other | each unit its own deficit; no request-level singleton, no `MIXED_UNSUPPORTED` |
| D | `theme:wine`, `intent:visit`, `intent:route_like` | GENERIC(wine, visit) + route_like unit | unrelated multi-component wine/visit candidate from GENERIC | DEFAULT | GENERIC owns no policy-bearing deficit; open route_like is owned by the other unit |
| E | COLD #7 / #10 Uco | GENERIC(wine, visit) | Uco, 3/3 source-supported, admitted multi-component | **DEFAULT** | see §6 |
| F | `intent:visit` | GENERIC(visit) | `candidate.intents = ['route_like']` | DEFAULT | candidate semantics are not an input |
| G | `global_capacity` | PLANNER_CAPACITY | any | DEFAULT | see §8 |

## 6. Uco (COLD #7 / COLD #10), step by step

1. Coverage: open `theme:wine`, `intent:visit`, `intent:route_like` (COLD #10
   also `intent:walk`).
2. Partition: `route_like` (and `walk`) + the single named-path anchor "Ruta
   del Vino de Mendoza" → AREA_ROUTE_WALK units. `theme:wine`,
   `intent:visit` → GENERIC.
3. GENERIC plan: requirements `{SINGLE_PLACE, MULTI_COMPONENT_EXPERIENCE}`,
   the multi-component requirement caused by `theme:wine`; query without the
   route anchor and without route keywords; `requestedIntents=[visit]`.
4. GENERIC execution discovers "Uco Valley Wine Tasting Itinerary" on
   SolSalute, 3/3 source-supported, admitted as multi-component.
5. Grant: GENERIC → `NONE` → Uco gets **DEFAULT**.

**Uco may not legitimately receive route-scale validation from this
acquisition.** No authoritative link exists: the work unit that discovered it
does not own the route_like deficit, did not search for route-like
Experiences, and admitted it for a theme-derived shape. (Whether a Uco Valley
itinerary even satisfies a "Ruta del Vino de Mendoza" route need is a
semantic question the GENERIC unit never asked.)

What is required instead: the route_like need is satisfied only through its
owning unit. Uco (or any regional wine itinerary) can be ROUTE_LIKE-authorized
only if it is discovered and admitted by the AREA_ROUTE_WALK(route_like) unit
for that anchor (or a DEDICATED_INTENT route_like unit when no single anchor
exists). In COLD #10 those units ran with `validationIntent=route_like`
already (`area-route-walk-acquisition.service.ts:529`), scanned
discoverywinemendoza 4 windows and admitted no qualifying multi-component
candidate. If the product wants multi-component theme itineraries found by
generic discovery to be judged at regional scale, that is a distinct,
explicitly requested need (e.g. a day-trip/regional-scope deficit with its own
owning unit and policy) — not borrowed route_like authority. Not designed
here.

Consequence for the COLD #10 counterfactual: with the corrected architecture
the generic-discovered Uco still validates under DEFAULT. The global model is
the first architecturally incorrect decision COLD #10 reached, but correcting
it does not by itself put Uco on a route-scale path.

## 7. walk + route_like + visit in one tour

Open: `intent:walk`, `intent:route_like`, `intent:visit`.

- With one area/route anchor: AREA_ROUTE_WALK(walk) → WALK (+ scope);
  AREA_ROUTE_WALK(route_like) → ROUTE_LIKE (+ scope); GENERIC(visit) →
  DEFAULT.
- Without a single anchor: DEDICATED_INTENT(walk) → WALK (no scope ⇒ default
  thresholds); DEDICATED_INTENT(route_like) → ROUTE_LIKE (route-scale
  compatibility); GENERIC(visit) → DEFAULT.
  *(Part II annotation: "route-scale compatibility" here is historical code
  behavior — the destination-centroid 80 km circle — and is superseded by
  §P2-6/§P2-9. The authorization outcome above stands.)*

Each candidate is materialized by exactly one unit and carries that unit's
authorization (or DEFAULT if single-place). There is no request-level value to
be ambiguous about.

## 8. Planner capacity

`global_capacity` is dimensionless; the planner-capacity plan is built from
`deficits: [plannerDeficit]` (`preferredFacets` only project extra deficits
when `candidates` are passed, which the planner call does not do). Its grant
is `NONE`: every candidate is DEFAULT, regardless of route_like having been
requested or still being open.

Legitimate widening path: none from the capacity unit. If residual planner
capacity should pursue a still-open route_like need, the backfill must route
that open `GeographicIntentDeficit` through `partitionDeficitsByStrategy`
into its own owning unit (AREA_ROUTE_WALK / DEDICATED_INTENT). The capacity
unit never inherits it.

## 9. Existing widening path to audit (not decided here)

`CompositeGeographicValidationService` also sets `routeScale` when a resolved
component has `role === 'route'` (`hasCanonicalRouteComponent`, line 743).
`role` is copied from the extractor's `hint.role`
(`experience-proposal-resolver.service.ts:697,1225`). The implementation task
must verify whether this widening rests on the resolved GeoEntity's canonical
kind (acceptable: verified geography) or only on the extractor's role label
(candidate self-description — must be removed). Recorded as an audit item;
not part of this decision.

## 10. COLD #10 interpretation

- COLD #10's request carried `intent:route_like` (wizard) and `intent:walk`
  (free text). Multiple intents in one tour are normal, not an input defect.
- AREA_ROUTE_WALK units already used their own `intentKey`.
- GENERIC and PLANNER_CAPACITY used `deriveRequestValidationIntent(facets)` →
  `MIXED_UNSUPPORTED` → `validationIntent=undefined` → `routeScale=false`.
- **First causal blocker:** geographic validation authorization is modeled
  globally for the request/batch, so simultaneous walk + route_like collapses
  to no authorization instead of being applied through the correct
  acquisition work-unit / candidate authorization path.
- Precision: under the corrected path, the generic-discovered Uco is DEFAULT
  too (§6); the RW4 multi-component route Experience must come from the
  route_like-owning unit.

### Known downstream findings / not yet promoted to blockers

- Alfa Crux: `UNRESOLVED / NO_CANDIDATE_ACQUIRED` under currently enabled
  identity sources (proven by COLD #10 trace).
- SuperUco: `UNRESOLVED / NO_CANDIDATE_ACQUIRED` under currently enabled
  identity sources (proven by COLD #10 trace).
- Bodega Azul: a candidate was acquired but judged
  `DESTINATION_INCOMPATIBLE` under the incorrect default geography used in
  COLD #10 (proven verdict; coordinates/provider of that candidate not
  recoverable — trace truncated).
- `resolveViaPlaces` searches a fixed 50 km circle
  (`PLACES_FALLBACK_BIAS_RADIUS_METERS = 50_000`,
  `experience-proposal-resolver.service.ts:182,2486`) while route-scale
  destination compatibility allows up to 80 km (code fact).
  *(Part II annotation: both numbers are UNJUSTIFIED search/compatibility
  radii — §P2-3 T7/T9; the 80 km "route-scale" domain is not a valid
  geographic authority — §P2-5.)*
- Prior manual probe (`cold10/analysis/uco-identity-probe.out.json`,
  observed, not a canonical run): Alfa Crux and SuperUco returned nothing at
  50 km or 150 km; "Bodega Azul" at 50 km returned only unrelated wineries,
  and at 150 km returned "Bodega La Azul" at 73 km. Raising Geoapify from
  50 km to 80 km did not by itself find the relevant wineries (Alfa Crux,
  SuperUco).

These are observations. None is promoted to the next blocker.

## 11. COLD #11 observability prerequisite

The generic `resolution.entity` step reached 67,856 chars and was truncated at
`MAX_STEP_PAYLOAD_CHARS`, hiding per-component identity. Before the next
canonical run, a compact bounded per-component record is required, per
multi-component candidate:

- component name
- resolution strategies attempted
- candidate acquired? (per strategy)
- candidate coordinates (absent from the attempt audit today; must be added)
- identity verifier verdict
- destination compatibility verdict (+ reason)

plus the candidate's `GeographicValidationAuthorization` (kind + owning unit).
Classified as **COLD #11 observability prerequisite**; not solved by this
docs task.

## 12. Expected implementation surface (next task)

- `be/src/modules/tours/utils/request-validation-intent.util.ts` (+ spec) —
  deleted.
- `be/src/modules/tours/utils/acquisition-strategy-selector.util.ts` —
  `GeographicIntentDeficit` narrowing, `DEDICATED_INTENT` unit, GENERIC
  never contains policy-bearing intent deficits.
- `be/src/modules/tours/services/experience-generation.service.ts` — iterate
  work units; remove `requestValidationIntent`; generic and planner capacity
  pass `NONE`; execute DEDICATED_INTENT units.
- `be/src/modules/tours/services/experience-acquisition.service.ts` —
  `materializeExecution(execution, { grant, … })` builds
  `AuthorizedCandidate[]` via `candidateSatisfiesEvidenceRequirement`.
- `be/src/modules/tours/services/area-route-walk-acquisition.service.ts` —
  pass its `OWNED_INTENT` grant instead of `validationIntent: intentKey`.
- `be/src/modules/tours/interfaces/experience-resolution.interface.ts` —
  replace batch `validationIntent` with per-candidate authorization.
- `be/src/modules/tours/services/experience-proposal-resolver.service.ts` —
  per-candidate `routeScale`.
- `be/src/modules/tours/services/composite-geographic-validation.service.ts` —
  per-candidate input; §9 audit.
- Trace: `utils/generation-trace/acquisition-audit.ts` (+ deficit-routing
  step) records units, grants and per-candidate authorization; §11 compact
  component step.
- Tests to rewrite: `request-validation-intent.util.spec.ts` (delete),
  `acquisition-strategy-selector` spec, `experience-generation.acquisition-orchestration.spec.ts`
  (Cases incl. "mixed → undefined"), `experience-proposal-resolver-trace.spec.ts`,
  `composite-geographic-validation.service.spec.ts`,
  `area-route-walk-acquisition.service.spec.ts`,
  `generation-trace-v2-contract.spec.ts`, integration
  `area-route-walk-geographic-validation.integration-spec.ts` (semantics
  preserved, input shape changes). Deterministic tests for scenarios A–G.

Behavior changes to expect: generic and planner-capacity candidates never
receive route scale (today they do whenever the request has route_like alone);
single places inside AREA_ROUTE_WALK units get DEFAULT/`AREA_CONTAINED`;
unanchored walk/route_like deficits cost one extra dedicated execution each.

Out of scope for the authorization change unless later promoted: the Places
search radius (§10 downstream findings).
*(Part II annotation: `4da75fac` then aligned the ROUTE_LIKE Places search to
the destination-centroid 80 km circle. That alignment fixed "search must
cover what validation accepts" but aligned both to a non-authority; the
replacement is §P2-10.)*

## 13. RW4

```text
RW4 EXIT CRITERIA

[x] stable deep-source examination
[ ] real multi-component Experience persisted
[ ] WARM reuses it
[ ] RW4 CLOSED
```

next blocker = geographic validation authority is request-global and
batch-wide instead of being granted only by the acquisition work unit that
exclusively owns an open walk/route_like deficit, and only to the candidates
that unit admitted as MULTI_COMPONENT_EXPERIENCE (policy-bearing intent
deficits must never be coalesced into generic plans).

---

# Part II — Geographic scope, distance thresholds and destination relation

Status: **ACTIVE CONTRACT — S1–S6 IMPLEMENTED (2026-10-02, see §P2-17)**.
Written 2026-10-02 at `ee0f55c1` as a docs-only correction; product
decisions PD1/PD2/PD3 recorded in §P2-17. Trigger: the Overture
identity characterization
(`spikes/rw4-mendoza-tourism-route-cloudflare-canonical-2026-09-30/identity-characterization/overture/assessment.md`)
found Alfa Crux (105.2 km) and SuperUco (87.1 km) in a licensed provider, but
outside the destination-centered 80 km "route-scale domain". Part II audits
whether that domain is a legitimate authority. It is not.

Part I (§§1–13) stays valid for what it decides: **which policy class** a
candidate may use (work-unit-owned authorization). Part II decides **which
geography** bounds a candidate, **who owns** each geographic decision, and the
fate of every geographic distance threshold. Where Part I says "default
destination policy" or "route-scale compatibility", read it through §P2-5 and
§P2-9 below.

## P2-1. Canonical statements

```text
authorization  != geographic scope
destination    != Experience scope
coherence      != trip feasibility
provider search scope MUST derive from real authorized geography
no semantic radius may be borrowed from another policy owner
```

1. **Authorization ≠ scope.** `GeographicValidationAuthorization`
   (`DEFAULT | WALK | ROUTE_LIKE`) answers "may this materialization use a
   broader *policy class*?". It never supplies a geometry, a center or a
   radius.
2. **Destination ≠ Experience scope.** The trip destination (`GeographicScope`)
   says where the traveler is going. The Experience scope says where this
   Experience physically is. A valid regional Experience can lie well outside
   the destination's administrative polygon (city → valley wine itinerary,
   capital → palace day trip, city → mountain excursion, port city → coastal
   day tour, capital → river-delta excursion).
3. **Coherence ≠ trip feasibility.** "Do these components form one
   physically coherent Experience?" is answered against the Experience's own
   real geography. "Can this traveler reach it from the trip destination
   within the day?" is a planning question (travel time, modes, day budget,
   departure point), not a validity question.
4. **Search scope derives from real geography.** An identity provider search
   for a component is bounded by the geometry that will later judge it
   (Experience scope, else destination scope). Never by a constant.
5. **No borrowed semantics.** A distance owned by one policy (e.g.
   composition coherence) may not be imported into another (destination
   compatibility, identity search, product scope) without its own typed
   contract and rationale.

## P2-2. The five geographic questions and their owners

| | Question | Owner (target) | Authority | Must not use |
| --- | --- | --- | --- | --- |
| A | EXPERIENCE GEOGRAPHIC SCOPE — where does this Experience belong? | scope derivation (new single owner, §P2-7) | canonical AREA / ROUTE geometry (§P2-6) | destination centroid, a radius, candidate intents |
| B | INTERNAL COMPOSITION COHERENCE — do the components form one physically coherent Experience? | `CompositeGeographicValidationService` | membership of every component in the Experience scope (`evaluateAreaScopeMembership` / `evaluateRouteScopeMembership`), admin-context contradictions, source composition | destination distance; a universal Euclidean radius |
| C | DESTINATION RELATION — is this Experience inside / extending beyond / outside the trip destination? | destination-compatibility policy (`evaluateDestinationCompatibility`, polygon only) produces a typed **fact**; tour eligibility/planning **consumes** it | destination polygon containment | a radius around the destination centroid |
| D | IDENTITY ACQUISITION SCOPE — where may providers search for a component? | resolver strategies | the authorized scope geometry of §P2-6 (bounding window derived from geometry) | fixed "plausibility" circles |
| E | ITINERARY FEASIBILITY — can the traveler include it? | daily planner / Planner Product Acceptance | routing/travel time, modes, opening hours, day budget | geographic-validation thresholds |

Before Part II, questions B, C and D were all answered by
`DEFAULT_GEOGRAPHIC_VALIDATION_THRESHOLDS.route.maxRadiusMeters` (80 km).

## P2-3. Threshold inventory (code truth at `ee0f55c1`)

Production (`be/src`, non-test). "Status" is one of: PRODUCT_POLICY,
PHYSICAL/TECHNICAL DERIVATION, PROVIDER_CONSTRAINT,
EXPERIMENTALLY_JUSTIFIED_POLICY, UNJUSTIFIED_MAGIC_NUMBER, TEST_ONLY, UNKNOWN.
No row is PRODUCT_POLICY: no product document gives a rationale for any of
these values.

| # | Value | Symbol (file) | Introduced | Original purpose | Current meaning(s) / callers | Status |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | 2 000 m | `neighborhoodWalk.maxRadiusMeters` (`interfaces/geographic-validation.interface.ts`) | `e3c3d5d7` 2026-08-31 | Activity-era NEIGHBORHOOD_WALK cluster radius around the components' own centroid (`b54bea69`) | **none** — last reader removed by `18e6703f` (2026-09-04); dead | UNJUSTIFIED_MAGIC_NUMBER (dead) |
| T2 | 4 000 m | `neighborhoodWalk.maxPairwiseDistanceMeters` | `e3c3d5d7` | same, pairwise | none (dead) | UNJUSTIFIED_MAGIC_NUMBER (dead) |
| T3 | 3 | `neighborhoodWalk.minAnchors`, `route.minAnchors` | `e3c3d5d7` | anchor counts | none (dead; route path uses an inline `1`, `composite-geographic-validation.service.ts:810`) | UNJUSTIFIED_MAGIC_NUMBER (dead) |
| T4 | 30 000 m | `experience.maxRadiusMeters` | `e3c3d5d7` | EXPERIENCE coherence radius around component centroid | `validateExperience` non-route coherence (`:843-850`); only reachable after every anchor already passed destination-polygon containment | UNJUSTIFIED_MAGIC_NUMBER |
| T5 | 60 000 m | `experience.maxPairwiseDistanceMeters` | `e3c3d5d7` | EXPERIENCE pairwise | same | UNJUSTIFIED_MAGIC_NUMBER |
| T6 | 2 | `experience.minAnchors` | `e3c3d5d7` | ≥2 components | `validateExperience:810`; mirrors the structural "≥2 non-area components" rule (Amendment 09-22 §3/§16.1, plan 08-31 §5.3) | PRODUCT_POLICY *as a structural count* (not a distance); duplicated with `candidateSatisfiesEvidenceRequirement` |
| T7 | 80 000 m | `route.maxRadiusMeters` | `e3c3d5d7` | ROUTE coherence radius around the **components' own centroid** | (a) route-scale coherence radius (`validateExperience:843-846`); (b) **destination-centroid** compatibility circle — `routeDestinationMismatch` (since `cc1e102b`), `evaluateDestinationCompatibility({routeScale})` (since `47ccae89`), used by Nominatim/Places PLACE filtering in identity resolution and by the canonical-ROUTE path; (c) Places **identity search circle** `routeScaleDestinationRadius` → `searchScope ROUTE_SCALE` (since `4da75fac`) | UNJUSTIFIED_MAGIC_NUMBER |
| T8 | 160 000 m | `route.maxPairwiseDistanceMeters` | `e3c3d5d7` | ROUTE pairwise | route-scale coherence (`:847-850`) | UNJUSTIFIED_MAGIC_NUMBER |
| T9 | 50 000 m | `PLACES_FALLBACK_BIAS_RADIUS_METERS` (`experience-proposal-resolver.service.ts:194`) | `2b0f6b62` 2026-09-05 | Places text-search bias for unresolved PLACE hints | DEFAULT/WALK identity search circle; the comment calls it a "still plausibly this destination" scale | UNJUSTIFIED_MAGIC_NUMBER (search window not derived from geometry) |
| T10 | 50 000 m | `NOMINATIM_BIAS_RADIUS_METERS` (`nominatim-api.service.ts:21`) | `bdd99c53` 2026-09-24 | soft viewbox bias | identity search bias; comment: "one shared 'how far … is still plausible' scale" — copied from T9 | UNJUSTIFIED_MAGIC_NUMBER |
| T11 | 50 000 m | `HIGHWAYS_BY_NAME_MAX_RADIUS_METERS` (`overpass-query.util.ts:31`) | `b4801433` 2026-09-24 | server-side cap of targeted highway-by-name query | route identity acquisition cap; rationale borrowed from T9/T10 | UNJUSTIFIED_MAGIC_NUMBER (as a scope); a separate operational cap may be legitimate |
| T12 | 8 000 / 2 500 / 8 000 m | `FEATURES_NEAR_MAX_RADIUS_METERS`, `DEFAULT_MAX_STREETS_RADIUS_METERS`, `DEFAULT_MAX_FEATURES_RADIUS_METERS` (OSM) | 2026-08/09 | protect the shared Overpass instance | operational caps on `around:` queries | PROVIDER_CONSTRAINT (operational; must never decide validity) |
| T13 | 1 000 / 2 500 / 5 000 m | catalog-refill anchor radii (`catalog-refill-anchor-planner.service.ts:27-29`) | `55b6f931` era | Places Nearby coverage circles | API coverage operation geometry (architecture doc: "an anchor means API coverage") | PROVIDER_CONSTRAINT (operational coverage) |
| T14 | 5 000 m | `?? 5000` (`google-places-acquisition.provider.ts:137`), controller/`tour-location.service.ts` defaults | `a42aa3f4` 2026-09-08 and earlier | fallback Nearby radius when none supplied | silent default search radius | UNJUSTIFIED_MAGIC_NUMBER |
| T15 | 25 000 m | `destinationScopePolicy.pointRadiusMeters` (`config/destination-scope-policy.config.ts`, env-overridable) | `4848fa81` 2026-09-14 | POINT_RADIUS destination scope for a selected point | destination scope for point destinations (catalog/acquisition/validation) | UNKNOWN (code calls it "explicit product policy"; no product rationale for the value; env-configurability does not make it policy) |
| T16 | 75 000 / 2 000 m | `MAX_DESTINATION_DISTANCE_METERS`, `MAX_POINT_DESTINATION_DISTANCE_METERS` (`destination-resolution.service.ts`) | `63c12a96` 2026-08-22 | geocoder result vs selected coordinate consistency | destination disambiguation tolerance | UNKNOWN (prose rationale, no characterization; destination-resolution only) |
| T17 | 200 m | `CONFIRMATION_RADIUS_METERS` (`identity-evidence-collector.service.ts`) | `673a556e` 2026-09-17 | Wikidata nearby corroboration search | corroboration search; Amendment 09-22 §12 already forbids reusing it as NEAR | UNKNOWN (documented owner, uncharacterized value) |
| T18 | 150 m | `REAL_WORLD_RECONCILIATION_RADIUS_METERS`, `OVERLAP_RADIUS_METERS` | `34a54345` / `5bac6ce9` | write-time dedupe / overlap filter | identity dedupe proximity (comment cites one live case, Caminito) | UNKNOWN (identity-dedupe owner; out of this audit's decision scope) |
| T19 | `destinationBoundary` bbox→circle | `boundingBoxToCenterRadius` (`geometry-search-area.util.ts`) | — | catalog retrieval window covering the destination polygon | catalog retrieval | PHYSICAL/TECHNICAL DERIVATION |
| T20 | user values | `maxWalkingDistancePerDayMeters`, `maxContinuousWalkingDistanceMeters` (+ DTO bounds 500–50 000 / 100–20 000) | wizard | traveler mobility tolerance | planner inputs | user input = PRODUCT input; DTO bounds UNKNOWN; planner-owned, out of scope |

Tests depending on T7: `destination-compatibility.policy.spec.ts`
(`routeScale evaluation`), `composite-geographic-validation.service.spec.ts`
(route-scale destination radius, ROUTE_LIKE thresholds, canonical ROUTE far
waypoint), `experience-proposal-resolver.place-cutover.spec.ts` (L / M:
`radiusMeters 80_000`), `generation-trace/component-identity-audit.spec.ts`
(`ROUTE_SCALE / 80_000`), `test/live/rw4-identity-characterization.live-spec.ts`.
These tests encode historical implementation, not product truth.

## P2-4. History of the 80 km threshold

| When | Commit | Fact |
| --- | --- | --- |
| 2026-08-31 19:30 | `e3c3d5d7` + `b54bea69` | Thresholds created per Activity-era proposal kind as **internal coherence**: radius around the components' own centroid + pairwise max. Commit has no body. The governing plan (`plans/2026-08-31-tour-engine-geographic-validation-outbox-media-handoff.md` §5.3) required only that they be "named configuration/constants and covered by boundary tests" — no values, no rationale. |
| 2026-08-31 20:03 | `cc1e102b` "allow region-scale routes" | **First semantic drift.** `route.maxRadiusMeters` reused as a radius around the **destination polygon centroid** (`routeDestinationMismatch`), justified in a code comment by "wineries in Maipú/Luján de Cuyo for Mendoza". The same-day plan said the opposite: "The current destination boundary is strict. A regional route cannot silently use a 'city plus surroundings' scope" (§3.2) and "'City plus surroundings' remains out of scope unless a separately modelled regional destination or mobility scope is introduced" (§5.4). The architecture doc's "Deferred design topic: city-and-surroundings excursions" requires an explicit wizard scope and travel-time eligibility. |
| 2026-09-04 | `18e6703f` | `neighborhoodWalk` readers removed; T1–T3 dead since. |
| 2026-09-29 | `47ccae89` | **Second drift.** Route radius "centralized in DestinationCompatibilityPolicy"; `WITHIN/OUTSIDE_ROUTE_DESTINATION_RADIUS` added; identity resolution (Nominatim/Places PLACE filtering) now applies the destination-centroid circle under `routeScale`. |
| 2026-10-02 | `4da75fac` | **Third drift.** `routeScaleDestinationRadius` extracted and used as the Places **identity search circle** (`ROUTE_SCALE / 80000`) "so identity search covers exactly what route-scale compatibility can accept". |

No product requirement justified any reuse. The value is a historical
implementation fact, not a product contract.

COLD #11 correctly proved candidate-scoped ROUTE_LIKE authorization and its
propagation into the then-current 80 km identity scope. It did **not** prove
that 80 km — or a destination-centroid circle at all — is a correct product
policy.

## P2-5. Defect: what the current implementation conflates

1. **One constant, three questions.** T7 answers composition coherence (B),
   destination compatibility (C) and identity search scope (D), with two
   different centers (component centroid vs destination centroid).
2. **The destination centroid is not a geographic authority.** It depends on
   the shape of an administrative polygon, belongs to no Experience, and is
   never a place the traveler or the source refers to.
3. **Authorization mapped to geometry.** `authorizesRouteScale(auth)` →
   boolean `routeScale` → selects a radius. Authorization picks a policy class
   *and* silently a circle.
4. **Physical fact mapped to a radius class.** A resolved canonical ROUTE
   component (`hasCanonicalRouteComponent`) also turns `routeScale` on — a
   real geometry is used to pick a constant instead of being used as the scope.
5. **Trip relation used as validity.** Destination compatibility (question C)
   rejects components during identity resolution and composite validation for
   regional candidates; it should be a fact consumed by planning/eligibility.
6. **The existing Experience-AREA primitive is subordinated to the
   destination.** `tryCanonicalGeometry` accepts a candidate-owned canonical
   AREA (`canonical_area`) only if `isInsideDestination(area)`, and AREA hint
   resolution (`areaDestinationCompatibility`, no route scale) rejects any
   area outside the destination polygon. A regional AREA can therefore never
   become an Experience scope.
7. **Route-scope membership embeds the destination.**
   `evaluateRouteScopeMembership` classifies any component outside the
   destination polygon as `OUTSIDE_DESTINATION` (failure), so a real route
   leaving the city cannot be a scope either.
8. **Borrowed "plausibility" scale.** T9→T10→T11 copy one 50 km value across
   Places, Nominatim and Overpass with the comment "one shared … still
   plausible scale".
9. **Misleading inventory.** T1–T3 are dead but still look like policy.
10. **User-named anchors.** `AreaRouteAnchorResolverService` requires a
    user-named AREA/ROUTE anchor to be destination-compatible, so a
    user-selected regional anchor cannot exist. Same class of conflation;
    recorded, fixed with milestone S5 only if the product asks for it.

Machine-readable reasons tied to the defect — `WITHIN_ROUTE_DESTINATION_RADIUS`,
`OUTSIDE_ROUTE_DESTINATION_RADIUS` (`DestinationCompatibilityReason`) and
`OUTSIDE_ROUTE_DESTINATION_RADIUS` (`GeographicDecisionReason`) — do **not**
survive: they name a non-authority. Replacement reasons in §P2-8.

## P2-6. Experience geographic scope — authority hierarchy

The architecture already has the primitives; it failed to use them for
regional composites. No "regional scope" abstraction is added.

| # | Authority | Created by | Verified by | May authorize | May NOT authorize |
| --- | --- | --- | --- | --- | --- |
| S-a | **Work-unit anchor scope** — `ExperienceValidationScope` AREA/ROUTE/POINT_RADIUS resolved from the user's named anchor | `AreaRouteAnchorResolverService` (AREA_ROUTE_WALK unit) | OSM/Nominatim resolution + structural geometry check | constraint every candidate of that unit must satisfy (conjunction with S-b/S-c, never replaced by them) | its own widening; candidates of other units |
| S-b | **Candidate-owned canonical AREA** — a source-backed `area`-role hint (supportSpan verified) resolved to a canonical AREA GeoEntity with polygon geometry | discovery extraction (existing `area` role, extraction contract §16.1 compatible: scope, not membership) → resolver AREA strategy | source-support gate + `IdentityVerifier` (unique, structurally AREA, no contradiction; ambiguity ⇒ no scope) | component membership via `evaluateAreaScopeMembership` (`AREA_ANCHORED_ROUTE` for WALK/ROUTE_LIKE, else `AREA_CONTAINED`); identity search window for sibling components | component identity; composition; destination eligibility; itself being an Experience |
| S-c | **Candidate-owned canonical ROUTE** — resolved GeoEntity `kind=ROUTE` with usable line geometry (`isCanonicalPhysicalRouteComponent`) | resolver ROUTE strategy | `IdentityVerifier` + `isUsableRouteGeometry` | membership via `evaluateRouteScopeMembership` (topological, no metric cutoff); search window = route bbox | a corridor width constant; a radius class |
| S-d | **Destination AREA** — `GeographicScope.AREA_BOUNDARY` polygon | destination resolution | Nominatim + Overpass boundary | scope of destination-local Experiences (every DEFAULT candidate; any candidate without S-b/S-c) | regional Experiences; a circle around its centroid |
| S-e | **Destination POINT_RADIUS** | destination resolution + `destinationScopePolicy` | — | scope of destination-local Experiences of a point destination | anything beyond its own radius (value T15 UNKNOWN) |
| S-f | **UNKNOWN** — `GEOGRAPHIC_SCOPE_UNKNOWN` | scope derivation when none of the above bounds the candidate | — | nothing | a manufactured region, centroid circle or provider bbox |

Selection rule (single owner, §P2-7):

```text
scope(candidate) =
  S-a  ∧  ( S-b | S-c  if the candidate owns exactly one verified one
           | S-d | S-e  if every component relates to the destination )
  else S-f UNKNOWN
```

Two or more candidate-owned AREA/ROUTE scopes (a genuine multi-area
Experience) give no single Experience scope; today they skip the single-area
shortcut (B5 point 14) and fall through to the destination path. Target: a
destination-local candidate still uses S-d; any other multi-scope case is
UNKNOWN until a multi-scope rule is designed from evidence.

Policy class (authorization) gates which scopes are admissible:

| Authorization | S-b/S-c inside or intersecting destination | S-b/S-c beyond destination | S-d/S-e |
| --- | --- | --- | --- |
| DEFAULT | allowed (`AREA_CONTAINED`) | **not allowed** → UNKNOWN for this candidate | allowed |
| WALK | allowed (`AREA_ANCHORED_ROUTE`) | not allowed | allowed |
| ROUTE_LIKE | allowed | **allowed** (validity only; eligibility is §P2-9 / PD1) | allowed |

The "beyond destination" column is the only thing ROUTE_LIKE widens. It
widens *which real scope may be used*, never a distance.

`walk` is not `route_like`: a WALK authorization never unlocks a scope beyond
the destination and keeps strict anchored membership. A `route_like`
Experience may span a large area because its *scope geometry* says so, not
because route_like means "big radius". Mobility semantics (vehicle vs foot
inside an Experience) are not expressed by the current model; they remain
separate follow-up work (planner/mobility), not part of this contract.

## P2-7. Scope derivation and unknown

- One owner: `deriveExperienceGeographicScope(authorizedCandidate,
  workUnitScope, destinationScope, resolvedScopeEntities)` (name indicative).
  It returns the evolved `ExperienceValidationScope` (renamed
  `ExperienceGeographicScope`) with provenance
  `WORK_UNIT_ANCHOR | CANDIDATE_AREA | CANDIDATE_ROUTE | DESTINATION_AREA |
  DESTINATION_POINT_RADIUS`, or `{ kind: 'UNKNOWN' }`.
- Two-phase resolution inside the resolver: scope hints (`area`/`route` role)
  first, then PLACE components bounded by the result. Scope hints are searched
  within the destination **country** (`destinationCountryCode`, a real
  authority) — never within a radius; homonyms inside the country are
  AMBIGUOUS ⇒ no scope.
- A candidate-owned scope's relation to the destination is recorded as a fact
  (INSIDE / INTERSECTS / OUTSIDE), not used as a gate for ROUTE_LIKE.
- `ComponentGeographicScope` (`VALIDATION_AREA | DESTINATION_AREA |
  POINT_RADIUS | UNAVAILABLE`) is evolved to carry the same provenance; it is
  not duplicated.
- **Unknown remains unknown.** With no S-a…S-e, the result is
  `GEOGRAPHIC_SCOPE_UNKNOWN`. Policy (fail-closed until product says
  otherwise, PD2): a multi-component candidate whose components do not all
  relate to the destination and that has no verified candidate-owned scope is
  **rejected** with reason `GEOGRAPHIC_SCOPE_UNKNOWN`; its components are not
  persisted as an Experience; the trace records it as a knowledge deficit
  ("Experience scope unresolved"). No circle is invented to continue.

## P2-8. Internal composition coherence

| Threshold | False composition it was meant to prevent | Target |
| --- | --- | --- |
| `neighborhoodWalk` 2/4 km | a "walk" spread across a city | dead; walk compactness, if the product wants one, is a mobility/planner policy based on the traveler's walking limits (T20), not geographic validity. REMOVE |
| `experience` 30/60 km | stops from different cities merged into one destination-local Experience | already prevented by destination-polygon containment (S-d) and by source composition (§16.1). Remaining dispersion inside one large polygon is feasibility (E). REMOVE |
| `route` 80/160 km | a "route" whose stops are in unrelated regions | REPLACE by membership in the candidate's real scope (S-b/S-c) + existing admin-context contradiction checks (`COUNTRY_CONFLICT`, `REGION_CONFLICT`, evidence-based) + UNKNOWN when no scope |

Removing these thresholds does not mean "anything anywhere": every component
must relate to one real scope; without one, the candidate fails
(`GEOGRAPHIC_SCOPE_UNKNOWN`); fake unions are already excluded at extraction
(§16.1) and by source support. Proximity still never creates membership (§17).

Reason codes: keep `OUTSIDE_CANONICAL_AREA_BOUNDARY`,
`EXTERNAL_AREA_SCOPE_MISMATCH`, `EXTERNAL_ROUTE_SCOPE_MISMATCH`,
`NO_MATERIAL_ANCHOR_RELATION`, `COUNTRY_CONFLICT`, `REGION_CONFLICT`,
`OUTSIDE_DESTINATION_BOUNDARY` (destination-local only); add
`GEOGRAPHIC_SCOPE_UNKNOWN` and `OUTSIDE_EXPERIENCE_ROUTE_SCOPE` if the existing
ROUTE code does not fit; delete `OUTSIDE_ROUTE_DESTINATION_RADIUS`,
`WITHIN_ROUTE_DESTINATION_RADIUS`; `geographic_incoherence` rejection reason
remains only if a scope-relative rule needs it.

Open item (no number decided here): an extractor could cite an implausibly
coarse AREA (a whole country) as scope. Guard candidates: identity ambiguity
(fail-closed), admin-level comparison already used by
`CANDIDATE_COARSER_THAN_DESTINATION`. Decide in S2 from characterization,
not by a radius.

## P2-9. Destination relation belongs downstream

- `evaluateDestinationCompatibility` stays THE destination owner, polygon only:
  the `routeScale` option, `routeScaleDestinationRadius` and the
  centroid circle are deleted.
- New typed fact per Experience, computed once from component relations to
  the destination polygon: `ExperienceDestinationRelation =
  WITHIN_DESTINATION | EXTENDS_BEYOND_DESTINATION | OUTSIDE_DESTINATION |
  UNKNOWN`. Geographic validation **produces** it; it never rejects a
  ROUTE_LIKE scoped Experience because of it.
- Tour eligibility / planner **consumes** it. Today there is no
  routing-backed feasibility (Planner Product Acceptance is pending), so
  **PD1** must decide what happens to an `EXTENDS_BEYOND_DESTINATION` /
  `OUTSIDE_DESTINATION` Experience for a trip; the architecture doc's
  "city-and-surroundings" section is the governing product direction (explicit
  scope preference + travel-time eligibility). Until PD1 is answered, the safe
  interpretation is: such an Experience may be **verified and persisted in the
  catalog under its own scope** (catalog truth is not trip-relative) but its
  **tour eligibility is undecided** — no fallback, no silent inclusion.
- Catalog retrieval is destination-windowed today (T19). WARM reuse of a
  beyond-destination Experience therefore depends on PD1 as well.
- A geographically valid regional Experience may still be rejected later by
  planning feasibility. That is not a contradiction.

## P2-10. Identity acquisition scope

What authorizes the search geography for a component: the scope that will
judge it.

| Candidate scope | Search window | Candidate filter |
| --- | --- | --- |
| S-b AREA | bbox→circle of the AREA polygon (`boundingBoxToCenterRadius`, a physical derivation) | `classifyComponentAreaRelation` supports membership |
| S-c ROUTE | bbox→circle of the route geometry | route-scope relation |
| S-a anchor | the anchor's geometry (already used for the local OSM pool via `entityResolutionScope`) | anchor membership |
| S-d destination AREA | bbox→circle of the destination polygon | `evaluateDestinationCompatibility` (polygon) |
| S-e POINT_RADIUS | the point radius itself | point-radius relation |
| UNKNOWN | **no scoped search for a scope-requiring candidate**; destination-local search only | destination polygon |

Deleted: `routeScaleDestinationRadius`, `searchScope.kind ROUTE_SCALE`, and the
50 km plausibility constants T9/T10 as search scopes (T11 may survive only as
a separately named operational cap that never decides validity). Provider
capability differences (bias vs restriction, circle vs bbox) stay inside
adapters.

## P2-11. Scenario matrix for the implementation (deterministic)

| | Setup | Expected |
| --- | --- | --- |
| A | destination-local single venue inside destination polygon | scope S-d; COMPATIBLE; search window = destination bbox; relation WITHIN |
| B | WALK (owned unit), components inside a neighborhood AREA anchor | scope S-a; `AREA_ANCHORED_ROUTE`; a WALK candidate whose area lies beyond the destination ⇒ not admissible (UNKNOWN, rejected) |
| C | ROUTE_LIKE, destination city polygon; candidate has a source-backed `area` hint resolving to a canonical AREA beyond the destination; ≥2 venues inside that AREA | scope S-b; components validated against the AREA; **not** rejected for destination-centroid distance; relation EXTENDS_BEYOND/OUTSIDE recorded; eligibility per PD1 |
| D | ROUTE_LIKE with a resolved canonical ROUTE leaving the destination | scope S-c from real geometry; membership topological; no radius |
| E | ROUTE_LIKE, components outside destination, no resolvable AREA/ROUTE | `GEOGRAPHIC_SCOPE_UNKNOWN`; rejected (PD2 fail-closed); no circle invented |
| F | fake composite: components in two unrelated regions/provinces, with or without one `area` hint | fails: components outside the scope (`OUTSIDE_CANONICAL_AREA_BOUNDARY`), or `REGION_CONFLICT`, or UNKNOWN; never accepted because a threshold was removed |
| G | identity search for C/D | provider called with the scope-derived window; never `ROUTE_SCALE`/destination-centroid; DEFAULT uses destination bbox, not 50 km |
| H | Experience C verified; planner day budget cannot fit the excursion | geographic validation ACCEPTED; planner rejects/omits with its own reason |
| I | Uco regression (fixture only): Alfa Crux, SuperUco, Bodega La Azul coordinates; destination Ciudad de Mendoza; (i) no area hint ⇒ E; (ii) with a verified "Valle de Uco"-class AREA fixture polygon ⇒ C | (i) UNKNOWN; (ii) accepted under S-b; never via 80 km |
| J | synthetic other-world fixture: destination "Fixture City" polygon; "Fixture Valley" AREA ~120 km away; 3 venues inside it; plus the same venues mixed with one venue in "Other Province" | general C acceptance; F rejection; no Mendoza/Uco strings in production |

## P2-12. Threshold fate table

| Threshold | Current meaning(s) | Legitimate? | Fate | Future owner |
| --- | --- | --- | --- | --- |
| 2 km (T1) | none (dead) | no | **REMOVE** | — (walk compactness → planner/mobility if ever requested) |
| 4 km (T2) | none (dead) | no | **REMOVE** | — |
| 3 anchors (T3) | none (dead) | no | **REMOVE** | — |
| 30 km (T4) | DEFAULT experience coherence radius | no | **REMOVE**; replaced by S-d containment + source composition | composite validation (scope membership) |
| 60 km (T5) | DEFAULT experience pairwise | no | **REMOVE** | same |
| 2 anchors (T6) | ≥2 components | yes (structural) | **KEEP**, single owner = evidence requirement / composition contract; delete the validator duplicate | composition contract |
| 80 km (T7) | route coherence; destination-centroid compatibility; identity search circle | no | **REPLACE**: coherence → scope membership (S-b/S-c); destination → polygon relation fact (§P2-9); identity → scope-derived window (§P2-10) | three different owners |
| 160 km (T8) | route pairwise | no | **REPLACE** by scope membership | composite validation |
| 50 km (T9, T10) | identity search "plausibility" | no | **REPLACE** by scope-derived window | resolver strategies |
| 50 km (T11) | Overpass highway cap | as a scope, no | **REPLACE** scope; optional operational cap with its own name/rationale | OSM adapter |
| 8 / 2.5 / 8 km (T12) | Overpass load caps | yes (operational) | **KEEP** as provider/operational constraints; never validity | OSM adapter |
| 1 / 2.5 / 5 km (T13) | Nearby coverage circles | yes (operational) | **KEEP** | catalog refill |
| 5 km (T14) | silent default search radius | no | **REPLACE** with explicit scope or explicit failure | acquisition provider |
| 25 km (T15) | point-destination scope | unknown | **UNKNOWN** — product decision on the value (PD3) | destination scope policy |
| 75 / 2 km (T16) | destination disambiguation tolerance | unknown | **UNKNOWN** — destination-resolution characterization | destination resolution |
| 200 m (T17) | Wikidata corroboration search | owner documented | **UNKNOWN** (value) — identity audit | identity evidence |
| 150 m (T18) | write-time dedupe / overlap | owner documented | **UNKNOWN** (value) — identity audit | identity dedupe |

## P2-13. Regression rule (mechanically enforceable)

> A geographic distance that decides a domain outcome lives in exactly one
> policy owner, is exported only as part of that owner's typed policy, and is
> never imported by another policy owner.

Enforcement (implementation milestone S6):

1. Architecture test (in `preference-first-architecture.spec.ts`):
   - `DEFAULT_GEOGRAPHIC_VALIDATION_THRESHOLDS` (or its successor) may be
     imported only by `composite-geographic-validation.service.ts`;
   - `destination-compatibility.policy.ts` may not import
     `centroidOfGeometry`/`distanceMeters` nor any threshold object;
   - `experience-proposal-resolver.service.ts` may not import threshold
     objects; search windows come from scope geometry;
   - symbols `routeScale`, `routeScaleDestinationRadius`, `ROUTE_SCALE`,
     `ROUTE_DESTINATION_RADIUS` are forbidden in `be/src`.
2. Distance-constant registry test: every `*_RADIUS_METERS` /
   `*_DISTANCE_METERS` constant and every meter-valued `\d+_000` literal in
   `be/src/modules/tours/**` and `be/src/modules/integrations/**` must appear
   in an allowlist naming owner, status (§P2-3) and rationale; a new entry
   requires a doc update. UNJUSTIFIED entries cannot be added.
3. Types: replace `routeScale?: boolean` by the typed scope; a search window
   is a `ScopeSearchWindow` derived from an `ExperienceGeographicScope`, not a
   number parameter.

## P2-14. Implementation sequence (bounded milestones; not started)

| | Milestone | Content | Exit |
| --- | --- | --- | --- |
| S0 | Product decisions | PD1 (eligibility of beyond-destination Experiences before routing feasibility), PD2 (UNKNOWN policy: fail-closed recommended), PD3 (point radius value; may stay deferred) | recorded in the progress pointer |
| S1 | Contracts | `ExperienceGeographicScope` (evolve `ExperienceValidationScope`, provenance, `UNKNOWN`), `ExperienceDestinationRelation`, `ScopeSearchWindow`, reason codes; no behavior change | typecheck + contract tests |
| S2 | Scope derivation | single `deriveExperienceGeographicScope`; two-phase resolution (scope hints first, country-bounded); authorization × scope admissibility table §P2-6; coarse-AREA guard decided from characterization | unit A–F, I, J |
| S3 | Identity acquisition scope | scope-derived windows for Places/Nominatim/OSM; delete `routeScaleDestinationRadius`, `ROUTE_SCALE`, T9/T10 as scopes, T14 default | G + trace search-window facts |
| S4 | Composite validation | validator consumes scope; `canonical_area`/`canonical_geometry` no longer destination-gated for ROUTE_LIKE; route-scope membership stops failing on OUTSIDE_DESTINATION for candidate-owned scope; delete `routeDestinationMismatch`, T1–T5, T7, T8, route-scale coherence | C, D, E, F |
| S5 | Destination relation cutover | `evaluateDestinationCompatibility` polygon-only (delete `routeScale` option and route reasons); compute/persist `ExperienceDestinationRelation`; eligibility + catalog retrieval per PD1 | A, H; no reachable centroid circle |
| S6 | Regression guards | §P2-13 architecture + registry tests; rewrite the T7-dependent specs listed in §P2-3 | CI green |
| S7 | Overture re-characterization | rerun the offline probe with the corrected scope (Experience scope, not 80 km) | revised assessment |
| S8 | `OVERTURE_IDENTITY` decision | only after S7 | design doc |
| S9 | Canonical COLD #12 | RW4 under the corrected architecture | RW4 evidence |

S1–S6 is one cutover: the destination-centroid circle must be unreachable at
the end (no dual authority).

## P2-15. Engineering-principles review of the target design

| Category | Current code | Target |
| --- | --- | --- |
| single policy authority | FAIL (T7 owns three questions) | PASS (one owner per question, §P2-2) |
| unknown semantics | FAIL (no-scope regional candidate gets a circle) | PASS (`GEOGRAPHIC_SCOPE_UNKNOWN`) |
| no magic defaults | FAIL (T4, T5, T7–T11, T14) | PASS (geometry-derived; surviving numbers are operational caps or UNKNOWN pending decision) |
| provider isolation | PASS | PASS (window semantics stay in adapters) |
| typed boundaries | FAIL (`routeScale?: boolean`) | PASS (typed scope + relation + window) |
| genericity | FAIL (Mendoza-justified constant in code comment) | PASS (scenario J; no destination/category numbers) |

## P2-16. RW4 consequence

Under the corrected architecture the COLD #11 Uco candidate ("Uco Valley Wine
Tasting Itinerary": Alfa Crux, SuperUco, Bodega Azul; three `venue` hints, no
`area` hint) is **case E**: components outside Ciudad de Mendoza and no
candidate-owned scope ⇒ `GEOGRAPHIC_SCOPE_UNKNOWN`. Its internal geometry is
coherent (Overture/OSM coordinates: centroid radius ≈ 20.9 km, max pairwise
≈ 38.4 km), and the region is named only in the Experience title, which the
extraction contract already lets it emit as an `area` hint.

```text
RW4 EXIT CRITERIA
[x] stable deep-source examination
[ ] real multi-component Experience persisted
[ ] WARM reuses it
[ ] RW4 CLOSED
```

next blocker = the geographic-scope architecture (S1–S5) is not implemented:
the route_like-owned regional composite has no Experience-scope authority
(destination-centroid 80 km is not one), and product decision PD1 (eligibility
of an Experience that extends beyond the trip destination) is open. Identity
coverage (Alfa Crux, SuperUco, Bodega Azul) is re-evaluated only after that.

## P2-17. Implementation status (S1–S6 cutover, 2026-10-02)

Product decisions (user-approved for the cutover):

- **PD1** — a geographically verified Experience may be persisted in the
  catalog whatever its relation to the trip destination (catalog validity is
  not trip-relative). Tour eligibility is separate: from the destination
  retrieval window only `WITHIN_DESTINATION` Experiences are tour-eligible;
  a regional Experience enters a tour only through an explicit request scope
  (a user-named `geographic_scope` AREA anchor owned by a ROUTE_LIKE unit).
  No travel time is fabricated; routing-backed feasibility stays with
  Planner Product Acceptance.
- **PD2** — fail closed: a multi-component candidate that needs a regional
  scope and has none is rejected `GEOGRAPHIC_SCOPE_UNKNOWN`; no circle.
- **PD3** — the 25 km point-destination radius (T15) is DEFERRED, unchanged,
  and never borrowed for a regional Experience.

| | Milestone | Status | Code |
| --- | --- | --- | --- |
| S1 | Contracts | COMPLETE | `interfaces/experience-geographic-scope.interface.ts` (`ExperienceGeographicScope` + provenance + `UNKNOWN`, `WorkUnitAnchorScope` — the renamed `ExperienceValidationScope`, its unused POINT_RADIUS variant deleted — `ScopeDestinationRelation`, `ExperienceDestinationRelation`, `ScopeSearchWindow`); `ComponentGeographicScope` evolved to the same provenance; reasons `geographic_scope_unknown`, `outside_experience_scope`, `GEOGRAPHIC_SCOPE_UNKNOWN`, `OUTSIDE_EXPERIENCE_ROUTE_SCOPE`; validator version 2 |
| S2 | Scope derivation + production | COMPLETE (code) / real Uco AREA unavailable | single owner `deriveExperienceGeographicScope` (`utils/experience-geographic-scope.policy.ts`): exactly one verified candidate-owned ROUTE (S-c) or AREA (S-b), else a regional user anchor (ROUTE_LIKE only), else S-d/S-e; §P2-6 admissibility table. Two-phase resolver (scope hints first — a ROUTE_LIKE AREA hint is searched within the destination country, no radius bias; components second, bounded by the derived scope). Extraction: an `area` hint alongside member components is a scope claim whose verified span must literally name the area (`SCOPE_NAME_NOT_IN_SUPPORT_SPAN`), plus a prompt rule. Coarse-AREA guard = existing area-scale rank band + `isCoarserThanDestination` (admin evidence only) + in-country homonym ambiguity |
| S3 | Identity acquisition scope | COMPLETE | Places/Nominatim/catalog windows = `scopeSearchWindow` of the scope that will judge the component; `PLACES_FALLBACK_BIAS_RADIUS_METERS`, `NOMINATIM_BIAS_RADIUS_METERS`, `routeScaleDestinationRadius`, `ROUTE_SCALE` deleted; Nominatim bias carries the window; Google adapter sends a rectangle bias above its 50 km circle cap; Overpass highway cap renamed operational and refuses (UNAVAILABLE) instead of clamping; T14 `?? 5000` replaced by explicit failure; dead `StructuredGeoEntityResolverService` (50 km semantic filter) deleted |
| S4 | Composite validation | COMPLETE | validator dispatches on the derived scope: S-b area membership, S-c topological route membership (topology before destination), S-d destination containment, S-e point radius, UNKNOWN rejected; COUNTRY/REGION contradictions kept; T1–T5, T7, T8 and `routeDestinationMismatch` deleted; source-composition completeness unchanged |
| S5 | Destination relation + regional retrieval | COMPLETE | `evaluateDestinationCompatibility` polygon-only (`routeScale` option + route reasons deleted); `evaluateExperienceDestinationRelation` fact on every validation result; tour eligibility gate `utils/tour-destination-eligibility.policy.ts` in generation/facet retrieval/sufficiency; regional `geographic_scope` AREA anchors resolve (unique in-country, fallback after in-destination candidates; WALK units refuse them) so WARM reuse runs through `findVerifiedMultiComponentInArea` over the persisted area-role component (existing schema; no migration) |
| S6 | Guards + regressions | COMPLETE | `services/geographic-distance-authority.architecture.spec.ts` (forbidden superseded symbols, polygon-only destination policy, resolver import rules, registry of every named distance constant with owner/status, no coherence-threshold objects); scenario matrix `services/geographic-scope-cutover.spec.ts`; WARM integration `test/integration/tour-generation/regional-catalog-reuse.integration-spec.ts` |
| S7–S9 | Overture / COLD #12 | NOT STARTED | out of scope |

Real-world evidence (2026-10-02, `spikes/rw4-geographic-scope-uco-area-probe-2026-10-02/`):

- **Source-backed AREA hint for Uco: SUPPORTED by the source, NOT obtained
  live.** The COLD #11 SolSalute excerpt states "If I were to plan a wine
  tasting in Valle de Uco Itinerary for a friend"; the deterministic
  extraction contract accepts an AREA hint quoting it. The live COLD #11
  extractor did not emit it.
- **Canonical polygon resolvable: NO.** Public and local Nominatim return
  only two residential streets named "Valle de Uco" ("Uco Valley": none).
  Even an OSM `place=region` would fall outside the existing area-scale rank
  band (13–25). The real Uco candidate therefore cannot yet reach scoped
  identity acquisition; with the current extraction it is case E
  (`GEOGRAPHIC_SCOPE_UNKNOWN` once its wineries are positively found beyond
  the destination).

COLD #11 proved candidate-scoped authorization propagation; it did NOT prove
the 80 km geographic policy (§P2-4). That historical record is unchanged.
