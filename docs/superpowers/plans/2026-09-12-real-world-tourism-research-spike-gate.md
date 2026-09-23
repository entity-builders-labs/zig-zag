# Real-World Tourism Research Spikes — B5/B6 Reality Gate

> **2026-09-22 forensic rerun amendment — authoritative for current RW1 diagnosis**
>
> RW1 was rerun after the live preference-first cutover and the corrected
> Bitácora work. Artifacts live under
> `spikes/rw1-san-telmo-historical-walk/forensic-rerun-2026-09-22/`.
> The original 2026-09-13 ORCHESTRATION_GAP remains historical evidence for
> that earlier runtime, but it is no longer the current dominant RW1 diagnosis.
>
> The 2026-09-22 campaign proves that real multi-component walks now reach
> grounded discovery, extraction and Entity Resolution. The dominant current
> blocker is the LLM-authored `required` / all-or-nothing component gate:
> partially resolved source-backed composites are discarded before useful
> composite Geographic Validation. It also exposes identity-policy issues such
> as El Zanjón de Granados, where multiple acquisition paths converge on the
> same canonical OSM object but the candidate remains unconfirmed because
> Wikidata does not fully corroborate the non-exact canonical name.
>
> The target correction is specified in
> `docs/superpowers/specs/2026-09-22-component-resolution-geographic-validation-and-enrichment-amendment.md`.
> References below to "all required components" describe the earlier gate and
> are superseded for future acceptance criteria. Do not delete them from the
> historical 2026-09-13 account.


Status: **required characterization + acceptance gate; planned, not automated.**
Written: 2026-09-12.
Amended: 2026-09-13 — infrastructure preflight (local Nominatim added; SerpAPI
forced with no silent Tavily fallback; dedicated clean-slate spike database)
and a hardened warm-reuse/idempotency acceptance contract. See
`docs/superpowers/progress/2026-09-13-pre-b6-gates-progress.md` for the
preflight completion record.
Amended again: 2026-09-13 — RW1 executed (verdict `ORCHESTRATION_GAP`; see
its entry under §7 and the full dossier in
`spikes/rw1-san-telmo-historical-walk/`). RW1 exposed that the live
orchestration was never wired to preference-first primitives at all, which
is now the subject of its own dedicated implementation plan,
`docs/superpowers/plans/2026-09-13-preference-first-live-cutover.md`. RW1
must be **rerun** after that cutover, before RW2–RW6 (still **not started**)
are authorized.
Branch: `feat/preference-first-selection`.

Related:
- `docs/superpowers/specs/2026-09-12-living-tourism-knowledge-base-design.md`
- `docs/superpowers/specs/2026-09-12-experience-identity-dedupe-and-diversity-design.md`
- `docs/superpowers/plans/2026-09-12-experience-identity-postgres-integration-gate.md`
- `docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md`
- `docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md`

---

## 1. Why this gate exists

Unit tests and Postgres integration tests prove that Zig-Zag behaves correctly for inputs we construct ourselves. They do **not** prove that the product can start from a real tourism request, research the open world, discover a real composed Experience, extract its real components, ground those components, survive every geographic/identity/classification filter, and persist useful reusable knowledge.

That distinction is product-critical.

The north star is not merely an itinerary generator. Zig-Zag is a **Tourism AI Research Agent** that continuously builds, corroborates and maintains a living tourism knowledge base. A composed walk/route is only valid when the research chain proves the Experience itself exists; plausible nearby places are not enough.

Therefore B5/B6 verification has two complementary layers:

```text
DETERMINISTIC TESTS
unit + Postgres integration
→ prove our invariants for controlled inputs

REAL-WORLD SPIKES
real discovery + real sources + real models + real geo providers + real DB
→ prove the research system can discover those inputs from reality
```

Neither replaces the other.

---

## 2. Gate sequence

The canonical sequence is:

```text
B5 implementation
  ↓
B5 unit / module / integration tests
  ↓
Experience identity Postgres gate
(SAME / NEW / AMBIGUOUS / idempotency / order invariance)
  ↓
REAL-WORLD SPIKE BASELINE — PRE-B6
  ↓
characterize every real failure honestly
  ↓
B6 implementation
  ↓
RE-RUN THE SAME REAL-WORLD CORPUS
  ↓
REAL-WORLD ACCEPTANCE — POST-B6
```

### Pre-B6 meaning

The pre-B6 spikes are a **mandatory characterization gate**, not a requirement that every scenario already succeeds. B6 is specifically allowed to exist because current real extraction/discovery may be wrong or too broad.

Before starting B6 we must know, from actual executions:
- what sources discovery found;
- whether they actually described a walk/route versus merely nearby attractions;
- what candidate extraction produced;
- what components were grounded or failed grounding;
- where geographic validation accepted/rejected;
- what dedupe/classification persisted;
- whether any invented composition slipped through.

A failing spike is useful if it produces a complete trace and a concrete diagnosis. A spike that was never run is not evidence.

