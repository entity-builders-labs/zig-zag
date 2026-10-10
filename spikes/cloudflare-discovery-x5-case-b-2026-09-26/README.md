# Cloudflare discovery extractor — frozen case-b ×5 replay

Live characterization of the corrected `CloudflareDiscoveryProvider`
(`@cf/qwen/qwen3.8-27b`) on the frozen case-b fixture: the original 10-item
grounded evidence bundle (including the strong `ev-4` composite item), to answer
two questions about temperature=0 stability and latency under a larger input.

## Scope

- Replay only. No Serper/DB/planner/tour pipeline. No evidence regeneration,
  reordering, or reduction to the strongest item.
- Frozen inputs: `case-b-request.json` + `case-b-grounded-evidence.json` from
  `spikes/extractor-reliability-run3-replay-2026-09-25/`.
- Runs the real corrected production provider (no mock).

## Config (unchanged for this experiment)

- provider `cloudflare`, model `@cf/qwen/qwen3.8-27b`
- `temperature=0`, `max_completion_tokens=900`
- `chat_template_kwargs: { enable_thinking: false }`
- no `response_format`
- transport timeout `60000ms`

## Results

| run | outcome | HTTP | finish_reason | tokens | latency | raw sha256 (first 16) |
|-----|---------|------|---------------|--------|---------|-----------------------|
| 01  | CANDIDATE | 200 | stop | 383 | 9.4s | `d4a12df796e025a98c` |
| 02  | CANDIDATE | 200 | stop | 491 | 10.3s | `b48bbf785db14bbe8c` |
| 03  | CANDIDATE | 200 | stop | 383 | 8.4s | `d4a12df796e025a98c` |
| 04  | CANDIDATE | 200 | stop | 383 | 8.2s | `d4a12df796e025a98c` |
| 05  | CANDIDATE | 200 | stop | 383 | 7.9s | `d4a12df796e025a98c` |

Distribution: **5/5 CANDIDATE**, 0 timeout, 0 HTTP 429, 0 NO_CANDIDATE,
0 INVALID_JSON.

Byte identity: runs 01/03/04/05 are byte-identical (`d4a12df…`); run-02 differs
(`b48bbf7…`).

## Component-set stability (the key signal)

| runs | components |
|------|-----------|
| 01, 03, 04, 05 (4/5) | `Plaza Dorrego` → `El Mercado de San Telmo` (2 components, **Lezama Park dropped**) |
| 02 (1/5) | `Lezama Park` → `Plaza Dorrego` → `El Mercado de San Telmo` (full 3-component set) |

- Candidate name stable across all 5: `San Telmo Walking Tour`.
- themes stable: `[history, architecture, culture]` in all 5 runs.
- intents: `[walk]` (4/5), `[walk, visit]` (run-02).
- traits: vary slightly (run-02 uses `historic mansions` vs `historic neighborhood`).
- supportSpans identical for shared components (`Plaza Dorrego`,
  `El Mercado de San Telmo`); `walk along the Lezama Park` present only in run-02.
- No generic/non-entity components; all `role=venue` / `expectedKind=PLACE`;
  source-support 100% SUPPORTED, zero violations.

## Questions answered

1. **Does temperature=0 keep extraction semantically stable with the 10-item bundle?**
   No — the component set is not stable: `Lezama Park` is dropped in 4/5 runs.
   The 4 partial runs are byte-identical among themselves, so temperature=0
   gives determinism *within* the dominant output mode, but not a stable
   component set across the sample.
2. **Does latency/timeout worsen with the larger input?**
   No — 7.9–10.3s, 0 timeouts (vs single-evidence 22–40s and 1 timeout). The
   larger bundle did not materially worsen latency.

## Comparison vs Cloudflare single-evidence ×5

| | single-evidence (1 item) | case-b (10 items) |
|--|--------------------------|-------------------|
| outcome | 4 CANDIDATE + 1 timeout | 5 CANDIDATE |
| component set | full 3-component (4/4 success) | full 1/5, partial 4/5 (Lezama Park dropped) |
| byte identity | 4 byte-identical | 4 byte-identical + 1 different |
| latency | 22–40s | 7.9–10.3s |

Evidence dilution observed: embedding `ev-4` in the 10-item bundle reduces the
composite to 2 components in the majority of runs, whereas the single-evidence
input produced the full 3-component set consistently.

## Descriptive comparison vs historical Groq case-b (temp=.7, 4096t)

Groq baseline: 8 CANDIDATE, 2 NO_CANDIDATE; 6/8 had all 3 components, 2/8
dropped `Lezama Park`. Cloudflare (temp=0, 900t): 5/5 CANDIDATE; 1/5 full set,
4/5 dropped `Lezama Park`. **These use different temperature/token configs, so
no better/worse conclusion is drawn**; the common observation is that case-b's
10-item bundle makes `Lezama Park` the first component to drop, on both
providers.

## Classification (bounded, N=5)

- SEMANTIC OUTPUT STABILITY: candidate name + themes stable; component set
  **not** stable (`Lezama Park` drops 4/5). Evidence dilution present.
- OPERATIONAL RELIABILITY: 5/5 completed, 0 timeouts, 0 429.
- LATENCY: 7.9–10.3s (median 8.4s), no material worsening.
- SOURCE-SUPPORT QUALITY: 100% SUPPORTED, no violations.

Harness: `harness/cloudflare-x5-caseb.ts`. Run from `be/`:

```bash
RUNS=5 npx ts-node --transpile-only -P tsconfig.json -r tsconfig-paths/register \
  ../spikes/cloudflare-discovery-x5-case-b-2026-09-26/harness/cloudflare-x5-caseb.ts
```
