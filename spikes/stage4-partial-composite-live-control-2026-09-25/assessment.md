# Stage 4 bounded live control (2026-09-25)

Code: `8bc5ce0` (Stage 4 commits `f4d4f81`, `0307a94`, `8bc5ce0` on top of
`5a9ec43`), built as `be/dist`, served by a dedicated process.

Path: real HTTP (`/auth/email/*` → `POST /tours/generate-tour` → outbox →
processor → generation). Request: the RW1 San Telmo walk request
(`request.json`, copied verbatim from the Stage 3 San Telmo E2E).
Providers: Serper grounded search (`GROUNDED_SEARCH_PROVIDER=serper`;
SerpApi calls in both backend logs: 0), Geoapify Places, local Nominatim
(:8088), local Overpass (:12345), Groq, `AI_CACHE_MODE=off`,
`USE_MOCK_MAPS=false`. Harness reused: Stage 3 `run-campaign.mjs`,
`catalog-counts.sh`, `analyze-run.py`; new here only the thin drivers
(`run-pair.sh`, `run-cold2.sh`) and `component-matrix.py`, which reads the
new typed trace fields (`coverage`, `identityStatus`, `geography`,
`deficit`) into `*/component-matrix.json`.

## Runs

| Run | DB | Status | Composites extracted (>1 hint) | Result |
| --- | --- | --- | --- | --- |
| COLD 1 | `zigzag_spike_stage4_partial_composite` (fresh) | completed, 5 experiences, 362 s | 1: "San Telmo Historic Walking Tour" (Plaza Dorrego, Mercado de San Telmo, Lezama Park) | 3/3 RESOLVED, all INSIDE the San Telmo destination area, `sourceCompositionComplete: true` → persisted with exactly 3 components |
| WARM | same DB | completed, 5 experiences, 34 s | 0 (catalog sufficient, no entity resolution ran) | counts unchanged (12 experiences / 14 components / 13 GeoEntities) |
| COLD 2 | `..._cold2` (fresh) | completed, 5 experiences | 1: "San Telmo Sunday Market and Historic Streets Walk" (Plaza Dorrego, "Calle Defensa") | 2/2 RESOLVED, INSIDE the San Telmo VALIDATION_AREA, persisted |

## What the control shows

- Complete composites still persist, with exactly their source
  membership (COLD 1: 3 components, `order` NULL because the source
  declared no sequence; nothing added, nothing dropped).
- Unresolved components stay explicit, never OUTSIDE/optional. COLD 1
  rejected 9 single-component candidates, all `UNRESOLVED` /
  `NO_CANDIDATE_ACQUIRED` / `PENDING_CLASSIFICATION` (finalReason
  `NO_OSM_MATCH`), including **Pasaje San Lorenzo**. None was turned into
  a research deficit (no KNOWLEDGE_DEFICIT without genuine ambiguity).
- No standalone promotion: the persisted Experience count matches the
  accepted candidates; resolved components of the composite did not
  create their own Experiences.

## What it does NOT show

**A source-backed composite with resolved + unresolved components was not
extracted in either COLD run** (extractor variance: the Stage 3 E2E on
the same request extracted a 7-hint walk that resolved 5/7). The run was
deliberately stopped after two COLDs rather than steering the request or
spending more provider quota. The partial-composite invariant is therefore
evidenced deterministically (unit) and on real Postgres
(`partial-composite-isolation.integration-spec.ts`, mutation-checked), not
by a live partial shape. Stage 5's RW1 cold/warm rerun is the natural
place to observe it live.

Side observation (not Stage 4 scope): in COLD 2 the extractor emitted
"Calle Defensa" as a `waypoint` / `expectedKind: PLACE` hint, and it
resolved to a PLACE point — so the live run exercised no ROUTE geometry.
Calle Defensa's ROUTE relation is covered by the deterministic
MultiLineString fixtures instead.
