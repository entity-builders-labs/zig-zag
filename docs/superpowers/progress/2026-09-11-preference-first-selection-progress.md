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
