# RW3 anchor-handoff rerun — Caminito canonical geographic ROUTE

Third RW3 run, against commit `d6149363` (same-branch destination screening,
audit-free source-plan fingerprints, typed `anchorNames` handed to the
discovery extractor). Same product request as the earlier RW3 runs: Buenos
Aires, wizard `intent: walk`, free text *"Me interesa recorrer Caminito
caminando y conocer los lugares más representativos del recorrido."* Nothing
injected (no PreferenceSpec, anchors, OSM ids, geometry or component hints).

Mobility `50000 / 20000` m is an **experimental control only** (non-binding,
to isolate route/geography semantics) — not a product default.

## Providers (canonical characterization pair, preflight-verified)

`GROUNDED_SEARCH_PROVIDER=serper`, `DISCOVERY_EXTRACTOR_PROVIDER=cloudflare`
(`@cf/qwen/qwen3.8-27b`, temperature 0, 900 tokens, `enable_thinking=false`,
60 s), `PLACES_PROVIDER=geoapify`, classification = repo `.env`
(`gemini`), local Overpass `:12345` / Nominatim `:8088`, fresh DB
`zigzag_spike_rw3_anchor_handoff`. `provider-preflight.cjs` resolves the
compiled runtime selection with the run's env and aborts before any live call
unless it is serper + cloudflare `@cf/qwen/qwen3.8-27b`.

## Result

COLD `failed` (fail-closed) in 40.5 s. Anchor resolution and the anchor
handoff pass; the extractor emits a Caminito-related, source-supported
walking Experience; entity resolution rejects it
(`INCOMPLETE_SOURCE_COMPOSITION`) because the source misspells one stop
(`La Bambonera`). WARM not run. **Gate: RW3 BLOCKED → RW4 NOT AUTHORIZED.**
See `assessment.md`.

## Layout

```text
request.json              product-shaped request (unchanged from earlier RW3 runs)
run.sh                    driver: preflight -> fresh DB -> backend -> HTTP run
provider-preflight.cjs    compiled-runtime provider selection gate (no network)
run-campaign.mjs          auth -> generate-tour -> poll orchestrator
count-requests.cjs        outbound request counter (host/path only, no secrets)
db-snapshot.sh            knowledge-table snapshot
analyze.py                trace-first cold/analysis.json
cold/                     run artifacts
```

## Reproduce

```bash
(cd ../../be && yarn build)
./run.sh cold zigzag_spike_rw3_anchor_handoff fresh 4051
python3 analyze.py
```
