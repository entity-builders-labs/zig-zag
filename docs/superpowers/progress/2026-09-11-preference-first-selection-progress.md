## Checkpoint A — Task A1 — COMPLETE

- Branch: `feat/preference-first-selection`
- Base commit: `39968fb2e4a356a12a9a7e23fa3cb5858efdbb53`
- Implementation commit: `4765409af4841c58da79c83222cd553d427e1579`
- Plan task: `A1 — PreferenceSpec + facetKey`
- Status: COMPLETE

### Implemented
- Added `be/src/modules/tours/interfaces/preference-spec.interface.ts` defining
  the canonical `PreferenceSpec` model from spec §3: `RequestedFacet`,
  `AnchoredPlace`, `PreferenceSpec`, `FacetCandidates`, `PortfolioSufficiency`,
  `UnmetAnchor`, `CompositionResult`, plus the shared `facetKey({dimension,key})
  => "dimension:key"` helper (plan §1 "Provide one shared facetKey helper").
- `PreferenceSpec.explorationStyle` is a top-level meta-preference field,
  structurally separate from `PreferenceSpec.facets: RequestedFacet[]`. No
  helper in this file inserts `'exploration_style'` as a `RequestedFacet`
  dimension anywhere (invariant #1, spec §3.1).
- `RequestedFacet.required` is typed as the literal `false` (positive facets
  stay soft in v1, plan line 88).
- File-level and field-level doc comments cross-reference the spec/plan
  invariant so future edits cannot silently regress `explorationStyle` into a
  facet.

### Files changed
- `be/src/modules/tours/interfaces/preference-spec.interface.ts` (new)
- `be/src/modules/tours/interfaces/preference-spec.interface.spec.ts` (new)
- `docs/superpowers/progress/2026-09-11-preference-first-selection-progress.md` (new, this file)

### Verification
- RED check: temporarily removed `preference-spec.interface.ts` and ran
  `yarn test src/modules/tours/interfaces/preference-spec.interface.spec.ts`
  → FAIL as expected — `TS2307: Cannot find module
  './preference-spec.interface'` (test suite failed to run, 0 tests executed).
  File restored immediately after.
- `cd be && yarn test src/modules/tours/interfaces/preference-spec.interface.spec.ts`
  → PASS — 10/10 tests passed (facetKey formatting for `theme:history` and
  `intent:walk`; `RequestedFacet.required:false` literal; `AnchoredPlace`
  venue/must literal; `explorationStyle` present as its own field and never
  present among `facets` regardless of the fixture's facets array;
  `explorationStyle` accepts only `iconic`/`local_deep_dive`/`balanced`;
  `FacetCandidates.satisfied` mirrors `strongMatches.length >= 1` for both a
  satisfied and an unsatisfied case; `PortfolioSufficiency`, `UnmetAnchor`
  (`UNRESOLVED`/`INFEASIBLE`), and `CompositionResult` literals construct and
  read back correctly).
- `cd be && yarn typecheck` (`tsc --noEmit`) → PASS — no errors.
- `cd be && npx eslint src/modules/tours/interfaces/preference-spec.interface.ts src/modules/tours/interfaces/preference-spec.interface.spec.ts` → PASS — 0 problems (3 prettier-only formatting errors were found on first run and fixed with `--fix` scoped to only these two files before re-verifying tests/typecheck stayed green).

### Deviations from plan
- None. Interfaces match plan §1 "Canonical interfaces" verbatim (field names,
  types, and the `required: false` literal).

### Decisions taken
- The worktree at `.worktrees/ui-redesign` already had `feat/preference-first-selection`
  checked out with HEAD identical to `feat/experience-domain-v2`
  (`39968fb2e4a356a12a9a7e23fa3cb5858efdbb53`) — confirmed via
  `git log feat/experience-domain-v2..feat/preference-first-selection --oneline`
  returning zero commits. No new branch was created since the required base
  already existed and matched exactly; this was verified rather than assumed.
- This worktree also carries pre-existing, unrelated uncommitted local
  modifications from other in-progress work (`.env.example`,
  `be/src/core/config/auth.config.ts`, `fe/app/(tabs)/profile.tsx`). These were
  left untouched (not staged, not reverted, not inspected further) and are not
  part of this or any A1 commit — only the two new A1 files plus this progress
  doc were committed.
- The RED verification was performed by temporarily moving the already-present
  `preference-spec.interface.ts` out of the way (rather than writing the test
  first from a blank slate), because both the interface and its spec file were
  already present untracked in the worktree before this task began. The
  resulting RED failure (`TS2307`, 0 tests run) matches the expected reason
  (missing implementation module), and the file was restored immediately
  after capturing that result.

### Open issues / debt
- None for A1 specifically. Note for future tasks: this worktree's pre-existing
  unrelated dirty files (see Decisions above) should be resolved (committed
  elsewhere, stashed properly, or discarded) by whoever owns that other work —
  they are out of scope for this plan and were not touched here.

### Next task
`A2 — Interpreter anchors (D3)`

---

## Checkpoint A — Task A2 — COMPLETE

- Branch: `feat/preference-first-selection`
- Base commit: `6f5570ddcaf7a2af15a7d2910777487cbd90df74`
- Implementation commit: `6e25fbf30265f235ae779b21068ca5ed6d3778a1`
- Plan task: `A2 — Interpreter anchors (D3)`
- Status: COMPLETE

### Implemented
- Added `anchoredPlaces: AnchoredPlace[]` to `NormalizedPreferenceIntent`
  (`preference-interpretation.interface.ts`), importing `AnchoredPlace` from
  the A1 `preference-spec.interface.ts`.
- Extended `PreferenceInterpreterService`'s `SYSTEM_PROMPT` to instruct the
  LLM to extract concrete named anchors as `{rawName, kind, priority}`, with
  the exact D3 rule: `priority: 'must'` ONLY for explicit, unambiguous
  named-place intent ("quiero visitar X", "incluí X", "sí o sí quiero ir a
  X", "no me quiero perder X"); anything weaker or ambiguous -- including a
  place mentioned only in passing while describing a theme -- defaults to
  `'soft'`. The prompt also tells the model to extract conservatively and
  never invent a named place that was not mentioned.
- Added `ANCHORED_PLACE_SCHEMA` and wired `anchoredPlaces` into
  `RESPONSE_SCHEMA` (documented/traced schema; not used for runtime
  validation, matching the file's existing pattern where `RESPONSE_SCHEMA`
  is recorded in the trace but not enforced against the raw LLM response).
- Added `anchoredPlaces: []` to `EMPTY_INTENT` (covers both the "skipped"
  early-return path and the deterministic regex `fallback()` path, since
  `fallback()` spreads `...EMPTY_INTENT`).
- Added private `normalizeAnchors(rawAnchors: unknown): AnchoredPlace[]`:
  drops non-array input, drops non-object entries, drops entries with a
  missing/blank/non-string `rawName` (trimmed), normalizes an invalid or
  missing `kind` to `'unknown'`, normalizes an invalid or missing `priority`
  to `'soft'` (never `'must'`), and caps the result to
  `MAX_ANCHORED_PLACES = 5`. This method validates/defaults the
  LLM-emitted `priority` -- it does not re-derive priority from the raw
  input text itself (the D3 phrase-based rule lives in the prompt, per the
  file's existing convention that the LLM interprets language while
  deterministic code enforces/normalizes the result -- see e.g.
  `mapStrengthToImportance` for the precedent this follows).
- Wired `this.normalizeAnchors(value?.anchoredPlaces)` into `normalize()`.
- Fixed four other `NormalizedPreferenceIntent` object-literal call sites
  that the new required field broke at typecheck: added
  `anchoredPlaces: []` to `experience-generation.service.ts`'s
  `emptyNormalizedPreferences()` default, and to three test fixtures
  (`experience-preference-evaluator.util.spec.ts`,
  `hard-soft-preference-contract.spec.ts`,
  `test/live/cold-start-experience-acquisition.live-spec.ts`). No other
  behavior in these files was changed.

### Files changed
- `be/src/modules/tours/interfaces/preference-interpretation.interface.ts`
- `be/src/modules/tours/services/preference-interpreter.service.ts`
- `be/src/modules/tours/services/preference-interpreter.service.spec.ts`
- `be/src/modules/tours/services/experience-generation.service.ts`
- `be/src/modules/tours/utils/experience-preference-evaluator.util.spec.ts`
- `be/src/modules/tours/utils/hard-soft-preference-contract.spec.ts`
- `be/test/live/cold-start-experience-acquisition.live-spec.ts`

### Verification
- RED check: ran the new/modified assertions in
  `preference-interpreter.service.spec.ts` before adding `anchoredPlaces` to
  `NormalizedPreferenceIntent` → FAIL as expected — 7 `TS2339: Property
  'anchoredPlaces' does not exist on type 'NormalizedPreferenceIntent'`
  compile errors, 0 tests executed (test suite failed to run).
- `cd be && yarn test src/modules/tours/services/preference-interpreter.service.spec.ts`
  → PASS — 11/11 tests, including the new `anchoredPlaces (D3)` describe
  block: explicit "sí o sí Teatro Colón" → `must`; "me gustaría conocer
  Teatro Colón" → `soft`; mere thematic mention ("me interesa la
  arquitectura del Teatro Colón") → `soft`, never `must`; malformed anchor
  payloads (blank name, missing `rawName`, non-object entries, invalid
  `kind`, invalid/missing `priority`) all degrade safely to the documented
  defaults; a 10-anchor payload is capped to <= 5; the deterministic
  fallback path defaults `anchoredPlaces` to `[]`.
- `cd be && yarn typecheck` (`tsc --noEmit`) → PASS — no errors (after
  fixing the four other call sites listed above; first run surfaced exactly
  those 4 `TS2741: Property 'anchoredPlaces' is missing` errors).
- `cd be && npx eslint <all 7 files changed>` → PASS — 0 problems.
- `cd be && yarn test src/modules/tours` → PASS — 79 test suites / 704
  tests, full `tours` module, no regressions from the interface change.

### Review fix (post-approval, before A3)

A2 was approved at implementation level, then received one review fix
before A3 started: the original must/soft/thematic-mention/malformed/cap/
fallback tests only proved `normalize()` handles a given LLM response
correctly -- none of them proved the D3 must/soft rules are actually present
in the prompt sent to the LLM. Added a dedicated prompt-contract test.

- Review fix commit: `77d16290cdbfd5937b06466a63ac4d29c2ef1cdb`
- File changed: `be/src/modules/tours/services/preference-interpreter.service.spec.ts`
  only -- `preference-interpreter.service.ts` was NOT touched (confirmed via
  `git diff --stat` showing zero changes to it before committing).
- New test: `anchoredPlaces (D3) > prompt contract > sends the conservative
  D3 anchor-priority rules to the LLM`. It calls `service.interpret(...)`,
  reads `langChain.generateChatResponse.mock.calls[0][0]` (the real
  `generateChatResponse(systemPrompt, userPrompt, variables, options)`
  signature -- the system prompt is the first positional argument, not a
  structured message array), and asserts the prompt contains: the exact
  `"must" ONLY for explicit, unambiguous named-place intent` rule plus its
  four example phrases (`quiero visitar X`, `incluí X`, `sí o sí quiero ir
  a X`, `no me quiero perder X`); the `weaker or ambiguous` / `is priority
  "soft"` rule plus the mere-thematic-mention example (`me interesa la
  arquitectura de X`); and the `do not invent named places` anti-hallucination
  rule.
- Sanity-checked the new test is not tautological: temporarily weakened the
  prompt's must-rule wording in a scratch copy (removed "ONLY for explicit,
  unambiguous"), reran just that test, confirmed it fails
  (`expect(received).toContain(expected)` on the exact-rule assertion), then
  restored `preference-interpreter.service.ts` to its original, unmodified
  content before committing.
- `cd be && yarn test src/modules/tours/services/preference-interpreter.service.spec.ts`
  → PASS — 12/12 tests: the 11 pre-existing normalization-contract tests
  (must/soft/thematic-mention/malformed/cap/fallback, unchanged) plus the 1
  new prompt-contract test, verifying both:
  - D3 prompt contract sent to LLM (new);
  - anchor normalization behavior (pre-existing, untouched).
- `cd be && yarn typecheck` → PASS — no errors.
- `cd be && npx eslint src/modules/tours/services/preference-interpreter.service.ts src/modules/tours/services/preference-interpreter.service.spec.ts`
  → PASS — 0 problems.
- Full `src/modules/tours` suite (704 tests) was not rerun for this fix, per
  the review instructions, since no implementation file changed.

### Deviations from plan
- None. `anchoredPlaces` was added to both files the plan named
  (`preference-interpretation.interface.ts`,
  `preference-interpreter.service.ts`); the prompt rule text matches the
  plan's D3 wording; the four required test scenarios are covered.

### Decisions taken
- Treated `priority` as an LLM-emitted, code-validated/defaulted field
  rather than adding a second deterministic regex classifier that
  re-derives `must`/`soft` from the raw request text. This follows the
  file's existing, explicit architecture ("You interpret language;
  deterministic code enforces the result" + the `mapStrengthToImportance`
  precedent, where the LLM emits a discrete signal and code deterministically
  maps/validates it) rather than attempting brittle regex named-entity
  extraction for arbitrary place names. The three phrase-based test cases
  ("sí o sí X" → must, "me gustaría conocer X" → soft, mere thematic mention
  → soft) are exercised by mocking the LLM response as a correctly-prompted
  model would emit it for that input, then asserting the normalization
  pipeline preserves/validates it correctly end-to-end -- mirroring the
  file's pre-existing test convention (e.g. the first existing test,
  "normalizes the complete typed LLM response...", already follows this
  same shape for `preferredFacets`).
