# RW1 — San Telmo AREA-scoped walk — Assessment

## Current rerun correction — 2026-09-14

The five-minute cold observation was a **HARNESS OBSERVATION TIMEOUT**, not a
provider failure. The persisted terminal record for cold tour
`369863c8-d977-46ce-9af3-01819d11068f` is `completed`:

- runtime derivable from `generatedAt`/`generationCompletedAt`: **403,767 ms**;
- anchor: **San Telmo**, resolved as an administrative `area` boundary by
  `DestinationResolutionService` (the trace does not persist a boundary ID);
- acquisition: ordinary `ExperienceAcquisitionService`, two passes;
- `AreaRouteWalkAcquisitionService`: **not invoked**;
- attempted providers: `google_places`, `osm`, `web`, `wikivoyage`;
- provider failures: **none**; both discovery passes are `PASS`;
- final status: **completed**.

The terminal tour contains no canonical composed historical walk. The planner
scheduled five independent, single-component venue Experiences:

| Day/order | Experience ID | Canonical name | Component ID/name |
|---|---|---|---|
| 1/1 | `21c8f628-f1e3-42a0-a112-cc7f224c5a80` | Baloon | `3619060d-e0c8-4a4f-8fc4-280749673ba1` / Baloon |
| 1/2 | `37ad0f10-5b5d-457a-9690-b397eb26b36f` | Monumento Canto al Trabajo | `d1e0584e-aefc-4c76-9839-30f748329911` / Monumento Canto al Trabajo |
| 1/3 | `2a28277b-7fa6-48e7-a623-65c9a700536a` | Museo de Arte Contemporáneo de Buenos Aires | `d55e8518-4232-46e9-b2ab-30743f03b33d` / Museo de Arte Contemporáneo de Buenos Aires |
| 1/4 | `223bdf86-41ef-46b6-8052-5251895154c1` | Plaza 30'000 compañeros | `748f3d3f-36ee-4986-b712-5c76a191cd2e` / Plaza 30'000 compañeros |
| 1/5 | `553538ff-127f-4b9a-adb2-42a5fe22635d` | La Hazana | `dade9905-9f49-404e-b76d-a18e65aa1e50` / La Hazana |

Component count is 1 for every selected Experience. No evidence proves a
composed walk itself; the trace records ordinary discovery, entity resolution,
geographic validation, and catalog materialization only. The selected rows
were geographically validated as individual proposals, not as a composed
route, and their persisted classifications are `visit`/place-oriented or
empty rather than `intent:walk`.

The correct cold product verdict is **EXPECTED_B6_GAP**: the real acquisition
pipeline completed successfully, but the B6 route/walk acquisition primitive
was not reached and no grounded multi-component walk was available to plan.

Warm rerun, without resetting `zigzag_spike_preb6`, produced tour
`80ebd9c3-0bf7-428e-af85-7fa6c45243a7` in **32,355 ms**, also completed with no
provider failures. It selected the same five Experience IDs and the catalog
remained at 23 Experiences / 23 components. This proves identity-stable
reuse of the individual catalog rows, but not reuse of a composed walk:
neither cold nor warm created one, and warm again ran ordinary acquisition.

Current classification:

```text
HARNESS: observation timeout at 5m
PIPELINE: eventually completed
PROVIDERS: no recorded failures
RW1 PRODUCT VERDICT: EXPECTED_B6_GAP
RW1 PERFORMANCE: cold 403,767 ms; warm 32,355 ms
```

## Canonical B5 rerun — current HEAD `811830b` — 2026-09-14

The current build was verified with an explicit runtime identity and a
working local Ollama preference interpreter. The earlier remote Gemini/Groq
credentials were invalid, causing fallback and loss of the interpreted
anchor; no downstream anchor was fabricated.

Cold tour: `c95dbc71-f727-4c94-9977-1adcbb180c5c`.

```text
runtime buildCommit: 811830bde0ad81656c89f9ffa807e3fcb40e597f
interpreter anchor: San Telmo / area / must
PreferenceSpec anchor: San Telmo / area / must
facets: theme:history, intent:walk
walk deficit: preference_facet / intent / walk
partition: AREA_ROUTE_WALK=1, GENERIC=1 (theme:history only)
AreaRouteWalkAcquisitionService: invoked, outcome=no_result
generationStatus: completed
runtime: 13,254 ms
```

