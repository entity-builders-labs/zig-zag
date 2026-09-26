# Groq discovery extractor — frozen run3 replay characterization

Isolated, live characterization of the Groq/Qwen discovery extractor using the
exact `ExperienceDiscoveryRequest` + normalized grounded evidence captured from
`spikes/post-dedupe-live-confirmation-2026-09-25/run3/generation-trace.json`.

**Question:** given the exact same request and exact same grounded evidence, how
consistently does the Groq extractor produce a valid multi-component
`ExperienceCandidate`?

**Scope:** characterization/replay only. No extractor prompt change, no dedupe/
geography/resolver/planner/Serper/acquisition-policy change. The harness reuses
the real production `GroqDiscoveryProvider`, `LangChainService`, prompt builder,
and parser — nothing is copied.

## 1. Method

Production path exercised (confirmed by reading source, not inferred from tests):

```
ExperienceDiscoveryRequest + ExperienceGroundedSearchResult.evidence[]
        ↓  buildDiscoverySystemPrompt() + buildDiscoveryUserPrompt()
        ↓  GroqDiscoveryProvider.extractExperiences()
        ↓  LangChainService.generateChatResponse()  (providerOverride: 'groq')
        ↓  qwen/qwen3.8-27b  (json_object mode, max_completion_tokens: 4096)
        ↓  JSON.parse(raw)
        ↓  extractExperienceCandidates() + deterministic source-support gate
```

Config resolved from the repo-root `.env` (unchanged):

```
DISCOVERY_EXTRACTOR_PROVIDER=groq
GROQ_DISCOVERY_MODEL=qwen/qwen3.8-27b
OPENAI_TEMPERATURE=0.7
```

Harness: `harness/replay.ts`. Run (from `be/`):

```bash
RUNS=10 TS_NODE_TRANSPILE_ONLY=1 TS_NODE_PROJECT=tsconfig.json \
  npx ts-node -r tsconfig-paths/register \
  ../spikes/extractor-reliability-run3-replay-2026-09-25/harness/replay.ts
```

Controlled lower-limit experiment (separate):

```bash
SKIP_PRIMARY=1 CONTROLLED_MAX_COMPLETION_TOKENS=900 \
  TS_NODE_TRANSPILE_ONLY=1 TS_NODE_PROJECT=tsconfig.json \
  npx ts-node -r tsconfig-paths/register \
  ../spikes/extractor-reliability-run3-replay-2026-09-25/harness/replay.ts
```

## 2. Frozen inputs

| Case | Source plan query | request | evidence |
|------|-------------------|---------|----------|
| case-a (walk pass) | `San Telmo San Telmo walking tours walks historical walk in San Telmo` | `case-a-request.json` | `case-a-grounded-evidence.json` (10 items) |
| case-b (history pass) | `San Telmo historic sites history historical walk in San Telmo` | `case-b-request.json` | `case-b-grounded-evidence.json` (10 items) |
| single-evidence | history pass, evidence `ev-4` only | `single-evidence-request.json` (= case-b request) | `single-evidence-grounded-evidence.json` (1 item) |

Frozen request fields (reconstructed from production code + run3 trace):

- case-a: `scope.destinationName="San Telmo"`, `requestedThemes=[]`,
  `requestedIntents=["walk"]`, `semanticQuery="historical walk in San Telmo"`,
  `coverageGaps=["walk"]`, `breadth="focused"`, `maxCandidates=8`,
  `evidenceRequirements=["MULTI_COMPONENT_EXPERIENCE"]`.
- case-b: `scope.destinationName="San Telmo"`, `requestedThemes=["history"]`,
  `semanticQuery="historical walk in San Telmo"`, `coverageGaps=["history"]`,
  `breadth="focused"`, `maxCandidates=8`,
  `evidenceRequirements=["SINGLE_PLACE","MULTI_COMPONENT_EXPERIENCE"]`.
- single-evidence: identical to case-b request (prompt unchanged; only the
  evidence block differs — one item vs ten).

