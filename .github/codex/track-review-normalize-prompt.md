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
- `code_review_verdict` is `PASS` only when there are zero findings.
- `architecture_verdict` is `ARCHITECTURE_DRIFT_WARNING` when any finding
  alleges conflict with a canonical contract, boundary, or invariant; otherwise
  `ARCHITECTURE_PASS`.
- Every finding requires a non-empty `file`, and `line` must be `""` only when
  no concrete line applies.
- Copy `track`, `pr_number`, `reviewed_head`, and `base_branch` **exactly** from
  the runtime facts. Never alter a SHA.
- `verification_summary` must mention the incremental baseline and any coverage
  limitation from the evidence.

If the evidence is empty or unusable, return `findings: []`, set
`code_review_verdict` to `PASS` only if there is genuinely nothing to flag, and
state in `verification_summary` that the evidence was insufficient and the
review should not be trusted as a full review.

Return only the JSON object. No markdown fences, no commentary.
