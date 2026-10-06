# RW4-EXTRACT-COMPLETENESS-1: extractor reliability determination (2026-10-06)

Question: can RW4 extraction fidelity depend on choosing a better extractor
model, or does the pipeline need a deterministic completeness mechanism
around a probabilistic extractor?

Answer: **model selection is not sufficient.** No mechanism in the current
pipeline can stop an extractor from silently omitting a source-defined stop.
A deterministic structural guard cannot detect the observed omissions
generically. The smallest mechanism with the required property is
exhaustive evidence-atom labelling with deterministic coverage and
assembly. It needs an owner decision and a spec amendment, and it is
**not implemented**. RW4-EXTRACT-COMPLETENESS-1 stays **OPEN**. C3 COLD was
not run, because neither acceptance path is met.

All inputs are the frozen complete units (`SOB_UNIT` 14926 chars,
`AG_UNIT` 13309 chars) and the frozen `oracle.json`, which is unchanged.
Production code is unchanged. A prompt correction was tried and reverted
(Part D).

## Part A: Cloudflare `@cf/qwen/qwen3.8-27b`

- `replays/verify-qwen38-cloudflare/`: 6 attempts (3 × SOB_UNIT,
  3 × AG_UNIT). **0 valid, 6 INVALID_RUN.** Every call returned HTTP 429,
  code 4006: "you have used up your daily free allocation of 10,000
  neurons", at 2026-10-06 10:30 UTC. Something else had already spent
  today's allocation. It resets at 00:00 UTC.
- Recall denominator: 0. No reliability claim is possible from today.
- Historical valid Cloudflare runs, on the pre-fix prompt
  (`baseline-cloudflare`, `prompt-v1-cloudflare`, temperature 0):
  - SOB_UNIT gave 0 candidates, then 3/8 unordered, then 4/8 and 4/8.
  - AG_UNIT gave 0 candidates in 4/4 runs.
  - No valid Cloudflare run has ever met the oracle.
- The harness now records the effective request settings (temperature,
  completion budget, `chat_template_kwargs`) and the response's finish
  reason and usage (`<input>-<run>.wire.json`). It also records the raw
  proposals scored before validation, normalization violations, and a
  per-segment verdict under the brief's acceptance rule. Re-run after the
  reset:
  `EXTRACTOR=cloudflare RUNS=3 INPUTS=SOB_UNIT,AG_UNIT LABEL=verify-qwen38b node spikes/rw4-extract-completeness-2026-10-05/replay-extract.cjs`

## Comparator: Gemini `gemini-3.5-flash-lite` on identical inputs

Transport facts (wire capture): the Gemini extractor sends **no
temperature** and **no output budget**, and it reads no finish status
(`gemini-discovery.provider.ts`, `fetchInteraction`). Observed usage was
940–2029 output tokens and 0 thought tokens. Truncation would be
detected only as a JSON parse failure. Recorded as
RW4-EXTRACT-GEMINI-TRANSPORT-1.

Per-segment success under the brief's rule. "Proposed" means the model's
raw output before validation.

| Segment | HEAD prompt (6 runs) | Normalization-wording prompt (9 runs) |
|---|---|---|
| SOB S1-walk | success 1/6. All 8 mandatory stops proposed in 6/6, but 5/6 rejected for `MISSING_NORMALIZATION_KIND` | success 1/9. Museo Histórico Nacional omitted 7/9 |
| SOB S2-la-boca | success 0/6. Proposed 2/6, both rejected by validation | success 4/9 |
| AG S1-walk | success 0/6. Obelisco omitted 6/6; recall 8,8,8,8,2,7 of 9 | success 0/9. Teatro Colón, Obelisco and Plaza de Mayo omitted 9/9 |
| AG S2-la-boca / S3-puerto-madero | success 0/6. Emitted 1/6, mixed into S1 | success 0/9. Never emitted |

Batches: `head-8981-gemini` and `head-8981b-gemini` use the HEAD prompt;
`normfix-gemini`, `normfix-b-gemini` and `normfix-c-gemini` use the Part D
wording. Summarize with `node summarize.cjs <dirs>`.

Findings:

1. **Identical evidence yields incompatible compositions.** On the same
   frozen input with the same prompt:
   - SOB La Boca was emitted in 2 of 6 runs.
   - AG recall ranged from 2/9 to 8/9.
   - The live C3 COLD omitted the museum, which these same-prompt replays
     proposed 6/6.
