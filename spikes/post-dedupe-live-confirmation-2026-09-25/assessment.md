# Post-dedupe live re-confirmation — assessment (2026-09-25)

Status: **INCONCLUSIVE DUE TO EXTRACTION VARIANCE** (deterministic fix remains green).

## Purpose

Bounded live confirmation of the post-milestone Experience-dedupe fix
`d6f060344073eba101f16ee8ebc1a798a9aed378`
(`fix(tours): separate membership from experience identity`), which
neutralizes shared component / role-aware membership as a standalone trigger
for `AMBIGUOUS` in the 1-vs-many (standalone-vs-composite) shape.

The only live question this campaign answers is:

> When discovery emits a legitimate standalone Experience and a legitimate
> multi-component Experience that share a canonical GeoEntity, can both now
> persist without `AMBIGUOUS_DEDUPE` caused solely by shared membership?

## Method

- Harness: `spikes/stage5-rw1-final-verification-2026-09-25/run.sh` (real HTTP
  path: auth → generate-tour → outbox → processor → generation).
- Request: `spikes/stage5-rw1-final-verification-2026-09-25/request.json`
  (RW1 San Telmo historical walk), copied here as `request.json`.
- Providers pinned by the harness: `GROUNDED_SEARCH_PROVIDER=serper`,
  `PLACES_PROVIDER=geoapify`, `AI_CACHE_MODE=off`, `USE_MOCK_MAPS=false`,
  extractor/classification `AI_PROVIDER=groq` (`qwen/qwen3.8-27b`), local
  Nominatim/Overpass, local Ollama embeddings.
- Starting HEAD: `320bab6caf32424f2df261983cc9a38a20d8b149`
  (`docs(tours): close dedupe policy finding`), verified equal to the fork
  remote. The backend was **rebuilt** before the campaign so `be/dist`
  actually contained `d6f0603` (the pre-existing `be/dist` predated the fix).
- Three fresh dedicated databases, never reused:
  `zigzag_stage5_dedupe_postfix`, `..._postfix2`, `..._postfix3`.
  Ports 4123 / 4124 / 4125. No prior Stage 5 evidence DB was touched.

## Runs

| Run | DB | Status | Latency | Persisted | Components | GeoEntities | Web candidates |
| --- | --- | --- | --- | --- | --- | --- | --- |
| run1 | `zigzag_stage5_dedupe_postfix` | completed | 91 s | 11 | 11 | 11 | 0 (Groq 429 OTPM) |
| run2 | `zigzag_stage5_dedupe_postfix2` | completed | 131 s | 11 | 11 | 11 | 0 (Groq 429 OTPM) |
| run3 | `zigzag_stage5_dedupe_postfix3` | completed | 325 s | 11 | 11 | 12 | 0 (grounding success, 0 extracted) |

Every persisted Experience is single-component (`experienceComponent ==
experience == 11`). No composite (multi-component) Experience was extracted
or persisted in any run; the standalone-vs-composite shared-membership path
was therefore **never reached live**.

## Why no qualifying composite was emitted

The composite candidates in this pipeline come from the web extraction pass.
In this campaign that pass produced zero candidates in all three runs, for
two distinct reasons:

- **run1, run2** — the web extraction call failed at the provider with
  **Groq 429 (OTPM rate limit)**:
  `"Limit 1000, Requested 2048 … rate_limit_exceeded"`. Environmental
  (free-tier output-token cap), not a dedupe or identity failure. run2 hit the
  same error on both of its web passes.
- **run3** — web grounding **succeeded** (Serper returned 10 evidences,
  `groundedProvider=serper`, `gl=ar`), but the extractor emitted
  **0 candidates** from those 10 evidences. This is the known low extraction
  yield on walk evidence (Stage 5 observed 2 composite-producing passes out of
  9 observed), not a regression.

All three runs otherwise acquired 21 structured single-PLACE candidates
(Geoapify structured observations), which are inherently single-component and
cannot exercise the standalone-vs-composite dedupe rule.

## What was NOT confirmed

- A standalone Experience and a composite Experience sharing a canonical
  GeoEntity persisting side-by-side (the fix's target) was **not observed**.
- `standalone_composite_shared_membership` trace evidence was **not emitted**
  (no 1-vs-many comparison occurred).
- No `dedupeDecision`/`dedupeEvidence.reasons` for a standalone-vs-composite
  pair was produced.

## What remains green

The deterministic validation of `d6f0603` (already executed and recorded in
the canonical plan) is unaffected by this inconclusive live run:

- `experience-dedupe.util.spec.ts`: 10/10
- `experience-identity-dedupe.integration-spec.ts` on `zigzag_test`: 19/19
- full unit suite: 2045/2046 (sole failure the known
  `preference-first-architecture` baseline)

## Provider request counts (per run, by `key`)

| provider | run1 | run2 | run3 |
| --- | --- | --- | --- |
| groq | 52 | 53 | 23 |
| geoapify/v1/routing | 30 | 30 | 30 |
| localhost:11434 (Ollama embeddings) | 13 | 13 | 13 |
| wikidata | 11 | 11 | 12 |
| geoapify.place-details | 9 | 9 | 9 |
| commons.wikimedia.org | 6 | 6 | 6 |
| wikipedia | 3 | 3 | 3 |
| overpass.local | 2 | 2 | 4 |
| nominatim.local/search | 2 | 2 | 4 |
| serper | 1 | 2 | 2 |
| es.wikivoyage.org | 1 | 2 | 2 |
| geoapify.places | 1 | 1 | 1 |

SerpApi and Google Places: **0** in all runs (correct — serper/geoapify are the
pinned providers).

## Performance classification

- **STRUCTURAL**: per-component identity/acquisition fanout; `geoapify/v1/routing`
  recomputed (30 calls) even though the catalog was fresh each run.
- **ENVIRONMENTAL**: Groq 429 OTPM (2 of 3 runs) on free-tier output limits;
  local Nominatim/Overpass/Ollama; `AI_CACHE_MODE=off`.
- **UNKNOWN UNTIL PRODUCTION-SHAPED BENCHMARK**: absolute cold latency here
  (91–325 s) does not predict production.

## Final classification

```text
INCONCLUSIVE DUE TO EXTRACTION VARIANCE
DETERMINISTIC FIX REMAINS GREEN
```

The Stage 5 historical observations (COLD 1 and COLD 4 failing under the old
policy) remain valid and are not rewritten by this campaign. No production
code was changed.
