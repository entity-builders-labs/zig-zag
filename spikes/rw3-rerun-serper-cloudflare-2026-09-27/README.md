# RW3 rerun — Caminito canonical geographic ROUTE (Serper + Cloudflare, post F1–F4)

Rerun of `spikes/rw3-caminito-canonical-route-2026-09-27` against the
F1–F4-fixed code (commit `b31f5f33`) with the canonical rerun provider pair.
Same request: `recorrido caminando por Caminito` (Buenos Aires, AR).

## Providers / config (pinned)

```text
GROUNDED_SEARCH_PROVIDER=serper          (canonical rerun pair)
DISCOVERY_EXTRACTOR_PROVIDER=cloudflare
CLOUDFLARE_DISCOVERY_MODEL=@cf/qwen/qwen3.8-27b
PLACES_PROVIDER=geoapify  AI_PROVIDER=groq
CLASSIFICATION_PROVIDER=gemini (repo .env drift vs original)
NOMINATIM_API_URL=http://localhost:8088/search
OVERPASS_API_URL=http://localhost:12345/api/interpreter
```

DB `zigzag_spike_rw3_rerun` (fresh), cold port 4043. No warm run: the cold
run fails closed before any Experience materialization, so there is nothing
to reuse.

## Results (summary)

See `assessment.md` for the full characterization. Headline:

- The original RW3 anchor defect is **FIXED and proven live**: Caminito
  resolves as `route` `osm:way:144844726` (route branch
  `ELIGIBLE/SELECTED`, `COMPATIBLE / WITHIN_DESTINATION_BOUNDARY`); the
  out-of-destination Ezeiza venue homonym (`osm:way:269972048`) is
  `REJECTED_DESTINATION_INCOMPATIBLE` and never selectable (F1); rejected
  candidate retained as evidence (persisted: 4 GeoEntities / 17 identities).
- F3/F4 live: persisted `candidateFacts` per anchor branch; routing output
  carries `anchorMode: canonical` (AREA_ROUTE_WALK=1; GENERIC=0);
  destination step carries `boundaryId osm:relation:1224652`.
- F2 observed (no failure this run): grounded search ran via Serper and
  succeeded; `providersAttempted` names `serper`; `providersFailed=[]`.
- Generation still **FAILS closed** (20.2s) at `coverage_analysis`
  (`intent:walk` without strong coverage): pass 1 produced one web candidate
  (`Avenida de Mayo to Congreso Walking Route`) that entity resolution
  accepted but geographic validation REJECTED (`external_scope_mismatch`);
  pass 2 produced none. Route-corridor membership was therefore still not
  exercised end-to-end (new finding N1: extraction targeting, not anchors).
- No substitute geometry was hand-supplied; failure recorded honestly.

## Layout

```text
run.sh run-campaign.mjs analyze.py count-requests.cjs db-snapshot.sh
repro-anchor-resolution.cjs request.json
cold/   run.log backend.log create-response.json run-manifest.json
        generation-trace.json analysis.json anchor-resolution-repro.json
        provider-requests.ndjson provider-config.txt
        db-before.json db-after.json migrate.log started-at.txt finished-at.txt
```

## Reproduce

```bash
./run.sh cold zigzag_spike_rw3_rerun fresh 4043
(cd ../../be && set -a && source ../.env && set +a \
  && export NOMINATIM_API_URL=http://localhost:8088/search \
            OVERPASS_API_URL=http://localhost:12345/api/interpreter \
  && node ../spikes/rw3-rerun-serper-cloudflare-2026-09-27/repro-anchor-resolution.cjs \
     > ../spikes/rw3-rerun-serper-cloudflare-2026-09-27/cold/anchor-resolution-repro.json)
python3 analyze.py
```
