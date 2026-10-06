# RW4-EXTRACT-COMPLETENESS-1: exhaustive source-atom labelling spike (2026-10-06)

Question: does exhaustive atom labelling make extraction fidelity
observable and structural assembly stable, even though semantic labels
stay probabilistic?

Answer: **yes for observability and structure, with residual semantic
precision and contract-compliance costs.**

- Every valid run labelled every atom exactly once.
- Every oracle-mandatory stop received an explicit atom-level decision in
  every valid run.
- Segment boundaries were assembled correctly in every valid run.
- The previously silent losses (the SOB museum, the later AG segments)
  never disappeared silently. The museum atom was labelled
  `ITINERARY_STOP` in 8/8 valid SOB runs, with its entity in every v2
  run. AG S2/S3 were assembled in 10/10 valid v2 AG runs.

Recommendation: **PROCEED_TO_PRODUCTIZATION** of the mechanism for
`SECTION_UNIT` editorial units, with the conditions and risks listed below.
Production code is unchanged. RW4-EXTRACT-COMPLETENESS-1 stays **OPEN**
until a cutover is authorized and C3 runs.

Contract: `docs/architecture/activity-discovery-and-tour-generation.md`,
"Experience Domain V2 — exhaustive source-atom labelling amendment
(2026-10-06)". Inputs: frozen units (production windowing, `SECTION_UNIT`,
`sectionComplete=true`; SOB 14926 chars, AG 13309 chars) and the frozen
`../rw4-extract-completeness-2026-10-05/oracle.json`, which is unmodified.

## Files

