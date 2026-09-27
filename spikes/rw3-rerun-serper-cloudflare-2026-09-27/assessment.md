# RW3 rerun — assessment (Serper + Cloudflare, post F1–F4)

Sources: trace-first. All run facts from `cold/generation-trace.json`,
`cold/analysis.json`, `cold/anchor-resolution-repro.json` (compiled
production resolver, read-only), `cold/provider-requests.ndjson`,
`cold/db-{before,after}.json`, `cold/run-manifest.json`. Original baseline
and defect record: `spikes/rw3-caminito-canonical-route-2026-09-27`
(verdict FAIL, defects T1–T4 → fixed as F1–F4 in commit `b31f5f33`).

> **Post-hoc correction (2026-09-27, review of `d1115a3b`).** Corrected
> against this run's own artifacts: (1) **F2 was not live-proven** — Serper
> succeeded and `providersFailed=[]`, so the provider-failure path was only
> proven by deterministic unit/integration tests; live, only the successful
> provider identity (`serper`) was proven. F1, F3 and F4 are live-proven.
> (2) **N1 was diagnosed too loosely**: the query already contained Caminito
> and Serper returned several Caminito/La Boca results; the stronger root
> cause is that the typed `anchorNames` reached grounded search but were
> dropped from the `ExperienceDiscoveryRequest` handed to the extractor.
> Fixed in `d6149363` and re-tested in
> `spikes/rw3-anchor-handoff-rerun-2026-09-27/`. (3) The rejected Ezeiza
> homonym was **not persisted**; it exists only as Bitácora `candidateFacts`
> audit evidence. Run artifacts are unchanged.

## Verdict: **F1/F3/F4 live-proven; F2 test-proven (failure path not live-triggered)** · run still **FAILS closed** downstream (N1: anchor context lost at the search→extractor handoff)

| RW3 truth condition | Original | Rerun |
| --- | --- | --- |
| real Caminito representation obtained | FAIL — found then discarded | **PASS** — resolved `route` `osm:way:144844726` |
| out-of-destination homonym never selectable | FAIL — counted toward ambiguity | **PASS** — `REJECTED_DESTINATION_INCOMPATIBLE` (F1) |
| real route geometry used in membership | not reached | **not reached** — no corridor candidate survived validation (N1) |
| source-backed Experience composition | INCONCLUSIVE (SerpAPI 429) | **FAIL (honest)** — 1 candidate, rejected `external_scope_mismatch` |
| provider failure provenance | FAIL (hidden as success) | **test-proven only** — failure path covered by unit/integration tests; live run had no provider failure; successful provider identity `serper` live-proven (F2) |
| bounded diagnostics (facts/modes/boundary) | FAIL (T1/T3/T4) | **PASS** — candidateFacts, anchorMode, boundaryId live (F3/F4) |

## 0. Run

cold only: `failed` (fail-closed), 20.2s, DB `zigzag_spike_rw3_rerun`,
port 4043. Failure message: `Coverage insuficiente después de catálogo y
adquisición multi-fuente acotada: Preference facet [intent:walk] has no
strong catalog match yet.` No warm run: nothing materialized to reuse.
No substitute route geometry was hand-supplied at any point.

## 1. Anchor resolution — PASS (F1 fix, live)

Persisted `anchor_geo_resolution` step (authoritative):

```text
ANCHOR Caminito → resolved, kind=route, canonicalName=Caminito,
                  externalId=osm:way:144844726
  area : NO_CANDIDATE (NO_CONFIDENT_AREA_MATCH)
  route: ELIGIBLE / SELECTED — COMPATIBLE / WITHIN_DESTINATION_BOUNDARY (match)
  place: REJECTED_DESTINATION_INCOMPATIBLE — INCOMPATIBLE /
         OUTSIDE_DESTINATION_BOUNDARY (rejected DESTINATION_INCOMPATIBLE)
```