### Post-B6 meaning

After B6, the same corpus becomes an **acceptance gate**. We compare against the pre-B6 characterization and require the intended extraction-authority improvements without weakening identity/geographic invariants to make the scenarios pass.

---

## 3. Definition of a real-world spike

A spike starts from a human-level tourism request. It must not start from a hand-built `ExperienceCandidate`, hand-written `componentHints`, manually curated evidence, or preselected GeoEntity ids.

Required chain:

```text
human request
  ↓
real acquisition planning
  ↓
real discovery/search
  ↓
real source documents / snippets / structured facts
  ↓
real evidence bundle
  ↓
real LLM extraction
  ↓
ExperienceCandidate generated by the system
  ↓
real component hints produced by extraction
  ↓
real OSM / Nominatim / Places resolution
  ↓
real GeoEntities
  ↓
real geographic validation
  ↓
real dedupe / canonical identity decision
  ↓
real evidence-only classification
  ↓
real PostgreSQL/PostGIS persistence
  ↓
canonical Experience re-read
  ↓
second request / reuse observation where applicable
```

If a developer edits the candidate/components to make the run succeed, that is no longer a real-world spike; it becomes a useful fixture for a deterministic test but cannot count as this gate.

---

## 4. What may and may not be mocked

For the real-world spike corpus, the following must be **real**:

- grounded/web discovery provider configured by the application;
- actual search queries generated by the application;
- returned provider/source content;
- discovery/extraction LLM;
- `ExperienceCandidate` extraction;
- OSM/Overpass queries;
- Nominatim search/reverse where the production path uses it;
- Places provider where fallback/grounding uses it;
- component resolution;
- geographic validation;
- dedupe/canonicalization;
- evidence-only semantic classification;
- PostgreSQL/PostGIS persistence and canonical re-read.

The spike must not mock any of those merely to obtain the expected result.

Infrastructure may be local/self-hosted instead of public as long as it is the real provider implementation over real data. For example, local Overpass is encouraged for reproducibility; it is not a mock.

---

## 5. Argentina baseline topology (RW1–RW4) — record this in every run

The repository's `osm-local` Docker profile now self-hosts **both** Overpass
and Nominatim, imported from the same Argentina Geofabrik source
(`docs/development/local-overpass.md`, `docs/development/local-nominatim.md`):

```text
Argentina OSM extract (Geofabrik south-america/argentina-latest.osm.pbf)
      ├── local Overpass  (streets, boundaries, ways/relations)
      └── local Nominatim (name search, reverse geocoding)
```

Both are opt-in (`docker compose --profile osm-local up -d`) and are never
required for normal application development — only for reproducible
composite/OSM testing and this spike corpus.

**Snapshot consistency is real but not byte-identical.** Geofabrik's
`-latest` URL is a moving pointer, `overpass`'s own entrypoint discards the
raw PBF it downloaded after conversion, and `overpass` runs its own hourly
diff-apply once started — so the two containers' actual OSM snapshots can
differ by however much Argentina data changed between their respective
import times, and `overpass`'s snapshot keeps moving forward afterward while
`nominatim` (imported here with no `REPLICATION_URL`/`UPDATE_MODE`, and
`FREEZE=true`) stays frozen at its own import time. Record the **actual**
snapshot age from each provider's own response in every run, never assume
byte-identity:

- Nominatim: `GET /status?format=json` → `data_updated`.
- Overpass: any `/api/interpreter` response → `osm3s.timestamp_osm_base`.

The full Argentina baseline for RW1–RW4 is therefore:

```text
SerpAPI                (real web search evidence — §5a)
real discovery/classification LLM
local Overpass          (http://localhost:12345 / service name `overpass`)
local Nominatim         (http://localhost:8088  / service name `nominatim`)
real Places             (when fallback/grounding uses it — PLACES_PROVIDER)
dedicated real Postgres/PostGIS (`zigzag_spike_preb6` — §6a)
```

See `.env.spike.example` at the repo root for the exact override set (never
edit the shared `.env`/`docker-compose.yml` defaults for this — see §5a).

### 5a. Grounded web discovery — SerpAPI forced, Tavily excluded

Tavily's quota is scarce for this characterization corpus and must not be
spent. `GROUNDED_SEARCH_PROVIDER=serpapi` is set explicitly in
`.env.spike.example` for every RW1–RW6 run of this corpus (foreign-city RW5
included).

