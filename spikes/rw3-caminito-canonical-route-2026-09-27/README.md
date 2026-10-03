# RW3 — Caminito canonical geographic ROUTE

Real-world spike for the canonical gate
`docs/superpowers/plans/2026-09-12-real-world-tourism-research-spike-gate.md`
(§ Spike RW3). Executed against the live preference-first product path
(auth → `POST /tours/generate-tour` → outbox → processor → generation), not a
fake runner.

## Request semantics

`destination = Buenos Aires, Argentina` (hard scope, `scaleHint: settlement`),
wizard `intents = ["walk"]`, `interests = []`, free text
`"Me interesa recorrer Caminito caminando y conocer los lugares más
representativos del recorrido."`. Caminito comes only from free text: no
`PreferenceSpec`, anchors, OSM ids, geometry or component hints were injected.

Mobility (experimental control only): `maxWalkingDistancePerDayMeters=50000`,
`maxContinuousWalkingDistanceMeters=20000` — the existing DTO upper bounds,
deliberately non-binding to isolate route/geography semantics. Not a product
default, recommendation or walking-policy change.

## Providers / config

- `GROUNDED_SEARCH_PROVIDER=serpapi` (never Tavily)
- `DISCOVERY_EXTRACTOR_PROVIDER=cloudflare` `@cf/qwen/qwen3.8-27b`
  (temperature 0, 900 tokens, `enable_thinking=false`, 60s timeout — code
  constants in `cloudflare-discovery.provider.ts`, unchanged)
- `PLACES_PROVIDER=geoapify`; classification = repo `.env` current
  `CLASSIFICATION_PROVIDER=gemini` (`gemini-3.5-flash-lite`); preference
  interpretation = Groq `qwen/qwen3.8-27b` (`AI_PROVIDER=groq`)
- local Overpass `:12345`, local Nominatim `:8088`
- dedicated disposable DB `zigzag_spike_rw3` (COLD: dropped/created/migrated,
  `db-before.json` proves zero knowledge rows)
- `AI_CACHE_MODE=off`, `USE_MOCK_MAPS=false`, `MOCK_MAPS_MODE=strict`

## Result (summary)

- COLD: `failed` after 6s at `coverage_analysis` (`intent:walk` uncovered).
- Caminito → `named_path` / `must`, but anchor resolution left it
  **unresolved** (`NO_CONFIDENT_GEO_ENTITY_MATCH`) although the production
  route branch finds the real `osm:way:144844726` (MultiLineString, 9 coords,
  ~143 m): an out-of-destination Nominatim "Caminito" street in Ezeiza
  (~32 km away) was accepted as a competing `venue`, and cross-kind
  disagreement discards both. Deterministic; reproduced read-only.
- SerpAPI account exhausted (429, 0/250 searches left) → zero evidence, no
  extraction. The Bitácora recorded it as `status: success`,
  `providersFailed: []`.
- WARM: not run (no Experience persisted).
- Verdict: **FAIL** (blocker: anchor resolution discards the real route;
  discovery/composition half INCONCLUSIVE due to provider quota).

See `assessment.md`.

## Layout

```text
request.json                  product-shaped request
run.sh                        run driver (cold/warm, dedicated DB, fresh backend)
run-campaign.mjs              auth -> generate-tour -> poll HTTP orchestrator
count-requests.cjs            outbound-provider request counter (spike-only)
db-snapshot.sh                knowledge-table snapshot (spike-only)
repro-anchor-resolution.cjs   read-only repro of the anchor-resolution branches
analyze.py                    writes cold/analysis.json (trace first, gaps labelled)
assessment.md                 full assessment + verdict
cold/                         run artifacts + repro output + route geometry
```

No credentials are written here: `run.sh` sources the gitignored repo-root
`.env` at run time and writes its pinned overrides to a temp file it deletes.

## Reproduce

```bash
./run.sh cold zigzag_spike_rw3 fresh 4033
(cd ../../be && node ../spikes/rw3-caminito-canonical-route-2026-09-27/repro-anchor-resolution.cjs \
  > ../spikes/rw3-caminito-canonical-route-2026-09-27/cold/anchor-resolution-repro.json)
python3 analyze.py
```