2. **Omission is also systematic, not only sampling noise.** Obelisco was
   omitted in 6/6 runs.
3. **Recall is fragile under unrelated prompt edits.** One paragraph
   changed in the *naming* rule, with no change to the completeness rules:
   - AG's leading stops (Teatro Colón, Plaza de Mayo) went from present in 6/6 runs to omitted in 9/9.
   - The museum went from proposed in 6/6 runs to omitted in 7/9.
   - It reproduced with neutral examples (`normfix-c`), so it was not
     caused by fixture names in the examples.
4. A clean sample cannot certify an extractor. Even k/k clean runs only
   bound the per-run omission rate to about 3/k at 95%. With the free
   quotas (Cloudflare: about 16 calls a day), no affordable N supports
   "reliable".

**Is Cloudflare materially more stable than Gemini?** Unknown today: there
are 0 valid runs. On the historical evidence (pre-fix prompt) it was not:
its outputs varied from 0 to 4 of 8 mandatory stops at temperature 0.
Whatever the re-run shows, findings 1–4 mean model selection cannot close
the generic defect. A better model lowers the omission rate. It does not
make an omission detectable.

## Part B: extraction vs identity (kept separate)

- Extraction: SOB museum omission, AG Teatro Colón, Obelisco and Plaza de
  Mayo omission, and dropped later segments. All of these are
  RW4-EXTRACT-COMPLETENESS-1.
- Identity: in live C3 COLD, agusyornet's faithfully emitted Monumento de
  Mafalda and El Patio de los Ezeiza were `CANDIDATE_REJECTED` by identity.
  Recorded as **RW4-ID-C3-AGUS-1**, separate from extraction. Identity
  thresholds were not touched.
