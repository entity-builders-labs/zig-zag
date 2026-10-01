# Agent Collaboration Foundation — Execution Plan

## Goal

Provide a checkout-local, tool-neutral collaboration contract so agents can
resume an active track, detect real branch overlap, and validate PR lineage
without a second project-management registry.

## Acceptance

- Progress documents declare explicit active-track identity and plan linkage.
- `scripts/agent-track` lists tracks and reports concise current-track context.
- A fresh agent can reconstruct the current checkpoint, next authorized action,
  and unresolved blockers/findings from canonical progress state without a
  manually rebuilt chat prompt.
- `scripts/agent-preflight` validates local write safety separately from
  integration readiness, alongside the same contract, lineage, and actual
  changed-file overlap.
- PR/CI use preflight as the single deterministic governance policy.
- Architecture review has a documented warning contract; it is not bash CI.
- Detailed review fixes remain anchored to the PR/reviewed HEAD rather than
  becoming another repository workflow registry.

## Durable resume contract

The progress document owns only the execution delta needed to resume:

- current execution verdict;
- current checkpoint/gate;
- next bounded authorized action;
- unresolved blockers/findings.

The plan continues to own intended gates and acceptance. It does not need to
enumerate every implementation step.

Track identity remains owned by that track's progress document and branch. A
legacy/pre-governance track gains its header through a metadata-only commit on
its own branch; no foreign branch may patch its progress document for
discoverability. Registered worktrees and fetched refs remain the discovery
sources, with no registry, alias, branch-name inference, fallback, or duplicate
metadata.

A blocker/finding changing does not create a new milestone. The stable
checkpoint remains active until its acceptance condition is satisfied:

```text
checkpoint
  -> blocker
  -> bounded fix
  -> rerun verification
  -> next blocker, if any
```

`scripts/agent-track context` surfaces this state. It does not invent the next
action from branch names or prose elsewhere.

## Review handoff contract

PR review is the integration/review boundary. When changes are required, the
reviewer may emit a compact Fix Brief containing:

```text
track
reviewed_head
progress / plan context
finding IDs
required fixes
forbidden scope expansion
verification
```

That brief is a delta for the coder, not a replacement project prompt.

Review feedback stays tied to the reviewed PR/HEAD. Do not commit detailed
review output into the reviewed branch merely to persist the review, because
that would change HEAD and immediately stale the review anchor.

No autonomous reviewer->coder->review loop is authorized by this plan. Human
merge/control remains explicit.

## Branch/worktree selection

Git worktrees remain the isolation authority.

Shell governance should expose facts and registered worktree locations, not hide
destructive Git operations. Automatic checkout switching is not required for
this foundation. A future agent skill may use `agent-track` facts to select/open
the correct registered worktree, then run context + preflight there.

`agent-track locate <id>` resolves one ACTIVE discovered track by ID and reports
its branch, worktree registration, progress, and plan. It is discovery only:
the agent—not the shell primitive—selects/opens the registered worktree before
continuing with context and preflight.

Preflight has two independent results. Local execution blocks writes only for
an unsafe or invalid current checkout; an integration merge conflict remains
visible as **INTEGRATION BLOCKED** while isolated work may continue. CI runs
the same primitive with `--ci`, where integration readiness is enforced as a
hard failure.

## Agent resume skill design

### Purpose and packaging

The single proposed skill is `resume-track`. Its standard Agent Skills header
will use this exact description:

```text
Resume an already-authorized Zig-Zag work track from durable repository,
Git, progress, plan, preflight, and optional PR-review context. Use for
"continue the work", "resume this track", "continúa con el trabajo",
"seguí con governance", or "retomá Preference-First".
```

The canonical, repository-owned source will be
`.agents/skills/resume-track/SKILL.md`. It must be a regular tracked directory,
not an absolute link into a developer home. The existing absolute third-party
skill links do not establish a portability convention for this skill.

The initial checkpoint adds no speculative client-specific copy. If a supported
client demonstrably requires another discovery directory, its entry must be a
thin **relative** symlink to `.agents/skills/resume-track`, with no copied
instructions. `CLAUDE.md`, `AGENTS.md`, and client configuration remain
repository guidance/configuration only; none becomes a duplicate resume
workflow or authority.

### Selection and worktree flow

The skill is a composition module: its interface is a human resume request and
its result is either one safe, bounded continuation or an explicit stop report.
It owns neither track state nor Git selection state.

1. Classify the request only as unnamed or named. Natural-language matching is
   agent-layer interpretation, never a field added to the track header.
2. For an unnamed request, run `scripts/agent-track context` in the caller's
   current checkout first. If it resolves exactly one ACTIVE current track, use
   that result. Otherwise run `scripts/agent-track list` to discover ACTIVE
   tracks; continue automatically only if discovery leaves exactly one plausible
   intended track. Never recover a track from chat memory or a branch-name guess.
3. For a named request, run `scripts/agent-track list`; match the human phrase
   against only the discovered ACTIVE IDs and branches. Zero matches or more
   than one plausible match stops for a concise clarification. Once one exact
   ID is selected, run `scripts/agent-track locate <exact-id>`.
