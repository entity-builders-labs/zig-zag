# Experience dedupe semantic-overlap threshold (0.58): forensic (2026-10-08)

Track `preference-first-selection`, HEAD `ede4f10c`. This is a read-only
investigation of the open item in
`../partial-composite-implementation-2026-10-08/README.md` §7, where a later
COMPLETE A-B was held AMBIGUOUS against an identically described PARTIAL A-F.

No production code, test expectation or threshold was changed. C3 was not run
and no live provider was called. The only executions were the existing
unit, characterization and integration suites (integration against
`zigzag_test`), each run with a read-only probe that wraps
`decideExperienceDedupe` and logs its real inputs and outputs. Pure
counterfactual calls to the same unmodified functions were also run. The
scripts are in `probe/`, and the per-call matrix is in
`corpus-threshold-matrix.tsv`.

**Verdict: `DEDUPE_MODEL_MISSING_STRUCTURAL_AUTHORITY`**, with
**`NO_EVIDENCE_FOUND_FOR_0_58`**. See §12.

---

## 1. Exact dedupe decision flow

There is one dedupe authority: `decideExperienceDedupe` in
`be/src/modules/tours/utils/experience-dedupe.util.ts`. Its only production
caller is `ExperienceCatalogService.persistVerifiedExperience`
(`be/src/modules/tours/services/experience-catalog.service.ts:1634`).

```text
ExperienceProposalResolverService (resolver.service.ts ~L690)
  └─ catalog.persistVerifiedExperience(input)               catalog.service.ts:1634
       1. decideSourceCompositionAdmission (COMPLETE | PARTIAL, else throw)
       2. advisory locks: experience:name:<lower name>, experience:component:<id>
       3. RETRIEVAL (Postgres, L1680-1700):
            status = VERIFIED AND (
              canonicalName equals input.canonicalName (case-insensitive)
              OR any component.geoEntityId IN distinct resolved ids )
            take 50 (no ORDER BY)
       4. fingerprints (L1702-1750)
            incoming.semanticTerms = semanticTerms(description, metadata, [])
            existing.semanticTerms = semanticTerms(description, metadata,
                                       [trait.label, trait.key, "dim:key"]...)
            conceptTerms = metadata.themes + metadata.intents (both sides)
       5. decideExperienceDedupe(incoming, existing)        dedupe.util.ts:103
            a. compareFingerprints per candidate (L252)
            b. rank by evidenceScore (L413):
                 0.22·name + 0.20·semantic + 0.15·component
                 + 0.30·roleAware + 0.05·provenance + distanceBonus
            c. SAME if best satisfies (L177-190):
                 exactStructure = roleAware===1 && component===1
                                  && (name===1 || concept===1) && !orderConflict
               OR strongConsistentIdentity = name>=0.86 && semantic>=0.72
                                  && roleAware>=0.8 && dist<=1.5km|null && !orderConflict
            d. else AMBIGUOUS if ANY ranked candidate satisfies (L204-226):
                 name >= 0.72
                 || semantic >= 0.58                     <-- the rule under review
                 || (!standaloneComposite && (component>=0.5 || roleAware>=0.4))
            e. else NEW ("insufficient_identity_overlap")
       6. AMBIGUOUS → returns {dedupeDecision: AMBIGUOUS}; no row written (L1752)
  └─ resolver: AMBIGUOUS → candidate status 'rejected', ['AMBIGUOUS_DEDUPE']
       (resolver.service.ts:722); recorded only in the trace
       (component-resolution-facts.util.ts:386). Nothing persists the
       ambiguity for later resolution.
```

Every occurrence of the semantic threshold family:

| Location | Constant | Stage | Effect |
| --- | --- | --- | --- |
| `dedupe.util.ts:221` | `semanticSimilarity >= 0.58` (inline literal, no name) | identity decision | sufficient **alone** for AMBIGUOUS |
| `dedupe.util.ts:306` | `>= 0.58` | evidence reasons | `partial_semantic_overlap` reason label only |
| `dedupe.util.ts:185` | `semanticSimilarity >= 0.72` | identity decision | one of four conjuncts of `strongConsistentIdentity` (SAME) |
| `dedupe.util.ts:305` | `>= 0.72` | evidence reasons | `strong_semantic_overlap` label only |
| `dedupe.util.ts:424` | weight `0.2` | ranking of retrieved candidates | chooses the `best` candidate that the SAME tests examine |

