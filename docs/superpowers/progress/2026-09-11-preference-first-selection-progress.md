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