- The deterministic regex `fallback()` path (used only when the LLM
  provider call itself throws) was NOT extended with anchor extraction,
  since arbitrary named-place extraction from free text is not a
  simple-keyword-list task like the fallback's existing theme/exclusion
  detection. `anchoredPlaces` defaults to `[]` in that path via
  `EMPTY_INTENT`. This is a narrower capability in the fallback path than
  the live LLM path, consistent with the fallback's existing narrow scope
  for other fields (e.g. its fixed `candidateKeywords` list vs. the LLM's
  open-vocabulary `preferredFacets` extraction).
- `experience-generation.service.ts`'s existing
  `normalizeWizardFacet('exploration_style', ...)` call (which currently
  inserts `exploration_style` as a facet on the *legacy* live orchestration
  path) was left untouched. That is pre-existing legacy behavior on a path
  Checkpoint D will replace wholesale with true `PreferenceSpec`-based
  orchestration (A3's builder is the place `explorationStyle` genuinely
  becomes a separate, non-facet field) -- fixing it now would be an
  unrequested, out-of-scope behavior change to a file A2 only needed to
  typecheck against the new required interface field.

### Open issues / debt
- The legacy `exploration_style`-as-facet merge in
  `experience-generation.service.ts` (`mergeStructuredPreferences`) still
  exists on the current live orchestration path and violates the
  canonical invariant that `explorationStyle` is never a
  `RequestedFacet`. This is known, pre-existing, and explicitly out of
  scope for A2 -- it is superseded by Checkpoint D's live-path cutover
  (D1), not fixed piecemeal here. Flagging so it is not mistaken for new
  debt introduced by this task.
- Same worktree pre-existing unrelated dirty files noted in the A1 section
  above remain untouched and unresolved (out of scope).

### Next task
`A3 — PreferenceSpec builder`

---

## Checkpoint A — Task A3 — COMPLETE

- Branch: `feat/preference-first-selection`
- Base commit: `e375b19bb0644503f90bf4b849ebae4b81bbe1fc`
- Implementation commit: `266e2f0a4200dab16f830d188a4b2dc5fe6f0ba1`
- Plan task: `A3 — PreferenceSpec builder`
- Status: COMPLETE

### Implemented
- Added `be/src/modules/tours/utils/preference-spec-builder.util.ts`
  exporting `buildPreferenceSpec(request: TourGenerationRequest, interpreted:
  NormalizedPreferenceIntent): PreferenceSpec`, merging:
  - wizard `intent.interests` → `theme` facets and wizard `intent.intents`
    → `intent` facets, via the existing `normalizeWizardFacet` helper
    (`preference-facet-merge.util.ts`, already used/tested elsewhere);
  - `interpreted.preferredFacets` (from Task A2's
    `PreferenceInterpreterService`);
  - `interpreted.exclusions`-equivalent fields → `PreferenceSpec.exclusions`
    (`excludedThemes` → `themes`, `excludedTraits` → `traits`,
    `hardExclusions` → `hard`);
  - `interpreted.anchoredPlaces` → `PreferenceSpec.anchors`, unchanged;
  - `request.intent.explorationStyle` → **only**
    `PreferenceSpec.explorationStyle` (never a facet);
  - `request.dietaryRestrictions` + `interpreted.dietaryPreferences` →
    `softConstraints.dietary`; `request.mobility.accessibilityNeeds` +
    `interpreted.accessibilityPreferences` → `softConstraints.accessibility`;
    `interpreted.budgetPreferences` + (`'low budget'` iff
    `request.budgetLevel === BudgetLevel.LOW`) → `softConstraints.budget`;
    `interpreted.groupPreferences` + (`'family friendly'` iff
    `request.groupType === GroupType.FAMILY`) → `softConstraints.group`.
    Each soft-constraint array is built from its own dedicated sources only.
  - `request.days` / `request.startDates` / `request.mobility.travelPace` →
    `PreferenceSpec.trip`.
- Added private `dedupeFacetsByHighestEffectiveWeight()`: merges facets by
  `(dimension,key)`, keeping the entry with the highest
  `calculateEffectiveWeight` (importance × confidence), all mapped to
  `RequestedFacet` with `required: false` always. Ties keep the first-seen
  entry; since wizard facets are always pushed first and always carry the
  maximum possible effective weight (`1.0 × 1.0 = 1.0`), a wizard facet
  always wins over a same-key free-text facet in practice, without a
  separate hardcoded source-precedence branch.
- Added private `mapExplorationStyle()` and `mapPace()` to convert the
  `ExplorationStyle`/`TravelPace` enums to the plain string-literal unions
  `PreferenceSpec` uses, rather than casting the enum values directly.
- Added `unique()` (trim + lowercase + de-duplicate) local helper for the
  soft-constraint arrays, used consistently for all four dimensions so no
  dimension accidentally reuses another's input array (the "previous bug"
  the plan calls out is not present here).

### Files changed
- `be/src/modules/tours/utils/preference-spec-builder.util.ts` (new)
- `be/src/modules/tours/utils/preference-spec-builder.util.spec.ts` (new)

### Verification
- RED check: ran the new spec before creating
  `preference-spec-builder.util.ts` → FAIL as expected —
  `TS2307: Cannot find module './preference-spec-builder.util'` plus 2
  `TS7006: implicit any` errors on filter/some callbacks whose parameter
  type could not be inferred without the module; 0 tests executed.
- `cd be && yarn test src/modules/tours/utils/preference-spec-builder.util.spec.ts`
  → PASS — 7/7 tests: wizard `history` + interpreted `history` merge into
  exactly one `theme:history` facet with `weight: 1.0, source: 'wizard'`
  (the higher-effective-weight entry); `explorationStyle` produces zero
  facet entries (`spec.facets` has exactly the one requested theme facet,
  none with `dimension === 'exploration_style'`); dietary restrictions
  land in `softConstraints.dietary` only; a low budget level lands in
  `softConstraints.budget` only; a family group type lands in
  `softConstraints.group` only; `anchoredPlaces` pass through to
  `spec.anchors` unchanged (deep-equal); exclusions/semanticQuery/trip are
  wired correctly from the request/interpreted intent.
- `cd be && yarn typecheck` (`tsc --noEmit`) → PASS — no errors.
- `cd be && npx eslint <the 2 new files>` → PASS — 0 problems (3
  prettier-only formatting errors found on first run, fixed with `--fix`
  scoped to only these two files, then re-verified tests/typecheck stayed
  green).
- `cd be && yarn test src/modules/tours` → PASS — 80 test suites / 712
  tests (up from 79 suites / 704 tests before this task), full `tours`
  module, no regressions.

### Deviations from plan
- None. All six plan-required test scenarios are covered (history
  dedup, exploration-style-zero-facets, dietary isolation, budget
  isolation, group isolation, anchor pass-through), plus one additional
  test wiring exclusions/semanticQuery/trip that the plan did not
  explicitly list but that this task's own new file made otherwise
  completely untested.

### Decisions taken
- Implemented the `(dimension,key)` → highest-effective-weight dedup as
  its own function in the new file rather than reusing the existing
  `mergePreferenceFacets` (`preference-facet-merge.util.ts`), because that
  helper's rule is "wizard always wins outright" rather than "highest
  effective weight wins" — a materially different (if, for current input
  ranges, behaviorally equivalent) semantic. The plan explicitly specifies
  the effective-weight rule for this builder, so this task encodes that
  rule directly rather than depending on the older helper's different
  stated invariant.
- `interpreted.anchoredPlaces` is passed straight into
  `PreferenceSpec.anchors` without any further validation/normalization,
  since Task A2's `PreferenceInterpreterService.normalizeAnchors()` is
  already the single place that validates/degrades raw anchor payloads.
  Re-validating here would duplicate that logic.

### Open issues / debt
- Same as A2: the legacy `exploration_style`-as-facet merge in
  `experience-generation.service.ts` (`mergeStructuredPreferences`) still
  exists on the current live orchestration path and is not wired to this
  new builder yet — Checkpoint D's live-path cutover replaces that call
  site with `buildPreferenceSpec`, not this task.
- `buildPreferenceSpec` is not yet called from any live code path (no
  wiring task was in scope for A3); it is a pure, unit-tested primitive
  only, consistent with Checkpoint A's stated scope ("creates pure/
  canonical primitives... does not wire the live generation path yet").
- Same worktree pre-existing unrelated dirty files remain untouched. Two
  additional unrelated modified frontend files appeared in this worktree
  during A3 (`fe/app/(tabs)/saved.tsx`, `fe/app/tours/[id].tsx`) that were
  not present at the start of A2 -- not authored by this task, not staged,
  not inspected further. This worktree appears to be shared with other
  concurrent work; flagging so it is not mistaken for anything A3 touched.

### Next task
`A4 — Canonical sufficiency helper`

---

## Checkpoint A — Task A4 — COMPLETE

- Branch: `feat/preference-first-selection`
- Base commit: `c4aa40a4bf22d1618383f76b039867c2958d4a00`
- Implementation commit: `2bd62084ea20f6367952c7b7cf3c3e509dda111e`
- Plan task: `A4 — Canonical sufficiency helper`
- Status: COMPLETE

### Implemented
- Added `be/src/modules/tours/utils/preference-sufficiency.util.ts` with
  exactly the four canonical pure primitives the plan specifies (spec
  §6.2 -- GLOBAL portfolio target):
  - `paceFactor(pace)`: `relaxed` → 3, `moderate` → 4, `fast` → 5.
  - `basePortfolioTarget(days, pace) = clamp(days,1,14) * paceFactor(pace)`
    -- the GLOBAL base portfolio target for the whole trip, never a
    per-facet quota.
  - `facetSatisfied(strongCount) = strongCount >= 1`.
  - `portfolioTarget(baseTarget, distinctReservations, distinctMustAnchors)
    = max(baseTarget, distinctReservations + distinctMustAnchors)`.
- Reused `PreferenceSpec['trip']['pace']` (indexed-access type) as the
  `Pace` type alias instead of redeclaring the `'relaxed'|'moderate'|'fast'`
  union a second time, keeping A1's interface the single source of truth.
- Deliberately did **not** implement a per-facet `requiredMatchCount(days,
  pace)` -- the plan explicitly calls this out as something that would
  reintroduce a per-facet quota, which the canonical model rejects.
- Did not add a composed "overall sufficiency" wrapper function/interface
  beyond the four named primitives -- the plan's A4 scope names exactly
  these four, and the required test scenario that combines them (facet
  satisfaction + base target + portfolio target + distinct-eligible-count
  comparison) is expressed by composing the primitives directly in the
  test, matching how a future caller (e.g. Checkpoint C's composition
  service) is expected to compose them too.

### Files changed
- `be/src/modules/tours/utils/preference-sufficiency.util.ts` (new)
- `be/src/modules/tours/utils/preference-sufficiency.util.spec.ts` (new)

### Verification
- RED check: ran the new spec before creating
  `preference-sufficiency.util.ts` → FAIL as expected —
  `TS2307: Cannot find module './preference-sufficiency.util'`, 0 tests
  executed.