The specialized primitive was reached correctly. It did not produce a
grounded multi-component walk; the planner scheduled four independent,
single-component venue Experiences. The current cold product verdict is
**EXPECTED_B6_GAP**, not `ORCHESTRATION_GAP`, `INFRASTRUCTURE_GAP`, or
`PROVIDER_COVERAGE_GAP`. The run recorded one `google_places` provider failure
while the remaining sources continued; that diagnostic did not alter the B5
routing result.

No warm run was executed for this current cold run because there is no
canonical composed-walk Experience ID to reuse.

Human request: **"caminata histórica por San Telmo"**
Run via the real, unmodified application path: `POST /auth/email/*` → `POST
/tours/generate-tour` → outbox(`TourGenerationRequested`) →
`TourGenerationProcessorService` → `ExperienceGenerationService.generateTourExperiences`.
No lower-level service was invoked manually. No candidate/component/evidence
was hand-seeded. Spike database `zigzag_spike_preb6`, confirmed clean before
this run. `GROUNDED_SEARCH_PROVIDER=serpapi`, local Overpass/Nominatim,
`AI_CACHE_MODE=off`, `USE_MOCK_MAPS=false`.

RUN 1 tour: `09e6befd-3438-4bcc-beff-d41cf5e11e75` (COLD).
RUN 2 tour: `f1582d71-ff01-44fc-af45-cf03a15a9b68` (WARM, same DB, no reset).

---

## 1. What real Experience did the system attempt to establish?

None, structurally. The system never attempted to establish **one composed
"San Telmo Historical Walk" Experience**. It ran its ordinary point-of-
interest coverage/acquisition loop and ended up selecting five independent,
single-component "visit" Experiences (each a real museum/monument) that
happen to be geographically close to San Telmo. There was never a
`ComponentHints`-bearing candidate proposing a multi-stop walk; the loop
never composes multiple resolved places into one Experience unless a
provider (structured or web) proposes that composition itself, and none did.

## 2. Which evidence proves the composed walk itself exists?

None. No composed-walk evidence was ever produced or cited.

## 3. Which evidence only proves individual POIs exist?

All of it. `structuredProviders` (wikivoyage/osm/google_places, 493
candidates) and the one grounded/web pass (SerpAPI → Gemini extraction, 1
candidate) each proposed individual places — museums, monuments, streets —
never a walk/itinerary composition citing multiple stops as one product.

## 4. What components were extracted?

Per final Experience, exactly **one** `ExperienceComponent` each (`venue`-
role, single real place). No candidate anywhere in either run carried more
than one component hint (confirmed: `geographic_validation`'s
`canonical_geometry` strategy — the pre-existing, non-B5 shortcut for a
candidate that already carries its own AREA/ROUTE hint — fired 41-42 times,
but these still resolved to single-component Experiences in the persisted
set; no multi-component walk emerged from any of them either).

## 5. Were any components invented or inferred only from proximity?

No. Every persisted component resolved against a real provider identity
(OSM or Google Places), confirmed via `entity_resolution`'s
`RES-IDENTITY-001` rule (221-226 real entities resolved per pass, all with
real coordinates) and via `geographic_validation`'s explicit `REJECTED`
count (133-134 candidates correctly rejected for failing geographic
validation, not silently kept). No proximity-only invention was observed —
the honest failure here is compositional (no walk was ever proposed), not
fabricated grounding.

## 6. Did every required component resolve?

For each of the 5 final Experiences, yes (a single required `venue`
component each, resolved). There was never a multi-component "walk"
candidate to test partial resolution against.

## 7. Which provider IDs/geometries were used?

Real OSM/Google Places identities via `entity_resolution` against local
Overpass/Nominatim and Google Places. Two full identity/coordinate dumps are
in `run1-cold.json`/`run2-warm.json` (`entityResolutionPasses`). Raw
per-entity provider IDs remain in the spike Postgres database
(`geo_entity`/`geo_entity_identity` tables in `zigzag_spike_preb6`) — not
duplicated here to keep this dossier's committed size bounded, per the
plan's own "stable excerpts, not full raw payloads" rule.

## 8. Did AREA validation actually prove all required components fit San Telmo?

**No AREA validation of any kind ran.** This is the central finding of this
spike (see Verdict). `destination_resolution` degraded "San Telmo, Buenos
Aires, Argentina" to `scale: point` (`degradedReason: no_area_candidate` —
Nominatim's own real result for San Telmo is `addresstype: suburb`, which
`DestinationResolutionService`'s scale check does not accept as area-scale;
only `city`/`town`/`village` do). The subsequent catalog/discovery retrieval
then ran against a **25km-radius point**, not a San Telmo polygon — wide
enough to include Ecoparque (Palermo), Feria de Mataderos, and the former
ESMA site (Núñez), all real candidates that surfaced in the 65-strong pool.
B5's own, already-tested `AreaRouteAnchorResolverService`/
`CompositeGeographicValidationService.rejectIfExternalScopeViolated` (the
mechanism that WOULD have resolved a real San Telmo boundary and rejected
any component outside it) was never invoked — because
`AreaRouteWalkAcquisitionService` was never invoked at all (see Verdict).

