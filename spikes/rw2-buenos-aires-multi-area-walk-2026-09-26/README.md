# RW2 — Buenos Aires multi-area walk (San Telmo + La Boca)

Real-world spike for the canonical gate
`docs/superpowers/plans/2026-09-12-real-world-tourism-research-spike-gate.md`
(§ Spike RW2). Executed against the live preference-first product path, not a
fake runner.

## Request semantics

`destination = Buenos Aires, Argentina` (hard scope, `scaleHint: settlement`).
`wizard intent = walk`. Free text
`"Me interesan San Telmo y La Boca, especialmente su historia, arquitectura y
lugares emblemáticos."`. San Telmo and La Boca come only from free text; no
anchors/PreferenceSpec were injected.

## Providers / config (pinned, unchanged)

- `GROUNDED_SEARCH_PROVIDER=serpapi` (Google AI-mode), never Tavily
- `DISCOVERY_EXTRACTOR_PROVIDER=cloudflare` `@cf/qwen/qwen3.8-27b`
  (temperature 0, 900 tokens, `enable_thinking=false`, 60s timeout)
- `PLACES_PROVIDER=geoapify`, `CLASSIFICATION_PROVIDER=groq` `qwen/qwen3.8-27b`
- local Overpass `:12345` (snapshot 2026-09-25), local Nominatim `:8088`
  (snapshot 2026-09-12)
- dedicated disposable DB `zigzag_spike_rw2` (COLD fresh, verified empty)
- `AI_CACHE_MODE=off`, `USE_MOCK_MAPS=false`, `MOCK_MAPS_MODE=strict`

## Results (summary)

- COLD: completed in 252s; 15 VERIFIED Experiences (14 singletons + the
  7-component `San Telmo to La Boca History Walk`).
- WARM: completed in 34s; canonical catalog reuse (no SerpAPI / no Cloudflare
  extraction / no new rows / same Experience ID).
- Verdict: MIXED — multi-area semantics PASS; two named findings (GENERIC
  drops structured anchors → names survive only via `semanticQuery`; planner
  materialized 5 singletons instead of the eligible composite).

See `assessment.md` for the full trace-backed analysis.

## Layout

```text
request.json            product-shaped request
run.sh                  run driver (cold/warm, dedicated DB, fresh backend)
run-campaign.mjs        auth -> generate-tour -> poll HTTP orchestrator
count-requests.cjs      outbound-provider request counter (spike-only)
db-snapshot.sh          knowledge-table snapshot (spike-only)
analyze.py              writes cold/analysis.json + warm/analysis.json
assessment.md           full assessment
cold/  warm/            run artifacts (trace, tour, DB before/after, requests)
```

Cloudflare credentials are never committed: they are sourced at run time from a
gitignored `.env.cloudflare` (deleted after the run; `.env*` is gitignored).

## Reproduce

```bash
./run.sh cold zigzag_spike_rw2 fresh 4031   # COLD
./run.sh warm zigzag_spike_rw2 reuse 4032   # WARM (same DB)
python3 analyze.py                          # derived summaries
```