This is not a new fallback mechanism — it makes an already-existing
no-fallback property explicit. Both `be/src/shared/ai/ai.config.ts`'s
`groundedSearchProvider` resolution and the
`EXPERIENCE_GROUNDED_SEARCH_PROVIDER` DI factory in
`be/src/modules/tours/tours.module.ts` resolve strictly from
`GROUNDED_SEARCH_PROVIDER` (or `serpapi` when a `SERPAPI_API_KEY` is present
and the variable is unset, else `groq`) — there is no branch in either that
selects `tavily` except an explicit `GROUNDED_SEARCH_PROVIDER=tavily`, and an
unrecognized value throws rather than silently falling back to any provider.
This is covered by a permanent regression suite
(`be/src/shared/ai/ai.config.spec.ts`, `groundedSearchProvider — no silent
Tavily fallback`) and by a real, gated DI-resolution proof
(`be/test/live/pre-b6-spike-infrastructure-preflight.live-spec.ts`, real
`Test.createTestingModule({imports:[AppModule]})` boot, asserting the
resolved provider `instanceof SerpApiGroundedSearchService` and NOT
`instanceof TavilyGroundedSearchService`).

**One non-obvious second path to Tavily consumption**: selecting
`GROUNDED_SEARCH_PROVIDER=gemini` for this corpus would still spend Tavily
quota — `GeminiGroundedSearchService` internally calls
`TavilyExtractService` to fetch page content for URLs Gemini's own search
cites. Do not use `gemini` as the grounded-search provider for this
baseline; `serpapi` is the only correct choice.

If SerpAPI is unavailable, misconfigured, rate-limited, or exhausted during
an actual RW1–RW6 run, the correct classification is `FAIL` /
`INFRASTRUCTURE_GAP` (§11) — never a silent, automatic retry against
Tavily.

### Foreign-city implication (RW5)

The local Overpass/Nominatim profile above is Argentina-only. RW5 must
never accidentally query it and interpret an empty response as a product
failure — see §7's RW5 entry and the dedicated rule restated there.

---

## 6. The truth chain — what a successful composite must prove

A visually plausible final route is not sufficient.

For every composed walk/route, the trace must establish all four layers:

```text
1. EXPERIENCE EXISTENCE
   evidence proves a real walk/route/itinerary Experience exists

2. COMPOSITION
   evidence identifies the real places/components belonging to it

3. COMPONENT GROUNDING
   OSM/Nominatim/Places proves those named components exist and resolves them

4. GEOGRAPHIC VALIDITY
   deterministic validation proves the composition fits its real scope/route
```

This is a FAIL even if the resulting itinerary looks excellent:

```text
Places/OSM finds several nearby attractions
  +
LLM joins them into a plausible walk
  ↓
"San Telmo Historical Walk"
```

unless source evidence independently proves that composed Experience.

The research agent must be able to say **"I found places, but I did not find a real composed walk"** rather than inventing one.

---

## 6a. Dedicated clean-slate spike database

The baseline must not run against the normal development tourism catalog.
San Telmo and other corpus destinations have been used repeatedly during
development — existing Experiences, GeoEntities, evidence, classifications,
embeddings, or cached acquisition state could silently turn a nominal COLD
run into a partial/warm reuse and invalidate the characterization.

A dedicated real PostgreSQL/PostGIS database — `zigzag_spike_preb6`, a
sibling database on the same local Postgres/PostGIS server normal
development already uses (`docker-compose.yml`'s `postgres` service),
initialized through the normal `prisma migrate deploy` path, never
hand-seeded — is required before RW1. Postgres's own database-level
isolation (separate schemas/tables, zero shared rows with `zigzag`) is
sufficient; a fully separate server/container is unnecessary overkill here.
Prefer this completely fresh database over selectively deleting "San Telmo"
rows from the normal dev database — selective cleanup is unsafe because
related knowledge (a `GeoEntity` an unrelated Experience also references, a
stale classification) can survive and silently influence the run.

**Provider infrastructure is NOT catalog contamination.** The real local
Overpass/Nominatim indexes (§5) and their real OSM datasets stay populated —
they are external geographic knowledge providers under test, not Zig-Zag's
own living tourism knowledge base. Only the latter must start clean.

Before RW1, prove the tourism knowledge state is clean — at minimum zero
pre-existing rows in: `Experience`, `ExperienceComponent`, Experience
evidence/observation rows, persisted classification state tied to those
Experiences, `GeoEntity`/`GeoEntityIdentity` rows that could let component
grounding bypass the real Nominatim/OSM resolution being characterized, and
embeddings/other catalog-derived state tied to those rows. Record the actual
counts (or equivalent proof) in the RW1 manifest/dossier — never secrets.

**Cache state**: disable or isolate application/AI caches so RUN 1 is
genuinely cold. `AI_CACHE_MODE=off` (not `read`/`write` — see
`.env.spike.example`) guarantees `AiCacheService` never reads OR writes a
cached LLM response, which matters because the shared dev `.env` normally
runs `AI_CACHE_MODE=read`: a prior development run for the same
prompt+options hash would otherwise be silently served for free. If some
cache genuinely cannot be disabled for a future provider, isolate it or
document/prove it cannot serve previous tourism research results for this
corpus.

**Lifecycle**: this clean-slate requirement applies only to the corpus's
starting state, before its first run. Do not reset between a case's cold and
warm runs (§7a) or between different cases in the same campaign — see
§7a's "Cold → warm database lifecycle."

---

## 7. Required spike corpus

The initial corpus contains at least the following six scenarios. Additional cities/routes are encouraged, but these six test different architectural failure modes and must not be replaced by six variants of the same easy case.

### Spike RW1 — San Telmo AREA-scoped walk

**Status: EXECUTED 2026-09-13 (cold + warm). Dossier:
`spikes/rw1-san-telmo-historical-walk/`. Verdict below is authoritative;
the rest of this entry describes the original intended purpose/shape and
remains accurate as a spec for the eventual rerun (§11 of this document,
required after the live cutover — see
`docs/superpowers/plans/2026-09-13-preference-first-live-cutover.md`).**

```text
Primary:    ORCHESTRATION_GAP
Secondary:  EXPECTED_B6_GAP (composition/extraction authority)
            classification is not universally wired into live persistence
            destination-resolution neighborhood/suburb-scope precision gap
No B5_OR_IDENTITY_BUG.
```

RW1 exposed a missing **live cutover**, not a B5 or identity defect.
`PreferenceInterpreterService` correctly extracted a real, "must"-priority
`anchoredPlaces: [{kind:"area", rawName:"San Telmo"}]` on both the cold and
warm run (real Groq call, confirmed in the trace) — but the live
`ExperienceGenerationService` orchestration never consumes it: zero
invocations of `AreaRouteWalkAcquisitionService`/
`AreaRouteAnchorResolverService` across either run's full trace. This
matches this plan's own B5 completion record ("no live-orchestration wiring
into `ExperienceGenerationService.generateTourExperiences()`" was an
explicit, named non-goal of B5) — RW1 is the first live, empirical
confirmation of that already-known gap, not a new B5 defect. See
`spikes/rw1-san-telmo-historical-walk/assessment.md` for the complete
cold/warm trace analysis, including confirmation that RUN 2 (warm) fits the
disqualified "same ID after reacquisition ≠ catalog reuse" pattern this
plan's §7a explicitly names, not genuine catalog reuse.