| File | Role |
|---|---|
| `atom-labelling.cjs` | Pure contract: `atomize`, `checkCoverage`, `planBatches`, `buildPrompt`, `validateLabelling`, `mergeBatches`, relabel helpers, `assemble`. No provider and no domain vocabulary. |
| `atom-labelling.test.cjs` | 16 deterministic tests (`node --test spikes/rw4-atom-labelling-2026-10-06/atom-labelling.test.cjs`). |
| `units.cjs` | Rebuilds the frozen `SECTION_UNIT`s through the production windowing in `be/dist`. |
| `probe.cjs` | Live harness over the real extractor transport (`completeStructured`), with wire capture. A transport failure is `INVALID_RUN`. |
| `score.cjs`, `scoring-aliases.json` | Oracle scoring (evaluation only). The aliases are the source's own wordings for oracle items (for example "national history museum"). They were frozen **before** the first live run and are read from the unit text, never from model output. |
| `summarize.cjs` → `runs/summary.md`; `analyze.cjs` → `runs/analysis.md` | Run table, and per-item atom decisions across runs. |
| `runs/<batch>-gemini/` | Raw output per batch and relabel, wire capture, per-run `result.<RULE>.json` (every atom's label, issues, segments, verdicts). |

## Contract summary

- **Atom:** `{atomId: a-NNN, ordinal, sourceStart, sourceEnd, text,
  blockKind, fragment?}`.
  - Splits only on lines, unescaped table pipes, and sentence-final
    punctuation plus whitespace. The abbreviation guard works by token
    length (≤ 3 letters or digits). Over-long pieces are split at
    whitespace into offset-preserving fragments (default 600 chars).
  - Atoms and separators partition the unit exactly. A separator is
    whitespace, a newline, a pipe, or markup with no letter or number
    once URL targets are elided.
  - The model sees link targets and bare URLs as `…`. Every presented
    character maps back to a source offset.
- **Taxonomy:** `ITINERARY_STOP | OPTIONAL_STOP | ALTERNATIVE | TRANSFER |
  PASS_BY | NON_ITINERARY`. A `TRANSFER` atom may carry a `transferMode`.
- **Entities:** 0..n per atom, `{sourceName, supportSpan, role,
  mentionAtomId?}`.
  - `sourceName` is the exact source wording.
  - `supportSpan` must lie inside the atom. Containment ignores only case,
    accents, `*_\`` escapes, quotes and whitespace runs.
  - `sourceName` must lie inside its span, or inside the earlier atom that
    `mentionAtomId` cites.
- **Completeness invariant:** exactly one label per atom. A missing,
  duplicate, unknown or malformed label, an out-of-atom span, a name outside
  its span or mention, or a membership-relevant role inconsistency fails
  the unit closed.
  - Batches carry global IDs, and their union is re-checked.
  - At most one relabel round, scoped to the rejected atoms and validated
    the same way. An unknown atom ID or a malformed response is not
    repairable.
- **Assembly:**
  - Order comes from atoms. A `TRANSFER` closes a segment once it has its
    own membership, and adjacent transfers form one boundary.
  - Only `ITINERARY_STOP` entities are mandatory. Optional stops stay
    optional, alternatives form choice groups, and pass-by entities stay
    context.
  - Exact folded-name repeats inside a segment merge, and the strongest
    role wins.

### Contract iterations (all recorded)

- **Prompt v1** (`runs/smoke-v1-gemini`, 1 run per unit). Gaps:
  - anaphoric directives ("Jump inside.", "enjoy the park");
  - descriptive place references ("the national history museum" was
    labelled `ITINERARY_STOP` with no entity);
  - an overview sentence promoted to stops;
  - a transfer heading labelled as a stop (Caminito mixed into AG S1);
  - a return transfer opening a spurious segment.
- **Prompt v2:** adds `mentionAtomId` and generic guidance for those cases.
  It uses no fixture names.
- **Consistency rule:**
  - STRICT (v1): classification must equal the strongest entity role.
    Unnamed options failed closed ("2 ice-cream shops", "a choripan in some
    kiosk"), although they add no membership.
  - MEMBERSHIP (v2): fails closed only where membership can be hidden or
    invented. Both rules are reported for the runs that ran under both.
- **Batching (4000 presented chars, 4 context atoms) + one relabel:**
  forced by transport. 3 of 5 single-request SOB runs exceeded the Gemini
  extractor's fixed 25 s timeout (`INVALID_RUN`).

## Results

Full table: `runs/summary.md`. Per-item atom decisions: `runs/analysis.md`.

### Main campaign: `v2-batched-relabel-gemini` (MEMBERSHIP rule), 10 runs, 0 INVALID_RUN

| Unit | Run | Outcome | Classified | 1st-pass issues → relabelled atoms | Final issue | S1 | S2 | S3 |
|---|---|---|---|---|---|---|---|---|
| SOB | 1 | ASSEMBLED | 182/182 | 1 → 1 | none | 8/8 OK | 2/2 OK | – |
| SOB | 2 | FAIL_CLOSED | 182/182 | 2 → 2 | `NAME_NOT_IN_SPAN a-039` | (8/8) | (2/2) | – |
| SOB | 3 | FAIL_CLOSED | 182/182 | 1 → 1 | `NAME_NOT_IN_MENTION_ATOM a-041` | (8/8) | (2/2) | – |
| SOB | 4 | ASSEMBLED | 182/182 | 1 → 1 | none | 8/8 OK | 2/2 OK | – |
| SOB | 5 | ASSEMBLED | 182/182 | 4 → 4 | none | 8/8 OK | 2/2 OK | – |
| AG | 1 | ASSEMBLED | 95/95 | 5 → 5 | none | 9/9 OK | 1/1 OK | 1/1 OK |
| AG | 2 | ASSEMBLED | 95/95 | 1 → 1 | none | 8/9 (Obelisco `PASS_BY` @a-012) | 1/1 OK | 1/1 OK |
| AG | 3 | ASSEMBLED | 95/95 | 3 → 3 | none | 9/9 OK | 1/1 OK | 1/1 OK |
| AG | 4 | FAIL_CLOSED | 95/95 | 3 → 3 | `SPAN_NOT_IN_ATOM a-076` | (9/9) | (1/1) | (1/1) |
| AG | 5 | ASSEMBLED | 95/95 | 3 → 3 | none | 9/9 OK | 1/1 OK | 1/1 OK |

Values in parentheses are the diagnostic shadow assembly of a FAIL_CLOSED
run, built from the atoms that did validate. It is never a pipeline
outcome.

- Assembled: 7/10.
- Assembled and oracle-exact on every segment: 6/10.
- Assembled with a visible semantic miss: 1/10 (AG run 2, Obelisco).
- Failed closed: 3/10. Every residual issue is on a non-oracle,
  non-mandatory atom:
  - a-039 "oldest neighborhood of the capital city": the name included
    "the" but the span did not;
  - a-041 "San Telmo" cited an atom that does not contain it;
  - a-076 "Centro Cultural Kirchner" is an anaphora without
    `mentionAtomId`.
- First-pass issue codes (22 across 10 runs): `ROLE_INCONSISTENT` 12,
  `NAME_NOT_IN_MENTION_ATOM` 4, `STOP_WITHOUT_ENTITY` 3,
  `NAME_NOT_IN_SPAN` 3, `SPAN_NOT_IN_ATOM` 2. One relabel round fixed 19
  of 22.

### Supporting batches

- `v2-single-gemini` (one request per unit, no relabel, 10 attempts):
  - SOB: 3 runs `INVALID_RUN` (transport timeout); 2 valid runs failed
    closed.
  - AG under MEMBERSHIP: run 1 ASSEMBLED and oracle-exact; runs 2–5 failed
    closed.
  - Shadow recall: SOB S1 7/8 (Parque Lezama `PASS_BY` in run 4; run 5
    lost it only in the shadow, because the atom was rejected). AG S1 9/9
    in 4/5 runs and 6/9 in run 4, where a-026 "Walk through Defensa Street
    … entering San Telmo" was labelled `TRANSFER` and over-segmented S1.
- `smoke-v1-gemini` (prompt v1, 1 run per unit): both failed closed, under
  both rules.

## Deliverable answers

1. **Every atom classified?** Yes. In all 19 valid runs across the three
   batches, classified = total atoms (182 and 95), with 0 missing,
   0 duplicate and 0 unknown atom IDs. 3 runs were `INVALID_RUN`
   (transport timeout), not semantic failures.
2. **Mandatory recall per oracle segment** (main campaign, all 10 runs,
   shadow included):
   - SOB S1 8/8 in 5/5; SOB S2 2/2 in 5/5.
   - AG S1 9/9 in 4/5 (Obelisco missed once); AG S2 1/1 in 5/5;
     AG S3 1/1 in 5/5.
   - Order violations: 0.
3. **Museo Histórico Nacional:** an explicit atom-level decision in every
   valid run of every batch. Atom `a-079` "Make a stop at the national
   history museum." was labelled `ITINERARY_STOP` in 8/8 valid SOB runs
   (v1 smoke 1, v2 single 2, v2 batched 5). The entity ("national history
   museum") was emitted in 7/7 v2 runs.
   - Under prompt v1, the entity was missing. The validator surfaced it as
     `STOP_WITHOUT_ENTITY a-079` and failed closed instead of losing the
     stop silently.
   - The old failure ("the museum silently disappears") did not occur once.
4. **Can later AG segments still disappear silently?** No.
   - S2 (La Boca) and S3 (Puerto Madero) were assembled in 10/10 valid v2
     AG runs. Before, 1 in 15 list runs emitted them, mixed into S1.
   - A segment exists exactly when a `TRANSFER` atom separates labelled
     membership. Dropping one now requires an explicit wrong label on a
     named atom.
5. **Segment mixing after assembly?** 0 `SEGMENT_MIXED`, 0
   `TRANSFER_BOUNDARY_MISSED` in every v2 run.
   - The v1 mixing (Caminito in AG S1 through heading a-058) was a visible
     label decision. It is fixed in v2, where a-058 is `TRANSFER` 10/10.
   - What remains possible is over-segmentation by a wrong `TRANSFER`
     label (a-026, single run 4). It is visible in `openedBy`.
   - Return transfers (SOB a-105, AG a-075/a-077) open trailing segments
     with 0 mandatory members, which are not candidates.
6. **Food recommendations and alternatives:** never promoted to mandatory
   in v2.
   - Café Tortoni, London City, Alfonso, Saigón and Desnivel were
     `ALTERNATIVE` in 10/10 v2 AG runs (single + batched).
   - Nuestra Parrilla and Coffee Town were `ALTERNATIVE` 9/10 and
     `OPTIONAL_STOP` 1/10.
   - Trade Sky Bar was `ALTERNATIVE` or `OPTIONAL_STOP`.
   - `A or B` is kept as one choice group. `ALTERNATIVE_PROMOTED`: 0.
7. **Pass-by items promoted (the precision problem):** systematic. The
   oracle treats ACCEPTABLE items as present-or-absent faithful, so they
   are not failures.
   - SOB promoted to mandatory: the streets Defensa and Estados Unidos
     (5/5), Bar Sur (5/5), Museum of Modern Arts (4/5), the area "Boca"
     (4/5), and Paseo de Colon (2/5). It also emitted non-oracle
     descriptions as stops ("Feria San Telmo", "oldest neighborhood of the
     capital city", "big building with columns").
   - AG promoted Congress, Casa Rosada, Cathedral, Cabildo (5/5), "Don
     Carlos" (5/5), "Puerto Madero" (5/5) and "San Telmo" (not in the
     oracle, 5/5).
   - These are explicit, auditable labels. Downstream, they still meet the
     existing all-components-must-verify gate. In C3 COLD, "Estados Unidos"
     (AMBIGUOUS) rejected the SOB composite through that gate.
8. **Invented entities:** none reached assembly. The validator rejects any
   name outside its atom, span or cited atom. All `NAME_NOT_IN_*` and
   `SPAN_NOT_IN_ATOM` occurrences were rejected (fail closed or
   relabelled).
9. **Misclassification examples** (all visible on a named atom):
   - SOB v1: `a-009` "In front, you will see Casa Rosada." was `PASS_BY`.
   - SOB single run 4: `a-073` "On your left side, you will see Parque
     Lezama." was `PASS_BY`.
   - AG batched run 2: `a-012` gave Obelisco the role `PASS_BY` ("walk a
     few streets to see the Obelisco").
   - AG single run 4: `a-026` "Walk through Defensa Street" was labelled
     `TRANSFER`.
   - SOB v2: `a-033` "Go to the street Defensa." was `ITINERARY_STOP`
     (oracle: ACCEPTABLE).
10. **Remaining semantic uncertainty:**
    - "you will see X" (sight vs passing) and walked streets (route vs
      stop) are the unstable boundaries.
    - Area names (La Boca, Puerto Madero, San Telmo) used as transfer
      destinations or neighborhood entries are labelled `ITINERARY_STOP`.
    - Contract compliance on anaphora and exact name wording causes ~30%
      fail-closed units after one relabel.
    - Gemini flash-lite only; no second model was evaluated (out of scope
      by brief).

## Recommendation: PROCEED_TO_PRODUCTIZATION

The architectural property is demonstrated:

- an omission is no longer silent;
- segment loss and mixing caused by the model forgetting a candidate are
  structurally gone;
- required stops are labelled consistently, not "consistently
  misclassified".

The remaining failures are explicit atom-level decisions or deterministic
fail-closed outcomes with atom IDs.

**Smallest next cutover step (not implemented; needs owner
authorization):**

1. Port `atom-labelling.cjs` into `be/src` as a provider-neutral utility.
   Wrap it in an extractor-boundary step that runs on the configured
   extractor's `completeStructured`, only for web sources whose window is
   `SECTION_UNIT` with `sectionComplete=true`.
2. Map each assembled segment that has mandatory members to one
   `ExperienceCandidate`:
   - mandatory members become component hints, in source order, with
     `sourceName` and `supportSpan`;
   - optional, alternative and pass-by entities stay trace provenance
     only.
   - Run them through the unchanged source-support → identity → geography
     → `INCOMPLETE_SOURCE_COMPOSITION` path.
3. Fail closed per unit: no fallback to the generative extractor for that
   unit. Trace atom counts, issue codes and the relabel scope.
4. Delete the generative path for `SECTION_UNIT` editorial units in the
   same cutover (no dual authority). Then run C3 COLD, and WARM only if
   COLD persists a composite.

**Known risks before C3 (owner decisions, not downstream relaxations):**

- **Pass-by promotion of streets and areas** (answer 7) will probably still
  reject SOB through `INCOMPLETE_SOURCE_COMPOSITION`, because "Estados
  Unidos" was AMBIGUOUS in C3. Options:
  - a taxonomy role for a route or street the walk follows (`ROUTE_LEG`,
    resolved as ROUTE context, not a mandatory PLACE);
  - tighter `PASS_BY` guidance.
  - Do not weaken the all-components rule or identity thresholds.
- **Fail-closed rate** (3/10 after one relabel, all on non-mandatory
  atoms). A unit-level fail closed is correct, but it costs real
  composites. A second relabel round, or atom-scoped prompts for
  anaphora, are candidates. Measure them; do not assume them.
- **Transport:** batching is mandatory under the fixed 25 s Gemini
  timeout and its unbounded output (RW4-EXTRACT-GEMINI-TRANSPORT-1).

## Reproduce

```bash
cd be && yarn build && cd ..
node --test spikes/rw4-atom-labelling-2026-10-06/atom-labelling.test.cjs
set -a; . ./.env; set +a
EXTRACTOR=gemini RUNS=5 RELABEL=1 MAX_BATCH_CHARS=4000 LABEL=v2-batched-relabel \
  node spikes/rw4-atom-labelling-2026-10-06/probe.cjs
# re-score saved output without provider calls:
RESCORE=1 CONSISTENCY=STRICT RUNS=5 LABEL=v2-single node spikes/rw4-atom-labelling-2026-10-06/probe.cjs
```
