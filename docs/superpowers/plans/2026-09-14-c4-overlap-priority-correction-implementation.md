# C4 overlap-priority correction — implementation plan

Status: implementation-ready  
Branch: `feat/preference-first-selection`  
Canonical repository: `jiseruk/zig-zag`  
Reviewed baseline HEAD: `b34b59b46d7142cafa09c1a05342cac684150695`

## 1. Purpose

The previous C4 correction correctly:

- moved `preferenceWeight` to the canonical strong-match semantic authority;
- removed `rankingScore` from `PlanningExperienceCandidate`;
- made planner sorting and placement share the same explicit relevance function;
- normalized raw canonical `qualityScore` exactly once;
- preserved `mustInclude` as transport-only.

Those decisions remain correct and MUST NOT be reverted.

Independent review found one regression outside the planner boundary:

`filterOverlappingExperienceCandidates()` still needs an upstream ordering tie-break when two overlapping Experiences contain the same number of components.

Before the C4 correction, the caller provided an ordinal derived from full composition order.

The correction replaced that value with `preferenceWeight`.

That loses semantic/quality/exploration/etc. decisions already made by composition and can make overlap filtering choose by lexical ID rather than the better composed Experience.

This task fixes that regression without restoring `rankingScore` to the planner.

## 2. Architectural decision

There are TWO distinct concepts and they MUST remain separate.

### 2.1 Planner relevance

Planner relevance is owned exclusively by:

`plannerRelevanceScore(...)`

and uses the typed planner candidate signals:

```text
semantic contribution
+ canonical strong preferenceWeight
+ normalized raw quality contribution
```

plus planner-local terms where applicable.

`PlanningExperienceCandidate` MUST NOT regain `rankingScore`.

The planner MUST NOT consume an ordinal composition score.

### 2.2 Overlap-filter composition priority

Overlap filtering occurs BEFORE planner normalization.

When two overlapping candidates have the same component count, overlap filtering needs to know which candidate composition ranked earlier.

This is NOT a planner score.

It is only a deterministic ordinal representation of the already-decided composition order.

Canonical rule:

```text
selected[0]
selected[1]
...
selected[n]
reservoir[0]
reservoir[1]
...
```

becomes a monotonically descending priority.

For example:

```ts
const orderedIds = [
  ...composition.result.selected,
  ...composition.result.reservoir,
];

compositionOrderScore(id at index i) =
  orderedIds.length - i;
```

Only relative ordering matters.

Do NOT recompute composition ranking.

Do NOT rebuild a weighted scalar from:

- preferenceWeight;
- semanticSimilarity;
- quality;
- explorationTilt;
- groundingStrength;
- softAnchorBoost.

Composition has already decided their interaction.

The overlap boundary preserves that decision by carrying the ordinal order only.

## 3. Naming decision

Do NOT reintroduce the name `rankingScore` for this concept.

Rename the overlap-filter-only field:

```ts
compositionOrderScore?: number;
```

Therefore change:

```ts
export interface OverlapCandidate {
  id: string;
  rankingScore?: number;
  ...
}
```

to:

```ts
export interface OverlapCandidate {
  id: string;
  compositionOrderScore?: number;
  ...
}
```

Update the filter tie-break accordingly.

The term `rankingScore` must remain absent from `PlanningExperienceCandidate`.

This naming distinction is intentional:

```text
compositionOrderScore
    = pre-planner overlap/dedup ordering only

plannerRelevanceScore
    = planner soft relevance
```

They are not interchangeable.

## 4. CandidateSelection contract

Modify the internal `CandidateSelection` contract in:

`be/src/modules/tours/services/experience-generation.service.ts`

to add:

```ts
compositionOrderScoreById: Map<string, number>;
```

Do NOT overload:

```ts
scoreBreakdownById
```

for this purpose.

`CandidateScoreBreakdown.totalScore` remains diagnostic/trace data and MUST NOT become the source of overlap priority.

This separation prevents trace compatibility fields from silently becoming algorithmic authority again.

## 5. composeExperiences implementation

Inside the existing `composeExperiences(...)` path, composition already produces:

```ts
composition.result.selected
composition.result.reservoir
```

Build:

```ts
const orderedIds = [
  ...composition.result.selected,
  ...composition.result.reservoir,
];

const compositionOrderScoreById = new Map(
  orderedIds.map((id, index) => [
    id,
    orderedIds.length - index,
  ]),
);
```

Return this map as part of `CandidateSelection`.

Do not infer it later from `preferenceWeight`.

Do not derive it from `scoreBreakdownById.totalScore`.

Do not change `ExperienceCompositionService` ordering in this task.

## 6. Generation orchestration wiring

At the generation/orchestration level, alongside the existing maps such as:

```ts
offeredScoreBreakdownById
planningPreferenceWeightById
```

maintain:

```ts
offeredCompositionOrderScoreById
```

When a `CandidateSelection` contributes Experiences to the candidate pool, copy its composition order score for each offered Experience.

Then change the overlap-filter call from conceptually:

```ts
{
  ...experience,
  rankingScore:
    offeredScoreBreakdownById.get(experience.id)?.totalScore,
}
```

to:

```ts
{
  ...experience,
  compositionOrderScore:
    offeredCompositionOrderScoreById.get(experience.id),
}
```

Do not expose this field after overlap filtering unless already structurally required.

It is pre-planner transient data only.

## 7. Overlap winner policy

`filterOverlappingExperienceCandidates()` keeps its existing canonical priority:

```text
1. more real components wins;
2. if component counts are equal,
   higher compositionOrderScore wins;
3. if still equal / missing,
   lexical Experience id wins.
```

Nothing else about overlap detection changes.

Do NOT alter:

- 150m tolerance;
- name normalization;
- geographic overlap predicate;
- composite-subsumes-standalone behavior.