Evidence is the exact normalized `ExperienceGroundingEvidence[]` the extractor
received (key/title/source/snippet/url/kind/order verbatim from the trace; the
trace's `evidenceKey` is mapped to `key`, all other fields unchanged).

The strongest item (case-b `ev-4`, used for single-evidence):

> Title: `San Telmo Walking Tour (with Reviews)`
> Snippet: `You'll admire San Telmo ́s colonial architecture, walk along the Lezama Park, the antique galleries, Plaza Dorrego, El Mercado de San Telmo and other iconic ...`

## 3. Result distributions (10 runs per case, `max_completion_tokens: 4096`)

| outcome | case-a (walk) | case-b (history) | single-evidence |
|---------|---------------|------------------|-----------------|
| CANDIDATE | 3 | 8 | 5 |
| NO_CANDIDATE (semantic empty `{"candidates":[]}`) | 6 | 2 | 4 |
| INVALID_JSON (`json_validate_failed` 400) | 0 | 0 | 1 |
| PROVIDER_FAILURE (429 OTPM) | 1 | 0 | 0 |

Per-case aggregate JSON: `case-*/aggregate.json`. Full I/O per run:
`case-*/run-NN/{raw-response.txt,parsed-result.json}`.

The same frozen input produced **different** outcomes across identical runs —
stochastic, not deterministic.

## 4. Component-set stability (CANDIDATE runs only)

- **single-evidence**: every CANDIDATE run produced the **same** 3-component
  composition, same order, same names:
  `Lezama Park`, `Plaza Dorrego`, `El Mercado de San Telmo`.
- **case-b** (same evidence inside a 10-result bundle): 8 CANDIDATE runs, but
  composition varied:
  - 6/8 produced 3 components (the same three), in varying array order;
  - 2/8 produced only 2 components (**dropped `Lezama Park`**);
  - candidate name varied: `San Telmo Walking Tour` (7×) vs
    `San Telmo Historical Walk` (1×); `Mercado de San Telmo` vs
    `El Mercado de San Telmo` (the `El` prefix is inconsistent).
- **case-a** (walk pass): only 3 CANDIDATE runs, and those are **low-quality** —
  generic categories, not concrete entities:
  - `San Telmo & Market Tour` → `["San Telmo","San Telmo Market"]`
  - `San Telmo Free Walking Tour` → `["Main churches of San Telmo","Traditional houses of San Telmo"]`
  - `Historical Walk in San Telmo` → `["Streets of San Telmo","Main Churches of San Telmo","Traditional Houses of San Telmo"]`
  (`"Main churches…"/"Traditional houses…"` are categories from ev-6, not real
  resolvable entities; they pass the deterministic source-support gate because
  the span is verbatim in ev-6 — a separate quality concern, not fixed here.)

## 5. supportSpan stability

- **single-evidence**: perfectly stable across all 5 CANDIDATE runs —
  `Lezama Park → "walk along the Lezama Park"`, `Plaza Dorrego → "Plaza Dorrego"`,
  `El Mercado de San Telmo → "El Mercado de San Telmo"`.
- **case-b**: unstable — some runs copy the entire long sentence
  `"walk along the Lezama Park, the antique galleries, Plaza Dorrego, El Mercado
  de San Telmo"` as supportSpan for multiple components; others use minimal
  exact-name spans.

SupportSpan is read from the raw model envelope (`parsed-result.json` →
`rawComponentFacts`) because the deterministic parser strips it from the final
candidate (by design).

## 6. Provider failures

Two distinct provider-side failures, plus soft rate limiting:

1. **Hard 429 OTPM capacity blocker** (case-a run-02):
   `Request too large … service tier on_demand on output tokens per minute
   (OTPM): Limit 1000, Requested 1085`.
   Caused by production `groq: { maxCompletionTokens: 4096 }` — the model plans
   >1000 output tokens and the on-demand tier rejects the request outright.
   → **`EXTRACTOR_PROVIDER_CONFIGURATION / TIER CAPACITY BLOCKER`**.

2. **`json_validate_failed` 400** (single-evidence run-03):
   `Failed to generate JSON … failed_generation: "No candidate"`.
   The model decides "no candidate" and emits a bare non-JSON string, which
   `json_object` mode rejects. Distinct from a transport failure; it is semantic
   empty output that fails JSON validation at the API boundary.

3. **Soft 429 (TPM) retries**: 39 retry attempts across the 30 primary runs,
   all eventually succeeding via the built-in backoff. These are rate limiting,
   not the hard OTPM blocker above.

Total live Groq invocations: 36 (`extractExperiences` path) =
3 (RUNS=1 probe) + 30 (RUNS=10 primary) + 3 (controlled-900). Retries add
additional HTTP attempts (39 soft-429 retries in the primary run).

## 7. Controlled lower-limit experiment (separate, `max_completion_tokens: 900`)

One call per case, `SKIP_PRIMARY=1`:

- No 429 (the OTPM "Requested 1085 > 1000" blocker is eliminated).
- All three returned valid empty `{"candidates":[]}` (`NO_CANDIDATE`), in a
  single-call sample — so this neither proves nor disproves that 900 tokens
  yields candidates; it only proves the hard 429 is a token-budget artifact.

`case-*/controlled-limit-900/{raw-response.txt,parsed-result.json}`.

## 8. Observability findings (documented, NOT fixed)

1. `WebAcquisitionResult` (`experience-acquisition.service.ts`) carries
   `groundedRawOutput` and `extractorRawOutput`, but
   `generation-trace-builder.util.ts` (the `web` source-plan serialization)
   does not persist either — the trace keeps normalized evidence and
   extractor counts, but not raw provider/model output or the rendered prompt.
2. When `extractExperiences` throws after grounding succeeded,
   `executeWebSourcePlan`'s `catch` collapses the result to
   `status:'failed', evidenceKeys:[]` — the already-obtained grounded evidence
   is lost from the trace (`evidenceKeys` becomes `[]`).

Both are left as follow-ups; they are exactly why this replay needed a frozen
copy of the evidence rather than re-deriving it from the trace.

## 9. Answers

1. **Does the extractor produce a candidate for the strongest single evidence?**
   Yes, but not reliably — 5/10 (plus 1 `json_validate_failed` that was
   semantically "no candidate" and 4 clean empty). When it produces, it is the
   full, stable 3-component composition.
2. **Does it produce candidates for the full 10-evidence set?**
   case-b (history): 8/10. case-a (walk): 3/10, and those are low-quality.
3. **Is the output stable across identical repeated runs?** No — CANDIDATE /
   NO_CANDIDATE / `json_validate_failed` vary for the same input.
4. **When it varies, what varies?** candidate presence; component count (2 vs 3,
   `Lezama Park` dropped); component naming (`El` prefix); candidate name;
   supportSpan precision; component array order (`orderedByEvidence` stays
   `false` throughout).
5. **Failures provider/transport vs semantic empty?** Both: hard 429 (config
   blocker), soft 429 (rate), `json_validate_failed` 400 (semantic empty that
   fails JSON), and clean semantic empty `{"candidates":[]}`.
6. **Does evidence dilution appear real?** Only weakly and ambiguously. Single
   evidence yields the full 3-component composition every time it yields, but
   only ~50% of runs; the 10-bundle yields more often (~80%) but sometimes
   drops `Lezama Park` and uses sloppier supportSpans. The dominant effect is
   stochasticity, not dilution — and the comparison is confounded by the
   later-run rate limiting.
7. **Does the current Groq OTPM/maxCompletionTokens config prevent reliable
   characterization?** Yes — `max_completion_tokens: 4096` intermittently
   triggers hard 429 `Requested 1085 > Limit 1000`, plus heavy soft 429
   backoff. A lower limit avoids the hard 429.
8. **Enough evidence to change the prompt yet?** **No.** The first-order
   blockers are (a) the token-limit vs tier-OTPM config and (b) model
   stochasticity, neither of which is a prompt defect proven by this data.
   Prompt changes remain unjustified until characterization is repeated under a
   non-rate-limited config.

## 10. Final classification

```
STOCHASTIC_EXTRACTION
PROVIDER_CAPACITY_BLOCKER
INVALID_OUTPUT_INSTABILITY
EVIDENCE_DILUTION_OBSERVED   (weak/ambiguous)
```

Not applicable: `STABLE_EXTRACTION`, `SEMANTIC_ZERO_YIELD` (it does yield,
just unstably).

No production code was changed. No fix is proposed yet — the next step is
characterization under a corrected token budget, not a prompt edit.


