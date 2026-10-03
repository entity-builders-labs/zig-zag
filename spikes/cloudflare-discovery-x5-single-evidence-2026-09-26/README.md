# Cloudflare discovery extractor — frozen single-evidence ×5 replay

Live characterization of the **corrected** `CloudflareDiscoveryProvider`
(`@cf/qwen/qwen3.8-27b`) on the frozen single-evidence fixture, to compare
against the Groq Control B baseline
(`spikes/extractor-reliability-run3-replay-2026-09-25/controlled-temp0-limit900/single-evidence`).

## Scope

- Replay only. No Serper/DB/planner/tour pipeline.
- Same frozen request + evidence as the Groq baseline:
  `single-evidence-request.json` + `single-evidence-grounded-evidence.json`.
- Runs the real corrected production provider (no mock).

## Config

- provider `cloudflare`, model `@cf/qwen/qwen3.8-27b`
- `temperature=0`, `max_completion_tokens=900`
- `chat_template_kwargs: { enable_thinking: false }` (required: this
  Cloudflare-hosted Qwen is a reasoning variant — without this it emits
  `reasoning` and leaves `content` null at `finish_reason=length`)
- no `response_format`
- transport timeout 60000ms

## Results

| run | outcome | HTTP | finish_reason | tokens | latency |
|-----|---------|------|---------------|--------|---------|
| 01  | CANDIDATE | 200 | stop | 455 | 39.9s |
| 02  | CANDIDATE | 200 | stop | 455 | 30.1s |
| 03  | CANDIDATE | 200 | stop | 455 | 22.4s |
| 04  | CANDIDATE | 200 | stop | 455 | 34.7s |
| 05  | PROVIDER_FAILURE | — | — | — | 60.0s (timeout) |

Distribution: 4/5 CANDIDATE, 1/5 PROVIDER_FAILURE. No 429, no INVALID_JSON, no
NO_CANDIDATE.

The 4 CANDIDATE runs are **byte-identical** raw responses (sha256
`dff1ecaac2fe9d0791b48fc9ab15df545fb5841030d1308ff5de682b434f9399`). The raw
content is wrapped in a ```json fence (the provider strips it before parsing).

Candidate (identical across all 4):

- name: `San Telmo Walking Tour`
- components (order preserved): `Lezama Park` → `Plaza Dorrego` →
  `El Mercado de San Telmo` (all `role=venue`, `expectedKind=PLACE`,
  `evidenceKeys=[ev-4]`)
- supportSpans: `walk along the Lezama Park` / `Plaza Dorrego` /
  `El Mercado de San Telmo`
- themes: `[history, architecture]` · intents: `[walk]`
- sourceSupportAudits: 3/3 SUPPORTED

## Comparison vs Groq Control B (temp0 / 900t)

| | Groq | Cloudflare |
|--|------|-----------|
| outcomes | 2 CANDIDATE + 1 TPD 429 | 4 CANDIDATE + 1 timeout |
| composite | Lezama Park / Plaza Dorrego / El Mercado de San Telmo | identical |
| themes | `[history]` | `[history, architecture]` |
| determinism | byte-identical (N=2) | byte-identical (N=4) |
| latency | ~1.5s | 22–40s (success), 60s timeout (1/5) |

Same candidate name, description, traits, intents, component set/order,
evidenceKeys, supportSpans, and 3/3 source-support audits. Difference:
Cloudflare adds `architecture` to themes; Cloudflare is ~15–25× slower and hit
the 60s timeout once.

## Conclusion (scoped, non-extrapolated)

- 4/5, not 5/5: the strict "5/5 sin errores" bar for provider-stability
  evidence is **not met** — run-05 timed out (60s), a latency/operational
  failure, not a semantic one.
- On success, output is byte-identical and matches the Groq composite, so
  semantic determinism at temperature=0 is consistent across providers.
- Open question: whether the 60s timeout (vs Groq ~1.5s) is a real operational
  risk for this provider. Not extrapolated beyond this fixture.

Harness: `harness/cloudflare-x5.ts`. Run from `be/`:

```bash
RUNS=5 npx ts-node --transpile-only -P tsconfig.json -r tsconfig-paths/register \
  ../spikes/cloudflare-discovery-x5-single-evidence-2026-09-26/harness/cloudflare-x5.ts
```