Purpose (original, still valid for the post-cutover rerun):
- simplest real B5 AREA case;
- prove discovery finds evidence for an actual walk/route rather than a POI list;
- prove real component extraction;
- resolve San Telmo's real area geometry;
- resolve every required stop;
- apply external AREA scope before persistence;
- persist a composite Experience only if grounded;
- evidence-only classification should support `walk` when the evidence genuinely does;
- repeat the request and inspect reuse behavior.

A successful run should conceptually reach:

```text
published/grounded San Telmo walk evidence
  ↓
real named stops
  ↓
resolved GeoEntities
  ↓
all required components covered by San Telmo scope
  ↓
classified canonical Experience
  ↓
persisted
```

Second-run target once live reuse wiring exists — see §7a for the full,
hardened acceptance contract this must actually satisfy (same canonical ID
alone is explicitly NOT sufficient evidence of reuse):

```text
same request
→ canonical catalog hit
→ no unnecessary web acquisition for the walk
```

If the standalone B5 primitive is not yet wired into the normal generation path, record that as an orchestration gap rather than faking reuse.

### Spike RW2 — Buenos Aires multi-area walk

Human request:

```text
caminata de San Telmo a La Boca
```

Purpose:
- preserve both anchor names through discovery;
- find a real published walk/route spanning neighborhoods if one exists;
- prove multi-area semantics do not force all components inside the first AREA;
- ensure nearby POIs are not mechanically composed into a route;
- inspect whether source evidence supports sequence/order.

Expected truth conditions:
- both `San Telmo` and `La Boca` remain visible in the research query/trace;
- crossing area boundaries is not itself rejection;
- composition must still be evidence-backed and geographically coherent.

### Spike RW3 — Caminito canonical geographic ROUTE

Human request:

```text
recorrido caminando por Caminito
```

Purpose:
- exercise a canonical named OSM way/street where available;
- inspect the actual LineString returned by OSM;
- resolve real discovered components/stops;
- verify real point-to-LineString proximity rather than destination-centroid radius;
- prove regional route coherence still runs in addition to route membership.

The spike report must preserve the actual route geometry type/id used and measured/reported corridor decisions for required stops.

If current OSM representation does not resolve as the named way expected, record the real representation and failure honestly; do not hand-supply a substitute route geometry.

### Spike RW4 — Mendoza tourism route without canonical OSM ROUTE

Human request:

```text
Ruta del Vino de Mendoza
```

Purpose:
- prove `route_like` does not require one OSM way named after the tourism Experience;
- discover evidence that the tourism route itself exists;
- extract real wineries/stops from that evidence;
- ground each required component;
- use regional route-scale geographic coherence;
- classify from the route evidence;
- persist/reuse by canonical tourism Experience identity when the strict-name v1 rule permits it.

A generic article such as "10 wineries to visit in Mendoza" is not automatically proof of one composed `Ruta del Vino` Experience. The trace must distinguish those two cases.

### Spike RW5 — foreign-city walking Experience