None of these are named constants, and none has a comment or spec reference.
The long comment at L126-176 justifies only `exactStructure`. Semantic
similarity is **not** used in retrieval (step 3).

## 2. The "semantic overlap" formula

"Semantic" here means lexical bag-of-words overlap. It has nothing to do with
embeddings (`dedupe.util.ts:260, 432, 478, 512`).

```text
tokens(fp) = set( normalize(s).split(' ') for s in [canonicalName, ...semanticTerms] )
normalize  = NFKD, strip diacritics, lowercase, [^a-z0-9]+ → ' '
semanticTerms (catalog.service.ts:1914) =
    description, metadata.themes[], metadata.traits[],
    metadata.intents[] (or archetypes[]), relationalTraits[]
relationalTraits = []                              for the INCOMING side
                 = trait.label, trait.key, "dimension:key" for each persisted
                   ExperienceTrait row                  for EXISTING candidates
setOverlap(A,B) = |A ∩ B| / max(|A|, |B|)   (empty/empty = 1, one empty = 0)
```

| Input | Used? |
| --- | --- |
| canonicalName | **yes**: tokens counted here *and* separately in `nameSimilarity`, so the name is counted twice |
| description | yes, all tokens including stopwords (`an`, `the`, `de` …) |
| themes / intents | yes, and also in `conceptOverlap` |
| metadata.traits | yes |
| relational trait rows | **existing side only** (asymmetric, see §11) |
| embeddings | no |
| component names, source composition, GeoEntities | no |
| source URL / title | no |

## 3. Origin of 0.58

| Commit | Date | Content |
| --- | --- | --- |
| `57d2dfcf` | 2026-09-02 | `feat(v2): add conservative explainable experience dedupe`. Name/component thresholds (0.92, 0.72, 0.5, 0.4) arrive with no semantic signal. Subject only, 1 file, no tests. |
| `baba7da0` | 2026-09-02 (16 min later) | `fix(v2): include semantic identity in dedupe evidence`. Adds `semanticTerms`, `semanticSimilarity`, `>= 0.58` (AMBIGUOUS) and `>= 0.72` (SAME). Subject only, no body, 1 file, **no tests, no spec reference**. |
| `8bd16b97` | 2026-10-08 | Moves the line; value unchanged. |

Searched: `git log -S`, every `docs/` spec, plan, ADR and progress file, and
every `spikes/` README and trace. Nothing names the value. There is no
dataset, no positive or negative case set, no metric and no error tradeoff.
The only hit for `0.58` in `docs/` is a CSS animation delay in
`docs/presentations/zigzag-interactive/index.html`.

Later canonical text endorses the *role* in words but never the value:

