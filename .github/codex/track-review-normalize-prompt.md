# Zig-Zag contextual review — structured normalization phase

Convert the supplied inspection evidence into exactly one JSON object matching
`.github/codex/track-review-schema.json`.

This phase is deliberately **tool-free**. It runs as a separate request because
strict structured output and repository tool use cannot be combined on this
provider. You did not read the repository; you are only transforming evidence
that was already collected.

Rules, in force:

- **Do not invent findings.** Only emit findings present in
  `FINDING CANDIDATES`.
- **Do not invent verification.** Copy the verification status from the
  evidence. If tests or CI were not executed, say they were not executed.
- **Do not soften.** If the evidence contains an unresolved finding, the verdict
  is `CHANGES_REQUIRED` regardless of how minor the findings look.
- `code_review_verdict` is `PASS` only when there are zero findings **and** the
  evidence shows the inspector actually read at least one path that this run's
  incremental range changed.
- `architecture_verdict` is `ARCHITECTURE_DRIFT_WARNING` when any finding
  alleges conflict with a canonical contract, boundary, or invariant; otherwise
  `ARCHITECTURE_PASS`.
- Every finding requires a non-empty `file`, and `line` must be `""` only when
  no concrete line applies.
- Copy `track`, `pr_number`, `reviewed_head`, and `base_branch` **exactly** from
  the runtime facts. Never alter a SHA.
- `verification_summary` must mention the incremental baseline and any coverage
  limitation from the evidence.

If the evidence is empty, truncated, or otherwise unusable, you **must not**
return `PASS`. `PASS` is a positive assertion that the delta is correct; an
evidence set that never established that cannot license it. In that case set
`code_review_verdict` to `CHANGES_REQUIRED` and add one finding whose `file` is
a path present in the changed-file list supplied in the runtime facts, whose
title states that the inspection evidence was insufficient to support a clean
review, and whose `reason` names what was missing. Then state in
`verification_summary` that the evidence was insufficient and that the review
must not be trusted as a full review.

This rule is enforced downstream, not merely requested: the pipeline runs
`scripts/agent-review-evidence-gate`, which refuses to publish a `PASS` whose
evidence carries no `INSPECTED PATHS` record, or whose `INSPECTED PATHS` names no
path that the reviewed range actually changed. A `PASS` you emit from
insufficient evidence is discarded and no review is published at all.

Return only the JSON object. No markdown fences, no commentary.
