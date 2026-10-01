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