- The v2 plan (`plans/2026-09-01-experience-domain-v2…md`, "Experience
  dedupe") lists "semantic identity" among strong signals. The same section
  says: *"Do NOT use title, description, … or most traits/themes as identity
  by themselves."*
- The identity spec (`specs/2026-09-12-experience-identity-dedupe-and-diversity-design.md`)
  §3 says themes/intents/traits "must never independently establish
  identity". Invariant 8 says "Semantic similarity alone cannot force SAME".
  §6.1, added in `d6f06034` on 2026-09-25, says *"independent identity signals
  such as name/semantic evidence may still make the pair AMBIGUOUS"*. The
  recovery plan states that this correction "does not change … any numeric
  threshold".
- The recovery plan's milestone gate marks "Semantic similarity
  ranking-only" PASS because *"dedupe 'semanticSimilarity' is token overlap;
  no embedding in identity"*. The gate resolved a naming collision; it did
  not validate the rule.

**Classification: `ARBITRARY_HEURISTIC`.** The role (semantic evidence may
cause AMBIGUOUS) was later ratified as qualitative policy in §6.1. The number
was never calibrated.

**`NO_EVIDENCE_FOUND_FOR_0_58`.**

## 4. Evidence for or against the threshold

- **Test corpus.** The probe captured 182 real `decideExperienceDedupe`
  calls: 29 unit, 16 characterization and 137 integration. Replaying them
  reproduces 182/182 decisions.
- **Load-bearing cases.** The `semantic >= 0.58` disjunct is the *sole*
  cause of AMBIGUOUS in exactly **one** call: the A-F/A-B integration
  fixture. Of the 20 AMBIGUOUS decisions, by firing clauses: struct 5,
  name+sem 6, name+sem+struct 4, name 1, name+struct 1, sem+struct 2,
  **sem 1**.
- **SAME branch.** All 65 SAME decisions come from `exactStructure`.
  `strongConsistentIdentity`, the only SAME branch that reads semantic
  similarity, is never the deciding branch in any test.
- **Live traces.** 114 spike JSON files contain the token
  `semanticSimilarity`. They yield 4 unique dedupe evidence records, from
  RW3 final, RW4 campaign and post-dedupe confirmation. All 4 are AMBIGUOUS
  by structure, with semantic between 0.21 and 0.46. The semantic clause has
  **never fired live**. Caveat: traces record evidence only for rejected
  candidates, so live NEW/SAME pairs are not observable.

The threshold carries almost no weight in the corpus, and the corpus contains
no case that validates it.

## 5. Retrieval vs identity

| Responsibility | Implemented by | Semantic involved? |
| --- | --- | --- |
| Candidate retrieval: "worth comparing" | Postgres query: exact name OR any shared resolved GeoEntity (catalog.service.ts:1680) | **No** |
| Candidate ranking: "which one to test for SAME" | `evidenceScore` | yes, weight 0.20 |
| Identity → SAME | `exactStructure` / `strongConsistentIdentity` | only in the second, which never decides |
| Identity → AMBIGUOUS (fail-closed reject) | the disjunction at L219 | **yes, alone sufficient** |

The architecture does not separate these jobs. The v2 plan intended
semantic/vector *retrieval* ("Retrieve possible duplicates using … shared
GeoEntities and/or vector similarity"), but that was never built. The lexical
"semantic" score instead acts as an identity escalator inside the decision
step.

Similarity crosses into identity authority at `dedupe.util.ts:221`. A pair
nominated only because it shares one resolved GeoEntity becomes AMBIGUOUS,
and the incoming Experience is rejected, solely on bag-of-words overlap of
name + description + themes + intents + traits. Retrieval does bound the
damage: two pairs with disjoint stops and different names are never compared
(counterfactual F7 would be AMBIGUOUS if they were).

## 6. Structural evidence inventory (composite vs composite)

| Signal | Where it lives | Classification |
| --- | --- | --- |
| Source-defined member count | `components.length` | only as the `max(|A|,|B|)` denominator. USED_FOR_SAME (===1 forces equal counts) and USED_FOR_AMBIGUOUS (ratio) |
| Distinct resolved count | `distinctResolvedGeoEntityIds` | USED_FOR_DISTINCT: the standalone (1) vs composite (>1) check neutralizes structural AMBIGUOUS |
| Source member names, unresolved | `source:<normalized sourceName>` key | USED_FOR_SAME, USED_FOR_AMBIGUOUS |
| Source member names, resolved | `ExperienceComponent.sourceName` | AVAILABLE_BUT_UNUSED |
| Source order (`order`) | ExperienceComponent.order | USED_FOR_AMBIGUOUS only through `orderConflict`, which blocks SAME |
| Source position / contiguity | `sourcePosition` (persisted only; not in the incoming fingerprint) | AVAILABLE_BUT_UNUSED / NOT_AVAILABLE as a signal |
| Resolved GeoEntity identities | `geo:<id>` keys | USED_FOR_SAME, USED_FOR_AMBIGUOUS, and the sole structural retrieval key |
| Unresolved members | source-wording keys | USED_FOR_SAME, USED_FOR_AMBIGUOUS; not retrieval |
| Provenance (`evidence.source`, e.g. `web`) | ExperienceEvidence.source | ranking weight 0.05 and a reason label; no decision. AVAILABLE_BUT_UNUSED for identity |
| Source URL / document title | ExperienceEvidence.url/title | AVAILABLE_BUT_UNUSED; used only as the evidence-merge key after SAME |
| Component containment (A ⊆ B) | none | NOT_AVAILABLE |
| Exact source-composition equality | `component===1 && roleAware===1` | USED_FOR_SAME, but also requires name===1 or concept===1 |
| Subset / superset relation | none | NOT_AVAILABLE: `|∩|/max` gives the same score for "A-B ⊂ A-F" and "A-B shares 2 of 6 scattered members" |
| Completeness (PARTIAL/COMPLETE) | derived from member states | AVAILABLE_BUT_UNUSED directly; implicit through member keys |
| Geographic scope | Experience lat/lon only; AREA scope not persisted on Experience | lat/lon: USED_FOR_SAME in the strong branch, and ranking. Scope: NOT_AVAILABLE; retrieval is not scope-bounded |
| Route/area structure | `role` | USED (roleAware). Route geometry NOT_AVAILABLE |
| `required`, `resolutionReason`, `resolutionSource` | ExperienceComponent | AVAILABLE_BUT_UNUSED |
| Composition fingerprint / hash | none | NOT_AVAILABLE |
| Embedding | Experience.embedding | AVAILABLE_BUT_UNUSED, deliberately: ranking-only invariant 15 |

## 7. Containment / sub-composition semantics

The contract is `SAME | NEW | AMBIGUOUS` (`DedupeDecision`, L87). It cannot
represent CONTAINS, SUBCOMPOSITION or OVERLAPS. The identity spec states the
need without giving it a representation. §8: *"Walk A (Plaza Dorrego +
Mercado + El Zanjón) / Walk B (+ Pasaje Defensa) — if they are evidence-backed
distinct Experiences, they remain separate catalog rows"*. Under the current
rule that exact pair gives `componentOverlap = 3/4 ≥ 0.5`, so it is AMBIGUOUS
regardless of text. No test covers it.

The input side lacks the evidence as well. The overlap metric measures size
ratio, not containment. Nothing records whether the smaller composition is a
contiguous, same-ordered sub-sequence of the larger, or whether both come
from the same source document. **The three-way result is not expressive
enough** to tell "two different Experiences", "a route containing a smaller
Experience" and "the same Experience at different granularity" apart. Today
all three collapse to whichever of NEW or AMBIGUOUS the numeric cuts produce.
(Per scope, no new enum is proposed.)

## 8. Historical corpus matrix (composite vs composite, deduplicated)

`n` = name, `s` = semantic, `c` = component, `k` = concept overlap. "Fires"
lists the AMBIGUOUS clauses that are true.

| Shape | Case (suite) | n / s / c / k | Decision | Fires |
| --- | --- | --- | --- | --- |
| superset | later A-B vs identically described PARTIAL A-F (isolation, integ) | .43 / **.67** / .33 / 1 | AMBIGUOUS | **sem only** |
| superset | D7: independently described A-B vs PARTIAL A-F (integ) | .43 / .25 / .33 / 0 | NEW | — |
| superset | A-B vs PARTIAL A-F, unrelated names (unit) | .33 / .40 / .33 / 0 | NEW | — |
| superset | A-B vs A-F with unresolved dropped (unit characterization, old shape) | .33 / .40 / .50 / 0 | AMBIGUOUS | struct |
| superset | PARTIAL A-F vs COMPLETE A-B, identical name (unit) | 1 / 1 / .33 / 1 | AMBIGUOUS | name+sem |
| equal set, different text | Craft Beer Crawl vs Historical Walking Tour (integ) | 0 / .48 / 1 / 0 | AMBIGUOUS | struct |
| equal set, different text | Food Walk vs Historical Walk (integ) | .60 / **.57** / 1 / 0 | AMBIGUOUS | struct |
| equal set, different text | Evening vs Morning Walk (integ) | .60 / .67 / 1 / 0 | AMBIGUOUS | sem+struct |
| equal set, different text | Architecture vs Historical Walk (integ) | .60 / .65 / 1 / .5 | AMBIGUOUS | sem+struct |
| equal set, reworded | Case 1 "Historical Walk through…" vs "…Walking Tour" (integ) | .43 / .46–.67 / 1 / 1 | SAME | exact_structure |
| equal set, reworded, k=.5 | round-3 correction (integ) | .43 / .55 / 1 / .5 | AMBIGUOUS | struct |
| equal set, reversed order | conflicting evidenced order (integ) | 1 / 1 / 1 / 1 | AMBIGUOUS | all |
| partial overlap | Case 3 "San Telmo Walk" vs "…Historical Walk" (integ) | .75 / .57–.86 / .75 / 1 | AMBIGUOUS | name(+sem)+struct |
| partial overlap | Case 2 Immigration vs Colonial Architecture (integ) | .20 / .33–.42 / .25–.33 / 1 | NEW | — |
| partial overlap | Case 2b identical title, different stops (integ) | 1 / .37 / .25 / 1 | AMBIGUOUS | name only |
| partial overlap | "Ruta del vino premium" false friends (unit, catalog spec) | .86 / .86 / .33 / 0 | AMBIGUOUS | name+sem |
| partial overlap | Harbor Circuit vs Mountain Passage (unit) | 0 / 0 / .50 / 0 | AMBIGUOUS | struct |
| disjoint | Palermo parks vs Recoleta; two unrelated PARTIALs (unit) | 0 / 0 / 0 / 0 | NEW | — |
| equal | identical name + set, incl. same PARTIAL twice (unit, integ) | 1 / 1 / 1 / ≥0 | SAME | exact_structure |

The corpus has **no** composite-vs-composite case of "same description,
different composition" except the fixture under review. It also has no
spec-§8 superset case (3 ⊂ 4), and no live composite-vs-composite pair below
the structural cuts. Any accepted case whose decision would change under a
different semantic authority would show up as a flip in §9. Only the fixture
flips.

## 9. Threshold sensitivity (all 182 corpus calls, every other rule unchanged)

| T | SAME | AMBIGUOUS | NEW | Cases differing from T=0.58 |
| --- | --- | --- | --- | --- |
| 0.40 | 65 | 22 | 95 | +2 AMBIGUOUS: unit "A-B after PARTIAL A-F, unrelated names" (s=.40), integ **Case 2** NEW-preservation (s=.417) |
| 0.50 | 65 | 20 | 97 | — |
| 0.55 | 65 | 20 | 97 | — |
| **0.58** | 65 | 20 | 97 | baseline |
| 0.60 | 65 | 20 | 97 | — |
| 0.65 | 65 | 20 | 97 | — |
| 0.70 | 65 | 19 | 98 | −1: the A-F/A-B fixture (s=.667) becomes NEW |
| 0.80 | 65 | 19 | 98 | same |
| removed | 65 | 19 | 98 | same |

The corpus is **not** highly sensitive, because structure or name almost
always decides first. Sparsity is the real finding: there are no data
between 0.42 and 0.67 that the threshold actually separates. Two realistic
pairs sit right under the cut (Food vs Historical .57, Case 3b .57). They are
saved only by structure. Lowering the cut to 0.40 would break an accepted
spec Case 2 (NEW-preservation). The number sits in an empty region of an
untested space.

The counterfactuals in `probe/counterfactual.ts` (real functions, synthetic
inputs) show how much the decision depends on the text rather than the
structure:

| Probe | s | Decision |
| --- | --- | --- |
| F0 fixture | .667 | AMBIGUOUS |
| F1 drop description both sides | .500 | NEW |
| F2 drop themes/intents | .636 | AMBIGUOUS |
| F4 entirely different names, same description | .667 | AMBIGUOUS |
| F5 A-F COMPLETE instead of PARTIAL | .667 | AMBIGUOUS |
| F6 reverse direction | .667 | AMBIGUOUS |
| F7 disjoint stops, identical text (not retrievable in production unless names are equal) | .667 | AMBIGUOUS |
| C1 spec Case-2 walks (Immigration vs Colonial, 1/4 shared stop) sharing only a generic description | **.833** | **AMBIGUOUS** |

C1 shows that the accepted Case-2 NEW outcome holds only because the fixture
descriptions differ. Two genuinely distinct walks with a templated
description (common in LLM extraction) would be rejected.

## 10. A-F vs A-B forensic (integration fixture)

`test/integration/tour-generation/partial-composite-isolation.integration-spec.ts:272`

| | Existing PARTIAL A-F | Incoming COMPLETE A-B |
| --- | --- | --- |
| canonicalName | `Walk A-B-C-D-E-F` | `Walk A-B` |
| members (pos, source, state) | 0 Stop A R, 1 Stop B R, 2 Stop C **U**, 3 Stop D R, 4 Stop E **U**, 5 Stop F R | Stop A R, Stop B R |
| resolved GeoEntities | A, B, D, F (A, B reused, the same ids) | A, B |
| unresolved | C, E (missing knowledge) | none |
| role / order | waypoint, 1..6 | waypoint, 1..2 |
| description | `An evidenced San Telmo walk` | identical |
| themes / intents / traits | history / walk / [] | identical |
| evidence | `{source: web, title: "San Telmo walk", no url}` | identical (same fixture helper) |
| lat/lon | null | null |

Semantic tokens:
- incoming = {walk, a, b, an, evidenced, san, telmo, history} (8)
- existing = {walk, a, b, c, d, e, f, an, evidenced, san, telmo, history} (12)
- ∩ = 8, so **s = 8/12 = 0.667**

Contributions: the description adds {an, evidenced, san, telmo}, themes add
{history}, and the name adds {walk, a, b} plus six stop letters on the
existing side. The letters dilute the score: with neutral names, s would be
1.0.

| Signal | Value | Branch result |
| --- | --- | --- |
| nameSimilarity | 3/7 = .429 | < .72, < .86 |
| semanticSimilarity | .667 | **≥ .58 → AMBIGUOUS**; < .72 |
| componentOverlap | {geo:A, geo:B} vs 6 keys = 2/6 = .333 | < .5 |
| roleAwareComponentOverlap | .333 | < .4 |
| conceptOverlap | 1 | relevant only to exactStructure, which fails on component≠1 |
| provenanceOverlap | 1 (`web` = `web`) | ranking only |
| orderConflict | false (A<B on both sides) | — |
| standaloneComposite | false (2 vs 4 resolved) | structural clause stays live but is false |
| exactStructure / strong | false / false | no SAME |

Exact branch: `dedupe.util.ts:221` (`evidence.semanticSimilarity >= 0.58`).
Reasons: `partial_semantic_overlap, shared_geo_entities,
shared_role_aware_components, shared_provenance, shared_concept_evidence,
identity_signals_conflict_or_are_incomplete`.

**Evidence that the two may be the same Experience:**
- identical description, themes and intents; same evidence channel and
  title;
- A and B in the same relative order;
- A-B is an ordered prefix of A-F. The model does not measure this; it is
  read off the raw rows.

Every textual item here is a test artifact: one `walk()` helper produces both
texts. The prefix relationship is real structure, but the dedupe never reads
it.

**Evidence that they are distinct or containment-related:**
- different source-declared member counts (2 vs 6);
- four A-F members (C, D, E, F) are absent from A-B;
- different names;
- owner decision D7: a PARTIAL is never SAME with, nor promoted by, a
  smaller composition.

Nothing distinguishes "distinct" from "contained": no source URL is
compared, no containment signal exists, and no concept difference is
present.

**No policy decision is supported by the evidence.** The fixture cannot
separate identity from containment, and the model cannot represent
containment.

## 11. Risks

**Retaining semantic → AMBIGUOUS authority as is:**
- Rejection is fail-closed and permanent for the run. AMBIGUOUS is kept only
  in the trace, despite spec §6's "retain the ambiguity … for future
  resolution".
- Generic or templated descriptions turn distinct composites into AMBIGUOUS
  (C1 contradicts the spirit of spec Case 2 and §7).
- It conflicts with the v2 plan rule "do not use title, description, …
  themes as identity by themselves", and with spec §3 (themes/intents/traits
  never independently establish identity). Note that spec §6.1 explicitly
  allows "name/semantic evidence" to produce AMBIGUOUS; the two canonical
  texts are in tension.