- Mixed case: in live C3 COLD, SOB was also rejected because emitted
  passing streets failed identity ("Estados Unidos" AMBIGUOUS, "Paseo de
  Colon" NO_CANDIDATE). The oracle marks those streets ACCEPTABLE, so
  emitting them is not an oracle violation. The rejection is real only
  because every emitted component must verify. This is extraction
  compliance (the prompt already forbids passing mentions as stops), not an
  identity defect.

## Part C: what a deterministic guard can and cannot detect

`guard-probe.cjs` applies generic marker rules to the oracle-correct
emission and to every observed Gemini proposal (output:
`guard-probe.out.json`). The marker classes are `Stop N`, time-of-day
schedule headings and start/end banners. The rules flag uncovered marker
sections: any gap, gaps before the last covered section only, or gaps in
the numbering.

- **SOB has no generic structure inside the walk.** It has one
  `**START AT PLAZA DE MAYO:**` banner and no numbering or headings. The
  museum is plain prose ("Make a stop at the national history museum").
  Every rule caught **0 of 12** incomplete SOB runs.
- **AG's markers are not stop semantics.**
  - `(stop 10)` labels an alternative restaurant (Nuestra Parrilla).
  - Stop 13 (Don Carlos) is ACCEPTABLE, Stop 16 is an "Or if you feel
    like…" alternative, and Stop 12 comes after 13.
  - Stops 1–4 are not numbered at all, and those are the ones Gemini
    dropped.
  - Every numbered-stop rule flags the **oracle-correct** extraction (false
    incompleteness), so its catches are vacuous.
  - Only schedule headings with no trailing gaps have zero false flags. That
    rule catches 10/15 incomplete AG runs (leading omissions only). It
    misses Obelisco, which shares the "9am" section with Teatro Colón, and
    every dropped later segment.
- Conclusion: structural markers are a partial, source-dependent tripwire.
  They are not a completeness proof, and the hardest observed omission
  (prose, trailing) has no deterministic signal. Telling "Make a stop at X"
  apart from "you will see X" or "if you are hungry, X" is semantic. A
  lexical rule for it would be the universal prose heuristic the brief
  rules out.

### Why the existing fail-closed gates cannot catch it

`INCOMPLETE_SOURCE_COMPOSITION`, source support, identity and geography all
judge only what was emitted. An omitted stop leaves no trace, so a list of
names lets the extractor be the sole, silent authority on completeness.

### Smallest mechanism with the required property: exhaustive atom labelling

The property to establish: an LLM may propose structure but must not be able
to silently declare a source itinerary complete.

- **Deterministic:** split the editorial unit (already `SECTION_UNIT`,
  `sectionComplete`) into numbered atoms: lines, table cells and sentences.
- **LLM:** label **every** atom as STOP (named places plus a verbatim span),
  TRANSFER, or OTHER with a reason (PASSING / ALTERNATIVE / CONTEXT /
  NOT_ITINERARY).
- **Deterministic:** a missing or duplicate label, or a span not inside its
  atom, fails closed. Membership is the STOP atoms in atom order, split at
  TRANSFER atoms. Names stay as the evidence words them and go to the
  existing resolver. Source support, identity, geography and
  `INCOMPLETE_SOURCE_COMPOSITION` stay unchanged downstream.

What this buys:

- **No silent omission.** Leaving a stop out now takes an explicit,
  recorded claim ("A9 is PASSING") on a specific atom, which can be traced
  and audited. A missing label is a deterministic failure.
- **Order and segment drops become structurally impossible.** These were
  the dominant observed failure classes (S2/S3 dropped in most list runs).
- **Normalization pressure goes away.** The model no longer names or
  translates members, so the Part D failure class disappears instead of
  being prompt-tuned.

What it does not buy: the STOP vs PASSING call is still semantic and
probabilistic. It becomes explicit, but it is not proven.

Probe evidence (`atom-probe.cjs`, `replays/atoms-gemini/`, 3 runs per unit,
the same flash-lite model). This was a first probe prompt, not tuned.

- Label coverage was complete in 6/6 runs (126 and 88 atoms).
- **SOB:** the museum atom (A81) was labelled STOP in 3/3 runs, and the bus
  sentence (A87) was labelled TRANSFER in 3/3. S2-la-boca succeeded 3/3.
  S1 succeeded 1/3 (span-anchored scoring, `results.span.json`). The other
  two runs explicitly labelled "In front, you will see Casa Rosada" (and
  Cabildo and the Catedral) as PASSING: a visible semantic disagreement
  with the oracle, not a silent drop.
- **AG:**
  - S1 recall was 9/9 in 2/3 runs (Obelisco missed once).
  - S2 and S3 were emitted in 3/3 runs, against 1 of 15 list runs. The
    single list-run emission was mixed into S1, so no list run segmented
    them correctly.
  - Probe-prompt faults remain: food recommendations were labelled STOP
    (alternatives flattened), and the "15hs – Go to Caminito" heading
    precedes the bus sentence, which mixes Caminito into S1.

Rejected alternatives:

- **"Extract, then audit completeness with a second LLM pass."** The audit
  is the same silent list-recall task, so when both passes omit a stop,
  nothing records it. It costs one extra call for a weaker property.
- **Numbered-stop or schedule-heading guard as the authority.** Shown above
  to be blind on prose and wrong on real numbering. At most it is an
  optional cheap tripwire.
- **Model shopping.** Findings 1–4.

## Part D: normalization pressure

- Cause: the prompt says the model "SHOULD translate or normalize
  well-known place names", and the structured schema describes
  `normalizationKind` as "Optional". Gemini at HEAD expanded names the
  source already gives in Spanish without the kind ("Catedral
  Metropolitana" became "…de Buenos Aires"; "Cabildo" became "Museo
  Histórico Nacional del Cabildo y de la Revolución de Mayo"). The strict
  validator then rejected 5/6 SOB S1 candidates whose recall was 8/8.
- Correction tried (`normfix-prompt.diff`, with regression tests):
  - normalization is never required;
  - local-language wording is kept verbatim;
  - `normalizationKind` is required whenever `sourceName` is present,
    otherwise the hint uses the exact wording;
  - the schema description now matches.
  - Result: MISSING_NORMALIZATION_KIND fell from 2.0 to 0.7 hints per run
    (24 in 12 runs, 13 in 18 runs).
- **Reverted:** the same change systematically lowered recall (Part C,
  finding 3), and the result reproduced with neutral examples. A recall
  regression is not an acceptable price. `MISSING_NORMALIZATION_KIND` and
  the HEAD prompt are unchanged. The atom mechanism removes this class
  structurally. Recorded as RW4-EXTRACT-NORMALIZATION-1.

## Part E: C3

Not run.

- Path 1 (extractor reliability): not demonstrated. Cloudflare had 0 valid
  runs, and Gemini's per-segment success was at most 1/6 on any S1.
- Path 2 (generic completeness protection): not implemented. It needs the
  owner's decision and a spec amendment to
  `docs/architecture/activity-discovery-and-tour-generation.md`.

**RW4-EXTRACT-COMPLETENESS-1: OPEN.**
