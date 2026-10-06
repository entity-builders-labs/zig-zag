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
| `atom-labelling.cjs` | Pure contract: `atomize`, `checkCoverage`, `markEditorialStructure` (A.1), `planBatches`, `buildPrompt`, `validateLabelling`, `mergeBatches`, `resolveMentions` (A.2), relabel helpers, `assemble`, `labelUnit` (A.3 orchestration, `TransportFailure` → `INVALID_RUN`), `unitTrace`. No provider and no domain vocabulary. |
| `atom-labelling.test.cjs` | 32 deterministic tests (`node --test spikes/rw4-atom-labelling-2026-10-06/atom-labelling.test.cjs`). |
| `replay-recorded.cjs`, `counterfactual-a1-a2.cjs` → `runs/counterfactual-a1-a2.md` | Offline replay of recorded model answers under the current contract. No provider calls. |
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
node spikes/rw4-atom-labelling-2026-10-06/counterfactual-a1-a2.cjs   # offline, no provider
# probe.cjs now runs labelUnit at HEAD (editorial structure, ENTITY_ROLES,
# 2500-char batches). Batches recorded before A.1 are replayed with
# replay-recorded.cjs; earlier probe settings live in git history.
set -a; . ./.env; set +a
EXTRACTOR=gemini RUNS=5 RELABEL=1 MAX_BATCH_CHARS=4000 LABEL=v2-batched-relabel \
  node spikes/rw4-atom-labelling-2026-10-06/probe.cjs
