# RW2 rerun — Buenos Aires multi-area walk (Serper + Cloudflare, post F1–F4)

Rerun of `spikes/rw2-buenos-aires-multi-area-walk-2026-09-26` against the
F1–F4-fixed code (commit `b31f5f33`) with the canonical rerun provider pair.
Same request: `caminata de San Telmo a La Boca` (Buenos Aires, AR).

## Providers / config (pinned)

```text
GROUNDED_SEARCH_PROVIDER=serper          (canonical rerun pair)
DISCOVERY_EXTRACTOR_PROVIDER=cloudflare
CLOUDFLARE_DISCOVERY_MODEL=@cf/qwen/qwen3.8-27b
PLACES_PROVIDER=geoapify  AI_PROVIDER=groq
CLASSIFICATION_PROVIDER=gemini (gemini-3.5-flash-lite)  ← repo .env drift vs original (groq)
NOMINATIM_API_URL=http://localhost:8088/search
OVERPASS_API_URL=http://localhost:12345/api/interpreter
```

DB `zigzag_spike_rw2_rerun` (fresh), cold port 4041, warm port 4042.

## Results (summary)

See `assessment.md` for the full characterization. Headline:

- cold `completed` (74.5s): both anchors resolved as areas with bounded
  `candidateFacts` (F3 live: area `SELECTED/COMPATIBLE`, route/place
  `NO_CANDIDATE`); 14 VERIFIED Experiences (16 GeoEntities / 28 identities);
  **no composites** — Serper returned 9 applied evidence items (incl.
  relevant San Telmo/La Boca walking pages) and Cloudflare extracted **0**
  web candidates, before classification (the original SerpAPI evidence +
  Cloudflare extraction cold produced the 7-component `San Telmo to La Boca
  History Walk`; the Serper-vs-Cloudflare cause is not isolated); facet coverage FAIL
  (history/architecture/walk), portfolio sufficiency never reached; tour of
  5 Experiences with completeness WARN `Formato pedido sin cubrir: "walk"`.
- warm `completed` (46.4s): full catalog/identity reuse — **0 new rows**
  (16/28/14/14 unchanged) — but coverage still FAIL, so a bounded
  reacquisition ran again (serper 1 + cloudflare 1 + wikivoyage 1);
  different 5-Experience selection, same WARN.
- providersAttempted names `serper` (not generic `web`); providersFailed=[].
- Mobility-control deviation: this rerun executed with `5000 / 3000` m, not
  the intended non-binding `50000 / 20000` control; it does not affect the
  extraction result (no multi-component candidate was emitted). Future
  controlled RW2 reruns must use `50000 / 20000`.

Artifact quirk: `run-manifest.json` runLabel strings say `rw3-cold`/`rw3-warm`
because the copied `run.sh` hardcoded an `rw3-` label prefix. These are RW2
runs (see `request.json`). `run.sh` is fixed for future reruns; recorded
artifacts were left unmodified.

## Layout

```text
run.sh run-campaign.mjs analyze.py count-requests.cjs db-snapshot.sh request.json
cold/ warm/   run.log backend.log create-response.json terminal-tour.json
              run-manifest.json generation-trace.json analysis.json
              provider-requests.ndjson provider-config.txt
              db-before.json db-after.json started-at.txt finished-at.txt
```

## Reproduce

```bash
./run.sh cold zigzag_spike_rw2_rerun fresh 4041
./run.sh warm zigzag_spike_rw2_rerun reuse 4042
python3 analyze.py
```