- **Persistence-order dependence** (invariant 11, "Provider ordering must not
  change the final identity decision"): trait-row tokens are added only on
  the existing side. In probe O1/O2, the same pair scores .500 (NEW) when the
  trait-bearing Experience was persisted first, and .857 (AMBIGUOUS) in the
  other order. This was shown with synthetic inputs on the real function; it
  has not been observed live.
- The name is counted twice (in `nameSimilarity` and in the semantic
  tokens). Stopwords count. `|∩|/max` penalizes longer descriptions.

**Removing it from AMBIGUOUS (or raising it past ~.70):**
- The corpus impact is one flip (the fixture becomes NEW). No accepted case
  regresses.
- Real-world recall loss is **unmeasured**. No live or corpus case shows
  semantic catching a true duplicate that name and structure miss, but the
  live sample is tiny (4 records, rejected candidates only).
- A-B would then become a confident NEW with no positive distinctness
  evidence. Spec §6 forbids "a confident NEW identity merely to avoid the
  ambiguity". For identically described sources, nothing in the model can
  say whether NEW is right.
- `strongConsistentIdentity` would still read the same lexical score at .72,
  so the issue would only move.

**Demoting it to retrieval-only:**
- Retrieval does not use semantic today. Demotion means designing a new
  retrieval channel (the unbuilt v2 "vector similarity" path). That widens
  the compared set, where the name and structure clauses could create *new*
  AMBIGUOUS results.
- It requires a spec amendment of §6.1.
- On its own it does not address the missing containment or source-document
  evidence, so the A-F/A-B question stays undecidable.

## 12. Recommendation

**`DEDUPE_MODEL_MISSING_STRUCTURAL_AUTHORITY`**

- `SEMANTIC_THRESHOLD_JUSTIFIED`: rejected. There is no calibration or
  rationale, the commit is subject-only, the input is a lexical token bag, and
  the score is order-dependent through trait asymmetry.
- `SEMANTIC_THRESHOLD_RETRIEVAL_ONLY`: the principle "similarity nominates,
  it does not decide" is consistent with the v2 plan, spec §3 and invariant
  1. It contradicts spec §6.1 as written, and the code does not separate
  retrieval from decision. It is a plausible direction, but by itself it only
  trades a false AMBIGUOUS for an unproven NEW.
- The root gap is structural. The dedupe sees members as an unordered set
  scored by `|∩|/max`. It cannot express or detect containment, sub-sequence
  or ordered-prefix relations, or same source document (URL/title are
  persisted but unused). Its output contract has no containment
  relationship. The semantic token bag fills that gap by accident: it is the
  only signal left to differentiate pairs whose structure the model cannot
  describe.

Architectural debt recorded (no fix proposed, per scope):
1. Lexical "semantic" score has unscoped identity authority at
   `dedupe.util.ts:221` (and `:185`), with no calibrated basis.
2. Retrieval vs identity are not separated as responsibilities.
3. No containment / sub-composition evidence or result.
4. Source-document identity (`ExperienceEvidence.url/title`) is unused.
5. `semanticTerms` input asymmetry: existing-side trait rows can make the
   decision depend on persistence order.
6. The AMBIGUOUS outcome is not retained for future resolution, contrary to
   spec §6.
7. The same lack of provenance applies to the sibling cuts (`name >= .72`,
   `>= .86`, `component >= .5`, `roleAware >= .4`): they come from
   `57d2dfcf` and `baba7da0` with no evidence. This investigation did not
   cover them.

The owner decisions this needs: whether §6.1's "name/semantic evidence may
make the pair AMBIGUOUS" stays canonical, and what structural evidence
(containment, source document) should decide a sub-composition. Until then
the A-F/A-B expectation stays as implemented and flagged.

## Verification actually run

| Command | Result |
| --- | --- |
| `npx jest` (unit, with the probe) | 202/202 suites, 2866/2866 tests |
| characterization on `zigzag_test` (with the probe) | 35/36. The one failure, `CHAR-7 A vs [B] … AMBIGUOUS`, reproduces **without** the probe: a pre-existing stale expectation (standalone vs composite, superseded by spec §6.1 / `d6f06034`); not touched |
| `test:integration` on `zigzag_test` (with the probe) | 26/26 suites, 123/123 tests |
| offline replay of 182 captured calls | 182/182 identical decisions at 0.58 |
| live spike traces scanned | 114 JSON files, 4 unique dedupe evidence records |

Reproduce: run any jest config with
`--setupFilesAfterEnv probe/dedupe-probe.setup.js` and
`DEDUPE_PROBE_OUT=<dir>/{unit,char,integ}.jsonl`, then
`node probe/replay.js <dir>` and `node probe/attr.js <dir>`. The probe has an
absolute path to the util baked in. Raw JSONL captures (fixture data only)
are not committed; `corpus-threshold-matrix.tsv` is their replay output.