Run at least one non-Argentina case, initially one of:

```text
Montmartre walking tour — Paris
```

or

```text
Trastevere walking tour — Rome
```

Purpose:
- expose language/translation differences;
- exercise different administrative/address hierarchies;
- expose Nominatim canonical-name differences;
- avoid Argentina-specific heuristics accidentally appearing correct;
- verify discovery/provider behavior with different tourism ecosystems.

Because local Overpass currently contains Argentina only, the run configuration must explicitly select a real OSM source appropriate for the foreign city and record it in the report.

### Spike RW6 — negative / anti-fabrication case

Choose a request/source situation where discovery can readily find individual places but the evidence does **not** establish a real composed walk/route. A typical source pattern is:

```text
"10 places to visit in ..."
```

without route/itinerary/walking-tour composition evidence.

Purpose:
- prove that real POIs + plausible geography are insufficient to mint a composite Experience;
- identify whether current pre-B6 extraction wrongly synthesizes composition;
- after B6, require rejection/non-materialization unless evidence actually establishes the Experience.

Desired outcome when no real route evidence exists:

```text
web content exists                 ✓
individual places exist            ✓
geography may be coherent          ✓
composed Experience evidence       ✗
-------------------------------------
NO fabricated composite Experience
```

This is a first-class successful negative result, not a failure to find content.

---

## 7a. Warm-reuse / idempotency acceptance contract

Reuse is already part of this gate (RW1's "repeat the request and inspect
reuse behavior", and every other case that reaches a persisted canonical
Experience). This section makes the acceptance criterion explicit enough
that dedupe returning the same canonical ID after redoing all the expensive
research is **not**, by itself, proof of reuse. This does not create a
separate gate/architecture — it is the same reuse behavior RW1+ must
already exhibit, stated precisely.

### The critical invariant

```text
same canonical Experience ID after reacquisition
!=
catalog reuse
```

This is a FAIL even though the final ID is identical:

```text
same request
  → SerpAPI called again
  → extraction LLM called again
  → geography re-resolved
  → persist attempted again
  → dedupe decides SAME
  → same Experience ID returned
```

`decideExperienceDedupe` correctly converging to `SAME` is a real, necessary
property (proven by the Postgres identity gate) — but it is answering "is
this the same real Experience," not "did the system need to research it
again." A second request that re-runs the full expensive research chain and
merely lands back on the same row is not reuse; it is unnecessary
rediscovery that happens not to have corrupted the catalog. The reuse
contract below is about avoiding the rediscovery itself, not about what
happens if it occurs anyway.

### First equivalent request — COLD

```text
catalog lookup → MISS
  ↓
real discovery/search → extraction → real geography → validation → dedupe → classification → persistence
  ↓
result = acquired, canonical Experience X
```

Record whether the run invoked: SerpAPI, discovery/extraction LLM,
Nominatim, Overpass, Places, classification LLM. Not every provider is
required on every run — the point is making the cold/warm delta observable
later, not mandating a fixed provider set.

### Second equivalent request — WARM

Same or semantically equivalent human-level request.

```text
same human request
  → resolve request scope
  → catalog lookup → canonical Experience X
  → return/reuse
```

Required assertions — all of them, not just ID equality:

```text
same canonical Experience ID                     ✓
no new canonical Experience row                  ✓
no duplicate component rows                       ✓
no unnecessary SerpAPI discovery                  ✓
no unnecessary extraction LLM call                ✓
no reacquisition merely followed by dedupe SAME   ✓
outcome/reason explicitly indicates reuse         ✓
no new evidence rows created by the warm run       ✓
```

If some inexpensive, request-level scope-resolution call is still
legitimately required before the catalog lookup (e.g. resolving the
anchor's own geometry so the lookup can be scoped at all — see B5's
`AreaRouteWalkAcquisitionService`/`AreaRouteAnchorResolverService`), record
it separately and do not fail the reuse test merely because that happened.
The focus is avoiding unnecessary **rediscovery/extraction of the
Experience itself** — SerpAPI search, the discovery/extraction LLM call,
and a second persistence attempt — not every provider call whatsoever.

### No evidence inflation from reacquisition

A warm run must not create new `ExperienceEvidence` rows merely because the
system unnecessarily repeated the same discovery cycle. If a future
living-knowledge-base revalidation/enrichment policy intentionally
re-researches a stale Experience on a schedule, that is a distinct feature
with its own freshness/maintenance semantics (see
`docs/superpowers/specs/2026-09-12-living-tourism-knowledge-base-design.md`
§4.3) — this baseline is testing immediate warm reuse on the very next
equivalent request, not scheduled revalidation, and must not be excused by
appealing to that future feature.

### Live orchestration caveat

If the current live application path cannot reach the B5 reuse primitive
before reacquisition, classify this honestly:

```text
research primitive correct
live orchestration incomplete
→ ORCHESTRATION_GAP
```