- `cd be && yarn test src/modules/tours/utils/preference-sufficiency.util.spec.ts`
  → PASS — 10/10 tests: `paceFactor` maps relaxed/moderate/fast to 3/4/5;
  `basePortfolioTarget(5,'moderate') === 20` (the required "5 moderate
  days → base target 20 TOTAL" case) plus clamp-below-1 and
  clamp-above-14 boundary cases; `facetSatisfied(1) === true` (the
  required "history strongCount=1 → satisfied" case), `facetSatisfied(0)
  === false`, and `facetSatisfied(5) === true`; `portfolioTarget` picks
  the base when it is larger, the reservations+anchors sum when that is
  larger, and handles an exact tie; the required combined scenario
  (history=1 + architecture=1 + tango=1 on a 5-day/moderate trip, all
  three individually satisfied, but `portfolioTarget(20,3,0) === 20 > 3`
  distinct eligible Experiences, so overall NOT sufficient); and the
  required "exploration style cannot change any sufficiency result" case,
  asserted both by exact function arity (`paceFactor.length === 1`,
  `basePortfolioTarget.length === 2`, `facetSatisfied.length === 1`,
  `portfolioTarget.length === 3` -- no function has a slot for
  `explorationStyle`) and by re-invoking with identical inputs and
  confirming identical output.
- `cd be && yarn typecheck` (`tsc --noEmit`) → PASS — no errors.
- `cd be && npx eslint <the 2 new files>` → PASS — 0 problems (1
  prettier-only formatting error found on first run, fixed with `--fix`
  scoped to only these two files, then re-verified tests/typecheck stayed
  green).
- `cd be && yarn test src/modules/tours` → PASS — 81 test suites / 722
  tests (up from 80 suites / 712 tests before this task), full `tours`
  module, no regressions.

### Deviations from plan
- None. All four required test scenarios are covered exactly as
  specified, and `requiredMatchCount(days, pace)` was not implemented, per
  the explicit "do not implement" instruction.

### Decisions taken
- No new wrapper/composition function was added beyond the four named
  primitives (see "Implemented" above) -- kept strictly to the plan's
  named A4 scope rather than pre-building a `computePortfolioSufficiency`
  helper that no later task has asked for yet. `PortfolioSufficiency`
  (the result-shaped interface from Task A1) remains available for a
  future task to populate once a real caller needs it composed as an
  object rather than as individual comparisons.

### Open issues / debt
- `preference-sufficiency.util.ts` is not yet called from any live code
  path, consistent with Checkpoint A's stated scope (pure/canonical
  primitives only, no live wiring yet).
- Same worktree pre-existing unrelated dirty files remain untouched
  (`.env.example`, `be/src/core/config/auth.config.ts`,
  `fe/app/(tabs)/profile.tsx`, `fe/app/(tabs)/saved.tsx`,
  `fe/app/tours/[id].tsx`) -- unchanged since the A3 note, still not
  authored by this task.

### Next task
`A5 — Strong/weak match helper`

---

## Checkpoint A — Task A5 — COMPLETE

- Branch: `feat/preference-first-selection`
- Base commit: `c22faa50aaee513a692129af6b8a5e53ac22889a`
- Implementation commit: `1eb60fc64a4bfd00f663f8d1016fd726a4c3d850`
- Review fix commit: `470570365c60eda73bba36b7f4df0015a4399266`
- Plan task: `A5 — Strong/weak match helper`
- Status: COMPLETE

### Implemented
- Added `be/src/modules/tours/utils/preference-strong-match.util.ts`
  exporting `isStrongFacetMatch(experience, facet: RequestedFacet, policy?):
  boolean`, ANDing in order (spec §6.1):
  1. `candidateMatchesPreferenceFacet(experience, facet)` -- the one
     canonical matching primitive. `RequestedFacet` (Task A1) is adapted to
     the `PreferenceFacet` shape that primitive expects via a private
     `toPreferenceFacet()` (only `dimension`/`key` are ever read by the
     primitive; `importance`/`confidence` are filled with neutral
     placeholder values never used for matching).
  2. at least one resolved component with real geography
     (`component.geoEntity.latitude`/`longitude` both numbers).
  3. `qualityScore >= QUALITY_FLOOR` (`DEFAULT_QUALITY_FLOOR = 3.0`,
     overridable via `policy.qualityFloor`) -- a `null` `qualityScore`
     never gets a magic default (spec §10.1) and simply fails this check.
  4. classification/evidence grounding is not explicitly known-thin:
     `metadata.classification.state !== 'degraded'`. Absence of any
     classification metadata at all is explicitly NOT treated as thin
     (Task B2's classifier does not exist yet, so most current rows carry
     no classification metadata) -- only an explicit `'degraded'` state
     disqualifies.
  5. an obvious pre-planner feasibility guard only: an optional
     `policy.planningWindowMinutes` rejects a candidate whose
     `durationMinutes` obviously exceeds it. The daily planner remains
     authoritative for full feasibility (opening hours, routing, etc.) --
     this is explicitly not a substitute for Stage 10.
- A candidate that matches (step 1) but fails any of steps 2-5 is a *weak*
  match; this helper only answers strong/not-strong. The next task (A6's
  `FacetRetrievalService`) is expected to derive weak itself as
  `candidateMatchesPreferenceFacet(...) && !isStrongFacetMatch(...)`.

### Files changed
- `be/src/modules/tours/utils/preference-strong-match.util.ts` (new)
- `be/src/modules/tours/utils/preference-strong-match.util.spec.ts` (new)

### Verification
- RED check: ran the new spec before creating
  `preference-strong-match.util.ts` → FAIL as expected —
  `TS2307: Cannot find module './preference-strong-match.util'`, 0 tests
  executed.
- `cd be && yarn test src/modules/tours/utils/preference-strong-match.util.spec.ts`
  → PASS — 10/10 tests: strong (matches + resolved geography + quality
  4.4 + no degraded classification); not strong when quality is
  below the floor (2.5); not strong when quality is `null`; not strong
  with zero components and with a component whose geoEntity lacks
  lat/lng; not strong when classification is explicitly `degraded`;
  still eligible to be strong when classification metadata is simply
  absent; not strong for a non-matching candidate (facet gate itself
  fails); not strong when duration obviously exceeds a supplied
  `planningWindowMinutes` (and correctly still strong with no window
  supplied, or a window it fits within); respects a custom
  `qualityFloor`; `DEFAULT_QUALITY_FLOOR === 3.0`.
- `cd be && yarn typecheck` (`tsc --noEmit`) → PASS — no errors.
- `cd be && npx eslint <the 2 new files>` → PASS — 0 problems (2
  prettier-only formatting errors found on first run, fixed with `--fix`
  scoped to only these two files, then re-verified tests/typecheck stayed
  green).
- `cd be && yarn test src/modules/tours` → PASS — 82 test suites / 732
  tests (up from 81 suites / 722 tests before this task), full `tours`
  module, no regressions.

### Review fix (post-approval, before A6)

A5 was approved at architecture level, then received one mandatory numeric-
hardening fix before A6 started: `typeof value === 'number'` is `true` for
`NaN` and `Infinity`, so the original geography/quality checks let a
corrupted `Experience` (e.g. `qualityScore: NaN`, or `latitude: NaN` /
`longitude: Infinity`) pass as a strong match -- important because A6 uses
`strongMatches.length >= 1` to decide facet coverage and skip acquisition.

- Review fix commit: `470570365c60eda73bba36b7f4df0015a4399266`
- Files changed: `be/src/modules/tours/utils/preference-strong-match.util.ts`
  and its spec only.
- Geography: added private `isValidLatitude`/`isValidLongitude` requiring
  `Number.isFinite` plus the real-world range (`-90..90` / `-180..180`),
  not just `typeof === 'number'`.
- Quality: `qualityScore` must now be `Number.isFinite` AND within the
  canonical `0..5` scale before being compared against `qualityFloor`.
- No change to `candidateMatchesPreferenceFacet`, the `RequestedFacet` →
  `PreferenceFacet` adapter, the definition of "weak",
  `DEFAULT_QUALITY_FLOOR` (still `3.0`), absent-classification-is-not-thin
  treatment, `classification.state === 'degraded'`, `planningWindowMinutes`,
  or the conceptual gate order (facet match → geography → quality → not
  known-thin → obvious pre-planner feasibility).
- RED verified first: added the new invalid-value test cases, ran them
  against the unhardened implementation → 10 failures, all
  `Expected: false, Received: true` (proving the vulnerability described
  above), then implemented the fix.
- `cd be && yarn test src/modules/tours/utils/preference-strong-match.util.spec.ts`
  → PASS — 25/25 (15 pre-existing, unchanged, + 10 new): invalid numeric
  geography (`NaN` latitude, `Infinity`/`-Infinity` longitude/latitude,
  out-of-range latitude `91`/`-91`, out-of-range longitude `181`/`-181`) all
  → not strong; the exact `+-90`/`+-180` boundary → still strong (no
  over-rejection); invalid quality (`NaN`, `Infinity`, `-Infinity`,
  negative `-1`, above-scale `5.1`) all → not strong; `qualityScore: 0` →
  not strong at the default floor but strong once the floor is lowered to
  `0` (proving it is rejected as a valid-but-low score, not as an invalid
  value); `qualityScore: 5` (top of the canonical scale) → strong.
- `cd be && yarn typecheck` → PASS — no errors.
- `cd be && npx eslint src/modules/tours/utils/preference-strong-match.util.ts src/modules/tours/utils/preference-strong-match.util.spec.ts`
  → PASS — 0 problems (no `--fix` needed this time).
- `cd be && yarn test src/modules/tours` → PASS — 82 test suites / 747
  tests (up from 732 before this fix), full `tours` module green, no
  regressions.

### Deviations from plan
- The plan's Checkpoint A "New files" list (§1) does not name a specific
  file for this task's helper (only `facet-retrieval.service.ts`, for the
  *next* task A6, is listed). Named this file
  `preference-strong-match.util.ts` to match the naming convention of the
  other new preference-first primitives introduced in this checkpoint
  (`preference-spec-builder.util.ts`, `preference-sufficiency.util.ts`).
  This is a filename choice, not an architectural one -- the function's
  behavior follows the plan's A5 bullet list exactly.

### Decisions taken
- Treated "classification/evidence grounding is not known-thin" as
  "absence of classification metadata is not thin; only an explicit
  `degraded` state is" (see `isClassificationKnownThin` doc comment).
  This was necessary because Task B2 (the classifier that will actually
  populate `metadata.classification.state`) does not exist yet at this
  point in the checkpoint sequence, so requiring classification to be
  *present* would make every current row fail step 4 and never be
  strong -- clearly not the intent, since A5 explicitly precedes B2 in
  the plan's own ordering.
- `isStrongFacetMatch` deliberately does not compute or return a "weak"
  verdict itself (no `'strong'|'weak'|'none'` enum return type) --
  the plan's A5 wording only asks for a strong-match helper, and
  Stage 6's own text (§6.1) already defines weak as "matches but isn't
  strong", which the next task can derive by composing this helper with
  `candidateMatchesPreferenceFacet` directly, avoiding a second
  redundant classification surface.

### Open issues / debt
- `isStrongFacetMatch` is not yet called from any live/retrieval code
  path -- Task A6 (`FacetRetrievalService`) is where it gets its first
  real caller, consistent with Checkpoint A's stated scope (pure
  primitives only, no live wiring yet).
- **Concurrent upstream design amendment observed during this task's
  push** (not authored by this task, no action required on my part):
  after A4's progress was pushed, two docs-only commits landed directly
  on `feat/preference-first-selection` from outside this session --
  `d19d693` (spec: adds invariant #10 and §13.1 "D6 -- duration-aware
  planner backfill and bounded convergence", clarifying that
  `portfolioTarget`/`basePortfolioTarget` are **initial candidate
  breadth**, never final Tour cardinality) and `27a9883` (the matching
  plan update: `CompositionResult` gains a `rankedReservoir` field, a new
  `C5b` task is added to Checkpoint C, and an explicit note is added
  directly under A4's formulas: *"these helpers estimate pre-planner
  candidate breadth only... do not interpret `portfolioTarget` as the
  exact or maximum final Tour size"*). Neither commit touches A4's or
  A5's actual formulas/behavior -- confirmed by reading both diffs in
  full before merging. Both were merged locally with plain `git merge`
  (not rebase, to avoid disturbing this worktree's pre-existing unrelated
  dirty files) with zero conflicts, tests re-verified green after each
  merge, and pushed with the user's explicit approval (the first push
  attempt was blocked by the tool's permission classifier as a
  merge-of-concurrent-work action; the user confirmed proceeding). This
  is flagged here only as context for whoever picks up Checkpoint C later
  -- A4/A5 required no code changes because of it.
- Same worktree pre-existing unrelated dirty files remain untouched. One
  more unrelated file appeared during this task's merges
  (`fe/app.config.js`, alongside the previously-noted
  `.env.example`/`auth.config.ts`/`profile.tsx`/`saved.tsx`/`tours/[id].tsx`)
  -- still not authored by this task.

### Next task
`A6 — FacetRetrievalService with canonical catalog boundary`

---

## Checkpoint A — Task A6 — COMPLETE

- Branch: `feat/preference-first-selection`
- Base commit: `5ed403aea4b191cc9419cc48895859dc7b991dc5`
- Implementation commit: `e4e89886ea6205b1202b5f221551ae78f397e6c9`
- Plan task: `A6 — FacetRetrievalService with canonical catalog boundary`
- Status: COMPLETE

