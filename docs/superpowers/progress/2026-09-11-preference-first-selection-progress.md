## Checkpoint A — Task A1 — COMPLETE

- Branch: `feat/preference-first-selection`
- HEAD: `97956766dd49181873f8d20bd836bac2febc4e17`
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