Do not patch around this to force RW1 green: do not manually call the
catalog first from a spike harness if the actual product path does not; do
not bypass the production request → acquisition orchestration. The real
spike characterizes the real application path, including when that path
does not yet route through the primitive that would make reuse possible.

### Required cold-vs-warm dossier evidence

For every applicable case, the dossier (§10) must answer, with real
trace/counter evidence, not narrative claims:

**COLD**: Was the catalog queried before acquisition? Was there a genuine
MISS? Which external research providers ran? Which candidate was extracted?
Which Experience was persisted? What canonical Experience ID resulted?

**WARM**: Was the same/equivalent request issued? Was the same canonical
Experience found? Was SerpAPI invoked? Was the extraction LLM invoked? Was
another persistence attempt made? Was dedupe invoked only because
reacquisition happened? Were any duplicate rows/evidence created? What
explicit outcome/reason proves reuse?

A `second-run.json` artifact (§10) must carry enough of this trace/counter
information to distinguish **true catalog reuse** from **reacquire + dedupe
SAME** — a bare "same ID" line is not sufficient evidence either way.

### Cold → warm database lifecycle

The clean-slate spike database (§6a) is required only before the FIRST run
of a case. Do not reset or reseed the spike database between a case's cold
and warm runs:

```text
fresh spike DB
    ↓
RUN 1 — COLD (this case)
    ↓
Experience X persisted
    ↓
same DB, unchanged
    ↓
RUN 2 — WARM (this case)
    ↓
Experience X reused
```

Resetting between RUN 1 and RUN 2 invalidates the reuse test entirely — RUN
2 must observe the persisted knowledge RUN 1 actually created, not a fresh
MISS. (A different CASE may still start from the same, now-non-empty spike
database — the clean-slate requirement in §6a is about the corpus's overall
starting state, not about wiping the database between every individual
case.)

---

## 8. Additional corpus expansion

After the minimum six, progressively add cases that exercise:
- historic walks with several competing real variants in the same area;
- architecture walks;
- food/market walks;
- Jewish heritage walks;
- hiking/trail Experiences represented as OSM route relations (expected to use the tourism-route path in B5 v1, because route-relation resolution is not implemented);
- routes whose components change across sources;
- multilingual aliases;
- sparse destinations;
- dense destinations with many similarly named POIs;
- sources that disagree on stop sequence;
- discontinued/temporarily unavailable Experiences as the living knowledge model evolves.

These should grow into a durable research characterization corpus, not one-off console experiments.

---

## 9. Required run manifest

Every spike run must record enough environment information to explain provider-dependent differences later.

At minimum:

```text
run timestamp
branch + commit SHA
case id / request text
destination

DATABASE_URL target class (spike DB identity/class -- e.g. zigzag_spike_preb6;
  redact credentials) + Postgres/PostGIS version if useful

GROUNDED_SEARCH_PROVIDER (must be serpapi for this baseline -- §5a)
SerpAPI mode actually used (google-search / google-ai-mode)
DISCOVERY_EXTRACTOR_PROVIDER + model id
classification provider + model id
PLACES_PROVIDER

OVERPASS_API_URL class/value with secrets removed
whether Overpass is local or external
OSM extract/region when local
Overpass response's own osm3s.timestamp_osm_base (actual snapshot age)

NOMINATIM_API_URL class/value
NOMINATIM_REVERSE_API_URL class/value
whether Nominatim is local or public/external
Nominatim's own /status?format=json data_updated (actual snapshot age)

AI_CACHE_MODE (must be off for a genuine cold baseline -- §6a)
mock flags: USE_MOCK_MAPS, MOCK_MAPS_MODE (must demonstrate mocks are disabled)
```

Never commit secrets, API keys, credentials or signed/private provider URLs.
The dedicated `pre-b6-spike-infrastructure-preflight.live-spec.ts` (§14) can
be run once before a campaign to produce most of this evidence in one pass;
it is an infrastructure check, not a substitute for recording per-run
provider identity in each case's own manifest.

---

## 10. Required artifact/trace bundle

A spike must leave a research dossier. A final `PASS` line is not enough.

Recommended logical layout (the exact command/harness does not exist yet and must not be falsely claimed as implemented):

```text
spikes/<run-or-case>/
  manifest.json
  request.json
  acquisition-plan.json
  discovery-queries.json
  discovery-results.json
  evidence.json
  extracted-candidates.json
  resolved-geoentities.json
  geographic-validation.json
  dedupe.json
  classification.json
  persisted-experiences.json
  second-run.json             # when reuse is applicable -- see §7a for the
                               # required cold-vs-warm evidence this file
                               # must carry (provider call counts/booleans
                               # sufficient to distinguish true catalog
                               # reuse from reacquire + dedupe SAME, never
                               # just the canonical ID)
  assessment.md
```

Where the existing Bitácora/trace already contains the same information, the spike harness may export/reference that trace instead of implementing a second observability stack.

