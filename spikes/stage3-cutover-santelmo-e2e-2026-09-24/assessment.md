# Stage 3 cutover: small San Telmo E2E (COLD). Gate result: STOP

**Result: the section 17 gate is not met. The composite was not persisted.
Per the task rule ("If the composite is not persisted: STOP. Classify the
new failure locus. Do not run the mega-spike blind"), the Buenos Aires
COLD/WARM mega-spike was NOT run.** The campaign requests and driver are
prepared under `../stage3-buenosaires-walks-mega-control-2026-09-24/`, but
nothing there has been executed.

## Run

- Code: `544f9d7` (the cutover commits `b5f9177`, `ac39023`, `a7e5505`,
  `3e63838`, `544f9d7` on top of starting HEAD `56c5cb1`), built as `dist/`
  and served as a dedicated process on :4011.
- Real path: `POST /auth/email/request-code` → `/auth/email/verify` →
  `POST /tours/generate-tour` → outbox → `TourGenerationProcessorService` →
  generation → persistence. No resolver was called by hand.
- Providers: SerpAPI grounded search, Geoapify Places (confirmed in the
  backend startup log), local Nominatim (:8088), local Overpass (:12345),
  `AI_CACHE_MODE=off`, `USE_MOCK_MAPS=false`.
- DB: dedicated `zigzag_spike_stage3_cutover_santelmo_e2e`, freshly
  migrated. Counts before: all 0 (`counts-before-cold.json`). After:
  11 experiences, 11 components, 15 GeoEntities, 16 identities
  (`counts-after-cold.json`).
- Request: the RW1 San Telmo request (`request.json`, copied verbatim).
  The destination resolved to the **San Telmo** admin boundary
  (`osm:relation:2223069`).
- Outcome: `completed` in 349.7 s; the tour has 5 experiences.
  `cold/generation-trace.json`, `cold/run-manifest.json` and
  `cold-metrics.json` (from `analyze-run.py`) hold the evidence.

## Expected versus observed

| Expected (section 17) | Observed |
|---|---|
| "San Telmo Self-Guided Historical Walk" with Basílica de San Francisco + Defensa Street | **Did not recur.** The web discovery pass extracted ONE multi-component candidate, "San Telmo Historical Walking Tour", with 7 hints, **all PLACE**. No hint in the whole run had `expectedKind=ROUTE`. "Defensa" appears only inside addresses and evidence snippets. |
| Basílica → RESOLVED | **RESOLVED** (LOCAL_OSM_POOL → NOMINATIM) |
| Defensa → RESOLVED | **Not exercised**: no Defensa ROUTE hint was extracted. 0 `TARGETED_ROUTE` attempts in the run. |
| Geographic validation PASS → composite persisted with ≥2 components | **No composite persisted.** The walking tour resolved 5/7 components (Basílica, Convento Santo Domingo, Casa Mínima, San Telmo Market, Lezama Park) and was rejected with `UNRESOLVED_REQUIRED_COMPONENT` before geographic validation. |
| Defensa persisted as 1 ROUTE GeoEntity + N OSM identities | **0 ROUTE GeoEntities** in the DB (nothing to persist). 0 duplicate identity rows. |

## Failure locus: two things, neither in ROUTE/AREA resolution

1. **Discovery / extraction variance.** The known control candidate
   (Basílica + Defensa Street) was not extracted this run, and the
   extractor produced no ROUTE hint at all. The cutover's ROUTE path was
   therefore never reached live. This E2E proves neither the ROUTE path
   working nor failing. It simply did not run.
2. **The Stage 2 migration seam `isMigrationRequiredHint`.** Every hint is
   still treated as `required: true`, so one unresolved component rejects
   the whole composite (`UNRESOLVED_REQUIRED_COMPONENT`). The two
   unresolved components are PLACE hints:
   - `Mafalda Statue`: `NO_OSM_MATCH` (a known PLACE coverage gap, Group B
     of the earlier spikes);
   - `Farmacia la Estrella`: `UNCONFIRMED_MATCH`.

   Turning a source-backed 5/7 composite into a persisted partial
   composite is exactly the Stage 4 partial-composite lifecycle, which is
   explicitly out of scope and BLOCKED for this task.

## Other observations (not gate evidence)

- **El Zanjón de Granados.** RESOLVED twice: once as a standalone
  structured candidate via LOCAL_OSM_POOL, once via NOMINATIM with
  IDENTITY_CONVERGENCE. **Solar French** and **Plaza Dorrego** were also
  RESOLVED (PLACE, LOCAL_OSM_POOL). These are COLD runs with an empty
  catalog, so they do not test catalog reuse.
- **No WARM run was made.** Catalog-reuse behavior on this path is
  therefore not evidenced live.
- **Provider calls, derived from the trace:** 28 catalog lookups,
  5 Nominatim, 2 Places, 13 attempts carrying Wikidata evidence,
  0 targeted Overpass, 0 admin-compatibility network calls (the policy is
  polygon-only).

## What would unblock the gate, for review (not done)

- Make the ROUTE path observable live without depending on extractor
  variance. For example, re-run the E2E (possibly several COLD seeds)
  until a source-backed ROUTE hint appears, or use a request whose
  evidence names a street walk explicitly. This is a methodology decision
  for review, not a code change.
- The `UNRESOLVED_REQUIRED_COMPONENT` all-or-nothing rejection can only
  be relaxed by Stage 4 (partial-composite lifecycle and
  `isMigrationRequiredHint` retirement), which is BLOCKED. Until then, a
  real multi-component composite persists only when **every** extracted
  component resolves.
