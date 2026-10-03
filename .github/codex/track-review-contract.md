# Zig-Zag contextual review artifact contract

The pull-request review artifact is the authority for contextual review state.
Its body begins with this exact marker shape:

```html
<!-- zig-zag-contextual-review
track=<track-id>
reviewed_head=<40-character-pr-head-sha>
-->
```

`CURRENT` means one valid marker for the current PR has
`reviewed_head == current PR HEAD`. Otherwise the review is `STALE`. Historical
markers remain historical evidence and are never edited to appear current.

The review body then presents the structured fields defined by
`track-review-schema.json`. Track progress metadata never records review
status, reviewed heads, or verdicts.

## Canonical authenticity rules

A review is canonical only when all of the following hold:

1. The review author is `github-actions[bot]` (the workflow publisher).
2. The review state is an eligible GitHub state (`COMMENTED`, `APPROVED`, or
   `CHANGES_REQUESTED`).
3. The review body contains the exact marker with `track` and `reviewed_head`
   matching the current PR context.
4. The review body contains the structured verdict fields (`CODE REVIEW:` and
   `ARCHITECTURE_`).

A copied marker from another author does NOT suppress Codex execution. Only the
canonical workflow publisher may be treated as authoritative.

## Publication binding

The review must be published through the pull-request reviews API with
`commit_id` equal to the exact reviewed SHA and `event` equal to `COMMENT`.
The GitHub review object's `commit_id` must therefore equal the exact reviewed
SHA. Historical reviews become `STALE` when the PR advances because their
`commit_id` differs from the new HEAD.