Raw third-party content may be large, licensed or contain provider-specific fields. Commit only what is safe/necessary; full raw payloads may remain local while the committed characterization records stable excerpts/hashes/URLs/ids and the deterministic decisions derived from them.

### `assessment.md` must answer

1. What exact real Experience was the system trying to establish?
2. Which source/evidence proves the **Experience itself** exists rather than merely proving its component places exist?
3. Which source facts established each component?
4. Were any components invented, inferred from proximity, or added without cited composition evidence?
5. Did every required component resolve against a real provider?
6. Which GeoEntity/provider ids and geometries were used?
7. Which geographic-validation strategy/gates ran, and why did they accept/reject?
8. Was component order persisted? If yes, what evidence established sequence?
9. What was the dedupe decision and why?
10. What classification was persisted, and which evidence keys support every accepted semantic fact?
11. What canonical Experience was re-read from Postgres?
12. On a second equivalent request, was it reused or reacquired? Why? (Per
    §7a: reused means the second request never re-invoked SerpAPI/the
    extraction LLM/a persistence attempt for this Experience -- a
    reacquire-then-dedupe-SAME outcome is NOT reuse even when the ID
    matches, and must be reported as such.)
13. Is the result sensible to a human reviewer?
14. Did any provider/source return surprising or wrong-country/wrong-city data?
15. Is any observed problem B5 geography/identity, B6 extraction/composition, provider coverage, live orchestration, or a separate issue?

---

## 11. Pre-B6 characterization verdicts

Each pre-B6 run receives one of:

```text
SUCCESS_CURRENT
  current system produced a real, fully grounded Experience correctly

EXPECTED_B6_GAP
  failure traces to discovery/extraction/composition authority that B6 is designed to change

B5_OR_IDENTITY_BUG
  failure is geographic scope, resolution, dedupe, classification convergence or persistence
  → fix before proceeding as if B5 were complete

PROVIDER_COVERAGE_GAP
  required real data is unavailable/unresolvable from configured provider(s)

ORCHESTRATION_GAP
  primitive works but live generation never invokes it

INFRASTRUCTURE_GAP
  local/external provider configuration prevents a meaningful run

UNEXPLAINED
  insufficient trace to know what happened; spike is incomplete
```

Do not relabel a B5/identity bug as an extraction problem merely to move on to B6.

---

## 12. Post-B6 acceptance criteria

Re-run the same requests with comparable provider configuration.

For positive scenarios, acceptance requires:
- real evidence that the composed Experience exists;
- no invented composition;
- every required component grounded;
- all applicable external and candidate-owned geography checks pass;
- canonical identity/persistence is correct;
- evidence-only classification is current/reusable and semantically appropriate;
- Postgres contains the expected canonical Experience(s), not collapsed generic substitutes;
- repeat/reuse behavior is correct once live orchestration supports it — per
  §7a's contract, a matching canonical ID on the second run is not
  sufficient by itself; the run must also show no unnecessary
  SerpAPI/extraction-LLM/persistence-attempt calls.

For the negative scenario, acceptance requires:
- no composite Experience is minted merely from a list of individually real nearby POIs;
- the trace clearly records why composition evidence was insufficient.

### Never "fix" a spike by weakening truth

If a real positive Experience fails because a provider cannot resolve a legitimate component, improve provider/resolution coverage or document the limitation.

If a fake/plausible route passes because validation is too permissive, strengthen the correct boundary.

Do not:
- hand-edit component hints;
- seed the desired Experience before the run;
- loosen geographic thresholds specifically for one fixture;
- treat requested `walk`/`route_like` as evidence the candidate actually has that semantic intent;
- turn a POI list into route evidence;
- merge distinct walks because they share area/theme/intent.

---

## 13. Relationship to Postgres identity gate

The Postgres identity gate and this spike gate answer different questions:

```text
Postgres identity gate:
"Given realistic canonical inputs, does persistence/dedupe preserve tourism knowledge correctly?"

Real-world spike gate:
"Can the Research Agent discover and produce those canonical inputs from reality?"
```

Both are mandatory before treating the research architecture as proven.

In particular, real spikes should eventually produce naturally occurring examples for the SAME/NEW/AMBIGUOUS corpus. When they do, capture those observations as future deterministic regression fixtures while keeping the original raw spike characterization separately.

---

## 14. Desired harness — future implementation, not claimed to exist

A small explicit runner is desirable so these cases become repeatable without becoming normal CI tests. Example target interface only:

```bash
yarn spike:tourism-research --case san-telmo-history-walk
yarn spike:tourism-research --case san-telmo-la-boca-walk
yarn spike:tourism-research --case caminito-route
yarn spike:tourism-research --case mendoza-wine-route
yarn spike:tourism-research --case montmartre-walk
yarn spike:tourism-research --case negative-poi-list
```

Until such a harness is implemented, run the actual application/service path manually with mocks disabled and export the existing trace/DB state into the dossier. Do not create a fake spike runner that bypasses production acquisition merely to make the command exist.

