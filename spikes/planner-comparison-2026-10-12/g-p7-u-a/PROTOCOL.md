# G-P7-U.A protocol — preference-utility encoding

Gate G-P7-U part A (task 33.0, design "P-D7 preference-first objective").
Question: given the request's `PreferenceSpec` and one eligible Experience,
what preference signal is derived, how is it ordered, and what crosses the
planner boundary? Part B (preference vs travel / mode friction / UNKNOWN
hours) is out of scope: no travel, friction or uncertainty coefficient, and
no exchange rate between preference and minutes, is chosen here.

## Rules fixed before evaluation

1. Hard eligibility precedes utility. Hard exclusions, accessibility NEEDS
   (UNKNOWN never satisfies a need) and allowed travel modes are not part of
   preference utility.
2. Explicit preference evidence is authoritative. Semantic similarity, generic
   quality, popularity or proximity never lift an Experience above one with
   stronger explicit evidence.
3. Semantic similarity refines only within equal explicit evidence. It never
   creates a facet match and never bypasses eligibility.
4. Missing semantic evidence is UNKNOWN. It must be neither punished (ranked
   below every known peer) nor rewarded (ranked above every known peer). Known
   peers keep their relative order when an UNKNOWN candidate joins.
5. Generic quality is subordinate to both and is labelled generic, not
   preference.
6. Provenance (owner, 2026-10-14). DIRECT evidence (a wizard pick, or a
   free-text excerpt that maps to the key through the versioned vocabulary or
   its explicit aliases) precedes INFERRED evidence. A soft venue anchor
   follows both and precedes semantic similarity. The capture channel is not
   a tier, and confidence is not provenance.
7. No new coefficient. A scalar is introduced only if it is provably lossless
   with respect to the order. Otherwise the boundary stays structured.

## Method

- **Current pipeline.** Inspect the live code read-only. Confirm or disprove
  each defect claimed in the brief and design.
- **Real code.** `characterization/current-code.characterization.spec.ts`
  runs the real `plannerRelevanceScore` / `sortCandidatesDeterministically`
  (live policy config), `composeSet` and `findHardExclusionMatches` on the
  scenario values. Output goes to `runs/current_code.json`.
- **Reference orderings.** `scripts/encoding.py` (stdlib, deterministic,
  exact `Fraction` sums) implements:
  - the live planner order;
  - the live composition remainder order;
  - three superseded explicit-affinity encodings: count, Σ weight,
    channel-tiered Σ;
  - five UNKNOWN rules: zero, lower tier, constant 0.5, skip-for-the-tier,
    tier median;
  - a pairwise "skip when unknown" comparator.

  - the provenance-ordered encoding (DIRECT, INFERRED, soft anchor), with
    its dedupe and two variants.

  It evaluates them on 27 curated scenarios drawn from the product
  vocabulary, against expectations written from the rules above. These
  include mixed-source and soft-anchor cases. Output goes to
  `runs/encoding.json`.
- **Provenance rule.** `characterization/provenance-rule.characterization.spec.ts`
  applies a spike-only reference of the owner's rule to the live
  `INITIAL_DIMENSION_VOCABULARY` / `DIMENSION_KEY_SYNONYMS`. It runs on the
  owner's examples and edge cases, and characterizes the live interpreter on
  the same inputs. Output goes to `runs/provenance.json`.
- **Structural checks.**
  - Transitivity of the pairwise comparator.
  - Ordering invariance under matched/possible normalization.
  - Whether any order-preserving per-candidate scalar determines the additive
    set-level routing objective.

## Reproduce

```bash
python3 -I spikes/planner-comparison-2026-10-12/g-p7-u-a/scripts/encoding.py
cd be && npx jest -c ../spikes/planner-comparison-2026-10-12/g-p7-u-a/characterization/jest.config.json
```

**Reproduction after task 25.4 (2026-10-15).** The lexical provenance rule
evaluated here is superseded by the preference-assertion contract, and task
25.4 removed the alias table, the interpreter fallback and the hard-exclusion
evaluator from production, so the command above no longer runs against the
current tree. The results in `runs/` are unchanged. Two reproductions remain:

```bash
# Self-contained: the reference rule on the frozen vocabulary and synonym
# table of commit 9673571e (characterization/frozen-facet-vocabulary-9673571e.json);
# asserts equality with runs/provenance.json and never writes runs/.
cd be && npx jest -c ../spikes/planner-comparison-2026-10-12/g-p7-u-a/characterization/jest.frozen.config.json

# Live-code characterizations, pinned to their evidence commit: runs the
# original config in a temporary worktree of 9673571e and diffs runs/.
bash spikes/planner-comparison-2026-10-12/g-p7-u-a/scripts/reproduce-live-characterization.sh
```