This task only repairs equal-component-count priority.

## 8. Mandatory regression tests

### 8.1 Existing overlap utility test

Update:

`be/src/modules/tours/utils/candidate-overlap-filter.util.spec.ts`

to use:

```ts
compositionOrderScore
```

instead of `rankingScore`.

Keep the test proving:

> with equal component count, the higher composition-order candidate survives.

Example:

```text
lower compositionOrderScore = 2
higher compositionOrderScore = 5

same real component
same number of components

winner = score 5
```

### 8.2 Regression for the actual C4 bug

Add a regression at the `ExperienceGenerationService` / composition-handoff boundary.

It MUST prove the following scenario:

```text
Candidate A
preferenceWeight = 1
composition order = later

Candidate B
preferenceWeight = 1
composition order = earlier

A and B:
- same component count;
- overlap the same real place.
```

Composition ordering must differ because of some legitimate secondary composition signal, for example:

- semanticSimilarity; or
- qualityScore.

Expected behavior:

```text
B survives overlap filtering
A is excluded
```

The test MUST fail under the buggy implementation where:

```ts
totalScore = preferenceWeight
```

is used as overlap priority.

In other words, the regression must prove that equal `preferenceWeight` does NOT collapse composition ordering to lexical ID.

Do not write only another isolated overlap-filter unit test.

At least one test must exercise the actual composition/order → orchestration → overlap-priority handoff.

## 9. Planner regression protection

Retain/add assertions proving:

```ts
'rankingScore' in PlanningExperienceCandidate === false
```

where appropriate.

The micro-fix MUST NOT change:

```ts
plannerRelevanceScore
```

The planner continues to use:

```ts
semanticWeight * semanticScore
+ preferenceWeight
+ qualityWeight * (qualityScore / 5)
```

with unknown optional signals neutral.

Sorting and placement must continue sharing this single function.

## 10. Explicit non-goals

DO NOT:

- restore `rankingScore` to `PlanningExperienceCandidate`;
- use `compositionOrderScore` inside the planner;
- redesign planner scoring;
- change strong/weak facet semantics;
- change quality normalization;
- change `mustInclude`;
- implement must-anchor pinning;
- implement C5;
- implement C5b;
- implement reservoir backfill;
- change acquisition;
- change embeddings;
- change exploration logic;
- change overlap geography/name semantics;
- repair the live semanticSimilarity handoff in this task;
- clean/rewrite Git history;
- run RW1.

The live composition → planner semantic-similarity handoff is a known follow-up concern and must be addressed separately if required by the next implementation plan.

## 11. Execution-contract hardening

Update:

`docs/superpowers/contracts/preference-first-agent-execution-contract.md`

under repository/remote safety with this permanent invariant:

```text
- `fork` is the only write target for this initiative.
- All fetch/push operations for `feat/preference-first-selection` use `fork`.
- `origin` is upstream and is out of scope for writes.
- Never create, update, or push `feat/preference-first-selection` to `origin`.
```

Also make repository-root file semantics explicit:

- the agent must first `cd /Users/jiseruk/projects/zig-zag/.worktrees/ui-redesign`;
- verify `git rev-parse --show-toplevel` equals that path;
- then read `AGENTS.md` relative to that repository root;
- never interpret `/AGENTS.md` as an absolute filesystem path for this workflow.

Do not otherwise expand the execution contract with architecture-specific content.

## 12. Required verification

Run fresh targeted tests covering:

```text
candidate-overlap-filter
ExperienceGenerationService composition/overlap handoff
planning candidate normalizer
planner candidate sort
daily planning placement/scoring
C4 ranking/planner boundary characterization
```

Then run fresh:

```bash
cd be

yarn typecheck
yarn lint:check
yarn test --runInBand
yarn test:integration
yarn build
```

Run relevant non-DB characterization tests.

Do NOT bypass the disposable-database safety guard.

If DB characterization remains blocked by the known disposable-test-database guard, report it accurately.

## 13. Acceptance criteria

This correction is implementation-complete only when all are true:

1. `PlanningExperienceCandidate` has no `rankingScore`.
2. `plannerRelevanceScore()` is unchanged in semantics.
3. planner sorting and placement continue using the same relevance helper.
4. `preferenceWeight` remains strong-match-only.
5. raw canonical quality remains applied exactly once.
6. `mustInclude` remains transport-only.
7. overlap-filter candidate field is named `compositionOrderScore`.
8. equal-component overlap winner uses complete composition ordering.
9. equal `preferenceWeight` cannot erase semantic/quality ordering already decided by composition.
10. `CandidateScoreBreakdown.totalScore` is not overlap authority.
11. composition order is not recomputed by the overlap layer.
12. targeted regression reproduces the previous bug and passes after the fix.
13. full unit/integration/typecheck/lint/build are green, or any genuine environment blocker is reported.
14. `origin` write prohibition is recorded in the execution contract.
15. C5/C5b remain untouched.

## 14. Progress update

Update:

`docs/superpowers/progress/2026-09-11-preference-first-selection-progress.md`

Record:

- starting remote HEAD;
- this independent-review regression;
- implementation commit;
- exact fix;
- exact verification results;
- DB characterization status if still blocked.

Status must be:

`C4 CORRECTED — awaiting independent review`

Do NOT mark C4 approved.

## 15. Commit structure

Prefer:

```text
fix(cutover-C4): preserve composition priority through overlap filtering
```

and then:

```text
docs(progress): record C4 overlap correction
```

The plan itself may be committed with the implementation commit.

Do not create unrelated commits.

## 16. STOP condition

Push only to:

```bash
git push fork feat/preference-first-selection
```

Re-fetch `fork` before final reporting.

Then STOP.

Do not start C5.