The final 5 *selected* Experiences happened to land close to San Telmo
(0.32–1.65 km from its centroid) because the deterministic daily-planning
solver's own travel-time/clustering optimization favored nearby candidates
out of the 65-candidate pool for a 1-day tour — not because any geographic
scope check enforced San Telmo membership. This is a real, favorable
side-effect, not a substitute for the missing AREA validation.

## 9. Was component order persisted?

No (`order: null` implicitly — each Experience has exactly one component,
so sequence is not applicable).

## 10. If yes, what evidence established that order?

N/A — see above.

## 11. What dedupe decision occurred?

`decideExperienceDedupe`'s `SAME` path fired extensively and correctly on
the WARM run: of RUN 2's 75 `catalog_materialization` outcomes, all but one
converged onto an already-persisted `Experience` id (64 unique ids out of
75 occurrences on RUN 2, identical set to RUN 1's 65, plus exactly one
genuinely new place). This is real, correct SAME-identity convergence via
ordinary provider-identity dedupe (same OSM/Google Place id resolved twice
→ same canonical row) — not the B5 warm-reuse-first primitive, which was
never invoked (see Verdict, and the critical-invariant discussion below).

## 12. What classification was persisted, and which evidence keys support every accepted semantic fact?

**None.** All 66 Experiences in `zigzag_spike_preb6` after both runs have
`metadata.themes`/`metadata.intents`/`metadata.classification` **empty/null**
— confirmed directly against Postgres, not inferred. `ExperienceClassificationService`
(B2) was never invoked by this live persistence path. This matches B5's own
plan document, which already scoped universal classification-wiring into
`ExperienceProposalResolverService` as a separate, larger future task
("Checkpoint D") — `AreaRouteWalkAcquisitionService` is the only production
caller of the classifier today, and it was never reached here either. This
spike is the first live confirmation that, absent that wiring, **no
Experience acquired through the live path today can ever satisfy an
intent-based coverage check**, `walk` or otherwise — coverage's theme match
("history": PASS) is satisfied through a separate, looser keyword heuristic
over candidate name/description text (`theme-matching.util.ts`, per
CLAUDE.md), not through persisted classification.

## 13. What canonical Experience(s) were created/reused?

RUN 1 created 65 new canonical Experiences (of which 5 were selected into
the final 1-day tour, listed in `run1-cold.json`). RUN 2 reused the same 5
selected ones (identical ids) plus 63 of the other 60 already-persisted
rows, and created exactly 1 genuinely new Experience. No duplicate rows for
an already-real place were created on either run.

## 14. Is the result sensible to a human reviewer?

The final tour (5 real, nearby historical museums within ~1.6km of San
Telmo) is a *plausible, walkable* one-day itinerary a human might accept —
but it is **not** what was asked for. The product's own deterministic
`TourCompletenessValidator` flagged this itself, independently of this
assessment: `UNMET_REQUESTED_FORMAT — "You asked for 'walk' experiences,
but none made it into the final itinerary."`, on both runs. A human who
asked for "a historical walk through San Telmo" and received five
individually-scheduled museum visits — correctly grounded, geographically
plausible, but never verified as a real composed walk, and not verified as
confined to San Telmo itself — would reasonably say the system delivered a
good POI itinerary, not the walk they asked for.

---

## Provider-call observations

| Provider | RUN 1 (COLD) | RUN 2 (WARM) |
|---|---|---|
| SerpAPI | called (2 queries across 2 discovery passes) | called again (1 new query) |
| Extraction LLM (Gemini) | called (2 passes) | called again (1 pass) |
| Classification LLM | never called (not wired into this path) | never called |
| Nominatim | called (destination resolution + entity resolution) | called again |
| Overpass | called (entity resolution/boundary lookups) | called again |
| Google Places | called (structured discovery) | called again |
| Preference-interpretation LLM (Groq) | called | called again (fresh interpretation each request — expected; this is per-request NLU, not Experience research) |

Not every provider was called on every pass (e.g. classification never was);
this table records what actually happened, not a required set.

---

