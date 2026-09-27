# RW2 rerun — assessment (Serper + Cloudflare, post F1–F4)

Sources: trace-first. All run facts from `cold/generation-trace.json`,
`warm/generation-trace.json`, `*/analysis.json`, `*/provider-requests.ndjson`,
`*/db-{before,after}.json`, `*/run-manifest.json`. Original baseline:
`spikes/rw2-buenos-aires-multi-area-walk-2026-09-26`.

## Verdict: **CHARACTERIZED** (runs completed; behavior differs from original under the swapped provider pair)

| RW2 truth condition | Result |
| --- | --- |
| both anchors visible through discovery | **PASS** — `San Telmo` and `La Boca` both resolved (`kind=area`) and present in routing/trace |
| crossing area boundaries not itself rejection | **PASS (vacuous this run)** — no cross-area composite was proposed; nothing was rejected for crossing |
| multi-area composition evidence-backed | **NOT RE-PROVEN** — rerun materialized 14 singleton Experiences and **0 composites**; the original (serpapi+groq) produced the 7-component `San Telmo to La Boca History Walk` |
| nearby POIs not mechanically composed | **PASS** — no mechanical composition occurred |
| evidence supports sequence/order | INCONCLUSIVE — no composite/route evidence extracted this run |

## 0. Runs

- cold: `completed`, 74.5s, tour `b204bece…`, port 4041, fresh DB
  `zigzag_spike_rw2_rerun`.
- warm: `completed`, 46.4s, tour `a1040faf…`, port 4042, reuse mode.
- Config pinned: serper + cloudflare (`@cf/qwen/qwen3.8-27b`); geoapify
  places; groq AI; **gemini classification** (repo `.env` drift vs original
  groq — recorded, not part of the canonical pair); local Nominatim/Overpass.
- Manifest labels read `rw3-cold`/`rw3-warm` (copied `run.sh` prefix bug,
  since fixed); runs are RW2 per `request.json`.

## 1. Anchors + F1/F3 evidence (from trace)

`anchor_geo_resolution` (both runs): `San Telmo` → resolved `area`
(COMPATIBLE), `La Boca` → resolved `area` (COMPATIBLE). Persisted bounded
`candidateFacts` per anchor (F3 live):

```text
San Telmo: area ELIGIBLE/SELECTED (COMPATIBLE) · route NO_CANDIDATE · place NO_CANDIDATE
La Boca:   area ELIGIBLE/SELECTED (COMPATIBLE) · route NO_CANDIDATE · place NO_CANDIDATE
```

No INCOMPATIBLE candidates appeared (F1 path exercised live by RW3 instead).

## 2. Acquisition + F2 evidence (from trace)

- cold: 2 passes; `providersAttempted=["serper","wikivoyage"]`;
  `providersFailed=[]`; observations 20 structured, 1 web candidate.
- warm: 2 passes again; same providers; coverage still FAIL triggered bounded
  reacquisition despite full catalog reuse.
- Provider naming: execution summary and trace name `serper` — the generic
  `web` label no longer hides the grounded provider (post-F2 surface).
- Requests (cold): serper 1, cloudflare.workers-ai 1, es.wikivoyage 1,
  geoapify places 1 / place-details 16 / geocode 2 / routing 30,
  nominatim 7, overpass 6, wikidata 25, wikipedia 8, commons.wikimedia 7,
  gemini 14, groq 1, ollama(embeddings) 16.
- Requests (warm): serper 1, cloudflare 1, wikivoyage 1, nominatim 7,
  overpass 6, wikidata 9, wikipedia 5, commons 1, geoapify routing 30 /
  place-details 2, gemini 2, groq 3, ollama 17.

## 3. Coverage / sufficiency delta vs original

- Original cold (serpapi+groq): facet FAIL on pass 1, then portfolio
  sufficiency **PASS** (`15 elegibles vs 4 requeridas`), 1 pass total,
  15 VERIFIED including one 7-component composite.
- Rerun cold (serper+gemini): facet FAIL (`theme:history`,
  `theme:architecture`, `intent:walk`) on both passes;
  `AREA_ROUTE_WALK=0; GENERIC=3`; portfolio sufficiency never reached;
  14 VERIFIED, all singletons (`composites: []`); bounded budget exhausted →
  explicit degraded completion (no silent fallback).
- Read: the provider-pair swap changed grounded evidence and classification
  enough that multi-area composite synthesis and portfolio sufficiency did
  not recur. This is a real sensitivity finding, not an F1–F4 regression:
  F1–F4 touch anchor compatibility, failure provenance, and diagnostics —
  none gate composite synthesis for area anchors.

## 4. Reuse semantics (warm)

- DB before/after identical: geoEntity 16, identity 28, experience 14,
  component 14 → **0 new rows**; all identities reused from cold.
- Warm still reran anchor resolution (nominatim/overpass) and one bounded
  acquisition pass (serper+cloudflare+wikivoyage) because coverage remained
  FAIL — warm reuse is identity/catalog-level, not a sufficiency short
  circuit. Original warm (which had portfolio PASS) made 0 grounded calls;
  the delta follows the coverage delta in §3.
- Warm planned a different 5-Experience selection than cold (ranking
  variance under unchanged catalog); both `completed`.

## 5. Final tour state

Both runs: `daily_planning` PASS (GreedyDailyPlanningSolver, 1 day, 5
Experiences); `tour_completeness` **WARN** `Formato pedido sin cubrir:
"walk"` — honest degraded completion, walk format never covered by strong
evidence in either run.

## 6. Findings

- N3: multi-area composite synthesis is sensitive to grounded provider /
  classification pair (serpapi+groq → composite; serper+gemini → none).
  If cross-area composites are a product requirement, coverage/extraction
  targeting for area-pair walk requests needs its own investigation
  (candidate follow-up; out of scope for the F1–F4 gate).
- N4: warm reruns reacquire while coverage FAILs even when the catalog is
  fully reused; acceptable under bounded budget, worth revisiting if
  warm-run cost matters.