### Implemented
- Added `be/src/modules/tours/services/facet-retrieval.service.ts`
  exporting `FacetRetrievalService.retrieveFacetCandidates(facet:
  RequestedFacet, scope: {latitude,longitude,radiusMeters}, policy?:
  StrongMatchPolicy): Promise<FacetCandidates>`.
- Reuses `ExperienceCatalogService.findVerifiedWithin(...)` -- the
  existing canonical geography/hydration boundary (deterministic order,
  component + trait hydration, true radius filtering) -- instead of a
  second, arbitrary Prisma bounding-box query. No new catalog method was
  needed: the existing method's own scan (`scanLimit = max(limit*4,
  1000)`) already comfortably covers hundreds-to-low-thousands of rows;
  the actual truncation risk was its *final* geographically-closest
  slice to `limit` (default 100) *after* radius filtering but *before*
  any facet matching -- so this service calls it with a generously
  large `limit` (`FACET_RETRIEVAL_LIMIT = 2000`) instead of the default,
  so a relevant-but-not-closest row is never silently dropped before
  semantic matching ever sees it.
- Classifies each returned row via Task A5's `isStrongFacetMatch` +
  `candidateMatchesPreferenceFacet` into `strongMatches` / `weakMatches`
  / excluded-entirely (matches neither): strong = passes A5's full
  strong-match gate; weak = thematically matches
  (`candidateMatchesPreferenceFacet`) but fails at least one strong
  requirement (e.g. a bare/no-component row, or below the quality
  floor); excluded = does not match the facet at all.
- Both buckets are ordered strongest-first: `qualityScore` descending,
  `id` as a stable deterministic tie-break (private
  `byStrengthThenId`).
- `satisfied = facetSatisfied(strongMatches.length)`, reusing Task A4's
  helper directly rather than re-deriving `>= 1`.
- Exported `requestedFacetToPreferenceFacet` from Task A5's
  `preference-strong-match.util.ts` (previously a private
  `toPreferenceFacet`, identical behavior, only visibility changed) so
  this service reuses the one canonical `RequestedFacet` ->
  `PreferenceFacet` adapter instead of duplicating it -- avoiding a
  second, subtly-divergent adapter implementation.

### Files changed
- `be/src/modules/tours/services/facet-retrieval.service.ts` (new)
- `be/src/modules/tours/services/facet-retrieval.service.spec.ts` (new)
- `be/test/integration/tour-generation/facet-retrieval.integration-spec.ts` (new)
- `be/src/modules/tours/utils/preference-strong-match.util.ts` (modified:
  exported the existing adapter, no behavior change)

### Verification
- RED check: ran the new unit spec before creating
  `facet-retrieval.service.ts` → FAIL as expected —
  `TS2307: Cannot find module './facet-retrieval.service'`, 0 tests
  executed.
- `cd be && yarn test src/modules/tours/services/facet-retrieval.service.spec.ts`
  → PASS — 6/6 unit tests (mocked catalog, no DB): strong/weak/excluded
  bucketing from one mixed row set; strongest-first ordering by
  `qualityScore` with `id` tie-break; not satisfied when only weak
  matches exist; the service requests a `limit >= 2000` from the
  mocked catalog (proving the anti-truncation request itself, in
  isolation from real DB behavior); a custom `qualityFloor` policy is
  passed through to change the strong/weak boundary; a bare/no-component
  row that matches the facet never becomes strong.
- `cd be && yarn typecheck` → PASS (both after the unit implementation
  and again after the integration spec).
- `cd be && npx eslint <all 4 changed files>` → PASS — 0 problems (lint
  errors surfaced by `--fix` on formatting only, in two rounds: one for
  the unit service/spec, one for the integration spec's `it(name, fn,
  timeout)` indentation; re-verified tests/typecheck stayed green after
  each).
- `cd be && yarn test:integration --testPathPattern=facet-retrieval`
  (real Postgres) → PASS — 4/4 integration tests:
  - does not lose a relevant strong match among 500 unrelated filler
    Experiences + 1 real target (the target deliberately placed ~2 km
    from center, farther than every filler, so only a generously large
    `limit` retrieves it) -- **verified this test is not tautological**
    by temporarily lowering `FACET_RETRIEVAL_LIMIT` to 100 in a scratch
    copy, rerunning just this test, confirming it fails with
    `expect(received).toContain(expected)` / `Received array: []`
    (proving the exact regression this test guards against), then
    restoring the file to its original, unmodified content before
    committing;
  - a single strong history match satisfies the facet;
  - a name containing "history" ("History Bar & Grill") with themes
    `['food']` does not match at all (neither strong nor weak);
  - a bare/no-component row whose metadata themes match the facet lands
    in `weakMatches`, never `strongMatches`.
- `cd be && yarn test src/modules/tours` → PASS — 83 test suites / 753
  tests (up from 82 suites / 747 tests before this task).
- `cd be && yarn test:integration` (full suite, not just this file) →
  PASS — 12 test suites / 20 tests (up from 11 suites / 16 tests before
  this task) -- no regressions to the existing integration specs from
  reusing/exporting `requestedFacetToPreferenceFacet`.

### Deviations from plan
- None. Per the plan's explicit preference, no new `ExperienceCatalogService`
  method was added -- the existing `findVerifiedWithin` was reused as-is,
  called with a larger `limit` than its own default.

### Decisions taken
- Chose `FACET_RETRIEVAL_LIMIT = 2000` as the generous limit passed to
  `findVerifiedWithin`. This comfortably covers the plan's own required
  test scale (500+ seeded rows) and a realistic destination catalog
  (hundreds to low thousands of rows) without being literally unbounded.
  Documented in the constant's own comment; revisit if a real
  destination's catalog ever meaningfully exceeds this.
- `FacetRetrievalService` is not registered in `tours.module.ts` yet,
  consistent with every other Checkpoint A primitive/service --
  Checkpoint D's live-path cutover (D1) is where new services get
  registered and wired into the live orchestration path.
- Ordering key for "strongest-first" was not explicitly specified by
  the plan beyond the phrase itself; chose `qualityScore` descending
  with `id` as a stable tie-break, consistent with `qualityScore`
  already being part of A5's own strong-match definition and with the
  existing codebase convention of an `id`-based deterministic tie-break
  (e.g. `ExperienceCatalogService.findVerifiedWithin`'s own
  `left.id.localeCompare(right.id)`).

### Open issues / debt
- `FacetRetrievalService` is not yet called from any live orchestration
  path -- Checkpoint D wires it in.
- Confirmed with the user before running the real-Postgres integration
  suite for this task, since `resetDb()` truncates
  `tour`/`experience`/`geo_entity`/etc. tables and a docker-compose dev
  stack (`zigzag-backend`, `zigzag-postgres`) was already running in
  this shared worktree/machine at the time -- user confirmed it is
  disposable dev/test data and approved proceeding.
- Same worktree pre-existing unrelated dirty files remain untouched. One
  more unrelated file appeared during this task (`Makefile`, alongside
  the previously-noted `.env.example`/`auth.config.ts`/`app.config.js`/
  `profile.tsx`/`saved.tsx`/`tours/[id].tsx`) -- still not authored by
  this task.

### Next task
`A7 — Iconicity util`

---

## Checkpoint A — Task A6.1 — COMPLETE (review fix, A6 still not independently re-approved)

- Branch: `feat/preference-first-selection`
- Base commit: `37e38d51ed52aa6c285b8c14b64aa912b47c0785`
- Original A6 implementation SHA (unchanged, not rewritten): `e4e89886ea6205b1202b5f221551ae78f397e6c9`
- A6.1 implementation commit: `dc951aa36a8f03c800c2a092d3555fc4b525acb7`
- Plan task: `A6.1 — PostGIS Geospatial Catalog Boundary Review Fix`
- Status: COMPLETE

### Review context
A6's semantics were accepted (canonical facet matcher, A5 strongness, weak
= match-but-not-strong, A4 satisfaction, deterministic bucket ordering, no
embeddings in coverage, no live wiring) but its geography boundary was
review-blocked: `FACET_RETRIEVAL_LIMIT = 2000` over
`ExperienceCatalogService.findVerifiedWithin` only moved the failure
threshold of a bounded JS/Prisma scan-then-filter; it did not eliminate
arbitrary truncation before semantic matching. See
`docs/superpowers/progress/2026-09-11-a6-review-correction.md`,
`docs/superpowers/plans/2026-09-11-a6-1-postgis-geospatial-catalog-boundary.md`,
`docs/superpowers/specs/2026-09-11-postgis-geospatial-catalog-boundary.md`.

### Implemented
- **Docker**: `postgres.Dockerfile` (new, repo root) extends
  `pgvector/pgvector:pg15` (inspected first: Debian 12/bookworm, PGDG apt
  repo already configured) with `postgresql-15-postgis-3` +
  `postgresql-15-postgis-3-scripts`. `docker-compose.yml`'s `postgres`
  service now builds this (`image: zigzag-postgres-pgvector-postgis:pg15`)
  instead of using `pgvector/pgvector:pg15` directly.
- **Migration** `be/prisma/migrations/20260911233115_add_postgis_extension/migration.sql`
  (new, forward-only -- no historical migration edited): `CREATE EXTENSION
  IF NOT EXISTS "postgis"` (vector untouched/still enabled) plus a partial
  GiST expression index:
  `CREATE INDEX IF NOT EXISTS "geo_entity_location_gist_idx" ON "geo_entity"
  USING GIST ((ST_SetSRID(ST_MakePoint(longitude, latitude),
  4326)::geography)) WHERE latitude IS NOT NULL AND longitude IS NOT
  NULL`. No new persisted location column -- reuses existing
  `GeoEntity.latitude`/`longitude`. `schema.prisma`'s datasource
  `extensions` is now `[vector, postgis]`.
  `prisma migrate dev --create-only` also proposed an unrelated `DROP
  INDEX "experience_embedding_hnsw_idx"` (that HNSW index has no
  schema.prisma attribute, so Prisma's diff engine sees it as drift,
  exactly like the pre-existing Activity HNSW index before it) --
  removed that line before applying; confirmed the index still exists
  after migrating.
- **`ExperienceCatalogService.findVerifiedWithinForMatching(latitude,
  longitude, radiusMeters)`** (new method): one parameterized `$queryRaw`
  joining `experience` → `experience_component` → `geo_entity`, keeping
  VERIFIED Experiences with >=1 component whose GeoEntity lat/lng are
  finite and in range (`BETWEEN -90 AND 90` / `BETWEEN -180 AND 180` --
  empirically confirmed in-session this also excludes
  `NaN`/`Infinity`/`-Infinity`, matching A5's validity contract) and
  within `radiusMeters` via `ST_DWithin` on `::geography` (real meters).
  Distance for ordering is `MIN(...)` per Experience (`GROUP BY e.id`),
  `ORDER BY distance ASC, id ASC`. No `LIMIT`/`take` of any
  correctness-visible kind; IDs are hydrated via the existing
  `findVerifiedByIds` in internal batches (`HYDRATION_BATCH_SIZE = 500`,
  a performance detail only) while preserving the full PostGIS order. A
  bare Experience with no component is structurally unreachable (the
  joins require a real `ExperienceComponent` row).
- **`FacetRetrievalService`**: removed `FACET_RETRIEVAL_LIMIT = 2000` and
  the `findVerifiedWithin(..., 2000)` call entirely; now calls
  `findVerifiedWithinForMatching(lat, lng, radius)` (3 args, no limit).
  `requestedFacetToPreferenceFacet` / `isStrongFacetMatch` /
  `candidateMatchesPreferenceFacet` / `facetSatisfied` / strongest-first
  ordering / `StrongMatchPolicy` passthrough are all unchanged.
- **Test infra**: `test/integration/support/seed.ts` gained
  `bulkSeedFillerExperiences` (a few parameterized `INSERT ... SELECT ...
  FROM unnest(...)` statements instead of thousands of serial round
  trips) and an optional `id` override on `seedVerifiedExperience` (needed
  to force deterministic id-ordering for the global-scan regression).

### Confirmations requested by the plan
- **`vector` + `postgis` both present**, verified from a clean volume:
  ```
   extname
  ---------
   vector
   postgis
  ```
- **`FACET_RETRIEVAL_LIMIT = 2000` is gone.** `grep -n
  "FACET_RETRIEVAL_LIMIT" src/modules/tours/services/facet-retrieval.service.ts`
  matches nothing; the constant and the `findVerifiedWithin(...,
  FACET_RETRIEVAL_LIMIT)` call site were deleted, not just renamed/raised.
- **No A7 work started** — no `iconicity` file/code/tests exist on this
  branch; only A6.1's own files were touched.

### Files changed
- `postgres.Dockerfile` (new)
- `docker-compose.yml`
- `be/prisma/schema.prisma`
- `be/prisma/migrations/20260911233115_add_postgis_extension/migration.sql` (new)
- `be/src/modules/tours/services/experience-catalog.service.ts`
- `be/src/modules/tours/services/facet-retrieval.service.ts`
- `be/src/modules/tours/services/facet-retrieval.service.spec.ts`
- `be/test/integration/support/seed.ts`
- `be/test/integration/tour-generation/catalog-retrieval.integration-spec.ts`
- `be/test/integration/tour-generation/facet-retrieval.integration-spec.ts`

### Verification
- Clean-volume Docker rebuild: stopped/removed the old `zigzag-postgres`
  container, removed only the `ui-redesign_postgres_data` volume (left
  `ollama_data`/`overpass_argentina_data` and every other project's
  volumes on the machine untouched), `docker compose --profile dev build
  postgres` → built successfully, `docker compose --profile dev up -d
  postgres` → healthy.
- `cd be && yarn prisma:deploy` → all 15 pre-existing historical
  migrations applied cleanly from empty, then the new
  `20260911233115_add_postgis_extension` applied cleanly (after removing
  the unrelated proposed `DROP INDEX` line as described above).
- `cd be && yarn prisma:generate` → PASS, no errors.
- `docker exec zigzag-postgres psql ... SELECT extname FROM pg_extension
  WHERE extname IN ('vector','postgis')` → both present, confirmed twice
  (once manually before the migration to sanity-check package
  installation, once for real after a from-scratch `migrate deploy`).
- `docker exec zigzag-postgres psql ... \d geo_entity` → shows
  `geo_entity_location_gist_idx` (gist,
  `st_setsrid(st_makepoint(longitude, latitude), 4326)::geography`,
  `WHERE latitude IS NOT NULL AND longitude IS NOT NULL`).
- `docker exec zigzag-postgres psql ... SELECT indexname FROM pg_indexes
  WHERE indexname = 'experience_embedding_hnsw_idx'` → still present
  (confirms the diff-engine's proposed `DROP INDEX` was correctly excluded
  from the applied migration, not just described as excluded).
- Smoke-tested the raw SQL + bulk-seed helper directly via a throwaway
  ts-node script before writing the full jest suite (found target among
  5 fillers); script deleted before committing.
- `cd be && yarn test src/modules/tours/services/facet-retrieval.service.spec.ts`
  → PASS — 6/6 (bucketing/ordering/satisfied/policy-passthrough/bare-row
  unit semantics unchanged; the old "generously large limit" test replaced
  with "no result-limit argument at all", asserting the mocked call has
  exactly 3 arguments).
- `cd be && yarn test:integration --testPathPattern=facet-retrieval` →
  PASS — 4/4 (single-strong-match satisfied; name-without-theme
  non-match; bare row now excluded from BOTH strong and weak, since the
  PostGIS boundary never returns it at all -- adapted from A6's old
  weak-inclusion requirement, which no longer applies; new "no embedding
  authority" test: a real in-scope high-quality `tango`-themed Experience
  carrying `metadata.semanticSimilarity: 0.99` still cannot enter
  `history` strong/weak coverage).
- `cd be && yarn test:integration --testPathPattern=catalog-retrieval` →
  PASS — 8/8 (2 pre-existing + 6 new `findVerifiedWithinForMatching`
  cases): a target beyond the old closest-2000 window (2001 tightly
  clustered fillers) is still returned; a target whose id is the
  lexicographically maximal UUID-shaped string is still returned among
  8001 broadly-scattered fillers (this second regression's first draft
  used a target at distance 0 from the center, which is trivially
  closest regardless of any bug and so proved nothing -- caught by
  deliberately reverting to the old implementation and observing it
  still passed; fixed by forcing an explicit maximal id and raising the
  filler count past the old `scanLimit=8000` threshold); radius truth
  (inside/outside); multi-component nearest-distance-in-scope
  (~55km-away primary component + ~110m-away extra component still in
  scope); deterministic id tie-break at equal distance; bare row excluded
  by the join itself (`toHaveLength(0)`).
- **Verified the regression tests are not tautological**: temporarily
  patched `findVerifiedWithinForMatching` in the working tree to delegate
  to the old `findVerifiedWithin(..., 2000)`, reran — the two
  scale-regression tests (closest-2000, global-scan) failed with
  `Received array: []`/missing-target as expected, plus (on an earlier
  draft with the smaller 3000-scatter global-scan case) the
  multi-component and bare-row tests also failed for the expected
  reasons (old `Experience.latitude`/`longitude`-authoritative behavior).
  Restored the real implementation from a clean backup before
  committing; reran the full suite green afterward.
- `cd be && yarn typecheck` → PASS — no errors.
- `cd be && npx eslint` on all files listed above → PASS — 0 problems (62
  prettier-only formatting errors surfaced on the first pass across the
  new/edited integration specs and service files, fixed with `--fix`,
  then re-verified tests/typecheck stayed green).
- `cd be && yarn test src/modules/tours` → PASS — 83 test suites / 753
  tests, **unchanged** from before A6.1 (no regressions from the catalog
  method change).
- `cd be && yarn test:integration` (full suite) → PASS — 12 test suites /
  26 tests (up from 12 suites / 20 tests before A6.1 -- the net of the 6
  new catalog-retrieval PostGIS tests, facet-retrieval staying at 4).

### Deviations from plan
- None from A6.1's own required scope. One deliberate, disclosed test
  refinement: the plan's item 2 ("old global-scan regression... unrelated
  rows may be outside the radius") was initially implemented with the
  target Experience placed at the exact query center (distance 0),
  which -- caught by this session's own "verify against the old
  implementation" discipline -- turned out to always be the closest row
  regardless of whether the regression being tested was actually present,
  so it passed even when reverted to the old bounded implementation. Fixed
  by giving the target an explicit, deterministic, lexicographically
  maximal UUID-shaped id and raising the filler count to exceed the old
  `scanLimit` (8000 at A6's `FACET_RETRIEVAL_LIMIT=2000`), which now fails
  correctly against the old implementation and passes against the new one.

### Decisions taken
- Placed the heavy scale-regression tests (>2000 rows, >8000 rows)
  directly against `ExperienceCatalogService.findVerifiedWithinForMatching`
  in `catalog-retrieval.integration-spec.ts`, rather than duplicating
  them at the `FacetRetrievalService` level in
  `facet-retrieval.integration-spec.ts`. This isolates the actual
  regression-prone geography boundary from facet-matching-specific
  concerns (strong/weak/satisfied, embedding non-authority), and
  `FacetRetrievalService` has no geography logic of its own left to
  regress now that it simply delegates to the catalog method with no
  additional limit.
- Added `bulkSeedFillerExperiences` (parameterized `unnest`-based bulk
  insert) rather than seeding thousands of rows one at a time through the
  existing `seedVerifiedExperience` helper, per the plan's explicit
  "usá bulk SQL/efficient seeding" instruction. IDs are generated in JS
  and correlated by array position across the `geo_entity` /
  `experience` / `experience_component` inserts, avoiding any
  data-modifying-CTE row-correlation complexity.
- Removed the diff-engine-proposed `DROP INDEX
  "experience_embedding_hnsw_idx"` from the generated migration by hand
  rather than trying to make Prisma's schema aware of that raw-SQL-only
  index (e.g. via an unsupported/awkward schema.prisma annotation) --
  consistent with the existing codebase pattern of raw-SQL-only indexes
  invisible to schema.prisma, and explicitly out of A6.1's scope to fix
  more broadly.
- Confirmed with the user in an earlier task (A6) that this shared
  worktree's local Postgres is disposable dev/test data; treated
  A6.1's own explicit instruction to reset from a clean volume as
  already-authorized continuation of that, rather than re-asking, since
  the plan itself specifies `docker compose down -v` / clean-volume
  rebuild as a required verification step. Scoped the actual reset
  narrowly (only the `postgres` service/container/volume; left
  `ollama_data`, `overpass_argentina_data`, and every unrelated
  project's Docker volumes on the machine untouched).

### Open issues / debt
- A6.1 is a review fix, not an independent new checkpoint task -- per
  the plan, A6 (as corrected by A6.1) still awaits explicit review
  approval before A7 may begin. This progress entry documents
  completion of the required fix, not a self-granted approval.
- `FacetRetrievalService`/`findVerifiedWithinForMatching` are still not
  wired into any live orchestration path -- unchanged from A6, deferred
  to Checkpoint D.
- Same worktree pre-existing unrelated dirty files remain untouched
  (`.env.example`, `Makefile`, `be/src/core/config/auth.config.ts`,
  `fe/app.config.js`, `fe/app/(tabs)/profile.tsx`, `fe/app/(tabs)/saved.tsx`,
  `fe/app/tours/[id].tsx`) -- unchanged since the A6 note, still not
  authored by this task.

### Next task
`A7 — Iconicity util` (blocked until this A6.1 review-fix is explicitly approved)

---

## Checkpoint A — Task A6.1 review hardening — COMPLETE

- Branch: `feat/preference-first-selection`
- Base commit: `513d523dd418446a5a10d95609c366ae3293c1d4`
- A6.1 implementation (base for this fix): `dc951aa36a8f03c800c2a092d3555fc4b525acb7`
- Review-fix implementation commit: `e2fca1e92b43fe530728e3f70f93018ccbb9ae7e`
- Plan task: mini review-fix on A6.1 (two ordering/test details; PostGIS
  architecture itself already accepted)
- Status: COMPLETE

### Implemented

**1. Quality ordering fix** — `be/src/modules/tours/services/facet-retrieval.service.ts`

`byStrengthThenId`'s old check (`typeof qualityScore === 'number'`) let
`NaN`/`Infinity`/`-Infinity`/out-of-scale values (negative, or `>5`) win
strong/weak bucket ordering over a real, valid score. Added a small local
pure helper:

```ts
function qualityForOrdering(value: unknown): number {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 5
    ? value
    : -Infinity;
}
```

mirroring A5's own quality-validity contract in
`preference-strong-match.util.ts` **without touching that file** (per
explicit instruction) -- this is a separate, intentionally-duplicated
ordering-only check, not a shared export. Only ordering changed; strong
vs. weak classification is untouched.

**2. Nearest-component ordering test** — `be/test/integration/tour-generation/catalog-retrieval.integration-spec.ts`

The old test only asserted `toContain(multiId)` -- membership, not the
`MIN(component distance)` half of the contract. Discovered while
verifying (see below) that the original scenario (one component 55 km
outside the radius, one ~111 m inside) couldn't actually distinguish MIN
from MAX: the query's own `WHERE ST_DWithin(...)` clause filters
individual (experience, component) rows before any aggregate runs, so the
far outside-radius component never survives to the `MIN`/`MAX` aggregate
in the first place -- only one row (the near one) ever reaches it,
making `MIN` and `MAX` identical for that shape. Redesigned so **both**
components of the multi-component Experience are inside the radius, at
two different distances (~111 m and ~1002 m), plus a comparison
Experience at ~501 m (strictly between them). The test now asserts the
exact relative order `[multiId, comparisonId]`, which is only correct
under a genuine `MIN` contract.

### Files changed
- `be/src/modules/tours/services/facet-retrieval.service.ts`
- `be/src/modules/tours/services/facet-retrieval.service.spec.ts`
- `be/test/integration/tour-generation/catalog-retrieval.integration-spec.ts`

### Verification
- RED check (quality ordering): added the new
  `weakMatches[0] === 'weak-valid'` assertion, ran it against the
  pre-fix `byStrengthThenId` → FAIL — `Expected: "weak-valid", Received:
  "weak-infinity"` (i.e. `Infinity` incorrectly won the ordering).
  Implemented the fix, reran → PASS.
- RED check (nearest-component ordering), two rounds:
  - Round 1 (original one-component-outside-radius scenario): patched
    `MIN(` → `MAX(` in a scratch copy of
    `experience-catalog.service.ts` and reran the (still old,
    membership-only) test → **still PASSED**, proving that scenario
    could not actually distinguish MIN from MAX (the far component never
    survives the row-level `WHERE ST_DWithin` filter, so only one row
    ever reaches the aggregate). This is why the test was redesigned
    rather than merely re-asserted.
  - Round 2 (redesigned, both-components-in-radius scenario): reran
    against the real `MIN`-based implementation → PASS; patched `MIN(` →
    `MAX(` again in a scratch copy → **FAILED** as expected (`Expected:
    [multiId, comparisonId]`, `Received: [comparisonId, multiId]`),
    confirming the redesigned test genuinely exercises the MIN contract.
    Restored the real implementation from a clean backup before
    committing either time.
- `cd be && yarn test src/modules/tours/services/facet-retrieval.service.spec.ts`
  → PASS — 7/7 (6 pre-existing unit semantics + 1 new quality-ordering
  hardening test).
- `cd be && yarn test:integration --testPathPattern=catalog-retrieval` →
  PASS — 8/8 (7 pre-existing + the redesigned nearest-component-ordering
  test, same count since it was strengthened in place, not duplicated).
- `cd be && yarn typecheck` → PASS — no errors.
- `cd be && npx eslint` on the 3 files changed → PASS — 0 problems (1
  prettier-only formatting error surfaced on first run, fixed with
  `--fix`, re-verified tests/typecheck stayed green).
- `cd be && yarn test src/modules/tours` → PASS — 83 test suites / 754
  tests (up from 753 -- the one new unit test).
- `cd be && yarn test:integration` (full suite) → PASS — 12 test suites /
  26 tests (unchanged count from before this fix -- one existing
  integration test strengthened in place, no new file added).

### Deviations from plan
- None from the requested scope. The nearest-component test scenario
  itself was redesigned (not just its assertion) because the originally
  planned scenario, verified in-session, could not actually distinguish
  MIN from MAX -- documented above and in the implementation commit
  message rather than silently substituted.

### Decisions taken
- Implemented `qualityForOrdering` as a small, local, intentionally
  duplicated pure function in `facet-retrieval.service.ts` rather than
  extracting/exporting a shared helper from A5's
  `preference-strong-match.util.ts`, per the explicit "No cambies A5"
  instruction. The numeric contract (finite, `0..5`) is identical by
  design/comment cross-reference, but the two files remain independently
  owned.

### Confirmations requested
- **Quality corrupta no gana ordering**: confirmed by the
  RED-then-GREEN cycle above -- `Infinity`/`NaN`/`5.1`/`-1`-shaped values
  can no longer outrank a real `4.0`; they fall back to a stable id
  tie-break amongst themselves, and a real valid score always sorts
  first.
- **Nearest-component ordering probado explícitamente**: confirmed --
  the test now asserts the exact relative order of two Experiences whose
  correct relative position depends specifically on `MIN` (not `MAX`,
  not "primary component only") being used for the multi-component
  Experience's distance; verified to fail when that contract is broken.
- **A7 NO comenzó**: no `iconicity` file/code/tests exist on this
  branch; only the 3 files above were touched by this fix.

### Open issues / debt
- Unchanged from A6.1's own entry: `FacetRetrievalService`/
  `findVerifiedWithinForMatching` are still not wired into any live
  orchestration path (Checkpoint D); A6/A6.1 (as now further hardened by
  this fix) still await explicit review approval before A7 may begin.
- Same worktree pre-existing unrelated dirty files remain untouched,
  unchanged since the A6.1 note.

### Next task
`A7 — Iconicity util` (blocked until A6/A6.1, as hardened by this fix, is explicitly approved)

---

## Checkpoint A — A7 execution gate — READY

- Branch: `feat/preference-first-selection`
- A6/A6.1 review verdict: **APPROVED**
- Main-plan integration commit: `cb8a6386f59cd8b4a7fa9d7a0f52c35cdf9a9d15`
- Main-spec integration commit: `6fe1674f94ca997b2fba454430627a70acc6ac06`
- Status: READY FOR A7 IMPLEMENTATION

### Current canonical navigation

The historical `A7 — Iconicity util` lines above record what the plan said at
those earlier checkpoints. They are superseded by the current canonical docs;
do not execute them.

An implementation agent should now follow this sequence:

1. Read this latest progress entry and identify the NEXT task.
2. Read `docs/superpowers/plans/2026-09-11-preference-first-selection-implementation.md`.
3. Execute its `A7 — Evidence-Backed Exploration Signals` section.
4. Use `docs/superpowers/specs/2026-09-10-preference-first-selection-and-agent-convergence-design.md`
   as the canonical semantic authority.
5. Implement **only A7**, update this progress with real implementation/test
   SHAs, then STOP before B1.

The A7-specific addendum files remain supplemental rationale/history only; the
main plan/spec are now self-contained and authoritative for execution.

### Execution gate

```text
A1    ✅
A2    ✅
A3    ✅
A4    ✅
A5    ✅
A6    ✅
A6.1  ✅ APPROVED
A7    ⏭️ NEXT — Evidence-Backed Exploration Signals
B1    ⛔ blocked until A7 review approval
```

### Next task
`A7 — Evidence-Backed Exploration Signals`

---

## Checkpoint A — Task A7 — COMPLETE

- Branch: `feat/preference-first-selection`
- Base commit: `e75924db1ba77af4039cb845dc73a0b33b01d72b`
- Implementation commit: `d3f7a119a631cd31e74f370b211d3cad8368fb6e`
- Plan task: `A7 — Evidence-Backed Exploration Signals` (redefinition of the
  original `A7 — Iconicity util`; no `computeIconicity` code was ever
  written -- the design correction landed before implementation started)
- Status: COMPLETE

### Implemented
Added `be/src/modules/tours/utils/exploration-signals.util.ts`, a pure
utility with **zero imports** (no Prisma, no LLM, no embeddings, no
provider calls -- verified structurally, see Verification):

- `ExplorationSignals { prominence, tourismIntensity, localCharacter }`,
  each an `EvidenceBackedExplorationSignal { value: number|null,
  confidence, evidence: ExplorationSignalEvidence[], reasonCodes:
  string[] }`. `value: null` means insufficient grounded evidence and is
  never coerced to `0`.
- `computeExplorationSignals(input: ExplorationSignalInput):
  ExplorationSignals`:
  - **prominence** combines, via named-constant weights
    (`REVIEW_COUNT_WEIGHT=0.5`, `SITELINK_WEIGHT=0.3`,
    `WIKIPEDIA_PRESENT_BONUS=0.1`, `WIKIVOYAGE_LISTED_BONUS=0.1`,
    `HERITAGE_OR_LANDMARK_BONUS=0.05`) and saturating log-normalization
    (`logSaturating`, caps `REVIEW_COUNT_SATURATION_CAP=500_000` /
    `SITELINK_SATURATION_CAP=300`): Places review count, Wikidata
    sitelink count, Wikipedia presence, Wikivoyage listing, heritage/
    landmark. A 50→100-review delta moves meaningfully more than a
    50,000→50,100 delta (same log curve, different region); heritage
    alone cannot force a near-1 score (`HERITAGE_OR_LANDMARK_BONUS` is
    the smallest weight); zero valid sources → `value: null`; corrupt
    inputs (`NaN`/`Infinity`/negative) are rejected by
    `isValidNonNegativeCount` and treated as "no evidence for that
    source", never as an invalid/out-of-range score.
  - **tourismIntensity** / **localCharacter** consume ONLY
    `explicitTourismIntensityEvidence` / `explicitLocalCharacterEvidence`
    -- arrays of `{strength, evidenceKey, source}` -- via the shared
    `computeExplicitEvidenceSignal` helper. Never derived from
    prominence, review count, or obscurity. Per the Phase-7 population
    boundary (plan A7.6, confirmed by the user as intentional
    forward-compatible plumbing for the later agentic/research stage):
    these two legitimately stay `value: null` for most Experiences right
    now; this task does not own discovery of that evidence and does not
    invent a proxy to populate it.
  - `ExplorationSignalInput` has no field for traveler free text/
    preferences at all -- only grounded Experience-side facts can ever
    reach these signals.
- `computeExplorationTilt(style, signals): ExplorationTilt` -- a
  separate pure ranking-only projection (not wired into composition yet;
  plan says C1/C2 consume it later):
  - `'iconic'`: known prominence contributes positively
    (`ICONIC_PROMINENCE_TILT_WEIGHT=1.0`); unknown prominence is exactly
    neutral (`score: 0`);
  - `'local_deep_dive'`: known `localCharacter` contributes positively
    (`LOCAL_DEEP_DIVE_LOCAL_CHARACTER_TILT_WEIGHT=1.0`), known
    `tourismIntensity` penalizes/moderates
    (`LOCAL_DEEP_DIVE_TOURISM_INTENSITY_PENALTY_WEIGHT=0.5`, negative
    contribution); **prominence never contributes here directly** (never
    `1 - prominence`) -- low or unknown prominence alone gives no bonus;
  - `'balanced'`: exact neutral tilt (`score: 0`, `contributions: []`).
- Every branch (known/unknown for each signal, and each `explorationStyle`)
  carries a named `reasonCode` string constant for future Bitácora/trace
  explainability, matching this codebase's existing "human-readable
  reason, not a bare magic value" convention.

### Files changed
- `be/src/modules/tours/utils/exploration-signals.util.ts` (new)
- `be/src/modules/tours/utils/exploration-signals.util.spec.ts` (new)

### Verification
- RED check: ran the new spec before creating
  `exploration-signals.util.ts` → FAIL as expected —
  `TS2307: Cannot find module './exploration-signals.util'`, 0 tests
  executed. (One follow-up typing fix was needed after the implementation
  existed: the spec's own `signalsWith` test fixture needed an explicit
  `EvidenceBackedExplorationSignal` annotation to avoid `TS7018` implicit-
  any errors -- not a RED-cycle issue with the implementation itself.)
- `cd be && yarn test src/modules/tours/utils/exploration-signals.util.spec.ts`
  → PASS — 20/20, covering the full A7.10 required-test list:
  - prominence: more reviews > fewer reviews; 50,000→50,100 moves less
    than 50→100 (saturation); more Wikidata sitelinks increases
    prominence; Wikipedia/Wikivoyage/heritage each independently raise
    the score and heritage alone stays `< 0.5`; no evidence at all →
    `value: null` with `reasonCodes` containing
    `'no_prominence_evidence'`; `NaN`/`Infinity`/negative counts sanitize
    to `value: null` with a still-finite, in-range `confidence`.
  - tourismIntensity: high prominence alone does not populate it
    (`value: null`, `'no_explicit_tourism_intensity_evidence'`); explicit
    evidence produces a deterministic known value with exact provenance
    (`evidence` array matches `{source, key, value}` exactly) and is
    reproducible byte-for-byte across two calls with the same input.
  - localCharacter: an obscure/low-review candidate with no explicit
    evidence → `value: null`; explicit evidence produces a deterministic
    known value with exact provenance.
  - Phase-7 boundary: only-prominence-populated input is valid/complete
    (`tourismIntensity`/`localCharacter` stay `null`); an input object
    with a "smuggled" `additionalPreferences`/`explorationStyle`-shaped
    extra property (simulating a mistaken attempt to feed traveler free
    text into Experience-side evidence) produces a byte-for-byte
    identical result to the same input without those extra properties.
  - tilt: `iconic` higher known prominence → higher score; `iconic`
    unknown prominence → `score === 0` exactly; `local_deep_dive` known
    `localCharacter` → positive score; `local_deep_dive` known high
    `tourismIntensity` → strictly lower score than without it;
    `local_deep_dive` low OR unknown prominence alone → `score === 0` in
    both cases; `balanced` → `score === 0` regardless of how extreme the
    input signals are.
  - determinism: identical input → deep-equal `computeExplorationSignals`
    result.
  - architectural boundary: the module source file has **zero** lines
    matching `^\s*import\s` -- the strongest available proof of "no
    provider/Prisma/LLM/embedding dependency" (a regex over doc-comment
    prose was tried first and rejected as a false-positive risk, since
    this file's own comments legitimately say "no embeddings" in
    English); also asserts the module's exports have no `matches` or
    `satisfied` property.
- `cd be && yarn typecheck` (`tsc --noEmit`) → PASS — no errors.
- `cd be && npx eslint <the 2 new files>` → PASS — 0 problems (13
  prettier/`no-require-imports` errors found on first run -- the test
  file originally used inline `require('./exploration-signals.util')` /
  `require('fs')` / `require('path')` for the architectural-boundary
  test, which ESLint's `@typescript-eslint/no-require-imports` rejects;
  replaced with top-of-file `import * as ...` statements instead, then
  the remaining prettier-only errors were fixed with `--fix`; re-verified
  tests/typecheck stayed green after both rounds).
- `cd be && yarn test src/modules/tours` → PASS — 84 test suites / 774
  tests (up from 83 suites / 754 tests before this task).
- `cd be && yarn test:integration` (full suite) → PASS — 12 test suites /
  26 tests, **unchanged** from before this task -- A7 is a pure utility
  with no database/provider surface, so it needed no integration
  coverage, consistent with plan A7.9's architectural boundary.

### Deviations from plan
- None. All A7.10 required test scenarios are covered, and the
  implementation follows the corrected A7 design (Evidence-Backed
  Exploration Signals) that replaced the original iconicity-scalar
  wording before any code existed -- there was no legacy iconicity
  implementation to migrate away from.

### Decisions taken
- Confirmed with the user (before starting implementation) that
  `explicitTourismIntensityEvidence`/`explicitLocalCharacterEvidence`
  being essentially always-empty in the current Phase-7 system (no
  upstream source populates them yet) is intentional forward-compatible
  plumbing for the later agentic/research stage, not a design gap A7
  itself needs to close. Implemented exactly to that understanding: A7
  performs no discovery of that evidence and returns `value: null`
  whenever it is absent, per plan A7.6's explicit acceptance criterion.
- Chose `REVIEW_COUNT_SATURATION_CAP = 500_000` (rather than, e.g.,
  `50_000`) specifically so the "50,000 vs 50,100 moves little" required
  test case sits meaningfully below full saturation (both values compute
  to distinct, non-1.0 scores under the log curve) rather than both
  trivially clamping to `1` -- a cap equal to the example count itself
  would have made the test pass for the wrong reason (total saturation
  rather than a genuinely gentle high-end slope).
- Picked simple, clearly-named deterministic formulas for `confidence`
  (source-count / total-possible-sources for prominence; valid-entry-
  count / 3, capped at 1, for the two explicit-evidence signals) since
  the plan specifies the general `confidence: number` contract and
  "deterministic" requirement but not an exact formula; documented the
  reasoning inline so a later task can adjust the constant without
  reverse-engineering intent.
- Included an explicit `reasonCode` entry in `ExplorationTilt.contributions`
  even for the "unknown → neutral" cases (rather than omitting them from
  the array), matching this codebase's broader Bitácora/trace philosophy
  of explaining *why* a decision was neutral, not just leaving it absent.
  This is a forward-looking choice for when C1/C2 eventually surface this
  data in trace/Bitácora; it does not change any test-observable score.

### Open issues / debt
- `computeExplorationTilt` is defined but **not wired into composition**
  yet, per plan A7.8 ("A7 defines this primitive but does not wire it
  into composition yet; C1/C2 consume it later") -- this is expected,
  not a gap.
- `tourismIntensity`/`localCharacter` remain structurally unused in
  practice until a later agentic/research task normalizes real evidence
  into `explicitTourismIntensityEvidence`/`explicitLocalCharacterEvidence`
  -- tracked as intentional forward-compatible plumbing, not A7 debt.
- Same worktree note: this task ran concurrently with another
  session/agent actively committing and editing unrelated frontend files
  on this same branch (`fe/app.config.js`, `fe/app/(tabs)/map.tsx`,
  `fe/app/tours/wizard.tsx`, `fe/components/tours/TourWizardForm.tsx`,
  `fe/features/map/index.tsx`, `fe/features/search-by-address-input.tsx`,
  `fe/utils/location.ts`). None of these were touched, committed, or
  inspected further by this task -- only the 2 files listed above were
  staged. One already-local, not-yet-pushed commit from that concurrent
  work (`9bf3b9e feat(mobile): add multi-platform build targets, auth
  audiences, and responsive UI`) was present in this branch's history
  before this task began and was carried through untouched via `git
  merge` (not rebase); it is now part of the pushed history as a
  side effect of this task's own push, not authored or altered by this
  task.

### Next task
`B1 — Preserve adapter evidence` (blocked until A7 is explicitly reviewed/approved, per the execution gate above)

---

## Checkpoint A — A7 review hardening — COMPLETE

- Branch: `feat/preference-first-selection`
- Base A7 implementation: `d3f7a119a631cd31e74f370b211d3cad8368fb6e`
- Review-fix implementation commit: `871748ad907a51bc60db1e9435ed4d55732145c7`
- Scope: `be/src/modules/tours/utils/exploration-signals.util.ts` +
  `.spec.ts` only, `computeExplicitEvidenceSignal()` (the function
  backing `tourismIntensity`/`localCharacter`)
- Status: COMPLETE

### Review blocker fixed

Three issues in `computeExplicitEvidenceSignal()`'s normalization of
`explicitTourismIntensityEvidence` / `explicitLocalCharacterEvidence`:

1. **Malformed runtime payload could throw.** The old code assumed
   `entries` always matched its compile-time array type
   (`(entries ?? []).filter(...)`). A caller bypassing TypeScript (an
   `as any` cast, or genuinely malformed external metadata) passing
   `{}`, `'bad'`, `42`, etc. crashed with `TypeError: ...filter is not a
   function` -- confirmed live before the fix (see Verification).
2. **Evidence without provenance was accepted.** `{strength: 0.9}` (no
   `source`/`evidenceKey`), or an entry with an empty or
   whitespace-only `source`/`evidenceKey`, was previously accepted as
   valid grounded evidence.
3. **Duplicate claims inflated confidence.** Three identical `(source,
   evidenceKey)` entries counted as three independent corroborating
   claims toward `confidence`, rather than one.

### Fix

- `entries` is now treated as fully runtime-unknown inside
  `computeExplicitEvidenceSignal` (`Array.isArray(entries) ? entries :
  []`) -- the public `ExplorationSignalInput` interface's typed array
  fields are unchanged; only the internal parameter type became
  `unknown`.
- New `normalizeExplicitEvidenceEntry()`: an entry is valid grounded
  evidence only when **all** of:
  - `strength` is finite and in `0..1`;
  - `source` is a string, non-empty after `.trim()`;
  - `evidenceKey` is a string, non-empty after `.trim()`.
  No synthetic `"unknown"` source/key is ever substituted -- missing
  provenance means the entry is dropped entirely, not degraded-but-kept.
  Valid entries carry their **trimmed** `source`/`evidenceKey` forward
  into the final `evidence` output.
- New `dedupeExplicitEvidenceEntries()`, keyed by `(trimmed source,
  trimmed evidenceKey)`, runs **before** the aggregate value and
  confidence are computed. **Duplicate policy (documented inline in the
  code):** for conflicting duplicate strengths on the same claim, keep
  the strongest valid value -- not an average, since repeated reports of
  the same claim are not independent corroboration.
- `EXPLICIT_EVIDENCE_CONFIDENCE_DIVISOR = 3` is now a named constant
  (previously an inline magic `3`); the formula shape itself
  (`deduped.length / divisor`, clamped 0..1) is unchanged.

### Files changed
- `be/src/modules/tours/utils/exploration-signals.util.ts`
- `be/src/modules/tours/utils/exploration-signals.util.spec.ts`

### Verification
- RED check: added all new hardening tests against the pre-fix
  implementation → **22 failures**, including a literal
  `TypeError: (intermediate value)(intermediate value)(intermediate
  value).filter is not a function` at
  `computeExplicitEvidenceSignal (exploration-signals.util.ts:241:40)`
  for the non-array-payload case -- confirming the exact crash the
  review described, not a hypothetical. Implemented the fix, reran →
  all green.
- `cd be && yarn test src/modules/tours/utils/exploration-signals.util.spec.ts`
  → PASS — **60/60** (20 pre-existing, unmodified + 40 new hardening
  tests, parameterized via `describe.each` over both
  `explicitTourismIntensityEvidence` and
  `explicitLocalCharacterEvidence`):
  - non-array payloads (`{}`, `'bad'`, `42`) never throw, degrade to
    `value: null` / `confidence: 0` / `evidence: []`;
  - malformed entries (`null`, `undefined`, `{}`, `{strength: 0.8}` with
    no provenance, empty or whitespace-only `source`/`evidenceKey`) are
    all ignored;
  - invalid strengths (`NaN`, `Infinity`, `-Infinity`, `-0.1`, `1.1`)
    are ignored without throwing or inventing a score;
  - `source`/`evidenceKey` are trimmed into normalized provenance
    (`'  wikivoyage '` / `' local_market '` → `'wikivoyage'` /
    `'local_market'` exactly);
  - three identical-claim duplicates collapse into exactly one evidence
    entry, with `confidence` and `value` equal to the single-entry case;
  - conflicting duplicate strengths (`0.3`, `0.9`, `0.5`) for the same
    claim keep the strongest (`0.9`), not the average;
  - three genuinely distinct claims raise `confidence` above a single
    claim's.
- `cd be && yarn typecheck` → PASS — no errors.
- `cd be && npx eslint <the 2 files>` → PASS — 0 problems (16
  prettier-only formatting errors surfaced on first run, fixed with
  `--fix`, re-verified tests/typecheck stayed green).
- `cd be && yarn test src/modules/tours` → PASS — 84 test suites / 814
  tests (up from 774 -- the 40 new tests; no regressions elsewhere).
- Real Postgres/integration was correctly NOT touched or needed for this
  fix (pure-utility scope, per plan A7.9's architectural boundary,
  unchanged).

### Confirmations requested
- **`unknown != zero` unchanged**: with no explicit grounded evidence,
  `tourismIntensity.value === null` / `localCharacter.value === null`,
  never coerced to `0` -- unchanged, still directly tested.
- **Malformed evidence never throws**: confirmed by the RED-then-GREEN
  cycle above, including the literal pre-fix `TypeError` this task
  reproduced and then eliminated.
- **No semantic change to A7's architecture**: prominence formulas
  (`REVIEW_COUNT_WEIGHT`, `SITELINK_WEIGHT`, saturation caps, modest
  boolean bonuses) and `computeExplorationTilt` (`iconic`/
  `local_deep_dive`/`balanced` semantics, including "prominence never
  contributes to `local_deep_dive`") are byte-for-byte unchanged; only
  `computeExplicitEvidenceSignal`'s input normalization was hardened.
  No inference of `tourismIntensity`/`localCharacter` from prominence,
  review count, or obscurity was introduced or removed -- that
  invariant was never in scope for this fix and remains intact.
- **B1 NOT started**: no files outside
  `exploration-signals.util.ts`/`.spec.ts` and this progress doc were
  touched.

### Deviations from plan
- None. All items from the review (non-array payload safety, provenance
  validation, trimming, deduplication with a documented conflict
  policy) were implemented as specified.

### Decisions taken
- Chose `(trimmed source, trimmed evidenceKey)` string concatenation
  with a space separator as the deduplication map key (both components
  are already validated non-empty trimmed strings at that point, so no
  ambiguous-boundary collision is possible in practice for this input
  shape).
- Kept `isValidStrength` (already existing, used elsewhere for
  prominence's own internal checks is not applicable there, but the
  function itself was already shared/exported-internally) reused as-is
  for the per-entry strength check, rather than writing a second
  strength validator -- one canonical strength-validity predicate.

### Open issues / debt
- None new. Same open items as A7's own entry (tilt not yet wired into
  composition; `tourismIntensity`/`localCharacter` remain structurally
  unused until later agentic/research evidence exists) -- unaffected by
  this fix.
- Same worktree note: this fix ran concurrently with the same other
  session/agent continuing frontend/mobile work (two more local commits,
  `3e4289c` and `36f46cb`, landed on this branch during this task,
  entirely unrelated to `exploration-signals.util.ts`). Neither was
  touched, inspected further, or altered -- only the 2 files above were
  staged for this task's commit. The working tree was fully clean
  (nothing uncommitted) by the time this task's commit was pushed.

### Next task
`B1 — Preserve adapter evidence` (blocked until A7, as hardened by this fix, is explicitly reviewed/approved, per the execution gate above)

---

## Checkpoint B — Task B1 — COMPLETE

- Branch: `feat/preference-first-selection`
- Base commit: `0d9d4e795d2d1605c30e28c2156a604ba9d1005a`
- Implementation commit: `e0fbb6ec10c6e702b278b19f7a18db513d6db2b2`
- Plan task: `B1 — Preserve adapter evidence`
- Status: COMPLETE

### Implemented
Investigated all three adapters before changing anything and found the
same pattern each time: a field was either already computed/available
and silently dropped before reaching `SourceObservation`, or declared on
a type but never actually requested from the provider. No new
invariant was added or changed — the generic operational
food/nightlife-venue admission rule in `GooglePlacesAcquisitionProvider`
is untouched.

- **OSM** (`osm-acquisition.provider.ts`): `OsmCandidate.narrativeContext`
  already existed on the type (documented as populated "when the
  candidate carries a `wikidata` tag and Wikidata content passes a
  content-safety check" — that population path does not exist anywhere
  in the codebase yet, confirmed by a repo-wide grep; out of scope for
  B1, which is about not dropping evidence, not building new provider
  wiring), but the acquisition provider's metadata block never forwarded
  it even when present. Added
  `narrativeContext: candidate.narrativeContext || undefined`. Full OSM
  tags were already preserved via the existing `osmTags: candidate.tags`
  — confirmed, no change needed.
- **Wikivoyage** (`wikivoyage-acquisition.provider.ts`):
  `entry.sectionType` and `entry.templateName` were already computed and
  used internally to build `evidenceKey`/`evidenceType`, but discarded
  before reaching the returned `SourceObservation`. Added
  `metadata: { sectionType, templateName }`.
- **Google Places** — three related fixes:
  1. `places-api.interface.ts`: added `editorialSummary` and
     `primaryTypeDisplayName` (`{text, languageCode?}`, matching
     `displayName`'s existing shape) to `PlaceData`.
  2. `google-places-api.service.ts`: `getFieldMask()` was missing
     `places.websiteUri` entirely — `mapResponse()` already tried to map
     `p.websiteUri`, so it was silently always `undefined` from
     `searchNearby`/`searchText` (only the separate `getPlaceDetails`
     call ever actually requested it). Added `places.websiteUri`,
     `places.editorialSummary`, `places.primaryTypeDisplayName` to the
     field mask, and mapped the latter two in `mapResponse()`.
  3. `google-places-acquisition.provider.ts`: added `websiteUri`,
     `priceLevel`, `businessStatus` (already on `PlaceData`, never
     forwarded to the observation) plus `editorialSummary`/
     `primaryTypeDisplayName` (flattened to `.text`, same convention as
     `title` deriving from `displayName.text`) to the observation's
     metadata. `rating`/`userRatingCount`/`types` were already preserved.
  - Geoapify (`geoapify-places-api.service.ts`, the alternative
    `IPlacesApiService` implementation) was deliberately **not** touched:
    B1 names Google Places specifically, and Geoapify's current minimal
    property parsing has no equivalent source data for the new fields —
    they honestly stay `undefined` for that provider (never fabricated)
    rather than inventing a Geoapify-side mapping nobody asked for.

### Files changed
- `be/src/modules/integrations/google-places/interfaces/places-api.interface.ts`
- `be/src/modules/integrations/google-places/services/google-places-api.service.ts`
- `be/src/modules/integrations/google-places/services/google-places-api.service.spec.ts`
- `be/src/modules/tours/providers/google-places-acquisition.provider.ts`
- `be/src/modules/tours/providers/google-places-acquisition.provider.spec.ts`
- `be/src/modules/tours/providers/osm-acquisition.provider.ts`
- `be/src/modules/tours/providers/osm-acquisition.provider.spec.ts`
- `be/src/modules/tours/providers/wikivoyage-acquisition.provider.ts`
- `be/src/modules/tours/providers/wikivoyage-acquisition.provider.spec.ts`

### Verification
- RED check: ran all 4 spec files before implementing → all failed for
  the expected reasons: Wikivoyage's two pre-existing full-object
  `toEqual` fixtures missing the new `metadata` key; the new dedicated
  Wikivoyage/OSM tests asserting `metadata` fields that didn't exist yet
  (`received: undefined`); Google Places API service test asserting a
  field mask/mapped fields that weren't there; the Google Places
  acquisition provider spec **failed to compile** (`TS2353: Object
  literal may only specify known properties, and 'editorialSummary' does
  not exist in type 'PlaceData'`) until the interface fields were added.
  Implemented the fix, reran → all green.
- `cd be && yarn test <the 4 spec files>` → PASS — **52/52** (existing
  tests updated in place to include the newly-preserved fields, plus one
  new dedicated test per adapter/field-group):
  - OSM: a candidate carrying `narrativeContext` has it appear in the
    observation's `metadata.narrativeContext`; the pre-existing
    exact-`metadata` test (candidate with no `narrativeContext`) stays
    green unmodified since Jest's `toEqual` treats an `undefined`-valued
    key as equivalent to absent.
  - Wikivoyage: both pre-existing full-`toEqual` fixtures (SEE/DO
    entries) now include the exact expected `metadata: {sectionType,
    templateName}`; one new dedicated test confirms this independent of
    those broader fixtures.
  - Google Places API service: a new test confirms the field mask sent
    to Google contains `places.websiteUri`/`places.editorialSummary`/
    `places.primaryTypeDisplayName`, and that a mock response containing
    those three fields maps them onto the returned `PlaceData` correctly.
  - Google Places acquisition provider: a new test confirms
    `websiteUri`/`priceLevel`/`businessStatus`/`editorialSummary`/
    `primaryTypeDisplayName` all reach the observation's metadata
    (with the latter two flattened to `.text`); the pre-existing
    `Object.keys(obs.metadata).sort()` exact-key-list regression test
    (which explicitly proves "only factual metadata is carried through,
    no semantic/preference fields leak in") was updated to include the 5
    new keys, since `Object.keys()` — unlike `toEqual` — lists a key even
    when its value is `undefined`.
- `cd be && yarn typecheck` → PASS — no errors.
- `cd be && npx eslint <all 9 files>` → PASS — 0 problems, no `--fix`
  needed.
- `cd be && yarn test src/modules/tours src/modules/integrations` → PASS
  — 108 test suites / 1004 tests, no regressions.
- `cd be && yarn test:integration` (full suite, real Postgres) → PASS —
  12 test suites / 26 tests, unchanged, no regressions.

### Deviations from plan
- None. All three adapters' required fields are preserved exactly as
  the plan names them (OSM `narrativeContext` + full tags; Wikivoyage
  `sectionType` + `templateName`; Google Places
  `editorialSummary`/`websiteUri`/`priceLevel`/`businessStatus`/
  rating-count/types/`primaryTypeDisplayName`).

### Decisions taken
- Fixed the Google Places field-mask omission for `websiteUri` (it was
  being "mapped" in code but never actually requested from the API, so
  the mapping was dead code for `searchNearby`/`searchText`) as part of
  this task rather than treating it as a separate issue — B1 explicitly
  requires "preserve websiteUri", and preservation is meaningless if the
  field is never fetched in the first place. This is a direct
  consequence of the task's own stated goal, not a scope expansion.
- Did not implement the OSM `narrativeContext` Wikidata-content-safety
  population pipeline described in that field's own doc comment (a
  `wikidata`-tag lookup + `filterSafeWikidataExtracts` content-safety
  check, which exists as a utility but is wired into nothing). B1's
  literal scope is "preserve ... as structured metadata when present" —
  preserving a field through a mapping boundary is a different, much
  smaller task than building the (currently entirely unbuilt) provider
  pipeline that would populate it. Building that pipeline was not asked
  for and would be a real architectural addition (a new Wikidata
  dependency injected into `OsmPlacesService`, an async `toCandidate`,
  batched content-safety calls) — flagged here rather than done
  unilaterally.
- Left Geoapify's `IPlacesApiService` implementation untouched (see
  Implemented section) since B1 names Google Places specifically and
  Geoapify has no equivalent source data for the new fields today.

### Open issues / debt
- `OsmCandidate.narrativeContext` remains structurally unpopulated by
  any real code path (see Decisions above) — this is pre-existing debt
  from an earlier, unrelated "Fase 3" plan, not introduced or worsened by
  B1. The acquisition-provider-level preservation added here means that
  whenever that pipeline is eventually built, its output will correctly
  flow through to `SourceObservation` without a second fix.
- Same worktree note: no concurrent commits landed on this branch while
  this task was in progress (checked via `git log
  <base>..fork/feat/preference-first-selection` immediately before
  committing and again before pushing — both empty).

### Next task
`B2 — Evidence-only classifier + trait guard`

---

## Checkpoint B — Task B1 review fix — effective Places provenance — VERIFIED (already implemented)

- Branch: `feat/preference-first-selection`
- Fix implementation commit (already on remote when this review started):
  `b8cd292328aff727f9ac0f2c0fce299520d59239`
- Verified against remote HEAD: `b8cd292328aff727f9ac0f2c0fce299520d59239`
  (one commit past the reviewer's last-known
  `1366e15c3aca55ee11bf3320f6e0bd3d6eb8c295` — an unrelated Places
  cost-control correction chain, see
  `docs/superpowers/progress/2026-09-12-b1-places-cost-control-correction.md`,
  landed in between and is untouched by this review)
- Status: **VERIFIED CORRECT, no further code change required**

### Bug this fix addresses
`GooglePlacesAcquisitionProvider` consumes the provider-neutral
`IPlacesApiService` abstraction (which may be backed by either the real
Google Places adapter or the Geoapify adapter), but previously
hardcoded `provider: 'google_places'` and
`evidenceKey: \`google_places:${placeId}\`` on every observation
regardless of which backend actually produced the result. A
Geoapify-sourced observation could therefore be persisted/exposed with
`provider: 'google_places'` evidence provenance, breaking traceability.

### Fix (already applied, reviewed here)
- `experience-acquisition.interface.ts`: added `'geoapify'` to the
  `ExperienceAcquisitionProvider` union.
- `google-places-acquisition.provider.ts`: each search result now
  carries its own effective `result.provenance.provider` (`'google' |
  'geoapify'`) alongside the `PlaceData` (`PlaceWithProvider`), and a
  small explicit lookup map
  (`ACQUISITION_PROVIDER_BY_PLACES_PROVIDER = { google: 'google_places',
  geoapify: 'geoapify' }`) derives the observation's `provider` and
  `evidenceKey` prefix from that effective identity instead of a
  hardcoded literal. No heuristics on result shape/fields — exactly the
  "abstraction transports provider identity explicitly" approach asked
  for.
- New `google-places-acquisition.provider.provenance.spec.ts` (125
  lines): Google-backed result → `provider: 'google_places'`; Geoapify-
  backed result → `provider: 'geoapify'`, `evidenceKey` contains
  `'geoapify'` and never `'google'`, and all B1-preserved evidence
  fields (`rating`, `userRatingCount`, `primaryType`, `types`,
  `openingHoursWeekdayText`, `websiteUri`, `priceLevel`,
  `businessStatus`, `editorialSummary`, `primaryTypeDisplayName`) still
  reach `metadata` unchanged; graceful failure (`status: 'failed'`) is
  preserved for whichever provider is effectively backing the call.

### This review's own verification
Re-derived the bug/fix from the actual current code (not from prior
progress docs) before trusting anything: read
`google-places-acquisition.provider.ts`, its new provenance spec,
`IPlacesApiService`/`PlacesProvider`/`PlaceData`, both concrete
implementations (`google-places-api.service.ts`,
`geoapify-places-api.service.ts`), and
`ExperienceAcquisitionProvider`/`SourceObservation`. Confirmed the fix
matches the described root cause and required behavior exactly.

Ran (all green, no code change made — the fix was already correct):
- `yarn test src/modules/tours/providers/google-places-acquisition.provider.provenance.spec.ts src/modules/tours/providers/google-places-acquisition.provider.spec.ts --runInBand`
  → PASS — 20/20.
- `yarn test src/modules/tours --runInBand` → PASS — 85 suites / 820 tests.
- `yarn test src/modules/integrations --runInBand` → PASS — 24 suites / 187 tests.
- `yarn test --runInBand` (entire backend unit suite) → PASS — 132
  suites / 1138 tests.
- `yarn test:integration` (real Postgres) → PASS — 12 suites / 26 tests.
- `yarn test:acceptance` → PASS — 20 suites / 30 tests.
- `yarn typecheck` → PASS — no errors.
- `yarn lint:check` → PASS — no errors.
- `yarn test:characterization` → **2 suites / 8 tests fail**, but for a
  reason entirely unrelated to this fix:
  `test/characterization/provider-order-convergence.db.characterization-spec.ts`
  and `.../catalog-roundtrip.db.characterization-spec.ts` both call
  `assertDisposableDatabase` (`test/support/assert-disposable-database.ts`,
  a pre-existing, deliberate, documented safety guard — see that file's
  own header comment and
  `docs/superpowers/plans/2026-09-09-database-pool-hardening-and-observability.md`)
  before their `TRUNCATE`, which throws
  `"Refusing to TRUNCATE a database that is not provably disposable
  (localhost:5432/zigzag)..."` because the local `.env`'s `DATABASE_URL`
  points at a plain `zigzag` database name (not `*_test`/`*_e2e`/etc.)
  and `ALLOW_DESTRUCTIVE_TEST_DB` is unset. This throws in test setup
  before any provider/provenance code runs, so it fails identically
  regardless of the Places/Geoapify fix — confirmed by inspecting the
  guard's own source, which checks only the database name / an env
  flag. Not touched or bypassed (setting `ALLOW_DESTRUCTIVE_TEST_DB=1`
  is exactly the kind of destructive-action authorization this task
  did not ask for and this guard exists specifically to prevent
  un-authorized).

### Deviations from plan
- None. No code change was needed this session — the fix requested was
  already implemented and pushed (by a prior session/agent) before this
  review began, and it is correct.

### Confirmations requested
- **Concurrent changes**: yes — between the reviewer's last-known SHA
  (`1366e15`) and this review's start, one unrelated fix chain (Places
  provider cost-control: `fe562c2`, `75f414c`, `dadaa80`, `882f369`) plus
  its own progress doc (`1366e15`) landed, followed by the provenance
  fix itself (`b8cd292`). All were already on the remote before this
  review touched anything; none were overwritten.
- **B2 NOT started**: confirmed — only this progress doc was modified
  by this review.

### Next task
`B2 — Evidence-only classifier + trait guard`
