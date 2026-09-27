# RW3 rerun — assessment (Serper + Cloudflare, post F1–F4)

Sources: trace-first. All run facts from `cold/generation-trace.json`,
`cold/analysis.json`, `cold/anchor-resolution-repro.json` (compiled
production resolver, read-only), `cold/provider-requests.ndjson`,
`cold/db-{before,after}.json`, `cold/run-manifest.json`. Original baseline
and defect record: `spikes/rw3-caminito-canonical-route-2026-09-27`
(verdict FAIL, defects T1–T4 → fixed as F1–F4 in commit `b31f5f33`).

## Verdict: **F1–F4 FIXED (live-proven)** · run still **FAILS closed** downstream (extraction targeting, new finding N1)

| RW3 truth condition | Original | Rerun |
| --- | --- | --- |
| real Caminito representation obtained | FAIL — found then discarded | **PASS** — resolved `route` `osm:way:144844726` |
| out-of-destination homonym never selectable | FAIL — counted toward ambiguity | **PASS** — `REJECTED_DESTINATION_INCOMPATIBLE` (F1) |
| real route geometry used in membership | not reached | **not reached** — no corridor candidate survived validation (N1) |
| source-backed Experience composition | INCONCLUSIVE (SerpAPI 429) | **FAIL (honest)** — 1 candidate, rejected `external_scope_mismatch` |
| provider failure provenance | FAIL (hidden as success) | **PASS by construction** — no failure this run; serper named in trace (F2) |
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

## 4. Why the run still fails (N1)

Pass 1's single web candidate — `Avenida de Mayo to Congreso Walking
Route` (EXPERIENCE proposal, 2 anchors) — passed entity resolution
(3 provider-backed entities) but was REJECTED by geographic validation
with `external_scope_mismatch` (0 geo-verified). Pass 2 produced nothing.
With `intent:walk` uncovered after the bounded budget, generation failed
closed (canonical: explicit failure, no silent generic fallback).

Interpretation: grounded extraction aimed at a generic Buenos Aires walk
instead of stops inside the resolved Caminito corridor. The anchor and
routing half now works (route resolved, `AREA_ROUTE_WALK=1`,
`anchorMode=canonical`); the corridor-targeted evidence/composition half
remains unproven end-to-end. This is a discovery-targeting gap, not an
anchor or provenance defect, and it is recorded honestly rather than
patched with hand-supplied geometry.

## 5. Persistence

`db-after`: geoEntity 4, geoEntityIdentity 17, experience 0,
experienceComponent 0 — anchor route entity + rejected-homonym evidence
persisted as identities; no Experience persisted (correct: nothing
geo-verified).

## 6. Findings

- N1: area/route walk acquisition does not yet steer grounded search /
  extraction toward the resolved route corridor (query targeting), so
  canonical-route requests can fail coverage even when the anchor is
  resolved. Candidate follow-up investigation (not RW4).
- N2: fail-closed semantics behaved exactly as designed: explicit message,
  bounded budget (1 serper + 1 cloudflare), no legacy fallback.
