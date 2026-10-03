# Second historical product calibration (Overture) — INCOMPLETE, no verdict

This directory records a **failed** calibration attempt. It contains **no
review verdict and no findings**. It is evidence that the harness fails closed
when the provider cannot finish, not evidence about the reviewed product code.

- Target reviewed product SHA: `f39101726f9abca012575cc47b2102d43b6c9c18`
  (`fix(overture): publish only complete import snapshots`)
- Baseline SHA: `1ceb477de44b3589cbc01b13eac9bf7aa22c98da`
- Declared range: `1ceb477de44b3589cbc01b13eac9bf7aa22c98da..f39101726f9abca012575cc47b2102d43b6c9c18`
- Outcome: `INCOMPLETE` (`inspect_exit=1`)

## Why it is incomplete

The inspection phase was terminated by the provider before the model produced
any assessment. Two provider errors were captured (see `report.md`):

```text
provider.internal   Network connection lost.
provider.rate-limit Rate limit exceeded: free-models-per-day.
```

The OpenRouter free-tier daily request allowance for the pinned free model was
exhausted. Paid fallback and provider substitution are forbidden for this
track, so the attempt was abandoned rather than retried with credits.

## What the transcript does show

The captured transcript proves the attempt was real and bounded, and that the
reviewer was reading the right things before it was cut off. Recompute from
`inspect-transcript.jsonl`:

```bash
jq -r 'select(.type=="tool_use") | .part.tool' inspect-transcript.jsonl | sort | uniq -c
# 17 grep
# 21 read

jq -r 'select(.type=="tool_use" and .part.tool=="read")
       | .part.state.input.filePath // .part.state.input.path // empty' \
  inspect-transcript.jsonl | sort -u | grep -c .
# 16

jq -r 'select(.type=="text")' inspect-transcript.jsonl | grep -c .
# 0   <- no completed assistant text, hence no evidence to normalize
```

`inspect-transcript.jsonl` contains zero `text` events, so there was no prose
to feed the normalizer. Producing a verdict from this transcript would mean
inventing one.

## Evidence-gap note

`evidence-meta.txt` here shows only `checkout_unchanged` and `inspect_exit`,
because it was produced by the harness version that returned from the failure
branch before recording the tool-call audit trail.
`scripts/agent-review-calibration` was corrected on this branch to record that
trail before the failure branch, so future truncated runs stay auditable.
This artifact is left exactly as the run produced it rather than hand-edited.

## Not a canonical review

This is a **historical product calibration**, explicitly **not** a canonical
review of PR #71 and not a CURRENT marker for any pull request. It must never
be cited as a review of the reviewed commit. See
`.github/codex/track-review-contract.md`.
