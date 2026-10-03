# Extractor Characterization & Forensic Assessment (RW3)

Date: 2026-09-28
Evaluated Model: `@cf/qwen/qwen3.8-27b` (Cloudflare Workers AI)
Evaluation Harness: `spikes/extractor-characterization-rw3-2026-09-28/run-characterization.ts`
Transport Parameters: `temperature=0`, `max_completion_tokens=900`, `enable_thinking=false`, `timeout=60000ms`.

---

## 1. Executive Summary

This characterization was performed to systematically test the Cloudflare discovery extractor against frozen evidence from real RW3 runs:
1. **Positive Control (`positive-control-evidence.json`):** 10 evidence items from `spikes/rw3-anchor-handoff-rerun-2026-09-27/cold/generation-trace.json`, where `ev-5` contains an explicit 3-stop itinerary:
   > *"A private walking tour of the La Boca neighborhood · Visit Caminito, Benito Quinquela Martin Museum, and La Bambonera stadium · Learn about Buenos Aires' vibrant ..."*
2. **Latest RW3 Run Evidence (`latest-trace-evidence.json`):** 10 evidence items from `spikes/rw3-route-scope-rerun-2026-09-28/cold/generation-trace.json`, where none of the 10 snippets describe an itinerary with $\ge 2$ named non-area POIs.

---

## 2. Experimental Results (5 Samples Each)

### A. Positive Control (5 runs)
- **Outcome:** `CANDIDATE_ADMITTED (1/1)` across **5 / 5 runs (100% stable)**.
- **Candidate:** `"Private Caminito & La Boca Walking Tour"` / `"Caminito & La Boca Walking Tour"`
- **Extracted Components:**
  1. `[waypoint/route] Caminito` (evidence: `ev-5`)
  2. `[waypoint/venue] Benito Quinquela Martin Museum` (evidence: `ev-5`)
  3. `[waypoint/venue] La Bombonera` (evidence: `ev-5`, typo-corrected from `"La Bambonera stadium"`)
- **Tokens emitted:** ~468–512 tokens.
- **Latency:** ~10.3s – 23.0s (average 16.1s).
- **Result:** Complete success. Proves that the production prompt, Cloudflare transport, and deterministic admission logic faithfully extract multi-component walks and correctly normalize typos when grounded in evidence.

### B. Latest Semantic-Empty Evidence (5 runs)
- **Outcome:** `SEMANTIC_EMPTY (0 candidates)` across **5 / 5 runs (100% stable)**.
- **Raw model output:**
  ```json
  {
    "candidates": []
  }
  ```
- **Tokens emitted:** Exactly 10 tokens across all runs.
- **Latency:** ~0.9s – 1.1s (average 1.0s).
- **Finish reason:** `stop`.
- **Result:** Complete consistency. Demonstrates that the empty candidate set is **NOT model variance or a flaky hallucination failure**, but **stable, intended fail-closed behavior** adhering strictly to the anti-fabrication invariant.

---

## 3. Explicit Classification

Based on empirical evidence, the current state is classified as:

**Primary Classification: Case A — Evidence does not prove $\ge 2$ source-backed non-area components belonging to one real Experience.**
- The Serper snippets in `rw3-route-scope-rerun-2026-09-28` did not contain an explicit multi-stop walking itinerary with 2+ non-area components.
- The model's refusal to invent or synthesize components from disconnected snippets is the correct fail-closed response required by the repository's anti-fabrication invariant.

**Secondary Observability Finding: Case D — Trace Completeness Gap (Fixed).**
- Prior to this commit, `ExperienceAcquisitionService` received `extractorRawOutput` from `CloudflareDiscoveryProvider`, but `generation-trace-builder.util.ts` dropped it.
- Fixed cleanly in `generation-trace-builder.util.ts` and `generation-trace.interface.ts`: `extractor.rawOutput` is now preserved in the trace, bounded (`TRACE_RAW_OUTPUT_MAX_CHARS = 8000`) and redacted (`redactTraceText`).