4. Treat `locate` as the deterministic authority for branch, declared progress,
   plan, integration target, base snapshot, and registered worktree. If it
   reports duplicate/unavailable identity, stop. If `Worktree: <not registered>`
   appears, report the selected track and branch and stop: this first skill does
   not create, remove, switch, or register worktrees.
5. When a registered worktree is returned, make it the working directory for
   every subsequent repository command. Do not alter the caller checkout and do
   not run `git checkout`, `git switch`, `git reset`, `git rebase`, `git merge`,
   or `git worktree add/remove` merely to resume.
6. In that located worktree run `scripts/agent-track context`. Its identity
   fields must agree with `locate` (track, branch, progress, plan, integration,
   and base). Any disagreement is an authority/checkout inconsistency: stop and
   report both outputs rather than selecting one.

### Context and review reconstruction

After matching `context`, read `AGENTS.md`, the referenced progress and plan,
and every architecture/spec document that `AGENTS.md` makes mandatory for the
next authorized action's affected area. Reconstruct and present at least:

```text
track, branch, worktree, integration target, base snapshot,
current checkpoint, next authorized action, open blockers/findings
```

GitHub lookup is optional and read-only. When access is available, use the
located track branch to find its open PR, then obtain unresolved review
threads/findings and any current Fix Brief. A Fix Brief is a PR/review artifact,
not execution state, and conceptually contains:

```text
track, reviewed_head, progress/plan context, finding IDs, required fixes,
forbidden scope expansion, verification
```

It is current only when `reviewed_head == current track HEAD`. Otherwise it is
stale context that must not be executed blindly. A current review directive may
constrain or correct work within canonical progress/plan scope; it cannot
silently override product or architecture decisions. A material disagreement
between Fix Brief and canonical progress/plan stops for human resolution. Lack
of GitHub access is reported as unavailable review context and does not block
the canonical repository resume path.

### Preflight and bounded execution

After reconstruction, run `bash scripts/agent-preflight` in the located
worktree without weakening its checks.

- `WRITE BLOCKED`: stop; report the hard failures and make no writes.
- `WRITE AUTHORIZED` + `INTEGRATION READY`: execute only the current already-
  authorized action, subject to the boundaries below.
- `WRITE AUTHORIZED` + `INTEGRATION BLOCKED`: isolated non-integration work in
  the current checkpoint may proceed; merging, rebasing, conflict resolution,
  and any integration action remain stopped.

One invocation may work through the current checkpoint's blocker, a bounded
fix, required verification, and another blocker that is still inside the same
checkpoint. It must not automatically cross an explicit human approval gate, a
new unauthorized milestone, blocked integration, an architecture/product choice
requiring judgment, or any scope expansion. It is a resume workflow, not a
workflow engine or autonomous reviewer-coder-review loop.

### Required stop reports

The implementation must make these cases explicit rather than guessing:

| Condition | Resume result |
| --- | --- |
| One valid ACTIVE current track | Continue through its registered worktree path. |
| Named ACTIVE track in another registered worktree | Use that worktree for all subsequent commands; leave caller untouched. |
| Named track has no registered worktree | Report the track/branch and request/register a worktree outside this skill. |
| No ACTIVE phrase match | Report no matching ACTIVE track and list available IDs. |
| Ambiguous phrase or duplicate ACTIVE ID from `locate` | Report candidates/duplicate identity and request disambiguation. |
| `context` conflicts with `locate` | Stop as an authority/checkout inconsistency. |
| `WRITE BLOCKED` | Stop before writes. |
| Integration blocked after write authorization | Permit only isolated checkpoint work; prohibit integration. |
| Valid Fix Brief for current HEAD | Apply only its in-scope required fixes. |
| Stale Fix Brief | Surface it as stale; do not execute it. |
| Review conflicts with canonical plan/progress | Stop for human resolution. |
| GitHub/review unavailable | Continue from canonical local authorities and report review context unavailable. |

This creates no registry or parallel authority: progress still declares track
identity and execution state; plan/specs own acceptance and architecture; Git
owns refs, worktrees, and diffs; PR/review owns review artifacts; `agent-track`
and preflight own deterministic facts and safety. The skill only orders their
existing interfaces and persists nothing.

### Next implementation checkpoint

Implement only the designed composition and its focused contract tests:

```text
.agents/skills/resume-track/SKILL.md
scripts/agent-governance.spec.sh
docs/superpowers/plans/2026-09-30-agent-collaboration-foundation-plan.md
docs/superpowers/progress/2026-09-30-agent-collaboration-foundation-progress.md
```

Add a relative client-discovery adapter only when a supported client test proves
that `.agents/skills` is insufficient; no product/RW4 files are in scope.

## Out of scope

No autonomous reviewer/coder loop, GitHub Projects/Issues synchronization,
rulesets, product behavior, manually maintained scope registry, or hidden
destructive branch switching.
