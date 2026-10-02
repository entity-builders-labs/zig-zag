# Geographic validation authorization — architecture review

Status: **REVIEW / IMPLEMENTATION-READY CONTRACT (no production change)**.
Branch `feat/preference-first-selection` at `fda878a3`. Trigger: canonical
COLD #10 (RW4).

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