# re-score saved output without provider calls:
RESCORE=1 CONSISTENCY=STRICT RUNS=5 LABEL=v2-single node spikes/rw4-atom-labelling-2026-10-06/probe.cjs
```

## Milestone A gate: `ROUTE_LEG` (prompt v3), 2026-10-06. Verdict: **FAIL (stop before B)**

The gate was frozen before any v3 run (`milestone-a-gate.json`, commit
`547d6acb`). Baseline: `v2-batched-relabel-gemini`, rescored with the same
scorer and no provider calls. Candidate: `v3-batched-relabel-gemini` (5
runs per unit) and `v3-regression-gemini` (3 runs per fixture), with the
same model and settings (batch 4000 chars, one relabel). Tables:
`runs/summary-v3.md`, `runs/analysis-v3.md`.

| Criterion | Baseline v2 | v3 | Result |
|---|---|---|---|
| Mandatory recall (valid runs) | SOB S1 8/8 5/5, S2 5/5; AG S1 9/9 4/5, S2 5/5, S3 5/5 | SOB S1 8/8 3/3, S2 3/3; AG S1 9/9 5/5, S2 5/5, S3 5/5 | per run: equal or better (Obelisco fixed). The frozen total-hits rule fails only because of 2 INVALID_RUN |
| Transfers / mixing | S2/S3 always; 0 mixed | S2/S3 always; 0 mixed, 0 boundaries missed | PASS |
| Alternatives promoted | 0 | 0 | PASS |
| Route/area items promoted to mandatory (mean per valid run) | 2.9 (SOB 3.2, AG 2.6) | **3.4** (SOB 3.7, AG 3.2) | **FAIL**: worse |
| Defensa/Estados Unidos not mandatory in ≥ 4/5 SOB runs | 0/5 | 1/3 valid | **FAIL** |
| CONTRACT_FAIL_CLOSED | 3/10 | 1/8 valid | PASS |
| RW3 regression (RW3_EV3, ROUTE_EXPERIENCE) | n/a | recall 4/4 and 3/3 in 3/3 runs each; Mill Street never mandatory; Painted Lane always `ITINERARY_STOP`; 1 contract fail-closed | PASS |
| INVALID_RUN | 0/10 | 2/10 (SOB batches of ~60 atoms: call and retry both over 25 s) | operational; see point 5 |

### Why `ROUTE_LEG` did not reduce promotion

The model does use `ROUTE_LEG`. For example: Paseo de Colon, Avenida San
Juan, Av. Roque Saenz Peña, Av. de Mayo, Darsena Sur and Giralt are route
legs in 8/8 runs. Defensa is a route leg at a-054 and a-072. Promotion
comes from three conflicting instructions in the v3 prompt and from one
assembly rule:

1. **The transfer-destination rule.** "A TRANSFER atom may list the place
   it travels to: ITINERARY_STOP when the traveller visits that place next"
   turns area directions into stops: SOB a-085 "Boca" (3/3), AG a-069
   "Puerto Madero" (5/5), AG a-058 "La Boca" (2/5). This contradicts the
   area rule.
2. **The sight rule from v2.** "you will see X … is an ITINERARY_STOP"
   promotes streets presented as sights: SOB a-082 "you will see Avenida
   Caseros" (3/3).
3. **Directive verbs on a street.** "Go to the street Defensa" (a-033) and
   "go to the street Estados Unidos" (a-042) were labelled
   `ITINERARY_STOP` in 2/3 runs. "Now you are entering San Telmo" (AG
   a-026) was labelled `ITINERARY_STOP` in 4/5 runs, against the area rule.
4. **Strongest-role merge across atoms.** One `ITINERARY_STOP` atom for a
   street promotes it, even when every other atom labels the same street
   `ROUTE_LEG` (Defensa: a-033 STOP, a-054/a-072 ROUTE_LEG). The merge is
   right for anaphora ("pass the entrance" → "Jump inside."). It also hides
   a role conflict that ought to be visible.

### Proposed v4 for a re-gate (not run; needs your go-ahead)

All are generic and keep the LLM as the only semantic authority:

- Transfer destination: a named place that is visited next stays a stop. A
  district or area named as the direction or destination of the transfer
  is `ROUTE_LEG`, unless a later atom presents it as a destination to
  explore.
- Narrow the sight rule to places that are not the path. A street or
  avenue is never a sight stop merely because it is "seen". It is a stop
  only when the source presents walking or experiencing it as the
  attraction.
- "Go to / head to / reach" a street that the walk then follows is a
  `ROUTE_LEG`.
- Make cross-atom role disagreement visible. When the same folded name in
  a segment has both `ROUTE_LEG` and `ITINERARY_STOP` atoms, assembly keeps
  `ITINERARY_STOP` (no silent demotion) but records a typed `ROLE_CONFLICT`
  with both atom IDs, for trace and review. The anaphora case
  (`PASS_BY` → `ITINERARY_STOP`) is not a conflict.
- Batch transport: drop the batch budget to about 2500 presented chars
  (about 35–40 atoms), or have the production transport carry an explicit
  timeout for atom labelling. Measure that before B.

Over-fitting risk: these come from the same two fixtures. The re-gate must
keep the frozen criteria, and the RW3 fixtures guard the opposite failure
(a corridor that is itself the experience).

## Milestone A re-gate v4, 2026-10-06. Verdict: **FAIL; prompt tuning stopped, representation revision proposed**

The criteria were frozen before the v4 runs (`milestone-a-gate-v4.json` and
its evaluator `gate-v4.cjs`, commit `474b929a`). The evaluator reproduced
the v3 FAIL before use.

Settings: prompt v4, batch 2500 chars, one relabel, transport timeout
unchanged at 25 s. Results: `runs/gate-v4-result.json`,
`runs/summary-v4.md`, `runs/analysis-v4.md`.

| # | Criterion | v4 | Result |
|---|---|---|---|
| 1 | Defensa/Estados Unidos (SOB) mandatory in ≤ 1 valid run | 0/4 and 0/4 | PASS |
| 2 | Areas used only as direction or entry are never `ITINERARY_STOP` | SOB 4/4 clean. AG a-069 "Go to Puerto Madero … bus or taxi" labelled the destination `ITINERARY_STOP` 5/5, so Puerto Madero was mandatory 5/5. San Telmo 0/5 | **FAIL** |
| 3 | Avenida Caseros mandatory in ≤ 1 valid run | 1/4 | PASS |
| 4 | `ROLE_CONFLICT` on gate entities ≤ 1 | 4 (Puerto Madero: a-069 STOP vs a-071 ROUTE_LEG) | **FAIL** |
| 5 | Recall ≥ 99% and ≤ 1 item missing | 94/95 (98.9%): Obelisco labelled `PASS_BY` at a-012 in AG run 3, a contract fail-closed run | **FAIL** (narrowly) |
| 6 | RW3 route-as-experience | semantic 3/3 and 3/3. ROUTE_EXPERIENCE failed closed on the contract in 2/3 runs (see below) | PASS |
| 7 | Transfers and mixing | 0 violations | PASS |
| 8 | Alternatives promoted | 0 | PASS |
| 9 | CONTRACT_FAIL_CLOSED ≤ 12.5% | 2/9 | **FAIL** |
| 10 | INVALID_RUN ≤ 1/10 | 1/10 (SOB run 3; v3 had 2/10) | PASS |

- Semantic success: 8/9 valid runs exact on every oracle segment.
- Operational valid-run rate: 9/10.
- What improved since v3:
  - streets are solved: SOB Defensa and Estados Unidos went from 2/3 to
    0/4;
  - Avenida Caseros went from 3/3 to 1/4;
  - SOB areas are clean;
  - AG San Telmo went from 5/5 to 0/5.

### Stop rule applied

v4 failed again on areas (criteria 2 and 4), so prompt tuning stops here.
What is left is a representation problem, not a prompt problem.

**R1. A transfer's destination is a membership channel.** The only remaining
area promotion is Puerto Madero. It comes 5/5 from the TRANSFER atom
labelling its own destination `ITINERARY_STOP`, against an explicit v4
instruction.

Offline counterfactual, with no provider calls and not a gate result
(`counterfactual-transfer-destination.cjs` →
`runs/counterfactual-transfer-destination.md`): re-assembling the recorded
labels of 23 runs (v2, v3 and v4) with entities on TRANSFER atoms as
destination provenance only.

- Mandatory recall is unchanged in all 23 runs. Caminito and the other
  S2/S3 stops are always recovered from non-transfer atoms.
- Puerto Madero promotion disappears.
- The counterfactual mapped the destination to `ROUTE_LEG`, which creates
  false `ROLE_CONFLICT`s on Caminito. The destination needs its own
  provenance role.

**R2. The atom classification duplicates entity roles, and that redundancy
produces contract failures.** 3 of the 4 v4 contract fail-closed cases had
correct entity roles and an atom classification that did not equal the
strongest role:

- `ROUTE_EXPERIENCE` a-003 "Walk down Mill Street to reach the Painted
  Lane" was classified `ROUTE_LEG`, with entities Mill Street:`ROUTE_LEG`
  and Painted Lane:`ITINERARY_STOP` (runs 1 and 2);
- AG run 1 a-068 was classified `OPTIONAL_STOP`, with entity Caminito
  Street:`ITINERARY_STOP`.

The fourth (AG run 3, `NAME_NOT_IN_MENTION_ATOM` "the market") is a real
contract slip.

### Proposed v5: representation, not new prompt rules (not run; needs a decision)

- **R1:** a new entity role `TRANSFER_DESTINATION`, allowed only on
  TRANSFER atoms. It is provenance only and never membership, structurally,
  not by instruction. Membership of the next segment comes only from
  non-transfer atoms, and the recorded evidence shows that costs no recall.
- **R2:** atom kind ∈ {`ITINERARY_CONTENT`, `TRANSFER`, `NON_ITINERARY`}.
  Per-entity roles (`ITINERARY_STOP`, `ROUTE_LEG`, `OPTIONAL_STOP`,
  `ALTERNATIVE`, `PASS_BY`) are the only role authority.
  - Exhaustiveness is unchanged: one result per atom.
  - `ITINERARY_CONTENT` without entities still fails closed
    (`ENTITY_REQUIRED`), which keeps the "a-079 stop without an entity"
    signal.
  - The classification-vs-role mismatch class disappears.
- `ROLE_CONFLICT` stays visible, with the stronger role kept.
- Re-gate with the same 10 frozen criteria. Criterion 2 then measures
  membership coming from direction or entry atoms, because a transfer atom
  can no longer carry an `ITINERARY_STOP`.

**Genuine residual semantic ambiguity (not a representation issue):**

- AG a-026, the heading "**12 am - Walk through Defensa Street**", promotes
  Defensa 5/5. The source does frame walking Defensa as the activity of
  that section, and the oracle allows it (ACCEPTABLE). Defensa resolved as
  a ROUTE in C3 COLD (14 OSM ways), so it may pass identity.
- Obelisco was missed once (a-012 `PASS_BY`, visible).

## Milestone A last re-gate v5 (R1 + R2, prompt unchanged), 2026-10-06. Verdict: **FAIL; stopped for owner review (no v6)**

The criteria were frozen before the runs (`milestone-a-gate-v5.json`,
commit `5aca6242`). v5 implements R1 and R2 as a deterministic
projection of the unchanged v4 prompt output (`CONSISTENCY=ENTITY_ROLES`):

- the prompt text sent is byte-identical to v4;
- **R1:** every entity of a TRANSFER atom becomes `TRANSFER_DESTINATION`
  provenance, never membership;
- **R2:** atom kind is CONTENT, TRANSFER or NON_ITINERARY, and entity roles
  are the only role authority. `STOP_WITHOUT_ENTITY` and a
  NON_ITINERARY-with-entities failure stay fail-closed.

Results: `runs/gate-v5-result.json`, `runs/summary-v5.md`.

| # | Criterion | v5 | Result |
|---|---|---|---|
| 1 | Defensa/Estados Unidos (SOB) | 1/5 and 0/5 | PASS |
| 2 | Undue membership from direction/entry atoms | AG clean (Puerto Madero 0/5, San Telmo 0/5). SOB San Telmo mandatory 2/5: a-041 "It gives just that special character to San Telmo" (run 4) and a-172, a **navigation link** "Best hotels in San Telmo" (run 5) | **FAIL** |
| 3 | Avenida Caseros mandatory ≤ 1 | 3/5 (a-082 "you will see Avenida Caseros" or a-084) | **FAIL** |
| 4 | `ROLE_CONFLICT` on gate entities | 0 | PASS |
| 5 | Recall | 102/105: Obelisco labelled `PASS_BY` at a-012 in 3/5 AG runs | **FAIL** |
| 6 | RW3 route-as-experience | 3/3 and 3/3, all ASSEMBLED | PASS |
| 7 | Transfers and mixing | 0 | PASS |
| 8 | Alternatives promoted | 0 | PASS |
| 9 | CONTRACT_FAIL_CLOSED ≤ 12.5% | 3/10, all the same slip: SOB a-078 "Take your time and enjoy the park." with sourceName "park" and mentionAtomId a-077, which says "Parque Lezama", not "park" | **FAIL** |
| 10 | Operational | 10/10 valid (2500-char batches, 25 s timeout unchanged) | PASS |

- Semantic success: 7/10 valid runs exact on every oracle segment.
- Operational valid-run rate: 10/10.

### What R1 + R2 fixed, and what they cannot touch

- **R1 fixed transfer promotion.** Puerto Madero went from 5/5 mandatory
  to 0/5, and `ROLE_CONFLICT` from 4 to 0. Caminito and the other S2/S3
  stops were never lost.
- **R2 fixed the duplicated-authority failures.** Every v4
  `ROLE_INCONSISTENT` class is gone: ROUTE_EXPERIENCE now assembles 3/3
  (it was 1/3). No museum signal was lost: a-079 is a stop with its entity
  in 5/5 SOB runs.
- **The remaining failures come from label variance on borderline atoms,
  which the representation does not touch.** v4 and v5 send the same prompt
  and label a-012 and a-082 independently of R1 and R2, yet:
  - Obelisco was `ITINERARY_STOP` in 4/5 (v4) and 2/5 (v5); across all
    batched runs, 18/25;
  - Avenida Caseros was mandatory in 1/4 (v4) and 3/5 (v5).

  At n = 5, thresholds such as "≤ 1 of 5" cannot separate a representation
  effect from sampling noise for atoms whose true labelling rate is around
  50%.

### Questions for review (decision rule: no automatic v6)

1. **Criterion 5 (Obelisco).** "Then you can walk a few streets to see the
   Obelisco and then walkthrough Av. Roque Saenz Peña directly to Plaza de
   Mayo" is borderline between a sight and passing. Each miss is an
   explicit `PASS_BY` on a-012, never silent. RW4's closure condition is
   "no silently omitted mandatory stop", which this meets. Should the gate
   require about 99% semantic recall on borderline atoms, or require that
   every miss be explicit?
2. **Criterion 3 (Avenida Caseros).** The oracle marks it ACCEPTABLE
   (faithful either way). Its only cost is downstream identity risk if it
   becomes mandatory. Is that an extraction-gate requirement, or a C3
   identity question?
3. **Criterion 2 (SOB San Telmo).** These are real semantic errors at low
   frequency. a-172 is a navigation link labelled a stop, so a return
   segment can get a one-member mandatory set from page chrome. This is the
   finding with the most production risk; the trace makes it visible.
4. **Criterion 9 (contract).** A single systematic anaphora slip: the model
   writes the anaphor ("park") instead of the antecedent's wording. The
   fail-closed rule is correct; the referent cannot be verified by name. At
   about 30% unit fail-closed, a C3 run with two sources has about a 50%
   chance that both units assemble. Whether the anaphora contract should
   change is a design decision, not a tuning step.

## Milestone A closure, 2026-10-06: **COMPLETED_WITH_FINDINGS** (owner decision)

The owner closed exploratory milestone A on the v5 evidence. Its status
is **COMPLETED_WITH_FINDINGS**. The frozen semantic-accuracy gate is
**not** marked PASS:

- v5 failed the old gate (criteria 2, 3, 5 and 9 above);
- no further prompt or taxonomy tuning is authorized (no v6/v7);
- the architectural value of atomization is accepted: every atom is
  accounted for, missing atoms are visible, segment assembly is
  deterministic, transfer destinations cannot become membership,
  alternatives stay non-mandatory, and semantic errors such as
  `PASS_BY` vs `ITINERARY_STOP` sit on named atoms;
- what remains is boundary hardening (A.1–A.3 below) and
  productionization (B, not authorized).

The acceptance model changes from near-perfect oracle classification to
**observable fidelity plus fail-safe processing**. The definition is in
the architecture amendment ("Fidelity acceptance model"). An explicit
wrong label is still a semantic disagreement with the frozen oracle.
`Obelisco → PASS_BY` at `a-012` is a `SEMANTIC_FIDELITY_ERROR`. It is no
longer equivalent to "Obelisco silently omitted", and it is reported
differently.

### A.1 Source-noise boundary

**Root cause.** The SOB `SECTION_UNIT` is the page's walk section. It
ends at the next heading of the same or a shallower level, and the page
has none. The unit therefore runs to the end of the extracted markdown
and includes the page tail:

- tags, author box and social links (`a-110`..`a-121`);
- "Related Posts" (`a-122`..`a-130`);
- the comment form (`a-131`);
- two copies of the header menu, plus the full site menu
  (`a-132`..`a-182`).

`a-172` "+ [Best hotels in San Telmo](…)" is one item of that menu. v5
SOB run 5 labelled it `ITINERARY_STOP` San Telmo, which opened the
return segment with a one-member mandatory set. Tavily extract and
Cloudflare browser-rendering both return markdown, so no DOM role,
`<nav>` or article subtree survives. The structural evidence that does
survive is link density.

**Generic fix (`editorial-structure-v1`).** `markEditorialStructure`
runs before batching:

- An atom is *link-only* when every letter or number lies inside a
  markdown link or image construct, after a list or heading marker.
- A run of at least 3 consecutive link-only atoms is a
  `NAVIGATION_BLOCK`. Its atoms are marked `editorial: false`.

These atoms keep their IDs, offsets and text. They get a structural
`NON_EDITORIAL` label, which goes through the same exactly-once merge
check. They are never presented to the model, and a model label on one is
`UNKNOWN_ATOM`. A lone link-only atom ("Read more about La Boca") and a
prose line that contains a link ("**[Visit La Bombonera](…)**, the
stadium…") stay editorial. No word list is involved.

**Regression evidence.**

- SOB blocks: `a-118..a-121`, `a-123..a-130` and `a-132..a-182`
  (63 atoms, `a-172` in `nav-3`). AG: `a-084..a-088` (comment count,
  share icons, label link).
- Every atom that carries an oracle-mandatory wording stays editorial
  (deterministic test). So do the last walk prose (`a-104`, `a-105`,
  `a-109`) and the author note.
- Recorded v5 SOB run 5, replayed offline: San Telmo is no longer
  mandatory and recall stays 8/8 and 2/2. Run 4's San Telmo still
  comes from `a-041`, a prose atom ("special character to San Telmo").
  That is a visible semantic error, not chrome.
- Live SOB run 1: `a-172` is `NON_EDITORIAL`; ASSEMBLED, 8/8 and 2/2,
  with no route or area promoted.

Known limit: an itinerary written only as three or more consecutive bare
links, with no prose, would be marked non-editorial. It stays visible in
the trace (`nonEditorialBlocks`), never silent.

### A.2 Anaphora contract

**Before.** A `mentionAtomId` entity was accepted when its `sourceName`
was found anywhere in the cited atom's text. That rule had two defects:

- A valid anaphor failed closed. In `a-078` "enjoy the park", the
  sourceName "park" is not in `a-077` ("Parque Lezama"). This caused
  3/10 v5 fail-closed units.
- A partial word was accepted silently and created a duplicate member.
  "This Plaza" cited `a-020` ("Plaza de Mayo"), which minted a separate
  mandatory "Plaza". "Catedral" was minted next to "Catedral
  Metropolitana" the same way.

**Now.** Every mention is a reference to an entity that the cited atom
carries. The LLM names the antecedent; code verifies the explicit
reference:

1. The cited atom must exist, precede this atom, be editorial, and have
   been presented in the same request (LABEL or CONTEXT). Otherwise:
   `BAD_MENTION_ATOM`.
2. The surface form must be written either in this atom's span
   (`surfaceIn: SPAN`, "enjoy the park") or in the cited atom
   (`surfaceIn: MENTION_ATOM`, zero anaphora: "Jump inside.").
   Otherwise: `NAME_NOT_IN_MENTION_ATOM`.
3. `resolveMentions` runs at unit level after the batches merge, in source
   order, and again after the relabel round. It picks the cited atom's
   entity with the exact canonical name. Failing that, it picks the only
   entity whose name contains the surface form as whole words. Failing
   that, it picks the cited atom's only entity. Otherwise the unit fails
   closed with `MENTION_ANTECEDENT_AMBIGUOUS` or
   `MENTION_ANTECEDENT_MISSING`.

   An unresolved anaphor is never a candidate, and a chain resolves hop
   by hop. `assemble` refuses any unresolved anaphor.
4. A resolved entity takes the antecedent's canonical `sourceName`. It
   keeps its own `supportSpan` and offsets, and adds `mention` (the
   antecedent span offsets) and `anaphor` (`surfaceForm`, `surfaceIn`,
   `antecedent`).

There is no pronoun or noun heuristic. Whole-word containment is the
same containment the contract already used, scoped to the cited atom's
entities instead of its whole text.

**Regression evidence.**

- Recorded v5 SOB runs 2, 4 and 5 (the three `NAME_NOT_IN_MENTION_ATOM
  a-078` fail-closed units) replay as ASSEMBLED. The first-pass answer
  cited `a-073` "you will see Parque Lezama", whose only entity is
  Parque Lezama, so "park" resolves to it.
- The recorded relabel answer cited `a-077` instead, which carries
  Parque Lezama **and** Defensa. That is correctly
  `MENTION_ANTECEDENT_AMBIGUOUS` (deterministic test).
- AG "Plaza" → Plaza de Mayo and SOB "Catedral" → Catedral
  Metropolitana now merge into the canonical member instead of
  duplicating it.
- Live SOB run 1: `a-078` resolved to Parque Lezama through `a-073`.

### A.3 Batching

- **Settings.** Batches of 2500 presented chars and 4 context atoms
  (`DEFAULT_MAX_BATCH_CHARS`) are kept, with no evidence for a better
  structural bound. Excluding non-editorial atoms shrinks SOB from 5
  batches (34/38/39/54/17 atoms) to 4 (34/38/39/8) and AG from
  23/20/20/19/13 to 23/20/20/19/8. The 25 s Gemini timeout is unchanged.
- **Deterministic guarantees** (`labelUnit` tests):
  - global atom IDs survive batching;
  - the model is asked about exactly the editorial atoms, once each;
  - the union with the structural labels covers every atom exactly once;
  - there is at most one relabel round, and a second invalid answer fails
    closed;
  - a malformed response is not repairable;
  - a `TransportFailure` in a batch or in the relabel is `INVALID_RUN`
    with `{kind, batchIndex}`, never a contract or semantic outcome;
  - a programming error is not masked as `INVALID_RUN`.
- **Live timing** (`runs/a1a2-regression-*`, per-call `elapsedMs` in
  `*.wire.json`):
  - AG: 5 batches in 2.3–6.4 s, one relabel in 16.0 s.
  - SOB run 1: 10.8, 32.9, 14.0 and 12.3 s. The 32.9 s call is one
    25 s provider timeout plus the provider's own internal retry.
  - SOB run 2: `INVALID_RUN`, because batch 1 (34 atoms, 7107 prompt
    chars) timed out twice.
  - Batching is operationally viable, but SOB latency sits near the
    timeout. That is an operational risk for B (measure, then decide on
    an explicit atom-labelling timeout or a smaller bound), not a
    semantic one.

### Small regression replay (live, 2026-10-06)

Purpose, as authorized: verify that source trimming removed no mandatory
content, that the known anaphora case no longer fails closed, and that
atom accounting holds. It is not a gate and not a basis for prompt
changes. The prompt is byte-identical to v4/v5.

| Unit | Run | Outcome | Notes |
|---|---|---|---|
| SOB | 1 | ASSEMBLED, first pass valid | S1 8/8, S2 2/2. `a-172` NON_EDITORIAL. `a-078` → Parque Lezama via `a-073`. No route or area promoted. |
| SOB | 2 | INVALID_RUN | batch 1 timed out twice (operational) |
| AG | 1 | ASSEMBLED after relabelling 1 atom (`a-072`) | S1 9/9 (Obelisco a stop at `a-012`), S2 1/1, S3 1/1. Visible semantic disagreements: Defensa (oracle ACCEPTABLE) and La Boca at `a-043` (an "eat in La Boca" option labelled `ITINERARY_STOP` inside an `ALTERNATIVE` atom). |
| RW3_EV3 | 1 | ASSEMBLED | 4/4 |
| ROUTE_EXPERIENCE | 1 | ASSEMBLED | 3/3. Mill Street not mandatory. |

Offline counterfactual over all 16 recorded v5 units
(`runs/counterfactual-a1-a2.md`): 16/16 ASSEMBLED, against 13/16 recorded,
with oracle recall identical to the recorded runs in every unit and 0
alternatives promoted.

### Remaining semantic disagreements (visible, not silent)

- **Obelisco `a-012`:** `PASS_BY` in 3/5 v5 AG runs; `ITINERARY_STOP`
  in the live run.
- **Avenida Caseros `a-082`/`a-084`:** mandatory in 3/5 v5 SOB runs
  (oracle ACCEPTABLE).
- **San Telmo `a-041`:** SOB v5 run 4.
- **La Boca `a-043`:** AG live run.
- **Defensa:** promoted to mandatory in every recorded v5 AG run and in
  the live AG run (oracle ACCEPTABLE). The source frames walking it as the
  activity of that section (`a-026` heading).
- **Generic descriptions:** "oldest neighborhood of the capital city",
  "big building with columns".

Each one is an explicit label on a named atom, in the trace, with its
`supportSpan`. A reviewer can say "atom `a-012` was labelled `PASS_BY`"
and nothing else. None of them is an omission. Downstream, a wrong
`ITINERARY_STOP` still has to pass identity and the all-components rule.
Those gates are unchanged, and a rejection there is reported as
`FIDELITY_PASS_IDENTITY_BLOCKED`, not as an extraction loss.

### Structural readiness for B

| # | Property | Result | Evidence |
|---|---|---|---|
| 1 | Full atom accounting | PASS | 0 missing, duplicate or unknown atoms in every valid run; structural labels merge under the same exactly-once check |
| 2 | No silent mandatory loss | PASS | every oracle-mandatory item has an atom decision in every valid run; `STOP_WITHOUT_ENTITY` and the mention issues fail closed |
| 3 | Deterministic ordering | PASS | order = atom order, then span (tests 7/11/12) |
| 4 | Deterministic segment assembly | PASS | 0 mixing and 0 missed boundaries in v5, counterfactual and live runs |
| 5 | Transfer destination never membership | PASS | R1 `TRANSFER_DESTINATION` (test); Puerto Madero 0/5 |
| 6 | Alternatives not promoted | PASS | 0 `ALTERNATIVE_PROMOTED` (v5, counterfactual, live) |
| 7 | Chrome does not create membership (frozen regression) | PASS | `a-172` NON_EDITORIAL (test + live) |
| 8 | Valid anaphora does not fail closed unnecessarily | PASS | `a-078` resolves (recorded replay, test, live); ambiguous references still fail closed |
| 9 | Batching operationally viable | PASS, with risk | 2500-char batches; 1/5 live units INVALID_RUN on the 25 s timeout. To measure in B. |
| 10 | Semantic disagreements traceable | PASS | per-atom label, entity role, span and anaphor in `unitTrace` |

Recommendation: **READY_FOR_B**. B is not started and needs a separate
owner authorization.
