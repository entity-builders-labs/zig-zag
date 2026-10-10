# B1 review correction — Places provider cost control

Branch: `feat/preference-first-selection`

Context: B1 correctly preserved Google `editorialSummary` in the provider data
shape, but review identified that requesting `places.editorialSummary` in every
Google Nearby/Text Search raises the billing tier of the whole request. The
product also supports a configurable Places provider via `IPlacesApiService`
(Google or Geoapify), so later classification must not depend on a Google-only
field.

## Correction

- Keep `PlaceData.editorialSummary?` and observation metadata support intact.
- Remove `places.editorialSummary` from the baseline Google Nearby/Text Search
  field mask.
- Keep `places.websiteUri` and `places.primaryTypeDisplayName` in the baseline
  Google field mask.
- Preserve the `mapResponse()` mapping for `editorialSummary` so a future
  selective/budgeted enrichment path can carry it when intentionally obtained.
- Add regression assertions that both baseline Nearby Search and Text Search do
  **not** request `places.editorialSummary`.
- Canonicalize the provider-neutral/cost-control policy in
  `docs/superpowers/specs/2026-09-12-places-provider-cost-control-amendment.md`.
- `AGENTS.md` now requires Codex, Claude, and Antigravity to read that amendment
  for Places/acquisition/classification work on this branch.

## Commits

- `fe562c258e1a476959d53dbb9203468a3a7b7f8b` — remove paid editorial summary
  from baseline Google search field mask while retaining mapping support.
- `75f414cb6ba977c22c6974baf6ffbbe52180f420` — regression tests for baseline
  cost tier / optional mapping.
- `dadaa8042f99abcb7e2b63857d8f15468372a872` — provider-neutral cost-control
  amendment.
- `882f36913753f6db017fdf9b2584ed1a52d71abc` — make the amendment mandatory
  agent guidance.

## Verification status

The test contract was updated in-repo, but this correction was applied through
the GitHub connector rather than a local worktree, so no local Jest/typecheck/
lint execution is claimed here. The next coding-agent checkpoint should run at
minimum:

```bash
cd be
yarn test src/modules/integrations/google-places/services/google-places-api.service.spec.ts
yarn typecheck
npx eslint src/modules/integrations/google-places/services/google-places-api.service.ts \
  src/modules/integrations/google-places/services/google-places-api.service.spec.ts
```

B2 remains the next implementation task, with the additional invariant that its
classifier consumes provider-neutral evidence and tolerates Google/Geoapify
provider-specific fields being absent.