The Ezeiza homonym (`Caminito, La Unión, Partido de Ezeiza` —
`osm:way:269972048`, 1 of 5 Nominatim results) is retained only as rejected
evidence and excluded from ambiguity: pre-fix, the cross-kind
route-vs-venue disagreement discarded both candidates
(`NO_CONFIDENT_GEO_ENTITY_MATCH`). Read-only repro confirms branch facts
(route match MultiLineString, 1 line / 9 coordinates;
`targetedRouteResolver: RESOLVED / SINGLE_COMPATIBLE_CLUSTER`). The repro's
`selectCandidate` string reflects the pre-fix cross-kind helper and is
labelled as such in `analysis.json`; the live trace is authoritative.

## 2. Routing + diagnostics — PASS (F3/F4, live)

- Routing: `AREA_ROUTE_WALK=1; GENERIC=0` with `anchorMode: canonical`
  (resolved route anchor) — T3 closed.
- Destination step: `boundaryId osm:relation:1224652`,
  `boundaryName Buenos Aires` — T4 closed.
- `candidateFacts` bounded and audit-only on the persisted anchor step —
  T1 closed. No downstream planning behavior reads them.

## 3. Acquisition + provenance — PASS (F2 surface; no failure occurred)

- 2 bounded passes; `providersAttempted=["serper","wikivoyage"]`;
  `providersFailed=[]`; observations: 0 structured + 1 web candidate
  (pass 1), 0 + 0 (pass 2).
- Requests: serper 1, cloudflare.workers-ai 1, es.wikivoyage 2, nominatim 3,
  overpass 5, wikidata 1, wikipedia(es) 1, groq 1.
- Serper succeeded (unlike the original SerpAPI 429), so the F2 failure
  path was not triggered live; it is covered by unit + integration tests
  (failed results carry provider identity and `failureReason`).

## 4. Why the run still fails (N1 — corrected diagnosis)

Pass 1's single web candidate — `Avenida de Mayo to Congreso Walking
Route` (EXPERIENCE proposal, 2 anchors) — passed entity resolution
(3 provider-backed entities) but was REJECTED by geographic validation
with `external_scope_mismatch` (0 geo-verified). Pass 2 produced nothing.
With `intent:walk` uncovered after the bounded budget, generation failed
closed (canonical: explicit failure, no silent generic fallback).

Interpretation (corrected): the grounded query was **not** missing
Caminito — it was `Buenos Aires Caminito walking tours walks walking route
to see representative landmarks`, and Serper returned several relevant
Caminito/La Boca results (ev-2 *La Boca Tour*, ev-4 *BUENOS AIRES Walking
Tour | Caminito, La Boca*, ev-6 *From La Boca to …* audio guide, ev-9 *What
to do in Caminito*). Yet Cloudflare extracted only the generic `Avenida de
Mayo → Casa Rosada → Congreso` route from `ev-7`. The typed
`SourcePlan.web.anchorNames = ["Caminito"]` reached the grounded-search call
but was **not** carried into the `ExperienceDiscoveryRequest` given to the
extractor (which carried scope/themes/intents/semanticQuery/gaps only), so
the extractor had no structured statement that this acquisition was about
Caminito. That lost handoff — not query targeting — is the precise N1
hypothesis; it is fixed in `d6149363` and re-tested in
`spikes/rw3-anchor-handoff-rerun-2026-09-27/`. No hand-supplied geometry.

## 5. Persistence

`db-after`: geoEntity 4, geoEntityIdentity 17, experience 0,
experienceComponent 0 — the GeoEntities are `Caminito` (ROUTE, the resolved
anchor), `Avenida de Mayo` (ROUTE, 14 OSM segment identities), `Casa Rosada`
and `Antigua Sede del Congreso Nacional` (component resolutions). The
rejected Ezeiza homonym (`osm:way:269972048`) was **not** persisted: it is
retained only as Bitácora `candidateFacts` audit evidence. No Experience was
persisted (correct: nothing geo-verified).

## 6. Findings

- N1 (corrected): the resolved anchor reached grounded search but its typed
  `anchorNames` were lost at the search → extractor boundary, and the
  extractor chose an unrelated but evidence-supported Buenos Aires route.
  Fixed in `d6149363`; re-tested in `rw3-anchor-handoff-rerun-2026-09-27`.
- N2: fail-closed semantics behaved exactly as designed: explicit message,
  bounded budget (1 serper + 1 cloudflare), no legacy fallback.