## Critical invariant check — "same ID after reacquisition ≠ catalog reuse"

**RUN 2 fits the explicitly-disqualified pattern, not successful reuse:**

```text
same request
  → SerpAPI called again (new query, new evidence: 5 items vs RUN 1's 2)
  → extraction LLM called again (new candidate)
  → geographic re-resolution/re-validation of the full 65+1-candidate pool
  → persistence re-attempted for ~75 candidates
  → dedupe returned SAME for ~74/75 of them
  → same 5 canonical Experience ids ended up selected
```

The persisted knowledge from RUN 1 did **not** prevent unnecessary
rediscovery of "the Experience" — because there is no Experience-level
reuse check in this live path at all. `db_search` (the ordinary
`CoverageAnalyzer`/catalog-first check) DID find the 65 already-persisted
rows before acquisition — that part of reuse infrastructure works — but
because none of them carry a real `intent:walk` classification (see Q12),
coverage's own intent-deficit check can **structurally never be satisfied**
by catalog state alone, so `needs_additional_discovery` fires unconditionally
on every request for this intent, regardless of what's already known. The
observed "same 5 ids" outcome is a side effect of correct low-level
identity dedupe (same OSM/Google Place ids resolve to the same rows every
time), not evidence that the system recognized "I already have a walk
Experience for this."

This is exactly the disqualified pattern named in the RW1 authorization,
not `SUCCESS_CURRENT`.

---

## Verdict

**Primary: `ORCHESTRATION_GAP`.**

`PreferenceInterpreterService` correctly, really (via a live Groq call)
extracted `anchoredPlaces: [{kind: "area", rawName: "San Telmo", priority:
"must"}]` on both runs — a genuine, "must"-priority signal that the request
is scoped to a real named area. That signal is **never consumed anywhere
downstream** in the live generation path: confirmed by grep against the
full Bitácora trace of both runs — zero occurrences of
`AreaRouteWalkAcquisitionService`/`AreaRouteAnchorResolverService`, the B5
primitives that exist, are unit/integration-tested, and are specifically
designed to resolve a real AREA boundary for exactly this anchor, gate
persistence against it, and check the catalog for a compatible existing
Experience before acquiring. This matches the B5 plan's own documented,
explicit non-goal ("No live-orchestration wiring into
`ExperienceGenerationService.generateTourExperiences()`") — this spike is
the first **live, empirical confirmation** of that known gap, not a new
discovery, and not a defect in B5 itself. Nothing in this run suggests B5's
own logic is wrong; it was simply never reached.

**Secondary findings** (both real, both worth carrying into B6/orchestration
planning, neither the primary blocker):

1. **`EXPECTED_B6_GAP`** (composition/extraction authority): discovery/
   extraction (structured providers and the one grounded/web pass alike)
   never proposed a multi-component walk candidate from the available
   evidence — only individual places. Whether better-scoped queries/
   extraction prompts (B6's territory) would surface real composed-walk
   evidence for San Telmo specifically is untested here; this run only
   establishes that the *current* extraction never attempts composition
   at all when working from a generic "top attractions" query, which is
   itself partly a consequence of the primary gap (no anchor-aware query
   construction reached discovery, since B5's planner-side anchor routing
   was never invoked either).
2. A live-confirmed classification gap (Q12): zero Experiences acquired
   through this path carry any persisted classification, so no
   intent-based coverage can ever succeed here regardless of catalog
   state. Already scoped as a separate future task ("Checkpoint D") in
   B5's own plan; recorded here as now empirically observed in a real run,
   not newly discovered.
3. A destination-resolution precision gap, independent of B5: a real,
   resolvable neighborhood (`addresstype: suburb`) degrades to a
   25km-radius point rather than any area-scale handling, which is
   disproportionate for a neighborhood-scoped request. This compounds
   finding 1 (no AREA boundary ever reaches validation) but would remain
   even if AnchoredPlace routing were wired in, since `AreaRouteAnchorResolverService`
   is a separate primitive built specifically to not depend on this
   city/town/village-only check — worth noting as a related, adjacent gap,
   not conflating the two.

**No `B5_OR_IDENTITY_BUG` was found.** Every dedupe/identity/geographic
decision that DID run (single-POI `venue_centric` validation, the
pre-existing `canonical_geometry` shortcut, and dedupe's SAME convergence
on repeated identities) behaved correctly and consistently with the
deterministic gates already proven in the Postgres integration suite. No
fix is authorized or needed from this run.

Per the stop condition: **RW2 is not run. No product code was changed.
Reporting complete findings and waiting for review.**