These spikes should not run in ordinary CI because they depend on changing Internet content, external providers, LLM outputs, quotas/rate limits and OSM data. They are explicit characterization/acceptance runs.

A narrower **infrastructure preflight** (not a spike runner, not RW1-RW6
itself) does exist:
`be/test/live/pre-b6-spike-infrastructure-preflight.live-spec.ts`, gated
behind `RUN_SPIKE_PREFLIGHT=1` (never runs by accident). It boots the real
`AppModule` and proves, through the real production provider classes: the
grounded-search DI resolves to `SerpApiGroundedSearchService`; local
Nominatim search/reverse and Overpass boundary lookup are reachable and
geographically sensible for San Telmo/Mendoza; and the spike database is
connected, identified as the spike database (not `zigzag`), and starts with
zero rows in every relevant knowledge table. Re-run it once at the start of
a spike campaign (and whenever the local OSM containers are reimported) to
regenerate this evidence — it does not need to run before every individual
case.

---

## 15. Exit criteria to start B6

B6 may start only after:

1. B5 deterministic verification is green or all remaining B5 blockers are explicitly named.
2. The Postgres SAME/NEW/AMBIGUOUS gate is green.
3. All six minimum real-world spikes have actually been executed against real providers with mocks disabled.
4. Each run has a trace/dossier sufficient to determine what happened.
5. Failures are classified using §11 rather than guessed from the final output.
6. Any `B5_OR_IDENTITY_BUG` found by the spikes is fixed/reverified before B6.
7. `EXPECTED_B6_GAP` cases become concrete B6 acceptance examples.

The spikes do **not** need to all be positive before B6; otherwise B6 could never be used to fix the real extraction problems it exists to solve.

---

## 16. North-star rule

Every spike should answer this question:

> Did Zig-Zag behave like a Tourism AI Research Agent that proved a real tourism Experience from evidence, or like a route generator that assembled plausible places?

The former grows the living tourism knowledge base. The latter is a product failure even when the output looks attractive.


## 7b. RW1 forensic rerun — 2026-09-22

Remote state used by the captured campaign:

```text
run commit: 774cf60c7473befe1f5ae43b52f08fbe90d9d5dd
artifact commit: a07cbe683ef651619613bda9bd3ed587a951bb77
request: "caminata histórica por San Telmo"
3 independent COLD databases + 1 WARM reuse of cold-3
```

Observed product facts:

- COLD-1 extracted multi-component walks including 4- and 8-component
  candidates; final materialization still contained only singleton Experiences.
- COLD-2 extracted 7-component walks; unresolved components caused the
  composites to be rejected.
- COLD-3 had a degraded preference-interpretation call (Groq 429/fallback) and
  produced no extracted composite candidates; this run is evidence of
  degradation/nondeterminism, not proof that the normal pipeline cannot find
  walks.
- WARM extracted a 7-component self-guided walk and a real Freetour-backed
  6-component City Tour route. The City Tour resolved 4/6 components but the
  whole candidate was rejected.
- Composite Geographic Validation received no useful accepted proposal for
  these failed composites because Entity Resolution/all-or-nothing component
  policy rejected them first.

Important forensic examples:

1. **El Zanjón de Granados**
   - hint: `El Zanjón de Granados`;
   - local OSM: `osm:node:9953027884`,
     `El Zanjón de Granados (historic ruins)`;
   - Nominatim resolves the same OSM node;
   - the configured Places-path result recorded in the trace carries the same
     underlying OSM venue/node reference;
   - nearby Wikidata evidence reports `hintMatched=true`,
     `candidateMatched=false`;
   - current result: `UNCONFIRMED_MATCH`.

   The rerun therefore disproves the assumption that every non-exact candidate
   needs mandatory Wikidata confirmation. Provider-path convergence is useful
   evidence, while a missing corroboration is not automatically contradiction.

2. **Plaza de Mayo**
   - a source-backed walk can legitimately start near Plaza de Mayo and enter
     San Telmo by Calle Defensa;
   - strict every-point-inside-San-Telmo containment would reject that valid
     shape.

3. **Calle Defensa**
   - current ROUTE resolution can verify `Defensa`/the OSM way in healthy
     cases;
   - route-to-area relation must use LineString/intersection/corridor semantics,
     not representative-point containment.

4. **Source authority remains a separate problem**
   - some extracted composites blend independent source evidence;
   - Google AI Mode synthesis can become a candidate even when no independent
     product proves that exact Experience;
   - at least one extractor output introduced an entity not named by the cited
     evidence.

Current acceptance direction:

```text
real Experience/composition evidence
→ resolve every evidenced component
→ per-component identity + geographic relation
→ preserve unresolved/ambiguous deficits
→ resolution coverage
→ composite geographic validation
→ targeted research where needed
```

No partial-resolution percentage, minimum component count or generic NEAR
distance is accepted as canonical yet. The next rerun after the component
resolution cutover must collect those measurements first.
